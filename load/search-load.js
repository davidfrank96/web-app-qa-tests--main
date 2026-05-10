import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const baseUrl = (__ENV.LOCALMAN_URL || "http://localhost:3000").replace(/\/$/, "");
const requestTimeout = __ENV.REQUEST_TIMEOUT || "3s";
const searchTerms = (__ENV.SEARCH_TERMS || "00017,01234,04999,bbq,vegan,coffee")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const latency = new Trend("search_latency_ms");
const timeoutRate = new Rate("search_timeout_rate");
const failedRate = new Rate("search_failed_request_rate");
const failedRequestCount = new Counter("search_failed_request_count");

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    search_failed_request_rate: ["rate<0.05"],
    search_latency_ms: ["p(95)<2000"],
    search_timeout_rate: ["rate<0.02"]
  }
};

export default function () {
  const query = searchTerms[Math.floor(Math.random() * searchTerms.length)] || "00017";
  const url =
    `${baseUrl}/api/vendors/nearby` +
    "?lat=32.77670&lng=-96.79700&location_source=precise&radius_km=10" +
    `&search=${encodeURIComponent(query)}`;

  const response = http.get(url, {
    tags: { endpoint: "search" },
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
    "search returns a non-5xx status": (res) => res.status > 0 && res.status < 500,
    "search responds within 2000ms": (res) => res.timings.duration < 2000,
    "search returns JSON": (res) => (res.headers["Content-Type"] || "").includes("application/json")
  });

  sleep(0.2);
}
