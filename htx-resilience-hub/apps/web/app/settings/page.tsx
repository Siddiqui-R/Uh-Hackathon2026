import Workspace from "@/components/Workspace";
import ProtectedPage from "@/components/ProtectedPage";
export default function SettingsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  return <ProtectedPage path="/settings" searchParams={searchParams}><Workspace page="settings" /></ProtectedPage>;
}
