export const MAX_WORKER_IDLE_MS = 10_000;

// Only empty queue polls back off. Execution leases and heartbeats are independent.
export class WorkerIdleBackoff {
  private delayMs: number;
  private readonly initialMs: number;

  constructor(initialMs: number) {
    this.initialMs = Math.min(MAX_WORKER_IDLE_MS, Math.max(1, initialMs));
    this.delayMs = this.initialMs;
  }

  reset() { this.delayMs = this.initialMs; }

  nextDelay() {
    const delay = this.delayMs;
    this.delayMs = Math.min(MAX_WORKER_IDLE_MS, delay * 2);
    return delay;
  }
}
