import { sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import {
  buildLoadStages,
  executeAuthenticationWorkflow,
  getConfig,
  loadUsersFromJson,
  randomIntBetween,
  selectAccount,
  sleepWithThinkTime,
  summarizeFailure,
  summaryOutputs,
  validateConfig,
  validateStaticSafety
} from "./auth-helpers.js";

const config = getConfig("auth-load");
validateStaticSafety(config);
const users = loadUsersFromJson(open(config.usersFile));

export const authSuccessRate = new Rate("auth_success_rate");
export const e2eLoginDuration = new Trend("e2e_login_duration");
export const firebaseLoginDuration = new Trend("firebase_login_duration");
export const firebaseLookupDuration = new Trend("firebase_lookup_duration");
export const socialLoginJwtDuration = new Trend("social_login_jwt_duration");
export const socialAuthenticateDuration = new Trend("social_authenticate_duration");
export const profileLookupDuration = new Trend("profile_lookup_duration");

export const authFailures = new Counter("auth_failures");
export const authWorkflowSuccesses = new Counter("auth_workflow_successes");
export const authLoginRequests = new Counter("auth_login_requests");
export const firebaseLoginSuccesses = new Counter("firebase_login_successes");
export const firebaseLoginFailures = new Counter("firebase_login_failures");
export const firebaseLookupSuccesses = new Counter("firebase_lookup_successes");
export const firebaseLookupFailures = new Counter("firebase_lookup_failures");
export const socialLoginJwtSuccesses = new Counter("social_login_jwt_successes");
export const socialLoginJwtFailures = new Counter("social_login_jwt_failures");
export const socialAuthenticateSuccesses = new Counter("social_authenticate_successes");
export const socialAuthenticateFailures = new Counter("social_authenticate_failures");
export const profileLookupSuccesses = new Counter("profile_lookup_successes");
export const profileLookupFailures = new Counter("profile_lookup_failures");
export const http400 = new Counter("http_400_count");
export const http401 = new Counter("http_401_count");
export const http403 = new Counter("http_403_count");
export const http408 = new Counter("http_408_count");
export const http429 = new Counter("http_429_count");
export const http500 = new Counter("http_500_count");
export const http502 = new Counter("http_502_count");
export const http503 = new Counter("http_503_count");
export const http504 = new Counter("http_504_count");
export const http5xx = new Counter("http_5xx_count");
export const networkErrors = new Counter("network_error_count");

const metrics = {
  authFailures,
  authLoginRequests,
  authSuccessRate,
  authWorkflowSuccesses,
  e2eLoginDuration,
  firebaseLoginDuration,
  firebaseLoginFailures,
  firebaseLoginSuccesses,
  firebaseLookupDuration,
  firebaseLookupFailures,
  firebaseLookupSuccesses,
  http400,
  http401,
  http403,
  http408,
  http429,
  http500,
  http502,
  http503,
  http504,
  http5xx,
  networkErrors,
  profileLookupDuration,
  profileLookupFailures,
  profileLookupSuccesses,
  socialAuthenticateDuration,
  socialAuthenticateFailures,
  socialAuthenticateSuccesses,
  socialLoginJwtDuration,
  socialLoginJwtFailures,
  socialLoginJwtSuccesses
};

export const options = {
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
  scenarios: {
    authentication_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: buildLoadStages(config),
      gracefulRampDown: "30s",
      gracefulStop: "30s"
    }
  },
  thresholds: {
    http_req_failed: [
      {
        threshold: "rate<0.05",
        abortOnFail: true
      }
    ],
    http_5xx_count: [
      {
        threshold: "count<5",
        abortOnFail: true
      }
    ],
    network_error_count: [
      {
        threshold: "count<2",
        abortOnFail: true
      }
    ],
    auth_success_rate: [
      {
        threshold: "rate>=0.95",
        abortOnFail: true
      }
    ]
  }
};

export function setup() {
  validateConfig(config, users, config.maxVus);
  return {
    config,
    users
  };
}

export default function (data) {
  const account = selectAccount(data.users);
  const first = executeAuthenticationWorkflow(data.config, account, metrics);
  const result = shouldRetry(first) ? retryAuthentication(data.config, account) : first;

  if (!result.success) {
    console.error(summarizeFailure(result));
  }
  sleepWithThinkTime();
}

export function handleSummary(data) {
  return summaryOutputs(data, config);
}

function retryAuthentication(activeConfig, account) {
  sleep(randomIntBetween(1, 3));
  return executeAuthenticationWorkflow(activeConfig, account, metrics);
}

function shouldRetry(result) {
  if (!result || result.success) return false;
  const status = result.response?.status ?? 0;
  if ([400, 401, 403, 409, 429].includes(status)) return false;
  return status === 0 || status === 408 || status >= 500;
}
