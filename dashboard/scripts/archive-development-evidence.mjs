import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dashboardRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(dashboardRoot, "..");
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const archiveRoot = path.resolve(
  process.env.INSSA_PREDEPLOYMENT_ARCHIVE_ROOT || path.join(repoRoot, "..", "deployment-archives")
);
const outputDir = path.join(archiveRoot, `qa-platform-pre-deployment-${timestamp}`);
const archivePath = path.join(outputDir, "historical-development-evidence.tar.gz");
const manifestPath = path.join(outputDir, "archive-manifest.json");

const candidatePaths = [
  "dashboard/.data",
  "run-output",
  "playwright-report",
  "test-results",
  "reports",
  "lifecycle-artifacts",
  "lifecycle-campaigns",
  "security-campaigns"
];

async function collectStats(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const stat = await fs.stat(absolutePath);
  if (stat.isFile()) return { fileCount: 1, sizeBytes: stat.size };

  let fileCount = 0;
  let sizeBytes = 0;
  const entries = await fs.readdir(absolutePath, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    fileCount += 1;
    sizeBytes += (await fs.stat(path.join(entry.parentPath, entry.name))).size;
  }
  return { fileCount, sizeBytes };
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

const included = [];
for (const relativePath of candidatePaths) {
  try {
    included.push({ relativePath, ...(await collectStats(relativePath)) });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

if (!included.some((entry) => entry.relativePath === "dashboard/.data")) {
  throw new Error("dashboard/.data is required for the pre-deployment archive.");
}

await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
const tar = spawnSync(
  "tar",
  ["-czf", archivePath, "--", ...included.map((entry) => entry.relativePath)],
  { cwd: repoRoot, encoding: "utf8", shell: false }
);
if (tar.status !== 0) {
  throw new Error(`Archive creation failed: ${tar.stderr.trim() || `exit ${tar.status}`}`);
}

const gitSha = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
  shell: false
}).stdout.trim();
const archiveStat = await fs.stat(archivePath);
const manifest = {
  archivePath,
  archiveSha256: await sha256(archivePath),
  archiveSizeBytes: archiveStat.size,
  createdAt: new Date().toISOString(),
  gitSha,
  included,
  purpose: "Pre-deployment historical development evidence; not hosted Supabase operational state.",
  schemaVersion: 1
};
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

console.log(`archive: PASS (${included.reduce((sum, entry) => sum + entry.fileCount, 0)} files)`);
console.log(`archive directory: ${outputDir}`);
console.log(`archive manifest: ${manifestPath}`);
