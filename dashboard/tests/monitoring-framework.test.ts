import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getMonitoringDefinitionStore } from "../lib/monitoring/store";

test("monitoring definitions persist locally and remain read-only metadata", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qa-monitoring-framework-"));
  process.env.INSSA_QA_REPO_ROOT = repoRoot;
  delete process.env.INSSA_OPS_METADATA_STORE;

  try {
    const store = getMonitoringDefinitionStore();
    const all = await store.list({}, 0, 100);
    assert.equal(all.pagination.total, 8);
    assert.equal(all.items.filter((definition) => definition.enabled).length, 4);
    assert.equal(all.items.every((definition) => definition.schemaVersion === 1), true);
    assert.deepEqual(new Set(all.items.map((definition) => definition.environment)), new Set(["production", "staging"]));

    const enabled = await store.list({ enabled: true, product: "INSSA" }, 0, 100);
    assert.equal(enabled.pagination.total, 4);
    assert.equal(enabled.items.some((definition) => definition.campaignId === "monitor_inssa_auth_staging"), true);

    const scheduled = await store.list({ triggerType: "schedule" }, 0, 100);
    assert.equal(scheduled.pagination.total, 5);
    const safeSchedule = scheduled.items.find((definition) => definition.id === "17ab8e2e-f129-479c-a68e-c2087c1c52d0");
    assert.deepEqual(safeSchedule?.schedule, {
      frequency: "daily",
      hour: 3,
      minute: 0,
      timezone: "Europe/Dublin"
    });
    const stagingAuthenticationSchedules = scheduled.items
      .filter((definition) => definition.campaignId === "monitor_inssa_auth_staging")
      .sort((left, right) => (left.schedule?.hour ?? 0) - (right.schedule?.hour ?? 0));
    assert.deepEqual(
      stagingAuthenticationSchedules.map((definition) => ({
        enabled: definition.enabled,
        environment: definition.environment,
        hour: definition.schedule?.hour,
        id: definition.id
      })),
      [
        {
          enabled: true,
          environment: "staging",
          hour: 12,
          id: "9e678cef-036a-46b9-a6ca-f25ad880e92a"
        },
        {
          enabled: true,
          environment: "staging",
          hour: 18,
          id: "3080f13e-022a-44a1-bbbb-b905468ca18a"
        }
      ]
    );
    assert.equal(
      scheduled.items
        .filter((definition) => definition.campaignId === "monitor_inssa_auth_production")
        .every((definition) => !definition.enabled),
      true
    );

    const apiTriggered = await store.list({ triggerType: "api" }, 0, 100);
    assert.equal(apiTriggered.pagination.total, 1);
    assert.equal(apiTriggered.items[0].enabled, false);

    const firstPage = await store.list({}, 0, 2);
    assert.equal(firstPage.items.length, 2);
    assert.equal(firstPage.pagination.hasMore, true);
    assert.equal(firstPage.pagination.nextCursor, "2");
    assert.deepEqual(await store.get(firstPage.items[0].id), firstPage.items[0]);

    const snapshot = JSON.parse(
      await fs.readFile(path.join(repoRoot, "dashboard", ".data", "monitoring-definitions.json"), "utf8")
    ) as { definitions: unknown[]; schemaVersion: number };
    assert.equal(snapshot.schemaVersion, 1);
    assert.equal(snapshot.definitions.length, 8);
  } finally {
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});
