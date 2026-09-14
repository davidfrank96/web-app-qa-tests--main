type RunVersion = { id: string; status: string; updatedAt?: string; completedAt: string | null; createdAt: string };
const TERMINAL_STATUSES = new Set(["passed", "passed_with_warnings", "failed", "failed_startup", "timed_out", "cancelled"]);

export function terminalRunVersion(run: RunVersion | undefined) {
  return run && TERMINAL_STATUSES.has(run.status)
    ? `${run.id}:${run.status}:${run.updatedAt ?? run.completedAt ?? run.createdAt}`
    : null;
}

/** Session-local, bounded cache. Failed and active responses are never retained. */
export class TerminalRunDetailCache<T extends { run: RunVersion }> {
  private values = new Map<string, T>();
  private pending = new Map<string, Promise<T>>();

  invalidate(runId: string) {
    for (const key of this.values.keys()) if (key.startsWith(`${runId}:`)) this.values.delete(key);
    for (const key of this.pending.keys()) if (key.startsWith(`${runId}:`)) this.pending.delete(key);
  }

  async load(run: RunVersion, fetchDetail: () => Promise<T>): Promise<T> {
    const key = terminalRunVersion(run);
    const cached = key ? this.values.get(key) : undefined;
    if (cached) return cached;
    const requestKey = `${run.id}:${run.status}:${run.updatedAt ?? run.completedAt ?? run.createdAt}`;
    const existing = this.pending.get(requestKey);
    if (existing) return existing;
    const request = fetchDetail();
    this.pending.set(requestKey, request);
    try {
      const detail = await request;
      if (this.pending.get(requestKey) === request) {
        const version = terminalRunVersion(detail.run);
        for (const oldKey of this.values.keys()) if (oldKey.startsWith(`${run.id}:`)) this.values.delete(oldKey);
        if (version) this.values.set(version, detail);
        while (this.values.size > 10) this.values.delete(this.values.keys().next().value!);
      }
      return detail;
    } finally {
      if (this.pending.get(requestKey) === request) this.pending.delete(requestKey);
    }
  }
}
