import { test, expect } from "./mutation-fixtures";
import { LandingPage } from "../../pages/inssa/landing.page";
import { TimeCapsulePage } from "../../pages/inssa/time-capsule.page";
import { createInssaErrorMonitor, getInssaTestCredentials } from "../../utils/auth";
import {
  buildInssaQaCapsuleSeed,
  getInssaCleanupCapabilities,
  getInssaMutationReadiness,
  isInssaQaArtifact
} from "../../utils/inssa-mutation";
import { assertValidInssaUrl } from "../../utils/env";
import { withInssaStabilityMonitor } from "../../utils/monitor";

test.describe("INSSA mutation readiness", () => {
  test.beforeAll(() => {
    assertValidInssaUrl();
    getInssaTestCredentials();
  });

  test("draft-safe cleanup path is available while lifecycle mutation stays blocked", async (
    { mutationRunContext, page },
    testInfo
  ) => {
    const errorMonitor = createInssaErrorMonitor(page);
    const landing = new LandingPage(page);
    const compose = new TimeCapsulePage(page);
    const capabilities = getInssaCleanupCapabilities();
    const readiness = getInssaMutationReadiness(capabilities);
    const seed = buildInssaQaCapsuleSeed(mutationRunContext, {
      bodySuffix: "readiness-audit",
      subjectSuffix: "readiness-audit"
    });

    await withInssaStabilityMonitor(page, testInfo, errorMonitor, async (monitor) => {
      await monitor.step("open authenticated INSSA landing page", () => landing.goToHome(), {
        phase: "navigation",
        route: "/"
      });
      await monitor.step("assert authenticated landing surface", () => landing.expectAuthenticatedLandingSurface(), {
        phase: "assertion"
      });
      await monitor.step("open authenticated compose entry", () => landing.openBuryEntry(), { phase: "interaction" });
      await monitor.step("assert compose surface", () => compose.expectComposeSurface(), {
        phase: "assertion",
        route: "/timecapsule"
      });

      const controlSnapshot = await monitor.step("snapshot lifecycle controls", () => compose.snapshotLifecycleControls(), {
        phase: "assertion"
      });

      expect(controlSnapshot.discardDraft, "Expected the compose surface to expose Discard draft.").toBe(true);
      expect(controlSnapshot.saveAndExit, "Expected the compose surface to expose Save & exit.").toBe(true);
      expect(readiness.draftOnlyReady, "Expected draft-only mutation readiness to stay available.").toBe(true);
      expect(
        readiness.lifecycleReady,
        "Expected published lifecycle mutation testing to remain blocked until a verified cleanup path exists."
      ).toBe(false);
      expect(isInssaQaArtifact(seed.subject), "Expected generated QA capsule subject to be identifiable.").toBe(true);
      expect(isInssaQaArtifact(seed.message), "Expected generated QA capsule message to be identifiable.").toBe(true);

      await testInfo.attach("inssa-mutation-readiness.json", {
        body: JSON.stringify(
          {
            capabilities,
            controlSnapshot,
            readiness,
            seed
          },
          null,
          2
        ),
        contentType: "application/json"
      });

      await monitor.step("assert no unexpected INSSA errors", () => errorMonitor.expectNoUnexpectedErrors(), {
        phase: "assertion"
      });
    });
  });
});
