import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const baseUrl = (__ENV.LOCALMAN_URL || "http://localhost:3000").replace(/\/$/, "");
const requestTimeout = __ENV.REQUEST_TIMEOUT || "4s";
const latency = new Trend("vendor_detail_latency_ms");
const timeoutRate = new Rate("vendor_detail_timeout_rate");
const failedRate = new Rate("vendor_detail_failed_request_rate");
const failedRequestCount = new Counter("vendor_detail_failed_request_count");

export const options = {
  vus: Number(__ENV.VUS || 8),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    vendor_detail_failed_request_rate: ["rate<0.05"],
    vendor_detail_latency_ms: ["p(95)<3000"],
    vendor_detail_timeout_rate: ["rate<0.02"]
  }
};

export function setup() {
  const configuredSlug = (__ENV.LOCALMAN_VENDOR_SLUG || "").trim();
  if (configuredSlug) {
    return { detailPath: `/vendors/${configuredSlug}` };
  }

  const nearbyUrl =
    `${baseUrl}/api/vendors/nearby` +
    "?lat=32.77670&lng=-96.79700&location_source=precise&radius_km=10";
  const nearbyResponse = http.get(nearbyUrl, {
    tags: { endpoint: "vendor-detail-discovery" },
    timeout: requestTimeout
  });

  if (nearbyResponse.status >= 200 && nearbyResponse.status < 500) {
    const payload = nearbyResponse.json();
    const vendors = payload?.data?.vendors;
    if (Array.isArray(vendors) && vendors.length > 0) {
      const slug = vendors.find((vendor) => vendor && typeof vendor.slug === "string")?.slug;
      if (slug) {
        return { detailPath: `/vendors/${slug}` };
      }
    }
  }

  return { detailPath: "/vendors/qa-nonexistent-load-check" };
}

export default function (data) {
  const response = http.get(`${baseUrl}${data.detailPath}`, {
    tags: { endpoint: "vendor-detail" },
    timeout: requestTimeout
  });

  latency.add(response.timings.duration);

  const timedOut = response.status === 0;
  const failed = timedOut || response.status >= 500;

  timeoutRate.add(timedOut);
  failedRate.add(failed);

  if (failed) {
    failedRequestCount.add(1);
  }

  check(response, {
    "vendor detail avoids 5xx": (res) => res.status > 0 && res.status < 500,
    "vendor detail responds within 3000ms": (res) => res.timings.duration < 3000,
    "vendor detail returns HTML or JSON": (res) => {
      const contentType = res.headers["Content-Type"] || "";
      return contentType.includes("text/html") || contentType.includes("application/json");
    }
  });

  sleep(0.2);
}
