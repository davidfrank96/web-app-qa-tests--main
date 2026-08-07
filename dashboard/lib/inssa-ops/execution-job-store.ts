import fs from "node:fs/promises";
import path from "node:path";
import { withLocalFileLock } from "./local-file-lock";
import { getLocalExecutionJobStorePath } from "./paths";
import type { InssaExecutionJobRecord, InssaLiveExecutionContext, ResolvedInssaLifecycleArtifactSelection } from "./types";

type JobStoreSnapshot = {
  jobs: InssaExecutionJobRecord[];
  schemaVersion: 1;
};

export type EnqueueExecutionJobInput = {
  campaignKey: string;
  idempotencyKey: string;
  lifecycleArtifact?: ResolvedInssaLifecycleArtifactSelection;
  executionContext?: InssaLiveExecutionContext;
  maxAttempts?: number;
  runId: string;
};

export type ClaimExecutionJobInput = {
  leaseMs: number;
  workerId: string;
};

export interface InssaExecutionJobStore {
  claimNext(input: ClaimExecutionJobInput): Promise<InssaExecutionJobRecord | null>;
  complete(jobId: string, workerId: string, status: "completed" | "failed", error?: string): Promise<void>;
  enqueue(input: EnqueueExecutionJobInput): Promise<{ created: boolean; job: InssaExecutionJobRecord }>;
  getByIdempotencyKey(idempotencyKey: string): Promise<InssaExecutionJobRecord | null>;
  getByRunId(runId: string): Promise<InssaExecutionJobRecord | null>;
  getActive(): Promise<InssaExecutionJobRecord | null>;
  heartbeat(jobId: string, workerId: string, leaseMs: number): Promise<void>;
  markRunning(jobId: string, workerId: string, leaseMs: number): Promise<void>;
  recoverAbandoned(): Promise<InssaExecutionJobRecord[]>;
}

let singleton: InssaExecutionJobStore | null = null;

export function getInssaExecutionJobStore(): InssaExecutionJobStore {
  if (!singleton) {
    singleton = shouldUseSupabaseStore() ? new SupabaseExecutionJobStore() : new LocalExecutionJobStore();
  }
  return singleton;
}

class LocalExecutionJobStore implements InssaExecutionJobStore {
  async enqueue(input: EnqueueExecutionJobInput) {
    return this.write(async (snapshot) => {
      const existing = snapshot.jobs.find((job) => job.idempotencyKey === input.idempotencyKey);
      if (existing) return { created: false, job: existing };

      const active = snapshot.jobs.find((job) => ["claimed", "queued", "running"].includes(job.status));
      if (active) {
        throw new ActiveExecutionJobError(active.runId);
      }

      const now = new Date().toISOString();
      const job: InssaExecutionJobRecord = {
        attempt: 0,
        campaignKey: input.campaignKey,
        claimedAt: null,
        claimedBy: null,
        completedAt: null,
        createdAt: now,
        heartbeatAt: null,
        id: crypto.randomUUID(),
        idempotencyKey: input.idempotencyKey,
        executionContext: input.executionContext ?? null,
        lastError: null,
        leaseExpiresAt: null,
        lifecycleArtifact: input.lifecycleArtifact ?? null,
        maxAttempts: input.maxAttempts ?? 2,
        runId: input.runId,
        schemaVersion: 1,
        status: "queued",
        updatedAt: now
      };
      snapshot.jobs.push(job);
      return { created: true, job };
    });
  }

  async claimNext(input: ClaimExecutionJobInput) {
    return this.write(async (snapshot) => {
      const job = snapshot.jobs
        .filter((candidate) => candidate.status === "queued" && candidate.attempt < candidate.maxAttempts)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
      if (!job) return null;

      const now = new Date();
      job.attempt += 1;
      job.claimedAt = now.toISOString();
      job.claimedBy = input.workerId;
      job.heartbeatAt = now.toISOString();
      job.leaseExpiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
      job.status = "claimed";
      job.updatedAt = now.toISOString();
      return { ...job };
    });
  }

  async markRunning(jobId: string, workerId: string, leaseMs: number) {
    await this.updateOwned(jobId, workerId, (job) => {
      const now = new Date();
      job.status = "running";
      job.heartbeatAt = now.toISOString();
      job.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    });
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number) {
    await this.updateOwned(jobId, workerId, (job) => {
      const now = new Date();
      job.heartbeatAt = now.toISOString();
      job.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    });
  }

  async complete(jobId: string, workerId: string, status: "completed" | "failed", error?: string) {
    await this.updateOwned(jobId, workerId, (job) => {
      const now = new Date().toISOString();
      job.completedAt = now;
      job.heartbeatAt = now;
      job.lastError = error ?? null;
      job.leaseExpiresAt = null;
      job.status = status;
    });
  }

  async getByIdempotencyKey(idempotencyKey: string) {
    const snapshot = await readSnapshot(getLocalExecutionJobStorePath());
    return snapshot.jobs.find((job) => job.idempotencyKey === idempotencyKey) ?? null;
  }

  async getByRunId(runId: string) {
    const snapshot = await readSnapshot(getLocalExecutionJobStorePath());
    return snapshot.jobs.find((job) => job.runId === runId) ?? null;
  }

  async getActive() {
    const snapshot = await readSnapshot(getLocalExecutionJobStorePath());
    return snapshot.jobs.find((job) => ["claimed", "queued", "running"].includes(job.status)) ?? null;
  }

  async recoverAbandoned() {
    return this.write(async (snapshot) => recoverExpiredJobs(snapshot));
  }

  private async updateOwned(
    jobId: string,
    workerId: string,
    operation: (job: InssaExecutionJobRecord) => void
  ) {
    return this.write(async (snapshot) => {
      const job = snapshot.jobs.find((candidate) => candidate.id === jobId);
      if (!job) throw new Error(`Execution job not found: ${jobId}`);
      if (job.claimedBy !== workerId) throw new Error(`Execution job ${jobId} is not owned by worker ${workerId}.`);
      operation(job);
      job.updatedAt = new Date().toISOString();
    });
  }

  private async write<T>(operation: (snapshot: JobStoreSnapshot) => Promise<T> | T) {
    const storePath = getLocalExecutionJobStorePath();
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    return withLocalFileLock(storePath, async () => {
      const snapshot = await readSnapshot(storePath);
      const result = await operation(snapshot);
      const temporaryPath = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, storePath);
      return result;
    });
  }
}

class SupabaseExecutionJobStore implements InssaExecutionJobStore {
  private readonly apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  private readonly baseUrl = `${process.env.SUPABASE_URL}/rest/v1`;

  async enqueue(input: EnqueueExecutionJobInput) {
    const existing = await this.getByIdempotencyKey(input.idempotencyKey);
    if (existing) return { created: false, job: existing };
    const activeRows = await this.request("execution_jobs?status=in.(queued,claimed,running)&limit=1");
    if (activeRows[0]) throw new ActiveExecutionJobError(String(activeRows[0].run_id));

    const now = new Date().toISOString();
    const job: InssaExecutionJobRecord = {
      attempt: 0,
      campaignKey: input.campaignKey,
      claimedAt: null,
      claimedBy: null,
      completedAt: null,
      createdAt: now,
      heartbeatAt: null,
      id: crypto.randomUUID(),
      idempotencyKey: input.idempotencyKey,
      executionContext: input.executionContext ?? null,
      lastError: null,
      leaseExpiresAt: null,
      lifecycleArtifact: input.lifecycleArtifact ?? null,
      maxAttempts: input.maxAttempts ?? 2,
      runId: input.runId,
      schemaVersion: 1,
      status: "queued",
      updatedAt: now
    };
    await this.request("execution_jobs", { body: JSON.stringify(toRow(job)), method: "POST" });
    return { created: true, job };
  }

  async claimNext(input: ClaimExecutionJobInput) {
    const rows = await this.request("rpc/claim_inssa_execution_job", {
      body: JSON.stringify({ lease_ms: input.leaseMs, worker_id: input.workerId }),
      method: "POST"
    });
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async markRunning(jobId: string, workerId: string, leaseMs: number) {
    await this.heartbeatWithStatus(jobId, workerId, leaseMs, "running");
  }

  async heartbeat(jobId: string, workerId: string, leaseMs: number) {
    await this.heartbeatWithStatus(jobId, workerId, leaseMs);
  }

  async complete(jobId: string, workerId: string, status: "completed" | "failed", error?: string) {
    const now = new Date().toISOString();
    const rows = await this.request(`execution_jobs?id=eq.${encodeURIComponent(jobId)}&claimed_by=eq.${encodeURIComponent(workerId)}`, {
      body: JSON.stringify({ completed_at: now, heartbeat_at: now, last_error: error ?? null, lease_expires_at: null, status, updated_at: now }),
      method: "PATCH"
    });
    if (rows.length !== 1) throw new Error(`Execution job ${jobId} is no longer owned by worker ${workerId}.`);
  }

  async getByIdempotencyKey(idempotencyKey: string) {
    const rows = await this.request(`execution_jobs?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async getByRunId(runId: string) {
    const rows = await this.request(`execution_jobs?run_id=eq.${encodeURIComponent(runId)}&limit=1`);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async getActive() {
    const rows = await this.request("execution_jobs?status=in.(queued,claimed,running)&order=created_at.asc&limit=1");
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async recoverAbandoned() {
    const rows = await this.request("rpc/recover_inssa_execution_job_records", { body: "{}", method: "POST" });
    return rows.map(fromRow);
  }

  private async heartbeatWithStatus(jobId: string, workerId: string, leaseMs: number, status?: "running") {
    const now = new Date();
    const rows = await this.request(`execution_jobs?id=eq.${encodeURIComponent(jobId)}&claimed_by=eq.${encodeURIComponent(workerId)}`, {
      body: JSON.stringify({
        heartbeat_at: now.toISOString(),
        lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
        ...(status ? { status } : {}),
        updated_at: now.toISOString()
      }),
      method: "PATCH"
    });
    if (rows.length !== 1) throw new Error(`Execution lease is no longer owned by worker ${workerId}.`);
  }

  private async request(resource: string, init: RequestInit = {}) {
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
      throw new Error(`Supabase execution job request failed: ${response.status} ${response.statusText}${text ? ` ${text}` : ""}`);
    }
    if (response.status === 204 || response.headers.get("content-length") === "0") return [];
    return response.json();
  }
}

export class ActiveExecutionJobError extends Error {
  constructor(public readonly activeRunId: string) {
    super(`An INSSA QA run is already active: ${activeRunId}`);
    this.name = "ActiveExecutionJobError";
  }
}

function recoverExpiredJobs(snapshot: JobStoreSnapshot) {
  const now = Date.now();
  const recovered: InssaExecutionJobRecord[] = [];
  for (const job of snapshot.jobs) {
    if (!["claimed", "running"].includes(job.status) || !job.leaseExpiresAt) continue;
    if (new Date(job.leaseExpiresAt).getTime() > now) continue;
    job.claimedBy = null;
    job.leaseExpiresAt = null;
    job.lastError = "Worker lease expired before completion.";
    job.status = job.attempt < job.maxAttempts ? "queued" : "abandoned";
    job.updatedAt = new Date().toISOString();
    recovered.push({ ...job });
  }
  return recovered;
}

async function readSnapshot(storePath: string): Promise<JobStoreSnapshot> {
  try {
    const parsed = JSON.parse(await fs.readFile(storePath, "utf8")) as Partial<JobStoreSnapshot>;
    const schemaVersion = parsed.schemaVersion ?? 1;
    if (schemaVersion !== 1) throw new Error(`Unsupported execution job store schema version: ${String(schemaVersion)}`);
    return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [], schemaVersion: 1 };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { jobs: [], schemaVersion: 1 };
    throw error;
  }
}

function shouldUseSupabaseStore() {
  if (process.env.INSSA_OPS_METADATA_STORE !== "supabase") return false;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase execution persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; refusing an unsafe local or anon-key fallback."
    );
  }
  return true;
}

function toRow(job: InssaExecutionJobRecord) {
  return {
    attempt: job.attempt,
    campaign_key: job.campaignKey,
    claimed_at: job.claimedAt,
    claimed_by: job.claimedBy,
    completed_at: job.completedAt,
    created_at: job.createdAt,
    heartbeat_at: job.heartbeatAt,
    id: job.id,
    idempotency_key: job.idempotencyKey,
    execution_context: job.executionContext,
    last_error: job.lastError,
    lease_expires_at: job.leaseExpiresAt,
    lifecycle_artifact: job.lifecycleArtifact,
    max_attempts: job.maxAttempts,
    run_id: job.runId,
    schema_version: job.schemaVersion,
    status: job.status,
    updated_at: job.updatedAt
  };
}

function fromRow(row: Record<string, unknown>): InssaExecutionJobRecord {
  return {
    attempt: Number(row.attempt),
    campaignKey: String(row.campaign_key),
    claimedAt: nullableString(row.claimed_at),
    claimedBy: nullableString(row.claimed_by),
    completedAt: nullableString(row.completed_at),
    createdAt: String(row.created_at),
    heartbeatAt: nullableString(row.heartbeat_at),
    id: String(row.id),
    idempotencyKey: String(row.idempotency_key),
    executionContext: (row.execution_context as InssaLiveExecutionContext | null) ?? null,
    lastError: nullableString(row.last_error),
    leaseExpiresAt: nullableString(row.lease_expires_at),
    lifecycleArtifact: (row.lifecycle_artifact as ResolvedInssaLifecycleArtifactSelection | null) ?? null,
    maxAttempts: Number(row.max_attempts),
    runId: String(row.run_id),
    schemaVersion: 1,
    status: row.status as InssaExecutionJobRecord["status"],
    updatedAt: String(row.updated_at)
  };
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
