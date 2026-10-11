import Workspace from "@/components/Workspace";
import PublicDashboard from "@/components/PublicDashboard";
import { accountSession } from "@/lib/account";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await accountSession();
  if (session.status === "valid") return <Workspace page="dashboard" />;
  return <PublicDashboard sessionUnavailable={session.status === "unavailable"} />;
}
