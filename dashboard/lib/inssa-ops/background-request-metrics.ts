// Process-local counters: no extra Supabase requests/writes, credentials or query strings.
export const REQUEST_WINDOW_MS = 5 * 60_000;
export type BackgroundRequestSnapshot = { at: string; windowMs: number; requests: number; requestsPerMinute: number };
export class BackgroundRequestCounter {
  private buckets = new Map<number, number>();
  constructor(private readonly startedAt = Date.now()) {}
  record(at = Date.now()) {
    const bucket = Math.floor(at / 1000);
    this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + 1);
    this.prune(at);
  }
  private prune(at: number) { for (const second of this.buckets.keys()) if (second * 1000 <= at - REQUEST_WINDOW_MS) this.buckets.delete(second); }
  snapshot(at = Date.now()): BackgroundRequestSnapshot {
    this.prune(at);
    const windowMs = Math.max(1000, Math.min(REQUEST_WINDOW_MS, at - this.startedAt));
    const requests = [...this.buckets.values()].reduce((sum, count) => sum + count, 0);
    return { at: new Date(at).toISOString(), windowMs, requests, requestsPerMinute: requests * 60_000 / windowMs };
  }
}
let counter: BackgroundRequestCounter | null = null;
export function installBackgroundRequestMetrics() {
  if (counter || !process.env.SUPABASE_URL) return;
  const origin = new URL(process.env.SUPABASE_URL).origin;
  counter = new BackgroundRequestCounter();
  const original = globalThis.fetch;
  globalThis.fetch = function(input, init) {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin === origin && url.pathname.startsWith("/rest/v1/")) counter!.record();
    return original.call(globalThis, input, init);
  };
}
export function backgroundRequestSnapshot() { return counter?.snapshot() ?? null; }
