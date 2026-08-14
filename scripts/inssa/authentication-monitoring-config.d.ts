export type AuthenticationMonitorProvider = "apple" | "google" | "password";

export function resolveAuthenticationMonitorCredentials(
  env: NodeJS.ProcessEnv,
  environment: string,
  provider: AuthenticationMonitorProvider
): { email: string; password: string } | null;
