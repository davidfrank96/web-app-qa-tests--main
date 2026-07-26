import { LoginForm } from "../../components/login-form";
import { getSupabaseBrowserConfig } from "../../lib/inssa-ops/auth-config";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm authConfigured={getSupabaseBrowserConfig().configured} />;
}
