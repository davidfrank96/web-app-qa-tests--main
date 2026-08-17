import crypto from "node:crypto";
import fs from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import type { NextRequest } from "next/server";
import { withLocalFileLock } from "./local-file-lock";
import { getLocalAuthRateLimitPath } from "./paths";

export type AuthRateLimitAction = "magic-link" | "password";

type RateLimitPolicy = {
  blockSeconds: number;
  maxAttempts: number;
  scope: "account" | "combined" | "global" | "ip";
  windowSeconds: number;
};

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  resetScopeHashes: string[];
};

type StoredLimit = {
  action: AuthRateLimitAction;
  attemptCount: number;
  blockedUntil: string | null;
  scopeHash: string;
  updatedAt: string;
  windowStartedAt: string;
};

const POLICIES: Record<AuthRateLimitAction, RateLimitPolicy[]> = {
  password: [
    { blockSeconds: 900, maxAttempts: 300, scope: "global", windowSeconds: 300 },
    { blockSeconds: 900, maxAttempts: 30, scope: "ip", windowSeconds: 900 },
    { blockSeconds: 900, maxAttempts: 10, scope: "account", windowSeconds: 900 },
    { blockSeconds: 900, maxAttempts: 5, scope: "combined", windowSeconds: 900 }
  ],
  "magic-link": [
    { blockSeconds: 3600, maxAttempts: 100, scope: "global", windowSeconds: 3600 },
    { blockSeconds: 3600, maxAttempts: 10, scope: "ip", windowSeconds: 3600 },
    { blockSeconds: 3600, maxAttempts: 3, scope: "account", windowSeconds: 3600 },
    { blockSeconds: 3600, maxAttempts: 3, scope: "combined", windowSeconds: 3600 }
  ]
};

export class AuthRateLimitUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRateLimitUnavailableError";
  }
}

export async function consumeAuthenticationRateLimit(
  request: NextRequest,
  action: AuthRateLimitAction,
  normalizedEmail: string
): Promise<RateLimitResult> {
  const sourceIp = readSourceIp(request);
  const resetScopeHashes: string[] = [];
  let retryAfterSeconds = 0;

  for (const policy of POLICIES[action]) {
    const scopeHash = hashScope(scopeValue(policy.scope, sourceIp, normalizedEmail));
    const result = await consumeLimit(action, scopeHash, policy);
    if (policy.scope === "account" || policy.scope === "combined") resetScopeHashes.push(scopeHash);
    if (!result.allowed) retryAfterSeconds = Math.max(retryAfterSeconds, result.retryAfterSeconds);
  }

  return {
    allowed: retryAfterSeconds === 0,
    resetScopeHashes,
    retryAfterSeconds
  };
}

export async function resetSuccessfulPasswordLimits(scopeHashes: string[]) {
  if (scopeHashes.length === 0) return;
  if (hasSupabaseRateLimitConfig()) {
    const query = scopeHashes.join(",");
    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/auth_rate_limits?action=eq.password&scope_hash=in.(${query})`,
      { headers: serviceHeaders(), method: "DELETE" }
    );
    if (!response.ok) throw new AuthRateLimitUnavailableError("Unable to reset authentication rate limits.");
    return;
  }

  await updateLocalLimits((records) => records.filter(
    (record) => record.action !== "password" || !scopeHashes.includes(record.scopeHash)
  ));
}

export function authenticationRateLimitPolicy() {
  return POLICIES;
}

function readSourceIp(request: NextRequest) {
  const candidate = request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",", 1)[0].trim() || "unknown";
  return isIP(candidate) ? candidate : "unknown";
}

function scopeValue(scope: RateLimitPolicy["scope"], sourceIp: string, email: string) {
  if (scope === "global") return "global";
  if (scope === "ip") return `ip:${sourceIp}`;
  if (scope === "account") return `account:${email}`;
  return `combined:${sourceIp}:${email}`;
}

function hashScope(value: string) {
  const secret = process.env.INSSA_AUTH_RATE_LIMIT_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new AuthRateLimitUnavailableError("Authentication rate limiting is not configured.");
    }
    return crypto.createHash("sha256").update(`local:${value}`).digest("hex");
  }
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

async function consumeLimit(action: AuthRateLimitAction, scopeHash: string, policy: RateLimitPolicy) {
  if (hasSupabaseRateLimitConfig()) {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/consume_auth_rate_limit`, {
      body: JSON.stringify({
        p_action: action,
        p_block_seconds: policy.blockSeconds,
        p_max_attempts: policy.maxAttempts,
        p_scope_hash: scopeHash,
        p_window_seconds: policy.windowSeconds
      }),
      headers: { ...serviceHeaders(), "content-type": "application/json" },
      method: "POST"
    });
    if (!response.ok) throw new AuthRateLimitUnavailableError("Authentication rate limiting is unavailable.");
    const payload = await response.json() as Array<{ allowed: boolean; retry_after_seconds: number }>;
    const result = payload[0];
    if (!result) throw new AuthRateLimitUnavailableError("Authentication rate limiting returned an invalid response.");
    return { allowed: result.allowed, retryAfterSeconds: Number(result.retry_after_seconds) || 0 };
  }

  return consumeLocalLimit(action, scopeHash, policy);
}

async function consumeLocalLimit(action: AuthRateLimitAction, scopeHash: string, policy: RateLimitPolicy) {
  let result = { allowed: true, retryAfterSeconds: 0 };
  await updateLocalLimits((records) => {
    const now = Date.now();
    const index = records.findIndex((record) => record.action === action && record.scopeHash === scopeHash);
    const existing = index >= 0 ? records[index] : null;
    const blockedUntil = existing?.blockedUntil ? Date.parse(existing.blockedUntil) : 0;
    if (blockedUntil > now) {
      result = { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000)) };
      return records;
    }

    const windowExpired = !existing || now - Date.parse(existing.windowStartedAt) >= policy.windowSeconds * 1000;
    const attemptCount = windowExpired ? 1 : existing.attemptCount + 1;
    const denied = attemptCount > policy.maxAttempts;
    const record: StoredLimit = {
      action,
      attemptCount,
      blockedUntil: denied ? new Date(now + policy.blockSeconds * 1000).toISOString() : null,
      scopeHash,
      updatedAt: new Date(now).toISOString(),
      windowStartedAt: windowExpired ? new Date(now).toISOString() : existing.windowStartedAt
    };
    if (index >= 0) records[index] = record;
    else records.push(record);
    result = { allowed: !denied, retryAfterSeconds: denied ? policy.blockSeconds : 0 };
    return records;
  });
  return result;
}

async function updateLocalLimits(operation: (records: StoredLimit[]) => StoredLimit[]) {
  const filePath = getLocalAuthRateLimitPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await withLocalFileLock(filePath, async () => {
    let records: StoredLimit[] = [];
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as { records?: StoredLimit[]; schemaVersion?: number };
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) throw new Error("Invalid auth rate-limit store.");
      records = parsed.records;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
    const next = operation(records).filter((record) => Date.now() - Date.parse(record.updatedAt) < 7 * 24 * 60 * 60 * 1000);
    const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ records: next, schemaVersion: 1 }), "utf8");
    await fs.rename(temporary, filePath);
  });
}

function hasSupabaseRateLimitConfig() {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function serviceHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new AuthRateLimitUnavailableError("Authentication rate limiting is not configured.");
  return { apikey: key, authorization: `Bearer ${key}` };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
