import { DashboardClient } from "../components/dashboard-client";
import { getLocalManDashboardPayload } from "../lib/localman-dashboard";

export const dynamic = "force-dynamic";

export default async function Page() {
  const initialData = await getLocalManDashboardPayload();
  return <DashboardClient initialData={initialData} />;
}
