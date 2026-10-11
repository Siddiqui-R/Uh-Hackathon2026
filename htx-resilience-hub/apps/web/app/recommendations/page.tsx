import RecommendationExperience from "@/components/feature/RecommendationExperience";
import ProtectedPage from "@/components/ProtectedPage";
export default function RecommendationsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  return <ProtectedPage path="/recommendations" searchParams={searchParams}><RecommendationExperience /></ProtectedPage>;
}
