import ActivityPlanner from "@/components/feature/ActivityPlanner";
import ProtectedPage from "@/components/ProtectedPage";
import { safeReturnTo } from "@/lib/returnTo";
export default function RoutinesPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const welcome = searchParams?.welcome === "1";
  const candidate = typeof searchParams?.continue === "string" ? searchParams.continue : undefined;
  const continuePath = safeReturnTo(candidate);
  return <ProtectedPage path="/routines" searchParams={searchParams}>
    <ActivityPlanner placeId={typeof searchParams?.place === "string" ? searchParams.place : undefined} activityId={typeof searchParams?.activity === "string" ? searchParams.activity : undefined} onboarding={welcome} continuePath={continuePath.startsWith("/routines") ? "/" : continuePath} />
  </ProtectedPage>;
}
