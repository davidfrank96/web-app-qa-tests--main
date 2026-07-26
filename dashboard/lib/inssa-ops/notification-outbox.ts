import fs from "node:fs/promises";
import path from "node:path";
import { withLocalFileLock } from "./local-file-lock";
import { getLocalNotificationOutboxPath } from "./paths";
import { redactInssaLogLine } from "./redaction";
import type {
  CreateNotificationOutboxInput,
  NotificationOutboxRecord,
  NotificationOutboxStatus,
  NotificationSeverity
} from "./types";

type NotificationOutboxSnapshot = {
  notifications: NotificationOutboxRecord[];
  schemaVersion: 1;
};

export type NotificationOutboxFilters = {
  campaign?: string;
  environment?: string;
  product?: string;
  runId?: string;
  severity?: NotificationSeverity;
  status?: NotificationOutboxStatus;
};

export type NotificationOutboxPage = {
  items: NotificationOutboxRecord[];
  pagination: {
    hasMore: boolean;
    limit: number;
    nextCursor: string | null;
    total: number;
  };
};

export interface NotificationOutboxStore {
  create(input: CreateNotificationOutboxInput): Promise<{ created: boolean; notification: NotificationOutboxRecord }>;
  get(id: string): Promise<NotificationOutboxRecord | null>;
  list(filters: NotificationOutboxFilters, cursor: number, limit: number): Promise<NotificationOutboxPage>;
}

let singleton: NotificationOutboxStore | null = null;

export function getNotificationOutboxStore(): NotificationOutboxStore {
  if (!singleton) singleton = shouldUseSupabaseStore() ? new SupabaseNotificationOutboxStore() : new LocalNotificationOutboxStore();
  return singleton;
}

class LocalNotificationOutboxStore implements NotificationOutboxStore {
  async create(input: CreateNotificationOutboxInput) {
    const storePath = getLocalNotificationOutboxPath();
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    return withLocalFileLock(storePath, async () => {
      const snapshot = await readLocalSnapshot(storePath);
      const existing = snapshot.notifications.find((notification) => notification.deduplicationKey === input.deduplicationKey);
      if (existing) return { created: false, notification: existing };
      const notification = createRecord(input);
      snapshot.notifications.push(notification);
      await writeLocalSnapshot(storePath, snapshot);
      return { created: true, notification };
    });
  }

  async get(id: string) {
    const snapshot = await readLocalSnapshot(getLocalNotificationOutboxPath());
    return snapshot.notifications.find((notification) => notification.id === id) ?? null;
  }

  async list(filters: NotificationOutboxFilters, cursor: number, limit: number) {
    const snapshot = await readLocalSnapshot(getLocalNotificationOutboxPath());
    const matching = snapshot.notifications
      .filter((notification) => matchesFilters(notification, filters))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return pageRecords(matching, cursor, limit);
  }
}

class SupabaseNotificationOutboxStore implements NotificationOutboxStore {
  private readonly apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  private readonly baseUrl = `${process.env.SUPABASE_URL}/rest/v1`;

  async create(input: CreateNotificationOutboxInput) {
    const existing = await this.getByDeduplicationKey(input.deduplicationKey);
    if (existing) return { created: false, notification: existing };
    const notification = createRecord(input);
    const rows = await this.request("notification_outbox?on_conflict=deduplication_key", {
      body: JSON.stringify(toSupabaseRecord(notification)),
      headers: { prefer: "resolution=ignore-duplicates,return=representation" },
      method: "POST"
    });
    if (rows[0]) return { created: true, notification: fromSupabaseRecord(rows[0]) };
    const concurrent = await this.getByDeduplicationKey(input.deduplicationKey);
    if (!concurrent) throw new Error("Notification outbox insert was ignored without an existing deduplication record.");
    return { created: false, notification: concurrent };
  }

  async get(id: string) {
    const rows = await this.request(`notification_outbox?id=eq.${encodeURIComponent(id)}&limit=1`);
    return rows[0] ? fromSupabaseRecord(rows[0]) : null;
  }

  async list(filters: NotificationOutboxFilters, cursor: number, limit: number) {
    const clauses = ["order=created_at.desc"];
    if (filters.status) clauses.push(`status=eq.${encodeURIComponent(filters.status)}`);
    if (filters.severity) clauses.push(`severity=eq.${encodeURIComponent(filters.severity)}`);
    if (filters.campaign) clauses.push(`campaign_id=eq.${encodeURIComponent(filters.campaign)}`);
    if (filters.environment) clauses.push(`environment=eq.${encodeURIComponent(filters.environment)}`);
    if (filters.product) clauses.push(`product=eq.${encodeURIComponent(filters.product)}`);
    if (filters.runId) clauses.push(`run_id=eq.${encodeURIComponent(filters.runId)}`);
    const response = await fetch(`${this.baseUrl}/notification_outbox?${clauses.join("&")}`, {
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

  private async getByDeduplicationKey(deduplicationKey: string) {
    const rows = await this.request(
      `notification_outbox?deduplication_key=eq.${encodeURIComponent(deduplicationKey)}&limit=1`
    );
    return rows[0] ? fromSupabaseRecord(rows[0]) : null;
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
    if (!response.ok) throw await supabaseError(response);
    if (response.status === 204 || response.headers.get("content-length") === "0") return [];
    return (await response.json()) as Record<string, unknown>[];
  }
}

function createRecord(input: CreateNotificationOutboxInput): NotificationOutboxRecord {
  return {
    attemptCount: 0,
    campaignId: input.campaignId,
    correlationId: input.correlationId,
    createdAt: new Date().toISOString(),
    deduplicationKey: input.deduplicationKey,
    deliveredAt: null,
    environment: input.environment,
    errorMessage: null,
    eventType: input.eventType,
    id: crypto.randomUUID(),
    lastAttemptAt: null,
    message: redactInssaLogLine(input.message),
    payload: sanitizePayload(input.payload),
    product: input.product,
    provider: null,
    providerMessageId: null,
    runId: input.runId,
    schemaVersion: 1,
    severity: input.severity,
    status: "pending",
    title: redactInssaLogLine(input.title)
  };
}

function matchesFilters(notification: NotificationOutboxRecord, filters: NotificationOutboxFilters) {
  return (
    (!filters.status || notification.status === filters.status) &&
    (!filters.severity || notification.severity === filters.severity) &&
    (!filters.campaign || notification.campaignId === filters.campaign) &&
    (!filters.environment || notification.environment === filters.environment) &&
    (!filters.product || notification.product === filters.product) &&
    (!filters.runId || notification.runId === filters.runId)
  );
}

function pageRecords(items: NotificationOutboxRecord[], cursor: number, limit: number): NotificationOutboxPage {
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

async function readLocalSnapshot(storePath: string): Promise<NotificationOutboxSnapshot> {
  try {
    const parsed = JSON.parse(await fs.readFile(storePath, "utf8")) as Partial<NotificationOutboxSnapshot>;
    const schemaVersion = parsed.schemaVersion ?? 1;
    if (schemaVersion !== 1) throw new Error(`Unsupported notification outbox schema version: ${String(schemaVersion)}`);
    return { notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [], schemaVersion: 1 };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { notifications: [], schemaVersion: 1 };
    throw error;
  }
}

async function writeLocalSnapshot(storePath: string, snapshot: NotificationOutboxSnapshot) {
  const temporaryPath = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, storePath);
}

function sanitizePayload(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, isSensitivePayloadKey(key) ? "[redacted]" : sanitizeValue(item)])
  );
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return redactInssaLogLine(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        isSensitivePayloadKey(key) ? "[redacted]" : sanitizeValue(item)
      ])
    );
  }
  return value;
}

function isSensitivePayloadKey(key: string) {
  return /^(?:password|secret|private_?key|service_?role_?key|authorization|cookies?|session_?id|access_?token|refresh_?token|id_?token|share_?token|possible_?share_?tokens?)$/i.test(key);
}

function toSupabaseRecord(record: NotificationOutboxRecord) {
  return {
    attempt_count: record.attemptCount,
    campaign_id: record.campaignId,
    correlation_id: record.correlationId,
    created_at: record.createdAt,
    deduplication_key: record.deduplicationKey,
    delivered_at: record.deliveredAt,
    environment: record.environment,
    error_message: record.errorMessage,
    event_type: record.eventType,
    id: record.id,
    last_attempt_at: record.lastAttemptAt,
    message: record.message,
    payload: record.payload,
    product: record.product,
    provider: record.provider,
    provider_message_id: record.providerMessageId,
    run_id: record.runId,
    schema_version: record.schemaVersion,
    severity: record.severity,
    status: record.status,
    title: record.title
  };
}

function fromSupabaseRecord(row: Record<string, unknown>): NotificationOutboxRecord {
  return {
    attemptCount: Number(row.attempt_count),
    campaignId: nullableString(row.campaign_id),
    correlationId: String(row.correlation_id),
    createdAt: String(row.created_at),
    deduplicationKey: String(row.deduplication_key),
    deliveredAt: nullableString(row.delivered_at),
    environment: String(row.environment),
    errorMessage: nullableString(row.error_message),
    eventType: row.event_type as NotificationOutboxRecord["eventType"],
    id: String(row.id),
    lastAttemptAt: nullableString(row.last_attempt_at),
    message: String(row.message),
    payload: recordValue(row.payload),
    product: String(row.product),
    provider: nullableString(row.provider),
    providerMessageId: nullableString(row.provider_message_id),
    runId: nullableString(row.run_id),
    schemaVersion: 1,
    severity: row.severity as NotificationOutboxRecord["severity"],
    status: row.status as NotificationOutboxRecord["status"],
    title: String(row.title)
  };
}

function shouldUseSupabaseStore() {
  if (process.env.INSSA_OPS_METADATA_STORE !== "supabase") return false;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase outbox persistence requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; refusing an unsafe local or anon-key fallback."
    );
  }
  return true;
}

async function supabaseError(response: Response) {
  const text = await response.text().catch(() => "");
  return new Error(`Supabase notification outbox request failed: ${response.status} ${response.statusText}${text ? ` ${text}` : ""}`);
}

function nullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
