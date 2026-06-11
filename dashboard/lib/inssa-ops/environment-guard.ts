const REQUIRED_STAGING_HOSTNAME = "staging.inssa.us";
const BLOCKED_PRODUCTION_HOSTNAMES = new Set(["inssa.us", "www.inssa.us"]);

assertNoInssaProductionHostConfigured();

export type InssaEnvironmentValidation = {
  environment: string | null;
  error: string | null;
  ok: boolean;
};

export function validateInssaStagingEnvironment(): InssaEnvironmentValidation {
  const rawUrl = process.env.INSSA_URL?.trim();
  if (!rawUrl) {
    return {
      environment: null,
      error: "INSSA_URL is required for Operations Platform command execution and must be https://staging.inssa.us.",
      ok: false
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      environment: rawUrl,
      error: `INSSA_URL is not a valid URL: ${rawUrl}`,
      ok: false
    };
  }

  if (parsed.protocol !== "https:" || parsed.hostname !== REQUIRED_STAGING_HOSTNAME) {
    return {
      environment: rawUrl,
      error: `Blocked INSSA_URL ${rawUrl}. Operations Platform runs are allowed only against https://${REQUIRED_STAGING_HOSTNAME}.`,
      ok: false
    };
  }

  return {
    environment: rawUrl,
    error: null,
    ok: true
  };
}

function assertNoInssaProductionHostConfigured() {
  const rawUrl = process.env.INSSA_URL?.trim();
  if (!rawUrl) return;

  try {
    const parsed = new URL(rawUrl);
    if (BLOCKED_PRODUCTION_HOSTNAMES.has(parsed.hostname)) {
      throw new Error(`Production INSSA_URL is blocked for the Operations Platform: ${rawUrl}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Production INSSA_URL is blocked")) {
      throw error;
    }
  }
}
