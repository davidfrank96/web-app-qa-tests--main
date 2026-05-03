import { expect, type Page, type Request } from "@playwright/test";
import { hasLocalManVendors, type LocalManDiscoveryState } from "./test-data";

type VendorApiIssue = {
  endpoint: string;
  failureReason: string;
  durationMs?: number;
  method: string;
  status?: number;
};

type VendorApiCall = {
  endpoint: string;
  durationMs: number;
  method: string;
  payload: unknown | null;
  resourceType: string;
  status: number;
};

type VendorNearbyPayload = {
  success: boolean;
  data: {
    location: {
      source: string;
      label: string;
      coordinates: {
        lat: number;
        lng: number;
      };
      isApproximate: boolean;
    };
    vendors: Array<Record<string, unknown>>;
  };
  error: unknown;
};

const LOCALMAN_VENDOR_ENDPOINT_PATTERN = /\/api\/vendors(?:\/|$|\?)/i;

export function createLocalManVendorApiMonitor(
  page: Page,
  options: {
    label?: string;
  } = {}
) {
  const requestStarts = new Map<Request, number>();
  const issues: VendorApiIssue[] = [];
  const calls: VendorApiCall[] = [];
  const label = options.label ?? "localman-vendor-api";

  page.on("request", (request) => {
    if (!isVendorEndpoint(request.url())) {
      return;
    }

    requestStarts.set(request, Date.now());
  });

  page.on("requestfailed", (request) => {
    if (!isVendorEndpoint(request.url())) {
      return;
    }

    const issue = {
      endpoint: request.url(),
      failureReason: request.failure()?.errorText ?? "request failed",
      durationMs: elapsedSinceRequest(requestStarts, request),
      method: request.method()
    };
    issues.push(issue);
    logVendorApiEvent(label, {
      ...issue,
      kind: "requestfailed"
    });
  });

  page.on("response", async (response) => {
    const request = response.request();
    if (!isVendorEndpoint(response.url())) {
      return;
    }

    const durationMs = elapsedSinceRequest(requestStarts, request);
    let payload: unknown | null = null;
    let failureReason: string | null = null;

    if (response.status() >= 400) {
      failureReason = `HTTP ${response.status()}`;
    }

    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.includes("application/json")) {
      failureReason ??= `Expected JSON response but received "${contentType || "unknown"}"`;
    } else {
      try {
        payload = await response.json();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failureReason ??= `Unable to parse JSON response: ${message}`;
      }
    }

    if (!failureReason && payload) {
      failureReason = validateVendorEndpointPayload(response.url(), payload);
    }

    const call = {
      endpoint: response.url(),
      durationMs,
      method: request.method(),
      payload,
      resourceType: request.resourceType(),
      status: response.status()
    };
    calls.push(call);

    if (failureReason) {
      const issue = {
        endpoint: response.url(),
        failureReason,
        durationMs,
        method: request.method(),
        status: response.status()
      };
      issues.push(issue);
      logVendorApiEvent(label, {
        ...issue,
        kind: "response"
      });
      return;
    }

    logVendorApiEvent(label, {
      kind: "response",
      endpoint: response.url(),
      method: request.method(),
      status: response.status(),
      durationMs,
      vendorCount: extractVendorCount(payload)
    });
  });

  return {
    calls,
    issues,
    async waitForVendorResponses(timeoutMs = 10_000) {
      const deadline = Date.now() + timeoutMs;

      while (Date.now() <= deadline) {
        if (calls.length > 0 || issues.length > 0) {
          return;
        }

        await page.waitForTimeout(200);
      }

      expect(
        calls.length,
        "Expected Local Man to issue at least one vendor-related API request."
      ).toBeGreaterThan(0);
    },
    async expectHealthyVendorResponses(
      options: {
        state?: LocalManDiscoveryState;
        requireNearbyEndpoint?: boolean;
      } = {}
    ) {
      const nearbyCalls = calls.filter((call) => isNearbyVendorsEndpoint(call.endpoint));
      const failures = issues.map(formatVendorApiIssue);

      if (options.requireNearbyEndpoint ?? true) {
        expect(
          nearbyCalls.length,
          "Expected Local Man to call /api/vendors/nearby during discovery."
        ).toBeGreaterThan(0);
      }

      expect(
        failures,
        failures.length === 0
          ? "Expected Local Man vendor-related API requests to succeed."
          : `Unexpected Local Man vendor API failures:\n${failures.join("\n")}`
      ).toEqual([]);

      if (!options.state || nearbyCalls.length === 0) {
        return;
      }

      const latestNearbyCall = nearbyCalls[nearbyCalls.length - 1];
      const vendorCount = extractVendorCount(latestNearbyCall.payload);

      expect(
        vendorCount,
        "Expected /api/vendors/nearby to return a valid vendor array in the response payload."
      ).not.toBeNull();

      if (hasLocalManVendors(options.state)) {
        expect(
          vendorCount!,
          "Expected /api/vendors/nearby to return at least one vendor when the UI renders vendor cards."
        ).toBeGreaterThan(0);
        return;
      }

      expect(
        vendorCount!,
        "Expected /api/vendors/nearby to return zero vendors when the UI renders the empty discovery state."
      ).toBe(0);
    }
  };
}

function isVendorEndpoint(url: string): boolean {
  return LOCALMAN_VENDOR_ENDPOINT_PATTERN.test(url);
}

function isNearbyVendorsEndpoint(url: string): boolean {
  return /\/api\/vendors\/nearby(?:$|\?)/i.test(url);
}

function elapsedSinceRequest(requestStarts: Map<Request, number>, request: Request): number {
  return Date.now() - (requestStarts.get(request) ?? Date.now());
}

function validateVendorEndpointPayload(endpoint: string, payload: unknown): string | null {
  if (!isObject(payload)) {
    return "Response payload is not an object.";
  }

  if (typeof payload.success !== "boolean") {
    return 'Response payload is missing a boolean "success" field.';
  }

  if (payload.success !== true) {
    return `Vendor endpoint returned success=${String(payload.success)}.`;
  }

  if (!("data" in payload) || !isObject(payload.data)) {
    return 'Response payload is missing an object "data" field.';
  }

  if (isNearbyVendorsEndpoint(endpoint)) {
    return validateNearbyVendorPayload(payload as VendorNearbyPayload);
  }

  return null;
}

function validateNearbyVendorPayload(payload: VendorNearbyPayload): string | null {
  if (!isObject(payload.data.location)) {
    return 'Nearby vendor payload is missing a valid "location" object.';
  }

  const { location, vendors } = payload.data;

  if (typeof location.source !== "string" || location.source.trim() === "") {
    return 'Nearby vendor payload is missing location.source.';
  }

  if (typeof location.label !== "string" || location.label.trim() === "") {
    return 'Nearby vendor payload is missing location.label.';
  }

  if (!isObject(location.coordinates)) {
    return 'Nearby vendor payload is missing location.coordinates.';
  }

  if (!Number.isFinite(location.coordinates.lat) || !Number.isFinite(location.coordinates.lng)) {
    return "Nearby vendor payload contains invalid location coordinates.";
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

function extractVendorCount(payload: unknown): number | null {
  if (!isObject(payload) || !isObject(payload.data) || !Array.isArray(payload.data.vendors)) {
    return null;
  }

  return payload.data.vendors.length;
}

function pickVendorName(vendor: Record<string, unknown>): string | null {
  const candidate = [vendor.name, vendor.title, vendor.vendorName].find(
    (value) => typeof value === "string" && value.trim() !== ""
  );
  return typeof candidate === "string" ? candidate.trim() : null;
}

function pickVendorIdentifier(vendor: Record<string, unknown>): string | null {
  const candidate = [vendor.id, vendor.slug, vendor.vendorId].find(
    (value) => typeof value === "string" && value.trim() !== ""
  );
  return typeof candidate === "string" ? candidate.trim() : null;
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function formatVendorApiIssue(issue: VendorApiIssue): string {
  const duration = typeof issue.durationMs === "number" ? `${issue.durationMs}ms` : "unknown";
  const status = typeof issue.status === "number" ? ` status=${issue.status}` : "";
  return `${issue.method} ${issue.endpoint}${status} duration=${duration} reason=${issue.failureReason}`;
}

function logVendorApiEvent(label: string, payload: Record<string, unknown>) {
  console.log(`LOCALMAN_VENDOR_API ${JSON.stringify({ label, ...payload })}`);
}
