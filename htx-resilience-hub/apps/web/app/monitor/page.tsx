import MonitorExperience from "@/components/feature/MonitorExperience";
import ProtectedPage from "@/components/ProtectedPage";
export default function MonitorPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  return <ProtectedPage path="/monitor" searchParams={searchParams}><MonitorExperience /></ProtectedPage>;
}
