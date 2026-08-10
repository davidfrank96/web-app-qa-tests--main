export type ExecutionLeaseHeartbeatOptions = {
  failureLimit: number;
  heartbeat: () => Promise<void>;
  heartbeatMs: number;
  leaseMs: number;
  onFailure: (error: Error, consecutiveFailures: number, fatal: boolean) => Promise<void> | void;
  onHealthy?: (leaseExpiresAt: string) => Promise<void> | void;
  onTimingDrift?: (driftMs: number) => Promise<void> | void;
  ownershipError: (error: unknown) => boolean;
};

export type ExecutionLeaseHeartbeat = {
  stop: () => Promise<void>;
};

export function startExecutionLeaseHeartbeat(options: ExecutionLeaseHeartbeatOptions): ExecutionLeaseHeartbeat {
  validateContract(options);
  let consecutiveFailures = 0;
  let inFlight: Promise<void> | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let nextExpectedAt = Date.now() + options.heartbeatMs;

  const schedule = () => {
    if (stopped) return;
    const delayMs = Math.max(0, nextExpectedAt - Date.now());
    timer = setTimeout(() => {
      const driftMs = Math.max(0, Date.now() - nextExpectedAt);
      nextExpectedAt = Date.now() + options.heartbeatMs;
      inFlight = beat(driftMs).finally(() => {
        inFlight = null;
        schedule();
      });
    }, delayMs);
    timer.unref();
  };

  const beat = async (driftMs: number) => {
    if (driftMs >= options.heartbeatMs && options.onTimingDrift) await options.onTimingDrift(driftMs);
    try {
      await options.heartbeat();
      consecutiveFailures = 0;
      if (options.onHealthy) await options.onHealthy(new Date(Date.now() + options.leaseMs).toISOString());
    } catch (error) {
      consecutiveFailures += 1;
      const normalized = error instanceof Error ? error : new Error(String(error));
      const fatal = options.ownershipError(error) || consecutiveFailures >= options.failureLimit;
      await options.onFailure(normalized, consecutiveFailures, fatal);
      if (fatal) stopped = true;
    }
  };

  schedule();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) await inFlight;
    }
  };
}

function validateContract(options: ExecutionLeaseHeartbeatOptions) {
  if (!Number.isInteger(options.failureLimit) || options.failureLimit < 1) {
    throw new Error("Execution heartbeat failureLimit must be a positive integer.");
  }
  if (!Number.isInteger(options.heartbeatMs) || options.heartbeatMs < 1_000) {
    throw new Error("Execution heartbeat interval must be at least 1000ms.");
  }
  if (!Number.isInteger(options.leaseMs) || options.leaseMs <= options.heartbeatMs) {
    throw new Error("Execution lease duration must be greater than the heartbeat interval.");
  }
  if (options.heartbeatMs * options.failureLimit >= options.leaseMs) {
    throw new Error("Execution heartbeat failures must become fatal before the active lease can expire.");
  }
}
