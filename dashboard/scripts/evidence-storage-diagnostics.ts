// Operator-invoked only: no background polling or writes.
import { loadEnvConfig } from "@next/env";
import { activeEvidenceProvider } from "../lib/inssa-ops/storage-provider-model";
import {
  spacesConfiguration,
  storageProvider,
} from "../lib/inssa-ops/storage-providers";
import {
  createRetentionReader,
  readRetentionSnapshot,
} from "../lib/inssa-ops/retention-store";
async function main() {
  if (process.argv[2] !== "--read-only")
    throw new Error("Explicit --read-only required.");
  loadEnvConfig(process.cwd());
  const snapshot = await readRetentionSnapshot(createRetentionReader());
  let spaces: { status: string; objects?: number; bytes?: number } = {
    status: "not_configured",
  };
  try {
    spacesConfiguration();
    const objects = await storageProvider("spaces").listPrefix("", 5000);
    spaces = {
      status: "verified",
      objects: objects.length,
      bytes: objects.reduce((n, o) => n + o.sizeBytes, 0),
    };
  } catch {
    spaces = { status: "not_verified" };
  }
  const supabase = snapshot.objects.filter(
    (o) => !o.provider || o.provider === "supabase",
  );
  console.log(
    JSON.stringify(
      {
        asOf: new Date().toISOString(),
        activeWriteProvider: activeEvidenceProvider(),
        snapshotConsistent: snapshot.consistent,
        supabase: {
          objects: supabase.length,
          bytes: supabase.reduce((n, o) => n + (o.sizeBytes ?? 0), 0),
          complete: supabase.every((o) => o.sizeBytes !== null),
        },
        spaces,
        migration: {
          status: "not_implemented",
          migratedObjects: null,
          failedObjects: null,
        },
      },
      null,
      2,
    ),
  );
}
main().catch(() => {
  console.error(
    "Evidence storage diagnostics unavailable; no credentials logged.",
  );
  process.exitCode = 1;
});
