import {
  evidenceLocation,
  type EvidenceLocation,
} from "./storage-provider-model";
import { storageProvider } from "./storage-providers";
import { verifyStoredObject } from "./evidence-storage";
import type { RetentionObject } from "./retention-types";
import {
  createRetentionReader,
  readRetentionSnapshot,
} from "./retention-store";
import type { RetentionExecutorIO } from "./retention-executor";
import type { RetentionHealth } from "./retention-types";

export function retentionRpcClient() {
  createRetentionReader(); // Validate durable configuration, including HTTPS and fail-closed local mode.
  const base = new URL(process.env.SUPABASE_URL!);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return async <T = unknown>(
    name: string,
    body?: Record<string, unknown>,
  ): Promise<T> => {
    const response = await fetch(new URL(`/rest/v1/rpc/${name}`, base), {
      method: body ? "POST" : "GET",
      redirect: "error",
      cache: "no-store",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`Retention ${name} failed (${response.status}).`);
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  };
}
export const readRetentionHealth = () =>
  retentionRpcClient()<RetentionHealth>("retention_health");

export function createRetentionExecutorIO(
  signal?: AbortSignal,
): RetentionExecutorIO {
  const rpc = retentionRpcClient();
  if (
    process.env.INSSA_EVIDENCE_SUPABASE_BUCKET &&
    process.env.INSSA_EVIDENCE_SUPABASE_BUCKET !== "inssa-evidence"
  )
    throw new Error("Retention bucket mismatch.");
  const reader = createRetentionReader();
  const legacy: EvidenceLocation = {
    provider: "supabase",
    bucket: "inssa-evidence",
  };
  type Intent = {
    location: EvidenceLocation;
    objects: RetentionObject[];
    absent: RetentionObject[];
    checkedAt: string | null;
    occurrence: string;
    owner: string;
  };
  const intents = new Map<string, Intent>();
  const adapter = (l: EvidenceLocation) =>
    storageProvider(l.provider, l.bucket, signal);
  const assertOwner = (i: Intent) =>
    rpc("retention_assert_owner", {
      p_occurrence: i.occurrence,
      p_owner: i.owner,
    });
  const findIntent = (keys: string[], l: EvidenceLocation) => {
    const intent = [...intents.values()].find(
      (i) =>
        i.location.provider === l.provider &&
        i.location.bucket === l.bucket &&
        keys.every((k) => i.objects.some((o) => o.name === k)),
    );
    if (!intent)
      throw new Error("Deletion requires a provider-bound reservation.");
    return intent;
  };
  return {
    snapshot: () => readRetentionSnapshot(reader),
    claim: (id, owner, automatic, schedulerStartedAt) =>
      rpc("retention_claim_occurrence", {
        p_id: id,
        p_owner: owner,
        p_automatic: automatic,
        p_scheduler_started_at: schedulerStartedAt ?? null,
      }),
    heartbeat: (id, owner) =>
      rpc("retention_heartbeat", { p_occurrence: id, p_owner: owner }),
    reserve: async (i) => {
      const bundle = i.snapshot.bundles.find((b) => b.id === i.bundleId);
      if (!bundle) throw new Error("Retention bundle missing.");
      const location = evidenceLocation(bundle);
      const intent: Intent = {
        location,
        objects: i.objects,
        absent: [],
        checkedAt: null,
        occurrence: i.occurrence,
        owner: i.owner,
      };
      const body = {
        p_occurrence: i.occurrence,
        p_owner: i.owner,
        p_revision: i.snapshot.revision,
        p_bundle: i.bundleId,
        p_signature: i.signature,
        p_plan: i.planId,
        p_objects: i.objects,
      };
      let present: RetentionObject[] = [];
      if (location.provider === "spaces") {
        const store = adapter(location);
        // HEAD just before reservation binds the list inventory to immutable object metadata.
        for (const o of i.objects) {
          await assertOwner(intent);
          const head = await store.head(o.name);
          if (head) {
            if (
              head.etag !== o.etag ||
              head.sizeBytes !== o.sizeBytes ||
              head.sha256 !== o.sha256
            )
              throw new Error("Spaces object changed before reservation.");
            present.push(o);
          }
        }
      }
      const reserved = await rpc<{
        status: string;
        remaining?: RetentionObject[];
      }>(
        location.provider === "spaces"
          ? "retention_reserve_spaces_bundle"
          : "retention_reserve_bundle",
        location.provider === "spaces"
          ? {
              ...body,
              p_present: present,
              p_checked_at: new Date().toISOString(),
            }
          : body,
      );
      if (reserved.status === "RESERVED") intents.set(i.bundleId, intent);
      return reserved;
    },
    remove: async (keys, location = legacy) => {
      const store = adapter(location);
      if (location.provider === "supabase") {
        await storageProvider(
          location.provider,
          location.bucket,
          AbortSignal.any([
            AbortSignal.timeout(20_000),
            ...(signal ? [signal] : []),
          ]),
        ).delete(keys);
        return;
      }
      const intent = findIntent(keys, location);
      for (const key of keys) {
        await assertOwner(intent);
        const o = intent.objects.find((o) => o.name === key)!;
        const head = await store.head(key);
        if (!head) continue; // Already removed by this durable intent; absence is reverified at settlement.
        if (
          head.etag !== o.etag ||
          head.sha256 !== o.sha256 ||
          head.sizeBytes !== o.sizeBytes
        )
          throw new Error("Spaces deletion identity changed.");
        await verifyStoredObject(store, key, {
          sizeBytes: o.sizeBytes!,
          sha256: o.sha256!,
        });
        await assertOwner(intent);
        // Bounded per-object operation; the lease cannot expire unnoticed across a long batch.
        await storageProvider(
          location.provider,
          location.bucket,
          AbortSignal.any([
            AbortSignal.timeout(20_000),
            ...(signal ? [signal] : []),
          ]),
        ).delete([key]);
      }
    },
    verifyAbsent: async (keys, location = legacy) => {
      const store = adapter(location);
      const intent =
        location.provider === "spaces" ? findIntent(keys, location) : null;
      if (intent) {
        intent.absent = [];
        intent.checkedAt = null;
      }
      let verificationFailed = false;
      const checkedAt = new Date().toISOString();
      for (let i = 0; i < keys.length; i += 8) {
        if (intent) await assertOwner(intent);
        const results = await Promise.allSettled(
          keys.slice(i, i + 8).map(async (key) => {
            if (await store.exists(key))
              throw new Error("Storage object remains present.");
            if (intent)
              intent.absent.push(intent.objects.find((o) => o.name === key)!);
          }),
        );
        verificationFailed ||= results.some((r) => r.status === "rejected");
      }
      if (intent) intent.checkedAt = checkedAt;
      if (verificationFailed)
        throw new Error(
          "Storage object remains present or absence could not be verified.",
        );
    },
    settle: (id, owner, bundle, success, error) => {
      const intent = intents.get(bundle);
      const body = {
        p_occurrence: id,
        p_owner: owner,
        p_bundle: bundle,
        p_success: success,
        p_error: error,
      };
      return intent?.location.provider === "spaces"
        ? rpc("retention_settle_spaces_bundle", {
            ...body,
            p_absent: intent.checkedAt ? intent.absent : [],
            p_checked_at: intent.checkedAt,
          })
        : rpc("retention_settle_bundle", body);
    },
    finish: (id, owner, error, protectedCount, reviewCount) =>
      rpc("retention_finish_occurrence", {
        p_occurrence: id,
        p_owner: owner,
        p_error: error,
        p_protected: protectedCount,
        p_review: reviewCount,
      }),
  };
}
