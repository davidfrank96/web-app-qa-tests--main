import fs from "node:fs/promises";
import path from "node:path";
import { withLocalFileLock } from "./local-file-lock";
import { getLocalRunLogDirectory, getLocalRunStorePath } from "./paths";
import type {
  CreateRunInput,
  InssaArtifactRecord,
  InssaAuditEventRecord,
  InssaCleanupLedgerRecord,
  InssaCleanupManifest,
  InssaCommandDefinition,
  InssaEvidenceBundleRecord,
  InssaEvidenceItemRecord,
  InssaRunLogRecord,
  InssaRunRecord,
  RunPatch
} from "./types";

type StoreSnapshot = {
  artifacts: InssaArtifactRecord[];
  auditEvents: InssaAuditEventRecord[];
  cleanupLedger: InssaCleanupLedgerRecord[];
  evidenceBundles: InssaEvidenceBundleRecord[];
  evidenceItems: InssaEvidenceItemRecord[];
  logs: InssaRunLogRecord[];
  runs: InssaRunRecord[];
  schemaVersion: 4;
};

export type InssaRunStoreSummary = {
  backend: "local-json" | "supabase";
  backendLabel: "Local JSON" | "Supabase";
  counts: {
    artifacts: number;
    logs: number;
    runs: number;
  } | null;
  error: string | null;
  storePath: string | null;
};

export type InssaRunStore = {
  appendLog(runId: string, stream: InssaRunLogRecord["stream"], message: string): Promise<InssaRunLogRecord>;
  appendAuditEvent(event: Omit<InssaAuditEventRecord, "createdAt" | "id">): Promise<InssaAuditEventRecord>;
  createRun(input: CreateRunInput): Promise<InssaRunRecord>;
  getArtifact(id: string): Promise<InssaArtifactRecord | null>;
  getArtifacts(runId: string): Promise<InssaArtifactRecord[]>;
  getCleanupLedgerRecord(id: string): Promise<InssaCleanupLedgerRecord | null>;
  getEvidence(runId: string): Promise<{
    bundles: InssaEvidenceBundleRecord[];
    items: InssaEvidenceItemRecord[];
  }>;
  getLogs(runId: string): Promise<InssaRunLogRecord[]>;
  getRun(id: string): Promise<InssaRunRecord | null>;
  listRuns(): Promise<InssaRunRecord[]>;
  listCleanupLedger(): Promise<InssaCleanupLedgerRecord[]>;
  replaceRunCleanupLedger(runId: string, records: InssaCleanupLedgerRecord[]): Promise<InssaCleanupLedgerRecord[]>;
  replaceRunArtifacts(runId: string, artifacts: InssaArtifactRecord[]): Promise<InssaArtifactRecord[]>;
  replaceRunEvidence(
    runId: string,
    bundle: InssaEvidenceBundleRecord | null,
    items: InssaEvidenceItemRecord[]
  ): Promise<{
    bundle: InssaEvidenceBundleRecord | null;
    items: InssaEvidenceItemRecord[];
  }>;
  updateEvidenceItemMetadata(id: string, metadata: Record<string, unknown>): Promise<InssaEvidenceItemRecord>;
  updateRun(id: string, patch: RunPatch): Promise<InssaRunRecord>;
  upsertCleanupLedger(record: InssaCleanupLedgerRecord): Promise<InssaCleanupLedgerRecord>;
};

let storeSingleton: InssaRunStore | null = null;

export function getInssaRunStore(): InssaRunStore {
  if (!storeSingleton) {
    storeSingleton = shouldUseSupabaseStore() ? new SupabaseRunStore() : new LocalJsonRunStore();
  }

  return storeSingleton;
}

function shouldUseSupabaseStore() {
  if (process.env.INSSA_OPS_METADATA_STORE !== "supabase") return false;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase metadata persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; refusing an unsafe local or anon-key fallback."
    );
  }
  return true;
}

export async function getInssaRunStoreSummary(): Promise<InssaRunStoreSummary> {
  if (!shouldUseSupabaseStore()) {
    const storePath = getLocalRunStorePath();
    try {
      const snapshot = await readLocalSnapshot(storePath);
      const incrementalLogCount = await countIncrementalLogs();
      return {
        backend: "local-json",
        backendLabel: "Local JSON",
        counts: {
          artifacts: snapshot.artifacts.length,
          logs: snapshot.logs.length + incrementalLogCount,
          runs: snapshot.runs.length
        },
        error: null,
        storePath
      };
    } catch (error) {
      return {
        backend: "local-json",
        backendLabel: "Local JSON",
        counts: null,
        error: error instanceof Error ? error.message : String(error),
        storePath
      };
    }
  }

  const summary: InssaRunStoreSummary = {
    backend: "supabase",
    backendLabel: "Supabase",
    counts: null,
    error: null,
    storePath: null
  };

  try {
    const [runs, logs, artifacts] = await Promise.all([
      countSupabaseRows("campaign_runs"),
      countSupabaseRows("run_logs"),
      countSupabaseRows("artifacts")
    ]);
    summary.counts = { artifacts, logs, runs };
  } catch (error) {
    summary.error = error instanceof Error ? error.message : String(error);
  }

  return summary;
}

class LocalJsonRunStore implements InssaRunStore {
  private writeChain: Promise<unknown> = Promise.resolve();

  async appendAuditEvent(event: Omit<InssaAuditEventRecord, "createdAt" | "id">) {
    return this.withWrite(async (snapshot) => {
      const record: InssaAuditEventRecord = {
        ...event,
        createdAt: new Date().toISOString(),
        id: crypto.randomUUID()
      };
      snapshot.auditEvents.push(record);
      return record;
    });
  }

  async appendLog(runId: string, stream: InssaRunLogRecord["stream"], message: string) {
    const logPath = path.join(getLocalRunLogDirectory(), `${runId}.jsonl`);
    const sequencePath = `${logPath}.sequence.json`;
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    return withLocalFileLock(logPath, async () => {
      let sequenceState = await readLogSequenceState(sequencePath);
      if (!sequenceState) {
        const [snapshot, incrementalLogs] = await Promise.all([this.readSnapshot(), readIncrementalLogs(logPath)]);
        const legacySequence = snapshot.logs
          .filter((log) => log.runId === runId)
          .reduce((highest, log) => Math.max(highest, log.sequence), 0);
        const incrementalSequence = incrementalLogs.reduce((highest, log) => Math.max(highest, log.sequence), 0);
        sequenceState = { count: incrementalLogs.length, lastSequence: Math.max(legacySequence, incrementalSequence) };
      }
      const record: InssaRunLogRecord = {
        createdAt: new Date().toISOString(),
        id: crypto.randomUUID(),
        message,
        runId,
        sequence: sequenceState.lastSequence + 1,
        stream
      };
      await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, "utf8");
      await writeLogSequenceState(sequencePath, { count: sequenceState.count + 1, lastSequence: record.sequence });
      return record;
    });
  }

  async createRun(input: CreateRunInput) {
    return this.withWrite(async (snapshot) => {
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const record: InssaRunRecord = {
        campaignKey: input.campaignKey,
        cleanup: input.commandSnapshot.cleanupRequired
          ? createPendingCleanup(input.commandSnapshot, id)
          : createNotRequiredCleanup(id),
        commandSnapshot: input.commandSnapshot,
        completedAt: null,
        createdAt: now,
        durationMs: null,
        exitCode: null,
        executionContext: input.executionContext ?? null,
        id,
        requestedBy: input.requestedBy,
        startedAt: null,
        status: "queued",
        updatedAt: now
      };
      snapshot.runs.push(record);
      return record;
    });
  }

  async getArtifact(id: string) {
    const snapshot = await this.readSnapshot();
    return snapshot.artifacts.find((artifact) => artifact.id === id) ?? null;
  }

  async getArtifacts(runId: string) {
    const snapshot = await this.readSnapshot();
    return snapshot.artifacts
      .filter((artifact) => artifact.runId === runId)
      .sort((left, right) => left.filePath.localeCompare(right.filePath));
  }

  async getCleanupLedgerRecord(id: string) {
    const snapshot = await this.readSnapshot();
    return snapshot.cleanupLedger.find((record) => record.id === id) ?? null;
  }

  async getEvidence(runId: string) {
    const snapshot = await this.readSnapshot();
    return {
      bundles: snapshot.evidenceBundles
        .filter((bundle) => bundle.runId === runId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      items: snapshot.evidenceItems
        .filter((item) => item.runId === runId)
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    };
  }

  async getLogs(runId: string) {
    const snapshot = await this.readSnapshot();
    const incrementalLogs = await readIncrementalLogs(path.join(getLocalRunLogDirectory(), `${runId}.jsonl`));
    return [...snapshot.logs.filter((log) => log.runId === runId), ...incrementalLogs]
      .sort((left, right) => left.sequence - right.sequence);
  }

  async getRun(id: string) {
    const snapshot = await this.readSnapshot();
    return snapshot.runs.find((run) => run.id === id) ?? null;
  }

  async listRuns() {
    const snapshot = await this.readSnapshot();
    return [...snapshot.runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listCleanupLedger() {
    const snapshot = await this.readSnapshot();
    return [...snapshot.cleanupLedger].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async replaceRunArtifacts(runId: string, artifacts: InssaArtifactRecord[]) {
    return this.withWrite(async (snapshot) => {
      snapshot.artifacts = snapshot.artifacts.filter((artifact) => artifact.runId !== runId);
      snapshot.artifacts.push(...artifacts);
      return artifacts;
    });
  }

  async replaceRunEvidence(runId: string, bundle: InssaEvidenceBundleRecord | null, items: InssaEvidenceItemRecord[]) {
    return this.withWrite(async (snapshot) => {
      snapshot.evidenceBundles = snapshot.evidenceBundles.filter((record) => record.runId !== runId);
      snapshot.evidenceItems = snapshot.evidenceItems.filter((record) => record.runId !== runId);
      if (bundle) snapshot.evidenceBundles.push(bundle);
      snapshot.evidenceItems.push(...items);
      return { bundle, items };
    });
  }

  async updateEvidenceItemMetadata(id: string, metadata: Record<string, unknown>) {
    return this.withWrite(async (snapshot) => {
      const index = snapshot.evidenceItems.findIndex((item) => item.id === id);
      if (index < 0) throw new Error(`Evidence item not found: ${id}`);
      const updated = { ...snapshot.evidenceItems[index], metadata };
      snapshot.evidenceItems[index] = updated;
      return updated;
    });
  }

  async updateRun(id: string, patch: RunPatch) {
    return this.withWrite(async (snapshot) => {
      const index = snapshot.runs.findIndex((run) => run.id === id);
      if (index < 0) {
        throw new Error(`Run not found: ${id}`);
      }

      const updated: InssaRunRecord = {
        ...snapshot.runs[index],
        ...patch,
        updatedAt: new Date().toISOString()
      };
      snapshot.runs[index] = updated;
      return updated;
    });
  }

  async upsertCleanupLedger(record: InssaCleanupLedgerRecord) {
    return this.withWrite(async (snapshot) => {
      const index = snapshot.cleanupLedger.findIndex(
        (item) =>
          item.originatingRunId === record.originatingRunId &&
          item.objectType === record.objectType &&
          item.objectId === record.objectId
      );
      if (index >= 0) snapshot.cleanupLedger[index] = record;
      else snapshot.cleanupLedger.push(record);
      return record;
    });
  }

  async replaceRunCleanupLedger(runId: string, records: InssaCleanupLedgerRecord[]) {
    return this.withWrite(async (snapshot) => {
      snapshot.cleanupLedger = [
        ...snapshot.cleanupLedger.filter((record) => record.originatingRunId !== runId),
        ...records
      ];
      return records;
    });
  }

  private async readSnapshot(): Promise<StoreSnapshot> {
    const storePath = getLocalRunStorePath();
    return readLocalSnapshot(storePath);
  }

  private async writeSnapshot(snapshot: StoreSnapshot) {
    const storePath = getLocalRunStorePath();
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, storePath);
  }

  private async withWrite<T>(operation: (snapshot: StoreSnapshot) => T | Promise<T>) {
    const resultPromise = this.writeChain.then(async () => {
      const storePath = getLocalRunStorePath();
      await fs.mkdir(path.dirname(storePath), { recursive: true });
      return withLocalFileLock(storePath, async () => {
        const snapshot = await this.readSnapshot();
        const result = await operation(snapshot);
        await this.writeSnapshot(snapshot);
        return result;
      });
    });

    this.writeChain = resultPromise.catch(() => {});
    return resultPromise;
  }
}

async function readLocalSnapshot(storePath: string): Promise<StoreSnapshot> {
  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Omit<Partial<StoreSnapshot>, "schemaVersion"> & { schemaVersion?: number };
    const schemaVersion = parsed.schemaVersion ?? 1;
    if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3 && schemaVersion !== 4) {
      throw new Error(`Unsupported run store schema version: ${String(schemaVersion)}`);
    }
    return {
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts : [],
      auditEvents: Array.isArray(parsed.auditEvents) ? parsed.auditEvents : [],
      cleanupLedger: Array.isArray(parsed.cleanupLedger) ? parsed.cleanupLedger.map(normalizeCleanupLedgerRecord) : [],
      evidenceBundles: Array.isArray(parsed.evidenceBundles) ? parsed.evidenceBundles : [],
      evidenceItems: Array.isArray(parsed.evidenceItems) ? parsed.evidenceItems : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs.map(normalizeRunRecord) : [],
      schemaVersion: 4
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        artifacts: [],
        auditEvents: [],
        cleanupLedger: [],
        evidenceBundles: [],
        evidenceItems: [],
        logs: [],
        runs: [],
        schemaVersion: 4
      };
    }
    throw error;
  }
}

async function readIncrementalLogs(logPath: string): Promise<InssaRunLogRecord[]> {
  try {
    const raw = await fs.readFile(logPath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as InssaRunLogRecord);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function countIncrementalLogs() {
  try {
    const entries = await fs.readdir(getLocalRunLogDirectory(), { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const logPath = path.join(getLocalRunLogDirectory(), entry.name);
      const state = await readLogSequenceState(`${logPath}.sequence.json`);
      count += state?.count ?? (await readIncrementalLogs(logPath)).length;
    }
    return count;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return 0;
    throw error;
  }
}

async function readLogSequenceState(sequencePath: string): Promise<{ count: number; lastSequence: number } | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(sequencePath, "utf8")) as { count?: unknown; lastSequence?: unknown };
    if (typeof parsed.count !== "number" || typeof parsed.lastSequence !== "number") return null;
    return { count: parsed.count, lastSequence: parsed.lastSequence };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeLogSequenceState(sequencePath: string, state: { count: number; lastSequence: number }) {
  const temporaryPath = `${sequencePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(state), "utf8");
  await fs.rename(temporaryPath, sequencePath);
}

async function countSupabaseRows(table: string) {
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const baseUrl = `${process.env.SUPABASE_URL}/rest/v1`;
  const response = await fetch(`${baseUrl}/${table}?select=id`, {
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${apiKey}`,
      prefer: "count=exact",
      range: "0-0"
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Supabase metadata count failed for ${table}: ${response.status} ${response.statusText}${text ? ` ${text}` : ""}`);
  }

  const contentRange = response.headers.get("content-range") ?? "";
  const count = Number(contentRange.split("/")[1]);
  return Number.isFinite(count) ? count : 0;
}

class SupabaseRunStore implements InssaRunStore {
  private readonly apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  private readonly baseUrl = `${process.env.SUPABASE_URL}/rest/v1`;

  async appendAuditEvent(event: Omit<InssaAuditEventRecord, "createdAt" | "id">) {
    const record: InssaAuditEventRecord = {
      ...event,
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID()
    };
    await this.request("audit_events", {
      body: JSON.stringify(toSupabaseAuditEvent(record)),
      method: "POST"
    });
    return record;
  }

  async appendLog(runId: string, stream: InssaRunLogRecord["stream"], message: string) {
    const rows = await this.request(
      `run_logs?run_id=eq.${encodeURIComponent(runId)}&select=sequence&order=sequence.desc&limit=1`
    );
    const sequence = Number(rows[0]?.sequence ?? 0) + 1;
    const record: InssaRunLogRecord = {
      createdAt: new Date().toISOString(),
      id: crypto.randomUUID(),
      message,
      runId,
      sequence,
      stream
    };
    await this.request("run_logs", {
      body: JSON.stringify(toSupabaseLog(record)),
      method: "POST"
    });
    return record;
  }

  async createRun(input: CreateRunInput) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const record: InssaRunRecord = {
      campaignKey: input.campaignKey,
      cleanup: input.commandSnapshot.cleanupRequired
        ? createPendingCleanup(input.commandSnapshot, id)
        : createNotRequiredCleanup(id),
      commandSnapshot: input.commandSnapshot,
      completedAt: null,
      createdAt: now,
      durationMs: null,
      exitCode: null,
      executionContext: input.executionContext ?? null,
      id,
      requestedBy: input.requestedBy,
      startedAt: null,
      status: "queued",
      updatedAt: now
    };
    await this.request("campaign_runs", {
      body: JSON.stringify(toSupabaseRun(record)),
      method: "POST"
    });
    return record;
  }

  async getArtifact(id: string) {
    const rows = await this.request(`artifacts?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0] ? fromSupabaseArtifact(rows[0]) : null;
  }

  async getArtifacts(runId: string) {
    const rows = await this.request(`artifacts?run_id=eq.${encodeURIComponent(runId)}&order=file_path.asc`);
    return rows.map(fromSupabaseArtifact);
  }

  async getCleanupLedgerRecord(id: string) {
    const rows = await this.request(`cleanup_ledger?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0] ? fromSupabaseCleanupLedger(rows[0]) : null;
  }

  async getEvidence(runId: string) {
    const [bundleRows, itemRows] = await Promise.all([
      this.request(`evidence_bundles?run_id=eq.${encodeURIComponent(runId)}&order=created_at.desc`),
      this.request(`evidence_items?run_id=eq.${encodeURIComponent(runId)}&order=relative_path.asc`)
    ]);
    return {
      bundles: bundleRows.map(fromSupabaseEvidenceBundle),
      items: itemRows.map(fromSupabaseEvidenceItem)
    };
  }

  async getLogs(runId: string) {
    const rows = await this.request(`run_logs?run_id=eq.${encodeURIComponent(runId)}&order=sequence.asc`);
    return rows.map(fromSupabaseLog);
  }

  async getRun(id: string) {
    const rows = await this.request(`campaign_runs?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0] ? fromSupabaseRun(rows[0]) : null;
  }

  async listRuns() {
    const rows = await this.request("campaign_runs?order=created_at.desc");
    return rows.map(fromSupabaseRun);
  }

  async listCleanupLedger() {
    const rows = await this.request("cleanup_ledger?order=created_at.desc");
    return rows.map(fromSupabaseCleanupLedger);
  }

  async replaceRunArtifacts(runId: string, artifacts: InssaArtifactRecord[]) {
    await this.request(`artifacts?run_id=eq.${encodeURIComponent(runId)}`, {
      method: "DELETE"
    });

    if (artifacts.length > 0) {
      await this.request("artifacts", {
        body: JSON.stringify(artifacts.map(toSupabaseArtifact)),
        method: "POST"
      });
    }

    return artifacts;
  }

  async replaceRunCleanupLedger(runId: string, records: InssaCleanupLedgerRecord[]) {
    await this.request(`cleanup_ledger?originating_run_id=eq.${encodeURIComponent(runId)}`, {
      method: "DELETE"
    });
    if (records.length > 0) {
      await this.request("cleanup_ledger", {
        body: JSON.stringify(records.map(toSupabaseCleanupLedger)),
        method: "POST"
      });
    }
    return records;
  }

  async replaceRunEvidence(runId: string, bundle: InssaEvidenceBundleRecord | null, items: InssaEvidenceItemRecord[]) {
    await this.request(`evidence_items?run_id=eq.${encodeURIComponent(runId)}`, {
      method: "DELETE"
    });
    await this.request(`evidence_bundles?run_id=eq.${encodeURIComponent(runId)}`, {
      method: "DELETE"
    });

    if (bundle) {
      await this.request("evidence_bundles", {
        body: JSON.stringify(toSupabaseEvidenceBundle(bundle)),
        method: "POST"
      });
    }

    if (items.length > 0) {
      await this.request("evidence_items", {
        body: JSON.stringify(items.map(toSupabaseEvidenceItem)),
        method: "POST"
      });
    }

    return { bundle, items };
  }

  async updateEvidenceItemMetadata(id: string, metadata: Record<string, unknown>) {
    const rows = await this.request(`evidence_items?id=eq.${encodeURIComponent(id)}&limit=1`);
    if (!rows[0]) throw new Error(`Evidence item not found: ${id}`);
    await this.request(`evidence_items?id=eq.${encodeURIComponent(id)}`, {
      body: JSON.stringify({ metadata }),
      method: "PATCH"
    });
    return fromSupabaseEvidenceItem({ ...rows[0], metadata });
  }

  async updateRun(id: string, patch: RunPatch) {
    const current = await this.getRun(id);
    if (!current) {
      throw new Error(`Run not found: ${id}`);
    }

    const updated: InssaRunRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    await this.request(`campaign_runs?id=eq.${encodeURIComponent(id)}`, {
      body: JSON.stringify(toSupabaseRun(updated)),
      method: "PATCH"
    });
    return updated;
  }

  async upsertCleanupLedger(record: InssaCleanupLedgerRecord) {
    await this.request("cleanup_ledger?on_conflict=originating_run_id,object_type,object_id", {
      body: JSON.stringify(toSupabaseCleanupLedger(record)),
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      method: "POST"
    });
    return record;
  }

  private async request(resource: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}/${resource}`, {
      ...init,
      headers: {
        apikey: this.apiKey,
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        prefer: "return=minimal",
        ...init.headers
      }
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Supabase metadata request failed: ${response.status} ${response.statusText}${text ? ` ${text}` : ""}`);
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return [];
    }

    return response.json();
  }
}

function toSupabaseRun(run: InssaRunRecord) {
  return {
    campaign_key: run.campaignKey,
    cleanup: withRunId(run.cleanup, run.id),
    command_snapshot: run.commandSnapshot,
    completed_at: run.completedAt,
    created_at: run.createdAt,
    duration_ms: run.durationMs,
    exit_code: run.exitCode,
    execution_context: run.executionContext,
    id: run.id,
    requested_by: run.requestedBy,
    started_at: run.startedAt,
    status: run.status,
    updated_at: run.updatedAt
  };
}

function fromSupabaseRun(row: Record<string, unknown>): InssaRunRecord {
  return {
    campaignKey: String(row.campaign_key),
    cleanup: normalizeCleanup(row.cleanup, String(row.id)),
    commandSnapshot: row.command_snapshot as InssaRunRecord["commandSnapshot"],
    completedAt: nullableString(row.completed_at),
    createdAt: String(row.created_at),
    durationMs: nullableNumber(row.duration_ms),
    exitCode: nullableNumber(row.exit_code),
    executionContext: (row.execution_context as InssaRunRecord["executionContext"]) ?? null,
    id: String(row.id),
    requestedBy: String(row.requested_by),
    startedAt: nullableString(row.started_at),
    status: row.status as InssaRunRecord["status"],
    updatedAt: String(row.updated_at)
  };
}

function toSupabaseLog(log: InssaRunLogRecord) {
  return {
    created_at: log.createdAt,
    id: log.id,
    message: log.message,
    run_id: log.runId,
    sequence: log.sequence,
    stream: log.stream
  };
}

function fromSupabaseLog(row: Record<string, unknown>): InssaRunLogRecord {
  return {
    createdAt: String(row.created_at),
    id: String(row.id),
    message: String(row.message),
    runId: String(row.run_id),
    sequence: Number(row.sequence),
    stream: row.stream as InssaRunLogRecord["stream"]
  };
}

function toSupabaseArtifact(artifact: InssaArtifactRecord) {
  return {
    artifact_type: artifact.artifactType,
    content_type: artifact.contentType,
    created_at: artifact.createdAt,
    file_path: artifact.filePath,
    file_size: artifact.fileSize,
    id: artifact.id,
    render_inline: artifact.renderInline,
    run_id: artifact.runId,
    sensitive: artifact.sensitive,
    sha256: artifact.sha256
  };
}

function toSupabaseEvidenceBundle(bundle: InssaEvidenceBundleRecord) {
  return {
    bundle_type: bundle.bundleType,
    campaign_key: bundle.campaignKey,
    checksum_manifest: bundle.checksumManifest,
    created_at: bundle.createdAt,
    environment: bundle.environment,
    id: bundle.id,
    indexed_at: bundle.indexedAt,
    item_count: bundle.itemCount,
    product: bundle.product,
    retention_class: bundle.retentionClass,
    root_path: bundle.rootPath,
    run_id: bundle.runId,
    sensitive: bundle.sensitive,
    source_artifact_id: bundle.sourceArtifactId,
    status: bundle.status,
    storage_backend: bundle.storageBackend,
    storage_prefix: bundle.storagePrefix,
    title: bundle.title,
    total_bytes: bundle.totalBytes,
    upload_error: bundle.uploadError,
    upload_status: bundle.uploadStatus,
    uploaded_at: bundle.uploadedAt
  };
}

function fromSupabaseEvidenceBundle(row: Record<string, unknown>): InssaEvidenceBundleRecord {
  return {
    bundleType: row.bundle_type as InssaEvidenceBundleRecord["bundleType"],
    campaignKey: String(row.campaign_key),
    checksumManifest: recordValue(row.checksum_manifest),
    createdAt: String(row.created_at),
    environment: String(row.environment),
    id: String(row.id),
    indexedAt: String(row.indexed_at),
    itemCount: Number(row.item_count),
    product: String(row.product),
    retentionClass: row.retention_class as InssaEvidenceBundleRecord["retentionClass"],
    rootPath: String(row.root_path),
    runId: String(row.run_id),
    sensitive: Boolean(row.sensitive),
    sourceArtifactId: nullableString(row.source_artifact_id),
    status: row.status as InssaEvidenceBundleRecord["status"],
    storageBackend: row.storage_backend as InssaEvidenceBundleRecord["storageBackend"],
    storagePrefix: nullableString(row.storage_prefix),
    title: String(row.title),
    totalBytes: Number(row.total_bytes),
    uploadError: nullableString(row.upload_error),
    uploadStatus: (row.upload_status as InssaEvidenceBundleRecord["uploadStatus"]) ?? "local_only",
    uploadedAt: nullableString(row.uploaded_at)
  };
}

function toSupabaseEvidenceItem(item: InssaEvidenceItemRecord) {
  return {
    artifact_id: item.artifactId,
    bundle_id: item.bundleId,
    campaign_key: item.campaignKey,
    content_type: item.contentType,
    created_at: item.createdAt,
    file_name: item.fileName,
    id: item.id,
    item_type: item.itemType,
    metadata: item.metadata,
    relative_path: item.relativePath,
    render_inline: item.renderInline,
    retention_class: item.retentionClass,
    run_id: item.runId,
    sensitive: item.sensitive,
    sha256: item.sha256,
    size_bytes: item.sizeBytes,
    storage_backend: item.storageBackend,
    storage_key: item.storageKey,
    upload_error: item.uploadError,
    upload_status: item.uploadStatus,
    uploaded_at: item.uploadedAt
  };
}

function fromSupabaseEvidenceItem(row: Record<string, unknown>): InssaEvidenceItemRecord {
  return {
    artifactId: String(row.artifact_id),
    bundleId: String(row.bundle_id),
    campaignKey: String(row.campaign_key),
    contentType: String(row.content_type),
    createdAt: String(row.created_at),
    fileName: String(row.file_name),
    id: String(row.id),
    itemType: String(row.item_type),
    metadata: recordValue(row.metadata),
    relativePath: String(row.relative_path),
    renderInline: Boolean(row.render_inline),
    retentionClass: row.retention_class as InssaEvidenceItemRecord["retentionClass"],
    runId: String(row.run_id),
    sensitive: Boolean(row.sensitive),
    sha256: String(row.sha256),
    sizeBytes: Number(row.size_bytes),
    storageBackend: row.storage_backend as InssaEvidenceItemRecord["storageBackend"],
    storageKey: String(row.storage_key),
    uploadError: nullableString(row.upload_error),
    uploadStatus: (row.upload_status as InssaEvidenceItemRecord["uploadStatus"]) ?? "local_only",
    uploadedAt: nullableString(row.uploaded_at)
  };
}

function fromSupabaseArtifact(row: Record<string, unknown>): InssaArtifactRecord {
  return {
    artifactType: String(row.artifact_type),
    contentType: String(row.content_type),
    createdAt: String(row.created_at),
    filePath: String(row.file_path),
    fileSize: Number(row.file_size),
    id: String(row.id),
    renderInline: Boolean(row.render_inline),
    runId: String(row.run_id),
    sensitive: Boolean(row.sensitive),
    sha256: String(row.sha256)
  };
}

function toSupabaseCleanupLedger(record: InssaCleanupLedgerRecord) {
  return {
    affected_users: record.affectedUsers,
    campaign_key: record.campaignKey,
    created_at: record.createdAt,
    dedicated_qa_account: record.dedicatedQaAccount,
    deferred_at: record.deferredAt,
    environment: record.environment,
    evidence_paths: record.evidencePaths,
    id: record.id,
    media_type: record.mediaType,
    notes: record.notes,
    object_id: record.objectId,
    object_path: record.objectPath,
    object_type: record.objectType,
    originating_run_id: record.originatingRunId,
    owner_account: record.ownerAccount,
    product: record.product,
    reason_code: record.reasonCode,
    resulting_state: record.resultingState,
    resolved_at: record.resolvedAt,
    retention_until: record.retentionUntil,
    safely_accounted: record.safelyAccounted,
    schema_version: record.schemaVersion,
    security_sensitive: record.securitySensitive,
    sensitive_values_excluded: record.sensitiveValuesExcluded,
    selected_recipient: record.selectedRecipient,
    status: record.status,
    unexpected_data: record.unexpectedData,
    updated_at: record.updatedAt,
    verification_methods: record.verificationMethods
  };
}

function fromSupabaseCleanupLedger(row: Record<string, unknown>): InssaCleanupLedgerRecord {
  return normalizeCleanupLedgerRecord({
    affectedUsers: row.affected_users,
    campaignKey: row.campaign_key,
    createdAt: row.created_at,
    dedicatedQaAccount: row.dedicated_qa_account,
    deferredAt: row.deferred_at,
    environment: row.environment,
    evidencePaths: row.evidence_paths,
    id: row.id,
    mediaType: row.media_type,
    notes: row.notes,
    objectId: row.object_id,
    objectPath: row.object_path,
    objectType: row.object_type,
    originatingRunId: row.originating_run_id,
    ownerAccount: row.owner_account,
    product: row.product,
    reasonCode: row.reason_code,
    resultingState: row.resulting_state,
    resolvedAt: row.resolved_at,
    retentionUntil: row.retention_until,
    safelyAccounted: row.safely_accounted,
    schemaVersion: row.schema_version,
    securitySensitive: row.security_sensitive,
    sensitiveValuesExcluded: row.sensitive_values_excluded,
    selectedRecipient: row.selected_recipient,
    status: row.status,
    unexpectedData: row.unexpected_data,
    updatedAt: row.updated_at,
    verificationMethods: row.verification_methods
  });
}

function toSupabaseAuditEvent(event: InssaAuditEventRecord) {
  return {
    actor_email: event.actorEmail,
    actor_user_id: event.actorUserId,
    campaign_key: event.campaignKey,
    created_at: event.createdAt,
    event_type: event.eventType,
    id: event.id,
    metadata: event.metadata,
    role: event.role,
    run_id: event.runId,
    status: event.status
  };
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

function recordValue(value: unknown): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {};
}

function normalizeRunRecord(run: InssaRunRecord): InssaRunRecord {
  return {
    ...run,
    cleanup: normalizeCleanup(run.cleanup, run.id),
    executionContext: run.executionContext ?? null
  };
}

function normalizeCleanup(value: unknown, runId: string): InssaCleanupManifest {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const cleanup = value as Partial<InssaCleanupManifest>;
    return {
      affectedUsers: Array.isArray(cleanup.affectedUsers) ? cleanup.affectedUsers.filter((item): item is string => typeof item === "string") : [],
      automaticCleanupAvailable: cleanup.automaticCleanupAvailable === true,
      cleanupMethod: nullableString(cleanup.cleanupMethod),
      cleanupResult: nullableString(cleanup.cleanupResult),
      cleanupTimestamp: nullableString(cleanup.cleanupTimestamp),
      confirmedAt: nullableString(cleanup.confirmedAt),
      confirmedBy: nullableString(cleanup.confirmedBy),
      createdArtifactIds: stringArray(cleanup.createdArtifactIds),
      createdCapsuleIds: stringArray(cleanup.createdCapsuleIds),
      createdMediaIds: stringArray(cleanup.createdMediaIds),
      dedicatedQaAccount: cleanup.dedicatedQaAccount === true,
      evidencePaths: stringArray(cleanup.evidencePaths),
      finalActionPerformed: cleanup.finalActionPerformed === true,
      instructions: stringArray(cleanup.instructions),
      lifecycleState: nullableString(cleanup.lifecycleState),
      mediaType: cleanup.mediaType === "image" || cleanup.mediaType === "video" ? cleanup.mediaType : null,
      ownerAccount: nullableString(cleanup.ownerAccount),
      reasonCode: nullableString(cleanup.reasonCode),
      recordedAt: nullableString(cleanup.recordedAt) ?? undefined,
      relatedDefectId: nullableString(cleanup.relatedDefectId),
      retentionUntil: nullableString(cleanup.retentionUntil),
      runId,
      safelyAccounted: cleanup.safelyAccounted === true,
      schemaVersion: cleanup.schemaVersion === 2 ? 2 : 1,
      sensitiveValuesExcluded: cleanup.sensitiveValuesExcluded === true,
      selectedRecipient: nullableString(cleanup.selectedRecipient),
      status: ["cleanup_unavailable", "completed", "deferred", "failed", "manually_confirmed", "not_required", "pending"].includes(String(cleanup.status))
        ? (cleanup.status as InssaCleanupManifest["status"])
        : "not_required",
      unexpectedData: cleanup.unexpectedData === true,
      verificationMethods: stringArray(cleanup.verificationMethods),
      verifiedAt: nullableString(cleanup.verifiedAt),
      verifier: nullableString(cleanup.verifier)
    };
  }
  return createNotRequiredCleanup(runId);
}

function normalizeCleanupLedgerRecord(value: unknown): InssaCleanupLedgerRecord {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Partial<InssaCleanupLedgerRecord>)
    : {};
  const objectType = record.objectType === "media" ? "media" : "time_capsule";
  const objectId = typeof record.objectId === "string" ? record.objectId : "";
  const originatingRunId = typeof record.originatingRunId === "string" ? record.originatingRunId : "";
  const status = ["cleanup_unavailable", "completed", "deferred", "failed", "pending"].includes(String(record.status))
    ? (record.status as InssaCleanupLedgerRecord["status"])
    : "pending";
  const createdAt = nullableString(record.createdAt) ?? new Date(0).toISOString();
  return {
    affectedUsers: stringArray(record.affectedUsers),
    campaignKey: nullableString(record.campaignKey) ?? "unknown",
    createdAt,
    dedicatedQaAccount: record.dedicatedQaAccount === true,
    deferredAt: nullableString(record.deferredAt),
    environment: "staging",
    evidencePaths: stringArray(record.evidencePaths),
    id: nullableString(record.id) ?? cleanupLedgerId(originatingRunId, objectType, objectId),
    mediaType: record.mediaType === "image" || record.mediaType === "video" ? record.mediaType : null,
    notes: nullableString(record.notes),
    objectId,
    objectPath: nullableString(record.objectPath) ?? `${objectType === "media" ? "media" : "timeCapsules"}/${objectId}`,
    objectType,
    originatingRunId,
    ownerAccount: nullableString(record.ownerAccount),
    product: "INSSA",
    reasonCode: nullableString(record.reasonCode),
    resultingState: nullableString(record.resultingState),
    resolvedAt: nullableString(record.resolvedAt),
    retentionUntil: nullableString(record.retentionUntil) ?? createdAt,
    safelyAccounted: record.safelyAccounted === true,
    schemaVersion: 1,
    securitySensitive: record.securitySensitive === true,
    sensitiveValuesExcluded: record.sensitiveValuesExcluded === true,
    selectedRecipient: nullableString(record.selectedRecipient),
    status,
    unexpectedData: record.unexpectedData === true,
    updatedAt: nullableString(record.updatedAt) ?? createdAt,
    verificationMethods: stringArray(record.verificationMethods)
  };
}

function cleanupLedgerId(runId: string, objectType: string, objectId: string) {
  return `${runId}:${objectType}:${objectId}`;
}

function createPendingCleanup(command: InssaCommandDefinition, runId: string): InssaCleanupManifest {
  return {
    affectedUsers: [],
    automaticCleanupAvailable: false,
    confirmedAt: null,
    confirmedBy: null,
    createdArtifactIds: [],
    createdCapsuleIds: [],
    createdMediaIds: [],
    finalActionPerformed: false,
    instructions: [`Review ${command.displayName} evidence and remove all QA-tagged staging data created by this run.`],
    lifecycleState: "queued",
    runId,
    schemaVersion: 1,
    status: "pending"
  };
}

function createNotRequiredCleanup(runId: string): InssaCleanupManifest {
  return {
    affectedUsers: [],
    automaticCleanupAvailable: false,
    confirmedAt: null,
    confirmedBy: null,
    createdArtifactIds: [],
    createdCapsuleIds: [],
    createdMediaIds: [],
    finalActionPerformed: false,
    instructions: [],
    lifecycleState: null,
    runId,
    schemaVersion: 1,
    status: "not_required"
  };
}

function withRunId(value: InssaCleanupManifest | null | undefined, runId: string) {
  return value ? { ...value, runId } : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
