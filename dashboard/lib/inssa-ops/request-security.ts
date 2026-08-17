import { NextRequest, NextResponse } from "next/server";

export class InssaRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "InssaRequestError";
  }
}

export async function readBoundedJsonObject(request: NextRequest, maxBytes: number) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new InssaRequestError("Content-Type must be application/json.", 415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new InssaRequestError("Request body is too large.", 413);
  }

  const reader = request.body?.getReader();
  if (!reader) throw new InssaRequestError("A JSON request body is required.", 400);

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new InssaRequestError("Request body is too large.", 413);
    }
    chunks.push(value);
  }

  let parsed: unknown;
  try {
    const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    parsed = JSON.parse(body);
  } catch {
    throw new InssaRequestError("Request body must contain valid JSON.", 400);
  }

  if (!isPlainObject(parsed)) {
    throw new InssaRequestError("Request body must be a JSON object.", 400);
  }
  return parsed;
}

export function requestErrorResponse(error: unknown) {
  if (error instanceof InssaRequestError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  throw error;
}

export function assertAllowedFields(body: Record<string, unknown>, allowedFields: string[]) {
  const allowed = new Set(allowedFields);
  const unexpected = Object.keys(body).filter((field) => !allowed.has(field));
  if (unexpected.length > 0) {
    throw new InssaRequestError(`Unsupported request field: ${unexpected[0]}.`, 400);
  }
}

export function readEmail(value: unknown) {
  if (typeof value !== "string") throw new InssaRequestError("A valid email address is required.", 400);
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InssaRequestError("A valid email address is required.", 400);
  }
  return email;
}

export function readRequiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new InssaRequestError(`${field} is required.`, 400);
  }
  if (value.length > maxLength) {
    throw new InssaRequestError(`${field} is too long.`, 400);
  }
  return value;
}

export function readUuid(value: unknown, field: string) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new InssaRequestError(`${field} must be a valid UUID.`, 400);
  }
  return value;
}

export function requireTrustedMutationOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) {
    return NextResponse.json({ error: "A trusted Origin header is required." }, { status: 403 });
  }

  const trustedOrigins = getTrustedOrigins();
  let normalizedOrigin: string;
  try {
    normalizedOrigin = normalizeOrigin(origin);
  } catch {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  if (!trustedOrigins.has(normalizedOrigin)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  return null;
}

export function getCanonicalPublicOrigin() {
  const configured = process.env.INSSA_OPS_PUBLIC_ORIGIN?.trim();
  if (configured) return normalizeOrigin(configured);
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  throw new InssaRequestError("Canonical application origin is not configured.", 503);
}

function getTrustedOrigins() {
  const origins = new Set<string>();
  try {
    origins.add(getCanonicalPublicOrigin());
  } catch {
    // Production fails closed below when no canonical origin is configured.
  }

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
    origins.add("http://127.0.0.1:3000");
  }
  return origins;
}

function normalizeOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Invalid origin");
    }
    return url.origin;
  } catch {
    throw new InssaRequestError("Canonical application origin is invalid.", 503);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
