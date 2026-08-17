import { LoginForm } from "../../components/login-form";
import { getSupabaseBrowserConfig } from "../../lib/inssa-ops/auth-config";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const reason = (await searchParams).reason;
  const initialMessage = reason === "session_expired"
    ? "Your session expired. Please sign in again."
    : reason === "unauthorized"
      ? "This account is not authorized for QA Operations."
      : reason === "invalid_callback"
        ? "The sign-in link is invalid or expired. Please request a new one."
        : "";
  return <LoginForm authConfigured={getSupabaseBrowserConfig().configured} initialMessage={initialMessage} />;
}
