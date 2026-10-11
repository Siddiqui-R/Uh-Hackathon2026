import AuthForm from "@/components/AuthForm";
import { redirect } from "next/navigation";
import { accountSession } from "@/lib/account";
import { safeReturnTo } from "@/lib/returnTo";

export default async function LoginPage({ searchParams }: { searchParams?: { next?: string } }) {
  const destination = safeReturnTo(searchParams?.next);
  const session = await accountSession();
  if (session.status === "valid") redirect(destination);
  return <AuthForm flow="login" nextPath={destination} sessionWarning={session.status === "unavailable" ? "We couldn't verify your existing session. You can try signing in again when the account service is available." : undefined} />;
}
