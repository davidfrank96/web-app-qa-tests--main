import fs from "node:fs/promises";
import path from "node:path";
import { withLocalFileLock } from "../inssa-ops/local-file-lock";
import { getLocalMonitoringDefinitionPath } from "../inssa-ops/paths";
import { DEFAULT_MONITORING_DEFINITIONS } from "./catalog";
import type { MonitoringDefinition, MonitoringSeverity, MonitoringTriggerType } from "./types";

type MonitoringSnapshot = {
  definitions: MonitoringDefinition[];
  schemaVersion: 1;
};

export type MonitoringDefinitionFilters = {
  campaignId?: string;
  enabled?: boolean;
  environment?: string;
  product?: string;
  severity?: MonitoringSeverity;
  triggerType?: MonitoringTriggerType;
};

export type MonitoringDefinitionPage = {
  items: MonitoringDefinition[];
  pagination: {
    hasMore: boolean;
    limit: number;
    nextCursor: string | null;
    total: number;
  };
};

export interface MonitoringDefinitionStore {
  get(id: string): Promise<MonitoringDefinition | null>;
  list(filters: MonitoringDefinitionFilters, cursor: number, limit: number): Promise<MonitoringDefinitionPage>;
}

let singleton: MonitoringDefinitionStore | null = null;

export function getMonitoringDefinitionStore(): MonitoringDefinitionStore {
  if (!singleton) singleton = shouldUseSupabaseStore() ? new SupabaseMonitoringDefinitionStore() : new LocalMonitoringDefinitionStore();
  return singleton;
}

class LocalMonitoringDefinitionStore implements MonitoringDefinitionStore {
  async get(id: string) {
    const snapshot = await readOrInitializeLocalSnapshot();
    return snapshot.definitions.find((definition) => definition.id === id) ?? null;
  }

  async list(filters: MonitoringDefinitionFilters, cursor: number, limit: number) {
    const snapshot = await readOrInitializeLocalSnapshot();
    const matching = snapshot.definitions
      .filter((definition) => matchesFilters(definition, filters))
      .sort((left, right) => left.name.localeCompare(right.name));
    return pageDefinitions(matching, cursor, limit);
  }
}

class SupabaseMonitoringDefinitionStore implements MonitoringDefinitionStore {
  private readonly apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  private readonly baseUrl = `${process.env.SUPABASE_URL}/rest/v1`;

  async get(id: string) {
    const rows = await this.request(`monitoring_definitions?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0] ? fromSupabaseRecord(rows[0]) : null;
  }

  async list(filters: MonitoringDefinitionFilters, cursor: number, limit: number) {
    const clauses = ["order=name.asc"];
    if (filters.campaignId) clauses.push(`campaign_id=eq.${encodeURIComponent(filters.campaignId)}`);
    if (filters.enabled !== undefined) clauses.push(`enabled=eq.${String(filters.enabled)}`);
    if (filters.environment) clauses.push(`environment=eq.${encodeURIComponent(filters.environment)}`);
    if (filters.product) clauses.push(`product=eq.${encodeURIComponent(filters.product)}`);
    if (filters.severity) clauses.push(`severity=eq.${encodeURIComponent(filters.severity)}`);
    if (filters.triggerType) clauses.push(`trigger_type=eq.${encodeURIComponent(filters.triggerType)}`);
    const response = await fetch(`${this.baseUrl}/monitoring_definitions?${clauses.join("&")}`, {
      headers: {
        apikey: this.apiKey,
        authorization: `Bearer ${this.apiKey}`,
        prefer: "count=exact",
        range: `${cursor}-${cursor + limit - 1}`
      }
    });
    if (!response.ok) throw await supabaseError(response);
    const rows = (await response.json()) as Record<string, unknown>[];
    const total = Number(response.headers.get("content-range")?.split("/")[1] ?? rows.length);
    const nextOffset = cursor + rows.length;
    return {
      items: rows.map(fromSupabaseRecord),
      pagination: {
        hasMore: nextOffset < total,
        limit,
        nextCursor: nextOffset < total ? String(nextOffset) : null,
        total
      }
    };
  }

  private async request(resource: string): Promise<Record<string, unknown>[]> {
    const response = await fetch(`${this.baseUrl}/${resource}`, {
      headers: { apikey: this.apiKey, authorization: `Bearer ${this.apiKey}` }
    });
    if (!response.ok) throw await supabaseError(response);
    return (await response.json()) as Record<string, unknown>[];
  }
}

async function readOrInitializeLocalSnapshot(): Promise<MonitoringSnapshot> {
  const storePath = getLocalMonitoringDefinitionPath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  return withLocalFileLock(storePath, async () => {
    let snapshot: MonitoringSnapshot;
    try {
      snapshot = normalizeSnapshot(JSON.parse(await fs.readFile(storePath, "utf8")) as Partial<MonitoringSnapshot>);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
      snapshot = {
        definitions: structuredClone(DEFAULT_MONITORING_DEFINITIONS),
        schemaVersion: 1
      };
    }
    const temporaryPath = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, storePath);
    return snapshot;
  });
}

function normalizeSnapshot(snapshot: Partial<MonitoringSnapshot>): MonitoringSnapshot {
  if (snapshot.schemaVersion !== 1) throw new Error(`Unsupported monitoring definition schema version: ${String(snapshot.schemaVersion)}`);
  const definitions = Array.isArray(snapshot.definitions) ? snapshot.definitions.map(validateDefinition) : [];
  const existingIds = new Set(definitions.map((definition) => definition.id));
  return {
    definitions: [
      ...definitions,
      ...structuredClone(DEFAULT_MONITORING_DEFINITIONS.filter((definition) => !existingIds.has(definition.id)))
    ],
    schemaVersion: 1
  };
}

function validateDefinition(value: MonitoringDefinition): MonitoringDefinition {
  if (!value?.id || !value.name || !value.product || !value.campaignId || !value.environment) {
    throw new Error("Monitoring definition is missing required identity fields.");
  }
  if (value.schemaVersion !== 1) throw new Error(`Unsupported monitoring definition record schema: ${String(value.schemaVersion)}`);
  return value;
}

function matchesFilters(definition: MonitoringDefinition, filters: MonitoringDefinitionFilters) {
  return (
    (!filters.campaignId || definition.campaignId === filters.campaignId) &&
    (filters.enabled === undefined || definition.enabled === filters.enabled) &&
    (!filters.environment || definition.environment === filters.environment) &&
    (!filters.product || definition.product === filters.product) &&
    (!filters.severity || definition.severity === filters.severity) &&
    (!filters.triggerType || definition.triggerType === filters.triggerType)
  );
}

function pageDefinitions(items: MonitoringDefinition[], cursor: number, limit: number): MonitoringDefinitionPage {
  const page = items.slice(cursor, cursor + limit);
  const nextOffset = cursor + page.length;
  return {
    items: page,
    pagination: {
      hasMore: nextOffset < items.length,
      limit,
      nextCursor: nextOffset < items.length ? String(nextOffset) : null,
      total: items.length
    }
  };
}

function fromSupabaseRecord(row: Record<string, unknown>): MonitoringDefinition {
  return validateDefinition({
    campaignId: String(row.campaign_id),
    createdAt: String(row.created_at),
    enabled: Boolean(row.enabled),
    environment: String(row.environment),
    evidencePolicy: row.evidence_policy as MonitoringDefinition["evidencePolicy"],
    id: String(row.id),
    name: String(row.name),
    notificationPolicy: row.notification_policy as MonitoringDefinition["notificationPolicy"],
    product: String(row.product),
    retryPolicy: recordValue(row.retry_policy) as MonitoringDefinition["retryPolicy"],
    runPolicy: row.run_policy as MonitoringDefinition["runPolicy"],
    schedule: monitoringSchedule(row.schedule_config ?? row.schedule),
    schemaVersion: 1,
    severity: row.severity as MonitoringDefinition["severity"],
    timeout: Number(row.timeout_ms),
    triggerType: row.trigger_type as MonitoringDefinition["triggerType"],
    updatedAt: String(row.updated_at)
  });
}

function shouldUseSupabaseStore() {
  if (process.env.INSSA_OPS_METADATA_STORE !== "supabase") return false;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase monitoring persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; refusing an unsafe local or anon-key fallback."
    );
  }
  return true;
}

async function supabaseError(response: Response) {
  const text = await response.text().catch(() => "");
  return new Error(`Supabase monitoring definition request failed: ${response.status} ${response.statusText}${text ? ` ${text}` : ""}`);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function monitoringSchedule(value: unknown): MonitoringDefinition["schedule"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as MonitoringDefinition["schedule"];
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
