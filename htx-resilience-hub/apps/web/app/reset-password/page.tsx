import AuthForm from "@/components/AuthForm";
export default function ResetPasswordPage({ searchParams }: { searchParams: { token?: string } }) { return <AuthForm flow="reset" token={searchParams.token ?? ""} />; }
