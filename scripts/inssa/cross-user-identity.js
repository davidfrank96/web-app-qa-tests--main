function resolveCrossUserCapsuleIdentity(artifact) {
  const candidates = [
    artifact?.possibleFinalCapsuleId,
    extractCapsuleId(artifact?.finalShareLink || ""),
    extractCapsuleId(artifact?.finalUrl || ""),
    extractCapsuleId(artifact?.finalShareEvidence?.finalShareLink || "")
  ];

  return candidates.find((candidate) => typeof candidate === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(candidate)) ?? null;
}

function requireCrossUserCapsuleIdentity(artifact) {
  const capsuleId = resolveCrossUserCapsuleIdentity(artifact);
  if (!capsuleId) {
    throw new Error(
      "FAILED_CLEANUP_IDENTITY: Cross-user creation succeeded, but the exact staging capsule ID was not captured. Secondary probes and campaign certification are blocked."
    );
  }
  return capsuleId;
}

function extractCapsuleId(url) {
  try {
    return new URL(url).pathname.match(/\/capsule\/([^/?#]+)/i)?.[1] ?? null;
  } catch {
    return String(url).match(/\/capsule\/([^/?#]+)/i)?.[1] ?? null;
  }
}

module.exports = {
  requireCrossUserCapsuleIdentity,
  resolveCrossUserCapsuleIdentity
};
