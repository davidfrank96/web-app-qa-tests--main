import fs from "node:fs/promises";
import path from "node:path";
import { withLocalFileLock } from "../inssa-ops/local-file-lock";
import { getLocalSchedulerStorePath } from "../inssa-ops/paths";
import type { SchedulerDefinitionState, SchedulerOccurrence, SchedulerRuntimeStatus } from "./scheduler-types";

type SchedulerSnapshot = {
  occurrences: SchedulerOccurrence[];
  schemaVersion: 1;
  status: SchedulerRuntimeStatus;
};

const OCCURRENCE_CLAIM_LEASE_MS = 120_000;

export interface SchedulerStore {
  claimOccurrence(input: {
    campaignId: string;
    claimedBy: string;
    definitionId: string;
    occurrenceKey: string;
    scheduledFor: string;
  }): Promise<{ created: boolean; occurrence: SchedulerOccurrence }>;
  getOccurrence(occurrenceKey: string): Promise<SchedulerOccurrence | null>;
  getStatus(staleAfterMs: number, now?: Date): Promise<SchedulerRuntimeStatus>;
  heartbeat(schedulerId: string, at: Date): Promise<void>;
  markFailed(occurrenceKey: string, errorMessage: string): Promise<void>;
  markQueued(occurrenceKey: string, runId: string): Promise<void>;
  markSkipped(occurrenceKey: string, reason: string): Promise<void>;
  recordEvaluation(input: {
    at: Date;
    definitionStates: SchedulerDefinitionState[];
    definitionsEvaluated: number;
    errorMessage?: string;
    jobsQueued: number;
    schedulerId: string;
  }): Promise<void>;
  start(schedulerId: string, at: Date): Promise<void>;
  stop(schedulerId: string, at: Date): Promise<void>;
}

let singleton: SchedulerStore | null = null;

export function getSchedulerStore(): SchedulerStore {
  if (!singleton) singleton = shouldUseSupabaseStore() ? new SupabaseSchedulerStore() : new LocalSchedulerStore();
  return singleton;
}

class LocalSchedulerStore implements SchedulerStore {
  async start(schedulerId: string, at: Date) {
    await this.write((snapshot) => {
      snapshot.status.running = true;
      snapshot.status.schedulerId = schedulerId;
      snapshot.status.startedAt = at.toISOString();
      snapshot.status.heartbeatAt = at.toISOString();
      snapshot.status.updatedAt = at.toISOString();
      snapshot.status.lastError = null;
    });
  }

  async stop(schedulerId: string, at: Date) {
    await this.write((snapshot) => {
      if (snapshot.status.schedulerId !== schedulerId) return;
      snapshot.status.running = false;
      snapshot.status.heartbeatAt = at.toISOString();
      snapshot.status.updatedAt = at.toISOString();
    });
  }

  async heartbeat(schedulerId: string, at: Date) {
    await this.write((snapshot) => {
      if (snapshot.status.schedulerId !== schedulerId) return;
      snapshot.status.heartbeatAt = at.toISOString();
      snapshot.status.updatedAt = at.toISOString();
    });
  }

  async claimOccurrence(input: {
    campaignId: string;
    claimedBy: string;
    definitionId: string;
    occurrenceKey: string;
    scheduledFor: string;
  }) {
    return this.write((snapshot) => {
      const existing = snapshot.occurrences.find((item) => item.occurrenceKey === input.occurrenceKey);
      const now = new Date().toISOString();
      if (existing) {
        const claimIsActive = existing.status === "claimed" && Date.now() - new Date(existing.updatedAt).getTime() < OCCURRENCE_CLAIM_LEASE_MS;
        if (["queued", "skipped"].includes(existing.status) || claimIsActive) {
          return { created: false, occurrence: { ...existing } };
        }
        existing.claimedBy = input.claimedBy;
        existing.errorMessage = null;
        existing.status = "claimed";
        existing.updatedAt = now;
        return { created: true, occurrence: { ...existing } };
      }
      const occurrence: SchedulerOccurrence = {
        campaignId: input.campaignId,
        claimedBy: input.claimedBy,
        createdAt: now,
        definitionId: input.definitionId,
        errorMessage: null,
        id: crypto.randomUUID(),
        occurrenceKey: input.occurrenceKey,
        runId: null,
        scheduledFor: input.scheduledFor,
        schemaVersion: 1,
        status: "claimed",
        updatedAt: now
      };
      snapshot.occurrences.push(occurrence);
      return { created: true, occurrence: { ...occurrence } };
    });
  }

  async getOccurrence(occurrenceKey: string) {
    const snapshot = await readLocalSnapshot();
    return snapshot.occurrences.find((item) => item.occurrenceKey === occurrenceKey) ?? null;
  }

  async markQueued(occurrenceKey: string, runId: string) {
    await this.updateOccurrence(occurrenceKey, (occurrence) => {
      occurrence.errorMessage = null;
      occurrence.runId = runId;
      occurrence.status = "queued";
    });
  }

  async markFailed(occurrenceKey: string, errorMessage: string) {
    await this.updateOccurrence(occurrenceKey, (occurrence) => {
      occurrence.errorMessage = errorMessage;
      occurrence.status = "failed";
    });
  }

  async markSkipped(occurrenceKey: string, reason: string) {
    await this.updateOccurrence(occurrenceKey, (occurrence) => {
      occurrence.errorMessage = reason;
      occurrence.status = "skipped";
    });
  }

  async recordEvaluation(input: {
    at: Date;
    definitionStates: SchedulerDefinitionState[];
    definitionsEvaluated: number;
    errorMessage?: string;
    jobsQueued: number;
    schedulerId: string;
  }) {
    await this.write((snapshot) => {
      const timestamp = input.at.toISOString();
      snapshot.status.definitionsEvaluated = input.definitionsEvaluated;
      snapshot.status.definitionStates = input.definitionStates;
      snapshot.status.heartbeatAt = timestamp;
      snapshot.status.jobsQueued += input.jobsQueued;
      snapshot.status.lastError = input.errorMessage ?? null;
      snapshot.status.lastEvaluationAt = timestamp;
      snapshot.status.running = true;
      snapshot.status.schedulerId = input.schedulerId;
      snapshot.status.updatedAt = timestamp;
    });
  }

  async getStatus(staleAfterMs: number, now = new Date()) {
    const snapshot = await readLocalSnapshot();
    return withDerivedStatus(snapshot, staleAfterMs, now);
  }

  private async updateOccurrence(occurrenceKey: string, operation: (occurrence: SchedulerOccurrence) => void) {
    await this.write((snapshot) => {
      const occurrence = snapshot.occurrences.find((item) => item.occurrenceKey === occurrenceKey);
      if (!occurrence) throw new Error(`Scheduled occurrence not found: ${occurrenceKey}`);
      operation(occurrence);
      occurrence.updatedAt = new Date().toISOString();
    });
  }

  private async write<T>(operation: (snapshot: SchedulerSnapshot) => T | Promise<T>) {
    const storePath = getLocalSchedulerStorePath();
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    return withLocalFileLock(storePath, async () => {
      const snapshot = await readLocalSnapshot();
      const result = await operation(snapshot);
      const temporaryPath = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, storePath);
      return result;
    });
  }
}

class SupabaseSchedulerStore implements SchedulerStore {
  private readonly apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  private readonly baseUrl = `${process.env.SUPABASE_URL}/rest/v1`;

  async start(schedulerId: string, at: Date) {
    await this.upsertStatus({ heartbeat_at: at.toISOString(), last_error: null, running: true, scheduler_id: schedulerId, started_at: at.toISOString(), updated_at: at.toISOString() });
  }

  async stop(schedulerId: string, at: Date) {
    await this.patchStatus(schedulerId, { heartbeat_at: at.toISOString(), running: false, updated_at: at.toISOString() });
  }

  async heartbeat(schedulerId: string, at: Date) {
    await this.patchStatus(schedulerId, { heartbeat_at: at.toISOString(), updated_at: at.toISOString() });
  }

  async claimOccurrence(input: {
    campaignId: string;
    claimedBy: string;
    definitionId: string;
    occurrenceKey: string;
    scheduledFor: string;
  }) {
    const existing = await this.getOccurrence(input.occurrenceKey);
    if (existing) {
      const claimIsActive = existing.status === "claimed" && Date.now() - new Date(existing.updatedAt).getTime() < OCCURRENCE_CLAIM_LEASE_MS;
      if (["queued", "skipped"].includes(existing.status) || claimIsActive) return { created: false, occurrence: existing };
      const rows = await this.request(
        `monitoring_schedule_occurrences?occurrence_key=eq.${encodeURIComponent(input.occurrenceKey)}&updated_at=eq.${encodeURIComponent(existing.updatedAt)}`,
        {
          body: JSON.stringify({ claimed_by: input.claimedBy, error_message: null, status: "claimed", updated_at: new Date().toISOString() }),
          method: "PATCH"
        }
      );
      return rows[0]
        ? { created: true, occurrence: fromOccurrenceRow(rows[0]) }
        : { created: false, occurrence: (await this.getOccurrence(input.occurrenceKey)) ?? existing };
    }
    const now = new Date().toISOString();
    const occurrence: SchedulerOccurrence = {
      campaignId: input.campaignId,
      claimedBy: input.claimedBy,
      createdAt: now,
      definitionId: input.definitionId,
      errorMessage: null,
      id: crypto.randomUUID(),
      occurrenceKey: input.occurrenceKey,
      runId: null,
      scheduledFor: input.scheduledFor,
      schemaVersion: 1,
      status: "claimed",
      updatedAt: now
    };
    try {
      const rows = await this.request("monitoring_schedule_occurrences", { body: JSON.stringify(toOccurrenceRow(occurrence)), method: "POST" });
      return { created: true, occurrence: fromOccurrenceRow(rows[0]) };
    } catch (error) {
      const concurrent = await this.getOccurrence(input.occurrenceKey);
      if (concurrent) return { created: false, occurrence: concurrent };
      throw error;
    }
  }

  async getOccurrence(occurrenceKey: string) {
    const rows = await this.request(`monitoring_schedule_occurrences?occurrence_key=eq.${encodeURIComponent(occurrenceKey)}&limit=1`);
    return rows[0] ? fromOccurrenceRow(rows[0]) : null;
  }

  async markQueued(occurrenceKey: string, runId: string) {
    await this.patchOccurrence(occurrenceKey, { error_message: null, run_id: runId, status: "queued", updated_at: new Date().toISOString() });
  }

  async markFailed(occurrenceKey: string, errorMessage: string) {
    await this.patchOccurrence(occurrenceKey, { error_message: errorMessage, status: "failed", updated_at: new Date().toISOString() });
  }

  async markSkipped(occurrenceKey: string, reason: string) {
    await this.patchOccurrence(occurrenceKey, { error_message: reason, status: "skipped", updated_at: new Date().toISOString() });
  }

  async recordEvaluation(input: {
    at: Date;
    definitionStates: SchedulerDefinitionState[];
    definitionsEvaluated: number;
    errorMessage?: string;
    jobsQueued: number;
    schedulerId: string;
  }) {
    const current = await this.getStatus(Number.MAX_SAFE_INTEGER, input.at);
    await this.upsertStatus({
      definition_states: input.definitionStates,
      definitions_evaluated: input.definitionsEvaluated,
      heartbeat_at: input.at.toISOString(),
      jobs_queued: current.jobsQueued + input.jobsQueued,
      last_error: input.errorMessage ?? null,
      last_evaluation_at: input.at.toISOString(),
      running: true,
      scheduler_id: input.schedulerId,
      updated_at: input.at.toISOString()
    });
  }

  async getStatus(staleAfterMs: number, now = new Date()) {
    const rows = await this.request("scheduler_runtime_status?id=eq.primary&limit=1");
    const status = rows[0] ? fromStatusRow(rows[0]) : emptyStatus();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const occurrences = await this.request(`monitoring_schedule_occurrences?status=eq.queued&created_at=gte.${encodeURIComponent(startOfDay)}&select=id`);
    return deriveRuntimeStatus({ ...status, jobsQueuedToday: occurrences.length }, staleAfterMs, now);
  }

  private async patchOccurrence(occurrenceKey: string, body: Record<string, unknown>) {
    await this.request(`monitoring_schedule_occurrences?occurrence_key=eq.${encodeURIComponent(occurrenceKey)}`, { body: JSON.stringify(body), method: "PATCH" });
  }

  private async patchStatus(schedulerId: string, body: Record<string, unknown>) {
    await this.request(`scheduler_runtime_status?id=eq.primary&scheduler_id=eq.${encodeURIComponent(schedulerId)}`, { body: JSON.stringify(body), method: "PATCH" });
  }

  private async upsertStatus(body: Record<string, unknown>) {
    await this.request("scheduler_runtime_status?on_conflict=id", {
      body: JSON.stringify({ id: "primary", schema_version: 1, ...body }),
      headers: { prefer: "resolution=merge-duplicates,return=representation" },
      method: "POST"
    });
  }

  private async request(resource: string, init: RequestInit = {}): Promise<Record<string, unknown>[]> {
    const response = await fetch(`${this.baseUrl}/${resource}`, {
      ...init,
      headers: {
        apikey: this.apiKey,
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        prefer: "return=representation",
        ...init.headers
      }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Supabase scheduler request failed: ${response.status} ${response.statusText}${text ? ` ${text}` : ""}`);
    }
    if (response.status === 204 || response.headers.get("content-length") === "0") return [];
    return (await response.json()) as Record<string, unknown>[];
  }
}

async function readLocalSnapshot(): Promise<SchedulerSnapshot> {
  try {
    const parsed = JSON.parse(await fs.readFile(getLocalSchedulerStorePath(), "utf8")) as Partial<SchedulerSnapshot>;
    if (parsed.schemaVersion !== 1) throw new Error(`Unsupported scheduler store schema: ${String(parsed.schemaVersion)}`);
    return {
      occurrences: Array.isArray(parsed.occurrences) ? parsed.occurrences : [],
      schemaVersion: 1,
      status: parsed.status ? { ...emptyStatus(), ...parsed.status, schemaVersion: 1 } : emptyStatus()
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { occurrences: [], schemaVersion: 1, status: emptyStatus() };
    throw error;
  }
}

function withDerivedStatus(snapshot: SchedulerSnapshot, staleAfterMs: number, now: Date) {
  const startOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const jobsQueuedToday = snapshot.occurrences.filter((item) => item.status === "queued" && new Date(item.createdAt).getTime() >= startOfDay).length;
  return deriveRuntimeStatus({ ...snapshot.status, jobsQueuedToday }, staleAfterMs, now);
}

function deriveRuntimeStatus(status: SchedulerRuntimeStatus, staleAfterMs: number, now: Date): SchedulerRuntimeStatus {
  const heartbeatTime = status.heartbeatAt ? new Date(status.heartbeatAt).getTime() : 0;
  return { ...status, running: status.running && now.getTime() - heartbeatTime <= staleAfterMs };
}

function emptyStatus(): SchedulerRuntimeStatus {
  return {
    definitionsEvaluated: 0,
    definitionStates: [],
    heartbeatAt: null,
    jobsQueued: 0,
    jobsQueuedToday: 0,
    lastError: null,
    lastEvaluationAt: null,
    running: false,
    schedulerId: null,
    schemaVersion: 1,
    startedAt: null,
    updatedAt: new Date(0).toISOString()
  };
}

function toOccurrenceRow(occurrence: SchedulerOccurrence) {
  return {
    campaign_id: occurrence.campaignId,
    claimed_by: occurrence.claimedBy,
    created_at: occurrence.createdAt,
    definition_id: occurrence.definitionId,
    error_message: occurrence.errorMessage,
    id: occurrence.id,
    occurrence_key: occurrence.occurrenceKey,
    run_id: occurrence.runId,
    scheduled_for: occurrence.scheduledFor,
    schema_version: occurrence.schemaVersion,
    status: occurrence.status,
    updated_at: occurrence.updatedAt
  };
}

function fromOccurrenceRow(row: Record<string, unknown>): SchedulerOccurrence {
  return {
    campaignId: String(row.campaign_id),
    claimedBy: String(row.claimed_by),
    createdAt: String(row.created_at),
    definitionId: String(row.definition_id),
    errorMessage: nullableString(row.error_message),
    id: String(row.id),
    occurrenceKey: String(row.occurrence_key),
    runId: nullableString(row.run_id),
    scheduledFor: String(row.scheduled_for),
    schemaVersion: 1,
    status: row.status as SchedulerOccurrence["status"],
    updatedAt: String(row.updated_at)
  };
}

function fromStatusRow(row: Record<string, unknown>): SchedulerRuntimeStatus {
  return {
    definitionsEvaluated: Number(row.definitions_evaluated ?? 0),
    definitionStates: Array.isArray(row.definition_states) ? row.definition_states as SchedulerDefinitionState[] : [],
    heartbeatAt: nullableString(row.heartbeat_at),
    jobsQueued: Number(row.jobs_queued ?? 0),
    jobsQueuedToday: 0,
    lastError: nullableString(row.last_error),
    lastEvaluationAt: nullableString(row.last_evaluation_at),
    running: Boolean(row.running),
    schedulerId: nullableString(row.scheduler_id),
    schemaVersion: 1,
    startedAt: nullableString(row.started_at),
    updatedAt: String(row.updated_at)
  };
}

function shouldUseSupabaseStore() {
  if (process.env.INSSA_OPS_METADATA_STORE !== "supabase") return false;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase scheduler persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; refusing an unsafe local or anon-key fallback."
    );
  }
  return true;
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
