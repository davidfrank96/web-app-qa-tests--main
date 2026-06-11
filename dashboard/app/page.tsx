import { InssaOpsClient } from "../components/inssa-ops-client";
import { listInssaPhase1Commands } from "../lib/inssa-ops/command-registry";
import { getInssaRunStore, getInssaRunStoreSummary } from "../lib/inssa-ops/run-store";
import { getInssaAuthenticatedUser } from "../lib/inssa-ops/security";
import type { InssaRunRecord } from "../lib/inssa-ops/types";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await getInssaAuthenticatedUser();
  if (!user) {
    redirect("/login");
  }

  const initialMetadataBackend = await getInssaRunStoreSummary();
  let initialLoadError: string | null = null;
  let initialRuns: InssaRunRecord[] = [];
  try {
    initialRuns = await getInssaRunStore().listRuns();
  } catch (error) {
    initialLoadError = error instanceof Error ? error.message : String(error);
  }

  return (
    <InssaOpsClient
      currentUser={user}
      initialCampaignDefinitions={listInssaPhase1Commands()}
      initialLoadError={initialLoadError}
      initialMetadataBackend={initialMetadataBackend}
      initialRuns={initialRuns}
    />
  );
}
