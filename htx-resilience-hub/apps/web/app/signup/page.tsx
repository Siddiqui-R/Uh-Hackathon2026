import AuthForm from "@/components/AuthForm";
import { safeReturnTo } from "@/lib/returnTo";
export default function SignupPage({ searchParams }: { searchParams?: { next?: string } }) {
  return <AuthForm flow="signup" nextPath={safeReturnTo(searchParams?.next)} />;
}
