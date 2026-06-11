import type { InssaCommandDefinition } from "./types";

export const INSSA_PHASE1_COMMANDS: InssaCommandDefinition[] = [
  {
    commandType: "campaign",
    displayName: "INSSA Safe Suite",
    key: "test_inssa_safe",
    mutatesStaging: false,
    npmScript: "test:inssa:safe",
    operatorDescription: "Runs the non-mutating INSSA safe regression suite.",
    phase1Enabled: true,
    producesFindings: false,
    producesReports: true,
    riskLevel: "safe",
    timeoutMs: 10 * 60 * 1000
  },
  {
    commandType: "report_render",
    displayName: "Re-render Latest Security Report",
    key: "report_security",
    mutatesStaging: false,
    npmScript: "report:security",
    operatorDescription: "Uses existing findings and regenerates HTML. Does not run Playwright.",
    phase1Enabled: true,
    producesFindings: false,
    producesReports: true,
    riskLevel: "read_only",
    timeoutMs: 2 * 60 * 1000
  },
  {
    commandType: "campaign",
    displayName: "Run Security Campaign",
    key: "test_inssa_campaign_security",
    mutatesStaging: false,
    npmScript: "test:inssa:campaign:security",
    operatorDescription: "Executes the OWASP security campaign against staging and generates fresh findings and reports.",
    phase1Enabled: true,
    producesFindings: true,
    producesReports: true,
    riskLevel: "read_only",
    timeoutMs: 15 * 60 * 1000
  },
  {
    commandType: "campaign",
    displayName: "Security Verification",
    key: "test_inssa_campaign_security_verify",
    mutatesStaging: false,
    npmScript: "test:inssa:campaign:security:verify",
    operatorDescription: "Verify known security findings from existing artifacts. No staging mutation.",
    phase1Enabled: true,
    producesFindings: true,
    producesReports: true,
    riskLevel: "read_only",
    timeoutMs: 10 * 60 * 1000
  },
  {
    commandType: "report_render",
    displayName: "Render Lifecycle Report",
    key: "report_lifecycle",
    mutatesStaging: false,
    npmScript: "report:lifecycle",
    operatorDescription: "Uses existing lifecycle campaign evidence and regenerates HTML. Does not run Playwright.",
    phase1Enabled: true,
    producesFindings: false,
    producesReports: true,
    riskLevel: "read_only",
    timeoutMs: 2 * 60 * 1000
  },
  {
    commandType: "artifact_validation",
    displayName: "Authenticated Discovery",
    key: "test_inssa_discovery",
    mutatesStaging: false,
    npmScript: "test:inssa:discovery",
    operatorDescription: "Consumes one existing lifecycle artifact and checks authenticated discovery surfaces. Does not create capsules.",
    phase1Enabled: true,
    playwrightSpec: "tests/inssa/live-capsule-authenticated-discovery.spec.ts",
    producesFindings: true,
    producesReports: true,
    requiresLifecycleArtifact: true,
    riskLevel: "read_only",
    timeoutMs: 10 * 60 * 1000
  },
  {
    commandType: "artifact_validation",
    displayName: "Public Share Validation",
    key: "test_inssa_public_share",
    mutatesStaging: false,
    npmScript: "test:inssa:public-share",
    operatorDescription: "Consumes one existing lifecycle artifact and validates tokenized, tokenless, logged-out, and authenticated public-share retrieval.",
    phase1Enabled: true,
    playwrightSpec: "tests/inssa/live-capsule-public-share-lifecycle.spec.ts",
    producesFindings: true,
    producesReports: true,
    requiresLifecycleArtifact: true,
    riskLevel: "read_only",
    timeoutMs: 10 * 60 * 1000
  },
  {
    commandType: "artifact_validation",
    displayName: "Cleanup Capability Audit",
    key: "test_inssa_cleanup_audit",
    mutatesStaging: false,
    npmScript: "test:inssa:cleanup-audit",
    operatorDescription: "Consumes one existing lifecycle artifact and audits cleanup controls without deleting, archiving, or unpublishing.",
    phase1Enabled: true,
    playwrightSpec: "tests/inssa/live-capsule-cleanup-capability-audit.spec.ts",
    producesFindings: true,
    producesReports: true,
    requiresLifecycleArtifact: true,
    riskLevel: "read_only",
    timeoutMs: 10 * 60 * 1000
  },
  {
    commandType: "export",
    displayName: "Generate SIEM Export",
    key: "siem_export",
    mutatesStaging: false,
    npmScript: "siem:export",
    operatorDescription: "Generates metadata-only SIEM export JSON from existing campaign outputs.",
    phase1Enabled: true,
    producesFindings: false,
    producesReports: false,
    riskLevel: "read_only",
    timeoutMs: 2 * 60 * 1000
  },
  {
    commandType: "healthcheck",
    displayName: "Platform Health Check",
    key: "platform_healthcheck",
    mutatesStaging: false,
    npmScript: "platform:healthcheck",
    operatorDescription: "Checks local platform wiring and expected output locations.",
    phase1Enabled: true,
    producesFindings: false,
    producesReports: false,
    riskLevel: "read_only",
    timeoutMs: 2 * 60 * 1000
  }
];

export function listInssaPhase1Commands() {
  return INSSA_PHASE1_COMMANDS;
}

export function getInssaPhase1Command(key: string) {
  return INSSA_PHASE1_COMMANDS.find((command) => command.key === key) ?? null;
}
