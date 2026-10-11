import Workspace from "@/components/Workspace";
import ProtectedPage from "@/components/ProtectedPage";
export default function AssistantPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  return <ProtectedPage path="/assistant" searchParams={searchParams}><Workspace page="assistant" /></ProtectedPage>;
}
