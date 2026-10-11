import ActivityPlanner from "@/components/feature/ActivityPlanner";
import ProtectedPage from "@/components/ProtectedPage";
export default function RoutinesPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  return <ProtectedPage path="/routines" searchParams={searchParams}><ActivityPlanner /></ProtectedPage>;
}
