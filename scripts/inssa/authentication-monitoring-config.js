const METHODS = ["username-password", "google-oauth", "apple-sign-in"];

function credentialVariableNames(environment, provider) {
  const prefix = environment === "production" ? "AUTH_MONITOR_PRODUCTION" : "AUTH_MONITOR_STAGING";
  return {
    email: provider === "password" ? `${prefix}_EMAIL` : `${prefix}_${provider.toUpperCase()}_EMAIL`,
    password: provider === "password" ? `${prefix}_PASSWORD` : `${prefix}_${provider.toUpperCase()}_PASSWORD`
  };
}

function resolveAuthenticationMonitorCredentials(env, environment, provider) {
  const names = credentialVariableNames(environment, provider);
  const fallbackAllowed = environment === "staging" && provider === "password";
  const email = configuredValue(env[names.email]) || (fallbackAllowed ? configuredValue(env.INSSA_TEST_EMAIL) : "");
  const password = configuredValue(env[names.password]) || (fallbackAllowed ? configuredValue(env.INSSA_TEST_PASSWORD) : "");
  return email && password ? { email, password } : null;
}

function authenticationMonitorConfiguration(env, environment) {
  const providers = ["password", "google", "apple"];
  const variables = providers.flatMap((provider) => {
    const names = credentialVariableNames(environment, provider);
    return [names.email, names.password];
  });
  if (environment === "staging") variables.push("INSSA_TEST_EMAIL", "INSSA_TEST_PASSWORD");
  return {
    environment,
    methods: Object.fromEntries(
      providers.map((provider) => [
        provider,
        resolveAuthenticationMonitorCredentials(env, environment, provider) ? "CONFIGURED" : "MISSING_CONFIGURATION"
      ])
    ),
    variables: Object.fromEntries(variables.map((name) => [name, configuredValue(env[name]) ? "SET" : "MISSING"]))
  };
}

function sanitizedConfigurationLines(configuration) {
  return Object.entries(configuration.variables).map(([name, status]) => `${name}=${status}`);
}

function parseMethodSelection(args) {
  const option = args.find((argument) => argument.startsWith("--methods="));
  if (!option) return null;
  const requested = option.slice("--methods=".length).split(",").map((value) => value.trim()).filter(Boolean);
  const unsupported = requested.filter((method) => !METHODS.includes(method));
  if (requested.length === 0 || unsupported.length > 0) {
    throw new Error(`Unsupported authentication monitor methods: ${unsupported.join(", ") || "none selected"}`);
  }
  return [...new Set(requested)];
}

function configuredValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  METHODS,
  authenticationMonitorConfiguration,
  credentialVariableNames,
  parseMethodSelection,
  resolveAuthenticationMonitorCredentials,
  sanitizedConfigurationLines
};
