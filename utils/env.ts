export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function assertValidInssaUrl(): string {
  const value = optionalEnv("INSSA_URL")?.trim();
  if (!value || value.includes("your-inssa-staging-url")) {
    throw new Error("INSSA_URL is not configured correctly");
  }

  return value;
}
