import Workspace from "@/components/Workspace";
import ProtectedPage from "@/components/ProtectedPage";
export default function PlacesPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  return <ProtectedPage path="/places" searchParams={searchParams}><Workspace page="places" returnToPlanner={searchParams?.from === "planner"} /></ProtectedPage>;
}
