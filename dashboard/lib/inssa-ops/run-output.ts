import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { classifyArtifact } from "./artifact-indexer";
import { getRepoRoot, getRunOutputRoot } from "./paths";
import type { InssaRunOutputManifest } from "./types";

const LEGACY_OUTPUT_ROOTS = [
  "reports/security",
  "reports/lifecycle",
  "reports/siem",
  "lifecycle-artifacts",
  "lifecycle-campaigns",
  "security-campaigns"
];

export async function prepareRunOutput(runId: string) {
  const outputRoot = getRunOutputRoot(runId);
  await fs.rm(outputRoot, { force: true, recursive: true });
  await fs.mkdir(path.join(outputRoot, "playwright-report"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "test-results"), { recursive: true });
  return outputRoot;
}

export function buildRunOutputEnvironment(runId: string) {
  const outputRoot = getRunOutputRoot(runId);
  return {
    INSSA_RUN_OUTPUT_DIR: outputRoot,
    PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(outputRoot, "playwright-report"),
    PLAYWRIGHT_OUTPUT_DIR: path.join(outputRoot, "test-results")
  };
}

export async function finalizeRunOutput(input: {
  campaignKey: string;
  completedAt: Date;
  runId: string;
  startedAt: Date;
}) {
  const repoRoot = getRepoRoot();
  const outputRoot = getRunOutputRoot(input.runId);
  const sinceMs = input.startedAt.getTime() - 2_000;
  const untilMs = input.completedAt.getTime() + 2_000;

  for (const relativeRoot of LEGACY_OUTPUT_ROOTS) {
    await copyChangedFiles(
      path.join(repoRoot, relativeRoot),
      path.join(outputRoot, relativeRoot),
      sinceMs,
      untilMs
    );
  }

  const entries = await collectManifestEntries(outputRoot);
  const manifest: InssaRunOutputManifest = {
    campaignKey: input.campaignKey,
    completedAt: input.completedAt.toISOString(),
    entries,
    generatedAt: new Date().toISOString(),
    runId: input.runId,
    schemaVersion: 1,
    startedAt: input.startedAt.toISOString()
  };
  const manifestPath = path.join(outputRoot, "evidence-manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifest, manifestPath, outputRoot };
}

async function copyChangedFiles(source: string, destination: string, sinceMs: number, untilMs: number) {
  let entries;
  try {
    entries = await fs.readdir(source, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyChangedFiles(sourcePath, destinationPath, sinceMs, untilMs);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.stat(sourcePath);
    if (stat.mtimeMs < sinceMs || stat.mtimeMs > untilMs) continue;
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function collectManifestEntries(outputRoot: string) {
  const files = await collectFiles(outputRoot);
  return Promise.all(
    files
      .filter((filePath) => path.basename(filePath) !== "evidence-manifest.json")
      .map(async (filePath) => {
        const relativePath = path.relative(outputRoot, filePath).split(path.sep).join("/");
        const stat = await fs.stat(filePath);
        const classification = classifyArtifact(relativePath);
        return {
          artifactType: classification.artifactType,
          contentType: classification.contentType,
          relativePath,
          sha256: await hashFile(filePath),
          sizeBytes: stat.size
        };
      })
  );
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function hashFile(filePath: string) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
