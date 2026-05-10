import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const baseUrl = (__ENV.LOCALMAN_URL || "http://localhost:3000").replace(/\/$/, "");
const requestTimeout = __ENV.REQUEST_TIMEOUT || "3s";
const latency = new Trend("nearby_latency_ms");
const timeoutRate = new Rate("nearby_timeout_rate");
const failedRate = new Rate("nearby_failed_request_rate");
const failedRequestCount = new Counter("nearby_failed_request_count");

export const options = {
  vus: Number(__ENV.VUS || 12),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    nearby_failed_request_rate: ["rate<0.05"],
    nearby_latency_ms: ["p(95)<2000"],
    nearby_timeout_rate: ["rate<0.02"]
  }
};

export default function () {
  const lat = 32.7767 + (Math.random() - 0.5) * 0.05;
  const lng = -96.797 + (Math.random() - 0.5) * 0.05;
  const url =
    `${baseUrl}/api/vendors/nearby` +
    `?lat=${lat.toFixed(5)}` +
    `&lng=${lng.toFixed(5)}` +
    "&location_source=precise&radius_km=10";

  const response = http.get(url, {
    tags: { endpoint: "nearby" },
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
    "nearby returns a non-5xx status": (res) => res.status > 0 && res.status < 500,
    "nearby responds within 2000ms": (res) => res.timings.duration < 2000,
    "nearby returns JSON": (res) => (res.headers["Content-Type"] || "").includes("application/json")
  });

  sleep(0.2);
}
