import { NextRequest, NextResponse } from "next/server";
import { requireInssaApiUser } from "../../../lib/inssa-ops/api-guard";
import { recordInssaAuditEvent } from "../../../lib/inssa-ops/audit";
import { validateInssaStagingEnvironment } from "../../../lib/inssa-ops/environment-guard";
import { resolveInssaLifecycleArtifactSelection } from "../../../lib/inssa-ops/lifecycle-artifact-catalog";
import { getInssaRunStore, getInssaRunStoreSummary } from "../../../lib/inssa-ops/run-store";
import { startInssaPhase1Run } from "../../../lib/inssa-ops/runner";
import { getInssaCommandAuthorization } from "../../../lib/inssa-ops/security";
import type { InssaLifecycleArtifactSelection } from "../../../lib/inssa-ops/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) return auth.response;

  const metadataBackend = await getInssaRunStoreSummary();
  try {
    const allRuns = await getInssaRunStore().listRuns();
    const page = paginate(allRuns, request.nextUrl.searchParams);
    return NextResponse.json({ metadataBackend, runs: page.items, pagination: page.pagination });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
        metadataBackend,
        runs: []
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireInssaApiUser(request, "viewer");
  if (auth.response) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const campaignKey = typeof body?.campaignKey === "string" ? body.campaignKey : "";
  const artifactSelection = parseArtifactSelection(body?.artifactSelection);

  if (!campaignKey) {
    return NextResponse.json({ error: "campaignKey is required." }, { status: 400 });
  }

  const authorization = getInssaCommandAuthorization(auth.user.role, campaignKey);
  if (!authorization.allowed) {
    await recordInssaAuditEvent({
      campaignKey,
      eventType: "role_violation_attempt",
      metadata: { reason: authorization.reason, role: auth.user.role },
      status: "denied",
      user: auth.user
    });
    return NextResponse.json({ error: authorization.reason }, { status: 403 });
  }

  let lifecycleArtifact = undefined;
  if (authorization.command?.requiresLifecycleArtifact) {
    const resolved = await resolveInssaLifecycleArtifactSelection(artifactSelection);
    if ("error" in resolved) {
      await recordInssaAuditEvent({
        campaignKey,
        eventType: "run_denied",
        metadata: { reason: resolved.error },
        status: String(resolved.status),
        user: auth.user
      });
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    lifecycleArtifact = resolved.artifact;
  } else if (artifactSelection) {
    return NextResponse.json({ error: "Artifact selection is only allowed for artifact-validation commands." }, { status: 400 });
  }

  const environment = validateInssaStagingEnvironment();
  if (!environment.ok) {
    await recordInssaAuditEvent({
      campaignKey,
      eventType: "run_denied",
      metadata: { environment: environment.environment, reason: environment.error },
      status: "denied",
      user: auth.user
    });
    return NextResponse.json({ error: environment.error }, { status: 400 });
  }

  await recordInssaAuditEvent({
    campaignKey,
    eventType: "run_requested",
    metadata: { environment: environment.environment, lifecycleArtifact },
    status: "accepted",
    user: auth.user
  });

  const result = await startInssaPhase1Run({
    campaignKey,
    idempotencyKey: request.headers.get("idempotency-key") ?? undefined,
    lifecycleArtifact,
    requestedBy: auth.user.email || auth.user.id
  });
  if ("error" in result) {
    await recordInssaAuditEvent({
      campaignKey,
      eventType: "run_denied",
      metadata: { reason: result.error },
      status: String(result.status),
      user: auth.user
    });
    return NextResponse.json(result, { status: result.status });
  }

  return NextResponse.json({ run: result.run }, { status: result.status });
}

function paginate<T>(items: T[], searchParams: URLSearchParams) {
  const requestedLimit = Number(searchParams.get("limit"));
  if (!Number.isInteger(requestedLimit) || requestedLimit <= 0) {
    return { items, pagination: { hasMore: false, limit: items.length, nextCursor: null, total: items.length } };
  }
  const limit = Math.min(requestedLimit, 100);
  const offset = Math.max(0, Number(searchParams.get("cursor")) || 0);
  const pageItems = items.slice(offset, offset + limit);
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    pagination: {
      hasMore: nextOffset < items.length,
      limit,
      nextCursor: nextOffset < items.length ? String(nextOffset) : null,
      total: items.length
    }
  };
}

function parseArtifactSelection(value: unknown): InssaLifecycleArtifactSelection | null {
  if (!value || typeof value !== "object") return null;
  const selection = value as Record<string, unknown>;
  const mode = selection.mode;
  if (mode !== "explicit" && mode !== "latest") return null;
  return {
    mode,
    path: typeof selection.path === "string" ? selection.path : undefined
  };
}
