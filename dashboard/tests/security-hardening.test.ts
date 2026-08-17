import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import nextConfig from "../next.config";
import { GET as getHealth } from "../app/api/health/route";
import { consumeAuthenticationRateLimit } from "../lib/inssa-ops/auth-rate-limit";
import { redactInssaLogLine } from "../lib/inssa-ops/redaction";
import {
  InssaRequestError,
  readBoundedJsonObject,
  readUuid,
  getCanonicalPublicOrigin,
  requireTrustedMutationOrigin
} from "../lib/inssa-ops/request-security";
import { toInssaAuthenticatedUser } from "../lib/inssa-ops/security";
import { refreshInssaSession } from "../lib/inssa-ops/session-refresh";

test("dashboard output redaction removes credential formats", () => {
  const input = [
    "Authorization: Bearer secret-token-value-123456789",
    "Cookie: sessionId=private-session-value",
    "https://staging.inssa.us/capsule?id=1&token=private-share-token",
    '"refreshToken":"private-refresh-token"',
    "eyJaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbb.cccccccccc"
  ].join("\n");
  const output = redactInssaLogLine(input);
  for (const secret of [
    "secret-token-value-123456789",
    "private-session-value",
    "private-share-token",
    "private-refresh-token",
    "eyJaaaaaaaaaaaaaaaaaaaaa"
  ]) {
    assert.equal(output.includes(secret), false);
  }
});

test("users without an assigned platform role are denied by default", () => {
  const previousViewers = process.env.INSSA_OPS_VIEWER_EMAILS;
  delete process.env.INSSA_OPS_VIEWER_EMAILS;
  try {
    assert.equal(toInssaAuthenticatedUser(user({})), null);
    assert.equal(toInssaAuthenticatedUser(user({ inssa_ops_role: "viewer" }))?.role, "viewer");
  } finally {
    restoreEnv("INSSA_OPS_VIEWER_EMAILS", previousViewers);
  }
});

test("configured email allowlists remain a supported role source", () => {
  const previousOperators = process.env.INSSA_OPS_OPERATOR_EMAILS;
  process.env.INSSA_OPS_OPERATOR_EMAILS = "allowed@example.invalid";
  try {
    assert.equal(toInssaAuthenticatedUser(user({}, "allowed@example.invalid"))?.role, "operator");
    assert.equal(toInssaAuthenticatedUser(user({}, "unlisted@example.invalid")), null);
  } finally {
    restoreEnv("INSSA_OPS_OPERATOR_EMAILS", previousOperators);
  }
});

test("mutation origin validation fails closed for missing and untrusted origins", () => {
  const previousOrigin = process.env.INSSA_OPS_PUBLIC_ORIGIN;
  process.env.INSSA_OPS_PUBLIC_ORIGIN = "https://qa.example.invalid";
  try {
    assert.equal(requireTrustedMutationOrigin(request("https://qa.example.invalid/api/runs"))?.status, 403);
    assert.equal(
      requireTrustedMutationOrigin(request("https://qa.example.invalid/api/runs", { origin: "https://evil.example.invalid" }))?.status,
      403
    );
    assert.equal(
      requireTrustedMutationOrigin(request("https://qa.example.invalid/api/runs", { origin: "not an origin" }))?.status,
      403
    );
    assert.equal(
      requireTrustedMutationOrigin(request("https://qa.example.invalid/api/runs", { origin: "https://qa.example.invalid" })),
      null
    );
  } finally {
    restoreEnv("INSSA_OPS_PUBLIC_ORIGIN", previousOrigin);
  }
});

test("JSON request parsing enforces content type, size, and object shape", async () => {
  await assert.rejects(
    readBoundedJsonObject(request("http://localhost/api", { body: "{}", "content-type": "text/plain" }), 64),
    (error: unknown) => error instanceof InssaRequestError && error.status === 415
  );
  await assert.rejects(
    readBoundedJsonObject(request("http://localhost/api", { body: JSON.stringify({ value: "x".repeat(80) }) }), 64),
    (error: unknown) => error instanceof InssaRequestError && error.status === 413
  );
  await assert.rejects(
    readBoundedJsonObject(request("http://localhost/api", { body: "[]" }), 64),
    (error: unknown) => error instanceof InssaRequestError && error.status === 400
  );
});

test("dynamic identifiers reject non-UUID route input", () => {
  assert.throws(() => readUuid("../../etc/passwd", "runId"), (error: unknown) => {
    return error instanceof InssaRequestError && error.status === 400;
  });
  assert.equal(readUuid("11111111-1111-4111-8111-111111111111", "runId"), "11111111-1111-4111-8111-111111111111");
});

test("local authentication throttling persists and blocks repeated attempts", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qa-auth-limits-"));
  const previous = {
    repoRoot: process.env.INSSA_QA_REPO_ROOT,
    serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseUrl: process.env.SUPABASE_URL
  };
  process.env.INSSA_QA_REPO_ROOT = repoRoot;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;

  try {
    const attemptRequest = request("http://localhost/api/auth/password", {
      "x-forwarded-for": "192.0.2.10"
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await consumeAuthenticationRateLimit(attemptRequest, "password", "operator@example.invalid")).allowed, true);
    }
    const blocked = await consumeAuthenticationRateLimit(attemptRequest, "password", "operator@example.invalid");
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds > 0);

    const persisted = await fs.readFile(path.join(repoRoot, "dashboard", ".data", "auth-rate-limits.json"), "utf8");
    assert.equal(persisted.includes("operator@example.invalid"), false);
  } finally {
    restoreEnv("INSSA_QA_REPO_ROOT", previous.repoRoot);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", previous.serviceRole);
    restoreEnv("SUPABASE_URL", previous.supabaseUrl);
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});

test("magic-link throttling blocks repeated delivery attempts independently", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qa-magic-limits-"));
  const previous = {
    repoRoot: process.env.INSSA_QA_REPO_ROOT,
    serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabaseUrl: process.env.SUPABASE_URL
  };
  process.env.INSSA_QA_REPO_ROOT = repoRoot;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;

  try {
    const attemptRequest = request("http://localhost/api/auth/magic-link", {
      "x-forwarded-for": "192.0.2.20"
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      assert.equal((await consumeAuthenticationRateLimit(attemptRequest, "magic-link", "viewer@example.invalid")).allowed, true);
    }
    const blocked = await consumeAuthenticationRateLimit(attemptRequest, "magic-link", "viewer@example.invalid");
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSeconds >= 3_599);
  } finally {
    restoreEnv("INSSA_QA_REPO_ROOT", previous.repoRoot);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", previous.serviceRole);
    restoreEnv("SUPABASE_URL", previous.supabaseUrl);
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});

test("auth redirects use the configured canonical origin rather than request hosts", () => {
  const previousOrigin = process.env.INSSA_OPS_PUBLIC_ORIGIN;
  process.env.INSSA_OPS_PUBLIC_ORIGIN = "https://qa.example.invalid";
  try {
    assert.equal(getCanonicalPublicOrigin(), "https://qa.example.invalid");
  } finally {
    restoreEnv("INSSA_OPS_PUBLIC_ORIGIN", previousOrigin);
  }
});

test("SSR session refresh propagates cookies and cache-control headers", async () => {
  const previous = {
    anon: process.env.SUPABASE_ANON_KEY,
    publicKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    publicUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    url: process.env.SUPABASE_URL
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.example.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";

  try {
    const response = await refreshInssaSession(
      request("http://localhost/runs", { cookie: "existing=value" }),
      ((url: string, key: string, options: Record<string, unknown>) => {
        assert.equal(url, "https://project.example.invalid");
        assert.equal(key, "test-publishable-key");
        const cookies = options.cookies as {
          getAll(): Array<{ name: string; value: string }>;
          setAll(values: Array<{ name: string; options: Record<string, unknown>; value: string }>, headers: Record<string, string>): void;
        };
        assert.equal(cookies.getAll()[0]?.name, "existing");
        return {
          auth: {
            async getClaims() {
              cookies.setAll(
                [{ name: "refreshed", options: { httpOnly: true, path: "/" }, value: "token" }],
                { "cache-control": "private, no-store" }
              );
              return { data: { claims: null }, error: null };
            }
          }
        };
      }) as never
    );
    assert.match(response.headers.get("set-cookie") ?? "", /refreshed=token/);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  } finally {
    restoreEnv("NEXT_PUBLIC_SUPABASE_URL", previous.publicUrl);
    restoreEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", previous.publicKey);
    restoreEnv("SUPABASE_URL", previous.url);
    restoreEnv("SUPABASE_ANON_KEY", previous.anon);
  }
});

test("dashboard responses include the production security header baseline", async () => {
  const rules = await nextConfig.headers?.();
  const headers = new Map(rules?.[0]?.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(headers.get("strict-transport-security") ?? "", /max-age=31536000/);
  assert.ok(headers.has("content-security-policy-report-only"));
});

test("health endpoint is cheap, sanitized, and tied to the dashboard supervisor", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qa-health-"));
  const previousRepoRoot = process.env.INSSA_QA_REPO_ROOT;
  process.env.INSSA_QA_REPO_ROOT = repoRoot;
  try {
    const lockRoot = path.join(repoRoot, "dashboard", ".data", "dashboard-runtime.lock");
    await fs.mkdir(lockRoot, { recursive: true });
    await fs.writeFile(
      path.join(lockRoot, "owner.json"),
      JSON.stringify({ mode: "start", pid: process.pid }),
      "utf8"
    );
    const response = await getHealth();
    const body = await response.json() as Record<string, unknown>;
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(Object.keys(body).sort(), [
      "metadataBackend",
      "status",
      "supervisor",
      "timestamp",
      "uptimeSeconds",
      "web"
    ]);
    assert.equal(JSON.stringify(body).includes(repoRoot), false);
  } finally {
    restoreEnv("INSSA_QA_REPO_ROOT", previousRepoRoot);
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});

function request(url: string, values: Record<string, string> = {}) {
  const { body, ...headers } = values;
  return new NextRequest(url, {
    body,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers
    },
    method: body ? "POST" : "GET"
  });
}

function user(appMetadata: Record<string, unknown>, email = "unassigned@example.invalid") {
  return {
    app_metadata: appMetadata,
    aud: "authenticated",
    created_at: new Date(0).toISOString(),
    email,
    id: "11111111-1111-4111-8111-111111111111",
    user_metadata: {}
  } as User;
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
