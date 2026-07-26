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
    assert.equal(all.pagination.total, 7);
    assert.equal(all.items.filter((definition) => definition.enabled).length, 3);
    assert.equal(all.items.every((definition) => definition.schemaVersion === 1), true);
    assert.deepEqual(new Set(all.items.map((definition) => definition.environment)), new Set(["production", "staging"]));

    const enabled = await store.list({ enabled: true, product: "INSSA" }, 0, 100);
    assert.equal(enabled.pagination.total, 3);
    assert.equal(enabled.items.some((definition) => definition.campaignId === "monitor_inssa_auth_staging"), true);

    const scheduled = await store.list({ triggerType: "schedule" }, 0, 100);
    assert.equal(scheduled.pagination.total, 4);
    const safeSchedule = scheduled.items.find((definition) => definition.id === "17ab8e2e-f129-479c-a68e-c2087c1c52d0");
    assert.deepEqual(safeSchedule?.schedule, {
      frequency: "daily",
      hour: 3,
      minute: 0,
      timezone: "Europe/Dublin"
    });

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
    assert.equal(snapshot.definitions.length, 7);
  } finally {
    await fs.rm(repoRoot, { force: true, recursive: true });
  }
});
