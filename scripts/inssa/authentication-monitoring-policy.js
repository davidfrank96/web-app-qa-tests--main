const DEGRADED_STATUSES = new Set(["blocked_external", "missing_configuration"]);

function overallStatusFor(results) {
  const passwordResult = results.find((result) => result.method === "username-password");
  if (!passwordResult || passwordResult.status !== "passed") return "failed";
  if (results.some((result) => result.status === "failed" || result.status === "timed_out")) return "failed";
  if (results.some((result) => DEGRADED_STATUSES.has(result.status))) return "degraded";
  return "passed";
}

module.exports = { overallStatusFor };
