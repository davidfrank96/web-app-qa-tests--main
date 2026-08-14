type AuthenticationFailureLog = {
  message: string;
  sequence: number;
  stream: string;
};

export function describeAuthenticationMonitorIncompleteRun(logs: AuthenticationFailureLog[]) {
  const ordered = [...logs].sort((left, right) => left.sequence - right.sequence);
  const timeoutRequested = ordered.some((log) => log.message.includes("termination requested: reason=timeout"));
  const ownership = ordered.find((log) => /timeoutMs=\d+/.test(log.message));
  const workerFailure = [...ordered]
    .reverse()
    .find((log) => log.message.startsWith("Worker execution failure:"));
  const startupFailure = [...ordered]
    .reverse()
    .find((log) => log.message.startsWith("Startup failure:"));

  if (timeoutRequested) {
    const timeoutMs = ownership?.message.match(/timeoutMs=(\d+)/)?.[1];
    const timeoutDescription = timeoutMs ? `${Math.round(Number(timeoutMs) / 1000)}-second` : "configured";
    const cleanup = workerFailure?.message.replace(/^Worker execution failure:\s*/, "");
    return `Campaign exceeded its ${timeoutDescription} execution timeout before all provider results completed.${cleanup ? ` Worker cleanup reported: ${cleanup}` : ""}`;
  }
  if (startupFailure) return startupFailure.message.replace(/^Startup failure:\s*/, "");
  if (workerFailure) return workerFailure.message.replace(/^Worker execution failure:\s*/, "");
  return "The run ended before an authentication monitoring summary was produced. Review the run logs for the recorded execution failure.";
}
