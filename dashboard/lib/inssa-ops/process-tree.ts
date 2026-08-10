import type { ChildProcess } from "node:child_process";

export type OwnedProcessTerminationResult = {
  elapsedMs: number;
  forced: boolean;
  processGroupId: number | null;
  sigkillSent: boolean;
  sigtermSent: boolean;
};

type TerminationOptions = {
  graceMs: number;
  pollMs?: number;
};

export function ownedProcessGroupId(child: ChildProcess) {
  return process.platform === "win32" ? null : child.pid ?? null;
}

export function isOwnedProcessTreeAlive(child: ChildProcess, processGroupId: number | null) {
  if (processGroupId !== null && process.platform !== "win32") {
    return processGroupExists(processGroupId);
  }
  return child.exitCode === null && child.signalCode === null;
}

export async function terminateOwnedProcessTree(
  child: ChildProcess,
  processGroupId: number | null,
  options: TerminationOptions
): Promise<OwnedProcessTerminationResult> {
  const startedAt = Date.now();
  const pollMs = Math.max(10, options.pollMs ?? 50);
  let sigtermSent = false;
  let sigkillSent = false;

  if (isOwnedProcessTreeAlive(child, processGroupId)) {
    sigtermSent = sendSignal(child, processGroupId, "SIGTERM");
    await waitForTreeExit(child, processGroupId, options.graceMs, pollMs);
  }

  if (isOwnedProcessTreeAlive(child, processGroupId)) {
    sigkillSent = sendSignal(child, processGroupId, "SIGKILL");
    await waitForTreeExit(child, processGroupId, Math.max(1_000, options.graceMs), pollMs);
  }

  await waitForChildReaping(child, Math.max(1_000, options.graceMs));
  if (isOwnedProcessTreeAlive(child, processGroupId)) {
    throw new Error(`Owned campaign process tree ${String(processGroupId ?? child.pid)} survived SIGKILL.`);
  }
  return {
    elapsedMs: Date.now() - startedAt,
    forced: sigkillSent,
    processGroupId,
    sigkillSent,
    sigtermSent
  };
}

function sendSignal(child: ChildProcess, processGroupId: number | null, signal: NodeJS.Signals) {
  try {
    if (processGroupId !== null && process.platform !== "win32") {
      process.kill(-processGroupId, signal);
    } else {
      child.kill(signal);
    }
    return true;
  } catch (error) {
    if (isMissingProcess(error)) return false;
    throw error;
  }
}

function processGroupExists(processGroupId: number) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (isMissingProcess(error)) return false;
    if (isPermissionError(error)) return true;
    throw error;
  }
}

async function waitForTreeExit(
  child: ChildProcess,
  processGroupId: number | null,
  timeoutMs: number,
  pollMs: number
) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (isOwnedProcessTreeAlive(child, processGroupId) && Date.now() < deadline) {
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
}

async function waitForChildReaping(child: ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolve) => child.once("close", () => resolve())),
    delay(timeoutMs)
  ]);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isMissingProcess(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ESRCH";
}

function isPermissionError(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "EPERM";
}
