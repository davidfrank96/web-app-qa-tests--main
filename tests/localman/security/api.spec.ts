import { expect, test } from "../fixtures";

const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;
const LOCATION_SOURCE = "precise";
const RADIUS_KM = "10";

const MALICIOUS_REQUESTS = [
  {
    name: "boolean-like clause in longitude is handled safely",
    params: {
      lat: "0",
      lng: "0 OR 1=1"
    }
  },
  {
    name: "sql fragment in latitude is handled safely",
    params: {
      lat: "';SELECT * FROM vendors;--",
      lng: "0"
    }
  },
  {
    name: "extremely large coordinates are handled safely",
    params: {
      lat: "9999999999999999",
      lng: "-9999999999999999",
      radius_km: "999999999999"
    }
  }
] as const;

test.describe("Local Man vendor API injection safety", () => {
  for (const attack of MALICIOUS_REQUESTS) {
    test(attack.name, async ({ request }, testInfo) => {
      const endpoint = buildNearbyEndpoint(attack.params);
      const startedAt = Date.now();
      const response = await request.get(endpoint, {
        timeout: REQUEST_TIMEOUT_MS
      });
      const durationMs = Date.now() - startedAt;
      const contentType = response.headers()["content-type"] ?? "";
      const bodyText = await response.text();
      const sizeBytes = Buffer.byteLength(bodyText, "utf8");

      logInjectionResult({
        contentType,
        durationMs,
        endpoint,
        sizeBytes,
        status: response.status(),
        test: testInfo.title
      });

      expect(
        response.status(),
        `Expected Local Man vendor API injection probe to avoid 5xx responses for ${endpoint}.`
      ).toBeLessThan(500);

      expect(
        contentType,
        `Expected Local Man vendor API injection probe to return JSON for ${endpoint}, but received "${contentType || "unknown"}".`
      ).toContain("application/json");

      expect(
        sizeBytes,
        `Expected Local Man vendor API injection probe to keep the response body under ${MAX_RESPONSE_BYTES} bytes for ${endpoint}, but received ${sizeBytes} bytes.`
      ).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);

      expectNoLeakage(bodyText, endpoint);

      const payload = parseJson(bodyText, endpoint);
      const schemaIssue = validateNearbyPayloadShape(payload);

      expect(
        schemaIssue,
        schemaIssue
          ? `Expected Local Man vendor API injection probe to preserve a valid JSON schema for ${endpoint}. ${schemaIssue}`
          : `Expected Local Man vendor API injection probe to preserve a valid JSON schema for ${endpoint}.`
      ).toBeNull();
    });
  }
});

function buildNearbyEndpoint(params: Record<string, string>) {
  const search = new URLSearchParams({
    location_source: LOCATION_SOURCE,
    radius_km: RADIUS_KM,
    ...params
  });
  return `/api/vendors/nearby?${search.toString()}`;
}

function parseJson(bodyText: string, endpoint: string): unknown {
  try {
    return JSON.parse(bodyText) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Expected Local Man vendor API injection probe to return valid JSON for ${endpoint}. ${message}`);
  }
}

function validateNearbyPayloadShape(payload: unknown): string | null {
  if (!isObject(payload)) {
    return "Response payload is not an object.";
  }

  if (typeof payload.success !== "boolean") {
    return 'Response payload is missing a boolean "success" field.';
  }

  if (payload.success === false) {
    if ("data" in payload && payload.data !== null && !isObject(payload.data)) {
      return 'Failed response contains a non-object "data" field.';
    }

    return null;
  }

  if (!isObject(payload.data)) {
    return 'Successful response is missing an object "data" field.';
  }

  if (!isObject(payload.data.location)) {
    return 'Nearby vendor payload is missing a valid "location" object.';
  }

  const { location, vendors } = payload.data;

  if (typeof location.source !== "string" || location.source.trim() === "") {
    return "Nearby vendor payload is missing location.source.";
  }

  if (typeof location.label !== "string" || location.label.trim() === "") {
    return "Nearby vendor payload is missing location.label.";
  }

  if (!isObject(location.coordinates)) {
    return "Nearby vendor payload is missing location.coordinates.";
  }

  if (!isCoordinateInRange(location.coordinates.lat, -90, 90)) {
    return "Nearby vendor payload contains an invalid latitude.";
  }

  if (!isCoordinateInRange(location.coordinates.lng, -180, 180)) {
    return "Nearby vendor payload contains an invalid longitude.";
  }

  if (typeof location.isApproximate !== "boolean") {
    return "Nearby vendor payload is missing location.isApproximate.";
  }

  if (!Array.isArray(vendors)) {
    return 'Nearby vendor payload is missing a "vendors" array.';
  }

  for (const [index, vendor] of vendors.entries()) {
    if (!isObject(vendor)) {
      return `Vendor at index ${index} is not an object.`;
    }

    const name = pickVendorName(vendor);
    if (!name) {
      return `Vendor at index ${index} is missing a readable name/title.`;
    }

    const identifier = pickVendorIdentifier(vendor);
    if (!identifier) {
      return `Vendor "${name}" is missing an id or slug.`;
    }
  }

  return null;
}

function expectNoLeakage(bodyText: string, endpoint: string) {
  const leakagePatterns = [
    /<!doctype html/i,
    /<html/i,
    /stack trace/i,
    /sqlstate/i,
    /syntax error at or near/i,
    /\bpostgres(?:ql)?\b/i,
    /\bprisma\b/i,
    /\btraceback\b/i,
    /\btypeerror\b/i,
    /\breferenceerror\b/i,
    /\bbearer\s+[a-z0-9\-_=]+\.[a-z0-9\-_=]+(?:\.[a-z0-9\-_=]+)?/i,
    /\bapi[_-]?key\b/i,
    /\bsecret\b/i
  ];

  const offendingPattern = leakagePatterns.find((pattern) => pattern.test(bodyText));
  expect(
    offendingPattern,
    offendingPattern
      ? `Expected Local Man vendor API injection probe to avoid leaking internal details for ${endpoint}, but matched ${offendingPattern}.`
      : `Expected Local Man vendor API injection probe to avoid leaking internal details for ${endpoint}.`
  ).toBeUndefined();
}

function pickVendorName(vendor: Record<string, unknown>) {
  const candidate = [vendor.name, vendor.title, vendor.vendorName].find(
    (value) => typeof value === "string" && value.trim() !== ""
  );
  return typeof candidate === "string" ? candidate.trim() : null;
}

function pickVendorIdentifier(vendor: Record<string, unknown>) {
  const candidate = [vendor.id, vendor.slug, vendor.vendorId].find(
    (value) => typeof value === "string" && value.trim() !== ""
  );
  return typeof candidate === "string" ? candidate.trim() : null;
}

function isCoordinateInRange(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function logInjectionResult(input: {
  contentType: string;
  durationMs: number;
  endpoint: string;
  sizeBytes: number;
  status: number;
  test: string;
}) {
  console.log(`LOCALMAN_API_INJECTION ${JSON.stringify(input)}`);
}
