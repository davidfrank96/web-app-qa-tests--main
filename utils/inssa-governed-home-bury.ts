import { expect, type Page, type Request, type Response } from "@playwright/test";
import { LandingPage } from "../pages/inssa/landing.page";
import { TimeCapsulePage } from "../pages/inssa/time-capsule.page";
import { assertValidInssaUrl } from "./env";
import { INSSA_LIVE_CAPSULE_ENV_FLAG, INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG } from "./inssa-mutation";

export const GOVERNED_HOME_SEED_URL = "https://us-central1-kbean-stg-fcm.cloudfunctions.net/discover_seedQuickFindCategories";
export function assertGovernedHomeBury() {
  if (new URL(assertValidInssaUrl()).origin !== "https://staging.inssa.us" ||
      process.env[INSSA_LIVE_CAPSULE_ENV_FLAG] !== "1" ||
      process.env[INSSA_LIVE_CAPSULE_MANUAL_CLEANUP_APPROVED_ENV_FLAG] !== "1") {
    throw new Error("Home/Bury requires the existing staging mutation and manual-cleanup approvals");
  }
}

// Called only by the existing Text Lifecycle spec, inside its governed wrapper.
// This preserves both former Home/Bury assertions without a Safe entry point.
export async function openGovernedHomeBury(page: Page, authenticated: boolean) {
  assertGovernedHomeBury();
  const landing = new LandingPage(page);
  await landing.goToHome();
  if (authenticated) await landing.expectAuthenticatedLandingSurface();
  else await landing.expectPublicLandingSurface();
  await landing.openBuryEntry();
  if (authenticated) await new TimeCapsulePage(page).expectComposeSurface();
  else {
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/signin\/?$/);
    expect(new URL(page.url()).searchParams.get("next")).toMatch(/^\/timecapsule/);
  }
}

type SeedRecord = {
  functionName: "discover_seedQuickFindCategories"; timestamp: string;
  status?: number; createdCapsuleIdsCount?: number; reusedCapsuleIdsCount?: number;
  createdCapsuleIds?: string[]; reusedCapsuleIds?: string[];
  identity: "unknown" | "reported-system-owned";
  owner: "inssa"; cleanup: "manual-review-only-not-qa-owned";
};
export function seedResponseEvidence(value: unknown): Pick<SeedRecord, "identity" | "createdCapsuleIds" | "reusedCapsuleIds" | "createdCapsuleIdsCount" | "reusedCapsuleIdsCount"> {
  const envelope = value as { result?: unknown; data?: unknown } | null;
  const data = (envelope?.result ?? envelope?.data) as Record<string, unknown> | undefined;
  const out: ReturnType<typeof seedResponseEvidence> = { identity: "unknown" };
  for (const key of ["createdCapsuleIds", "reusedCapsuleIds"] as const) {
    const rows = data?.[key];
    if (!Array.isArray(rows)) continue;
    out[`${key}Count`] = rows.length;
    // Preserve only reported valid document identifiers; never infer identity
    // from a URL/payload or treat these system-owned objects as QA-owned.
    out[key] = rows.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id));
    if (out[key]!.length) out.identity = "reported-system-owned";
  }
  return out;
}
export function observeGovernedHomeSeeding() {
  const records: SeedRecord[] = [];
  const requests = new WeakMap<Request, SeedRecord>();
  const pending = new Set<Promise<void>>();
  const listeners: Array<{page: Page; request: (request: Request) => void; response: (response: Response) => void}> = [];
  return {
    records,
    attach(page: Page) {
      const request = (request: Request) => {
        if (request.method() !== "POST" || request.url().split("?")[0] !== GOVERNED_HOME_SEED_URL) return;
        const row: SeedRecord = { functionName: "discover_seedQuickFindCategories", timestamp: new Date().toISOString(), identity: "unknown", owner: "inssa", cleanup: "manual-review-only-not-qa-owned" };
        records.push(row); requests.set(request, row);
      };
      const response = (response: Response) => {
        const row = requests.get(response.request()); if (!row) return;
        row.status = response.status();
        const job = (async () => {
          try { Object.assign(row, seedResponseEvidence(await response.json())); }
          catch { /* Missing/failed response keeps truthful unknown identity. */ }
        })();
        pending.add(job); void job.finally(() => pending.delete(job));
      };
      page.on("request", request); page.on("response", response); listeners.push({page, request, response});
    },
    async finish() {
      for (const item of listeners) { item.page.off("request",item.request); item.page.off("response",item.response); }
      await Promise.all([...pending]);
      return { records, manualCleanup: true, advisory: true,
        note: "Home may create or update system-owned discover capsules/media. Reported IDs are review candidates, not QA ownership or deletion authorization. Missing IDs remain unknown; no automatic cleanup or retry." };
    }
  };
}
