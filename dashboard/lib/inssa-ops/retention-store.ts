import type { RetentionSnapshot } from "./retention-types";

export const RETENTION_RESOURCES = ["policies", "holds", "runs", "bundles", "items", "cleanup", "objects", "deletions"] as const;
export type RetentionResource = typeof RETENTION_RESOURCES[number];
type Manifest = { revision: string; counts: Partial<Record<RetentionResource, number>> };
export type RetentionReader = {
  manifest(): Promise<Manifest>;
  page(resource: RetentionResource, offset: number, limit: number): Promise<Record<string, unknown>[]>;
};

// Convert SQL columns only; command snapshots, manifests and item metadata already use camelCase.
function columns(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value]));
}

export async function readRetentionSnapshot(reader: RetentionReader): Promise<RetentionSnapshot> {
  const before = await reader.manifest();
  if (!before.revision || !before.counts) throw new Error("Retention metadata manifest unavailable.");
  const data: Partial<Record<RetentionResource, unknown[]>> = {};
  let consistent = true;
  for (const resource of RETENTION_RESOURCES) {
    const count = before.counts[resource] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid retention metadata count.");
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; offset < count; offset += 500) {
      const page = await reader.page(resource, offset, 500);
      if (!Array.isArray(page) || page.length > 500) throw new Error("Invalid retention metadata page.");
      if (page.length !== Math.min(500, count - offset)) consistent = false;
      rows.push(...page);
    }
    if (rows.length !== count || new Set(rows.map((row) => row.id)).size !== rows.length) consistent = false;
    data[resource] = rows.map(columns);
  }
  const after = await reader.manifest();
  consistent &&= before.revision === after.revision;
  return { ...data, revision: before.revision, consistent } as RetentionSnapshot;
}

export function createRetentionReader(fetcher: typeof fetch = fetch): RetentionReader {
  if (process.env.INSSA_OPS_METADATA_STORE !== "supabase" || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Retention planning requires the durable Supabase metadata store; no local or empty-hold fallback is permitted.");
  }
  const base = new URL(process.env.SUPABASE_URL);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/") throw new Error("Invalid Supabase URL.");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  async function get(rpc: string, params?: URLSearchParams) {
    const url = new URL(`/rest/v1/rpc/${rpc}`, base);
    if (params) url.search = params.toString();
    const response = await fetcher(url, { method: "GET", redirect: "error", cache: "no-store",
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Retention read unavailable (${response.status}); no eligibility certification.`);
    return response.json();
  }
  return {
    manifest: () => get("retention_read_manifest"),
    page: async (resource, offset, limit) => (await get("retention_read_page", new URLSearchParams({
      p_resource: resource, p_offset: String(offset), p_limit: String(limit)
    }))).rows
  };
}
