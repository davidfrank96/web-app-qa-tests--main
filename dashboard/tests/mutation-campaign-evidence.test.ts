import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { hasPersistedRevealSchedule } from "../../utils/inssa-reveal-schedule";

const require = createRequire(import.meta.url);
const {
  requireCrossUserCapsuleIdentity,
  resolveCrossUserCapsuleIdentity
}: {
  requireCrossUserCapsuleIdentity: (artifact: Record<string, unknown>) => string;
  resolveCrossUserCapsuleIdentity: (artifact: Record<string, unknown>) => string | null;
} = require("../../scripts/inssa/cross-user-identity.js");

test("cross-user terminal certification requires an exact capsule identity", () => {
  assert.throws(
    () =>
      requireCrossUserCapsuleIdentity({
        finalBuryThenChooseClicked: true,
        observedCreateSuccess: true,
        successSignals: ["home-button-visible"]
      }),
    /FAILED_CLEANUP_IDENTITY/
  );

  assert.equal(
    resolveCrossUserCapsuleIdentity({ finalUrl: "https://staging.inssa.us/capsule/capsule_123456" }),
    "capsule_123456"
  );
});

test("reveal-later terminal certification requires durable schedule evidence", () => {
  const scheduledAtIso = "2026-08-18T12:00:00.000Z";
  assert.equal(
    hasPersistedRevealSchedule({
      candidateTimestamps: [
        { context: "visible date", normalizedIso: scheduledAtIso, source: "dom-visible-input", value: "18/08/2026" }
      ],
      hiddenSchedulingValues: [],
      localStorageCandidates: [],
      networkCandidates: [],
      scheduledAtIso,
      selectedDateText: "18/08/2026",
      selectedTimeText: "12:00",
      sessionStorageCandidates: [],
      source: "dom-visible-input:visible date",
      visibleSchedulingControls: [],
      visibleSchedulingValues: []
    }),
    false
  );

  assert.equal(
    hasPersistedRevealSchedule({
      candidateTimestamps: [
        { context: "scheduledAt", normalizedIso: scheduledAtIso, source: "network", value: scheduledAtIso }
      ],
      hiddenSchedulingValues: [],
      localStorageCandidates: [],
      networkCandidates: [
        { context: "scheduledAt", normalizedIso: scheduledAtIso, source: "network", value: scheduledAtIso }
      ],
      scheduledAtIso,
      selectedDateText: null,
      selectedTimeText: null,
      sessionStorageCandidates: [],
      source: "network:scheduledAt",
      visibleSchedulingControls: [],
      visibleSchedulingValues: []
    }),
    true
  );
});
