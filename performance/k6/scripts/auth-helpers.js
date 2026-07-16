import http from "k6/http";
import { check, sleep } from "k6";

const PRODUCTION_HOSTS = new Set(["inssa.us", "www.inssa.us"]);
const PRODUCTION_CONFIRMATION_VALUE = "I_UNDERSTAND_THIS_GENERATES_PRODUCTION_TRAFFIC";
const PLACEHOLDER_PATTERN = /REPLACE_WITH_|<REDACTED>|CHANGE_ME/i;
const ACCOUNT_REUSE_WARNING =
  "Account reuse was enabled for this test. Results represent authentication pipeline and infrastructure capacity under concurrent sessions, not unique-user capacity.";

export const PROFILE_CONFIGS = {
  smoke: {
    maxVus: 2,
    smoke: true,
    stages: [{ duration: "1m", target: 2 }]
  },
  small: {
    maxVus: 10,
    stages: [
      { duration: "1m", target: 5 },
      { duration: "2m", target: 10 },
      { duration: "2m", target: 10 },
      { duration: "1m", target: 0 }
    ]
  },
  medium: {
    maxVus: 25,
    stages: [
      { duration: "1m", target: 5 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 25 },
      { duration: "3m", target: 25 },
      { duration: "1m", target: 0 }
    ]
  },
  large: {
    maxVus: 50,
    stages: [
      { duration: "1m", target: 5 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 50 },
      { duration: "3m", target: 50 },
      { duration: "2m", target: 0 }
    ]
  },
  event: {
    maxVus: 100,
    stages: [
      { duration: "1m", target: 5 },
      { duration: "2m", target: 20 },
      { duration: "2m", target: 50 },
      { duration: "2m", target: 75 },
      { duration: "2m", target: 100 },
      { duration: "3m", target: 100 },
      { duration: "2m", target: 0 }
    ]
  },
  stress150: {
    maxVus: 150,
    stages: [
      { duration: "1m", target: 10 },
      { duration: "2m", target: 25 },
      { duration: "2m", target: 50 },
      { duration: "2m", target: 100 },
      { duration: "2m", target: 150 },
      { duration: "3m", target: 150 },
      { duration: "2m", target: 0 }
    ]
  },
  stress200: {
    maxVus: 200,
    stages: [
      { duration: "1m", target: 10 },
      { duration: "2m", target: 25 },
      { duration: "2m", target: 50 },
      { duration: "2m", target: 100 },
      { duration: "2m", target: 150 },
      { duration: "2m", target: 200 },
      { duration: "3m", target: 200 },
      { duration: "2m", target: 0 }
    ]
  }
};

export function getConfig(scriptName = "auth-load") {
  const baseUrl = trimTrailingSlash(__ENV.BASE_URL || "https://staging.inssa.us");
  const backendBaseUrl = trimTrailingSlash(__ENV.KBEAN_BACKEND_BASE_URL || "https://kbeanbetastaging.azurewebsites.net");
  const firebaseIdentityToolkitBaseUrl = trimTrailingSlash(__ENV.FIREBASE_IDENTITY_TOOLKIT_BASE_URL || "https://identitytoolkit.googleapis.com/v1");
  const testProfile = (__ENV.TEST_PROFILE || "smoke").trim();
  const profile = PROFILE_CONFIGS[testProfile];
  if (!profile) {
    throw new Error(`Unsupported TEST_PROFILE. Use one of: ${Object.keys(PROFILE_CONFIGS).join(", ")}`);
  }

  const requestedMaxVus = parsePositiveInt(__ENV.MAX_VUS, profile.maxVus);
  const maxVus = Math.min(requestedMaxVus, profile.maxVus);

  return {
    allowAccountReuse: parseBoolean(__ENV.ALLOW_ACCOUNT_REUSE, false),
    allowProductionLoadTest: __ENV.ALLOW_PRODUCTION_LOAD_TEST === "true",
    backendBaseUrl,
    baseUrl,
    firebaseApiKey: (__ENV.FIREBASE_API_KEY || "REPLACE_WITH_FIREBASE_WEB_API_KEY").trim(),
    firebaseGmpId: (__ENV.FIREBASE_GMP_ID || "REPLACE_WITH_FIREBASE_GMP_ID").trim(),
    firebaseIdentityToolkitBaseUrl,
    firebaseLookupPath: (__ENV.FIREBASE_LOOKUP_PATH || "/accounts:lookup").trim(),
    firebaseLoginPath: (__ENV.FIREBASE_LOGIN_PATH || "/accounts:signInWithPassword").trim(),
    kbeanPublicApiKey: (__ENV.KBEAN_PUBLIC_API_KEY || "REPLACE_WITH_KBEAN_PUBLIC_API_KEY").trim(),
    maxVus,
    profileByEmailPath: (__ENV.KBEAN_PROFILE_BY_EMAIL_PATH || "/api/public/GetUserProfileByEmail").trim(),
    productionConfirmation: (__ENV.PRODUCTION_CONFIRMATION || "").trim(),
    requestTimeout: (__ENV.REQUEST_TIMEOUT || "10s").trim(),
    scriptName,
    socialAuthenticatePath: (__ENV.KBEAN_SOCIAL_AUTHENTICATE_PATH || "/Account/SocialAuthenticate").trim(),
    socialLoginJwtPath: (__ENV.KBEAN_SOCIAL_LOGIN_JWT_PATH || "/Account/SocialLoginJWT").trim(),
    testProfile,
    usersFile: (__ENV.USERS_FILE || "../data/users.example.json").trim()
  };
}

export function buildLoadStages(config) {
  const baseStages = PROFILE_CONFIGS[config.testProfile].stages;
  return baseStages.map((stage) => ({
    duration: stage.duration,
    target: Math.min(stage.target, config.maxVus)
  }));
}

export function validateConfig(config, users, requiredAccounts) {
  validateStaticSafety(config);
  validateVerifiedAuthContract(config);
  validateUsers(users, config, requiredAccounts);
}

export function validateStaticSafety(config) {
  validateHttpsUrl(config.baseUrl, "BASE_URL");
  validateHttpsUrl(config.backendBaseUrl, "KBEAN_BACKEND_BASE_URL");
  validateHttpsUrl(config.firebaseIdentityToolkitBaseUrl, "FIREBASE_IDENTITY_TOOLKIT_BASE_URL");
  enforceProductionGate(config);
}

export function isProductionUrl(baseUrl) {
  const host = parseHttpsHost(baseUrl);
  return Boolean(host && PRODUCTION_HOSTS.has(host.toLowerCase()));
}

export function enforceProductionGate(config) {
  if (!isProductionUrl(config.baseUrl)) return;
  if (!config.allowProductionLoadTest || config.productionConfirmation !== PRODUCTION_CONFIRMATION_VALUE) {
    throw new Error(
      "Production load testing is blocked. Set ALLOW_PRODUCTION_LOAD_TEST=true and the exact PRODUCTION_CONFIRMATION value before running against production."
    );
  }
}

export function loadUsersFromJson(rawJson) {
  let users;
  try {
    users = JSON.parse(rawJson);
  } catch {
    throw new Error("USERS_FILE must contain valid JSON.");
  }
  if (!Array.isArray(users)) {
    throw new Error("USERS_FILE must contain an array of accounts.");
  }
  return users.map((user, index) => normalizeUser(user, index));
}

export function validateUsers(users, config, requiredAccounts) {
  if (!users.length) {
    throw new Error("USERS_FILE must contain at least one account.");
  }
  for (const user of users) {
    if (!user.identifier || !user.password) {
      throw new Error("Every test user must include an email or username and a password placeholder/value.");
    }
    if (PLACEHOLDER_PATTERN.test(user.password)) {
      throw new Error("USERS_FILE contains placeholder passwords. Create data/users.json with runtime secrets outside Git.");
    }
  }
  if (users.length < requiredAccounts && !config.allowAccountReuse) {
    throw new Error(
      `This profile requires ${requiredAccounts} dedicated accounts. Found ${users.length}. Set ALLOW_ACCOUNT_REUSE=true only if the application owner approves account reuse.`
    );
  }
  if (users.length < requiredAccounts && config.allowAccountReuse) {
    console.warn(
      `WARNING: ${requiredAccounts} VUs are configured but only ${users.length} accounts were loaded. Account reuse may distort results or trigger protection controls.`
    );
  }
}

export function selectAccount(users) {
  const accountIndex = (__VU - 1) % users.length;
  return users[accountIndex];
}

export function executeAuthenticationWorkflow(config, account, metrics) {
  const startedAt = Date.now();
  metrics.authLoginRequests.add(1);

  const firebaseLogin = firebasePasswordLogin(config, account, metrics);
  if (!firebaseLogin.success) return failWorkflow(startedAt, firebaseLogin, metrics);

  const lookup = firebaseAccountLookup(config, firebaseLogin.idToken, metrics);
  if (!lookup.success) return failWorkflow(startedAt, lookup, metrics);

  const socialJwt = kbeanSocialLoginJwt(config, account, firebaseLogin, lookup, metrics);
  if (!socialJwt.success) return failWorkflow(startedAt, socialJwt, metrics);

  const socialAuth = kbeanSocialAuthenticate(config, socialJwt.jwt, metrics);
  if (!socialAuth.success) return failWorkflow(startedAt, socialAuth, metrics);

  const profile = kbeanGetUserProfileByEmail(config, account, metrics);
  if (!profile.success) return failWorkflow(startedAt, profile, metrics);

  const duration = Date.now() - startedAt;
  metrics.e2eLoginDuration.add(duration);
  metrics.authSuccessRate.add(true);
  metrics.authWorkflowSuccesses.add(1);
  return {
    duration,
    response: profile.response,
    stage: "complete",
    success: true
  };
}

export function firebasePasswordLogin(config, account, metrics) {
  const url = withApiKey(`${config.firebaseIdentityToolkitBaseUrl}${config.firebaseLoginPath}`, config.firebaseApiKey);
  const body = JSON.stringify({
    returnSecureToken: true,
    email: account.identifier,
    password: account.password,
    clientType: "CLIENT_TYPE_WEB"
  });
  const response = http.post(url, body, {
    headers: firebaseHeaders(config),
    tags: {
      endpoint: "firebase_sign_in_with_password",
      operation: "authentication",
      stage: "firebase_login"
    },
    timeout: config.requestTimeout
  });

  recordHttp(response, metrics);
  metrics.firebaseLoginDuration.add(response.timings.duration);

  const json = safeJson(response.body);
  const success = response.status === 200 && Boolean(json?.idToken && json?.refreshToken && json?.localId);
  recordStageResult(metrics.firebaseLoginSuccesses, metrics.firebaseLoginFailures, success);
  check(response, {
    "firebase login returned 200": (res) => res.status === 200,
    "firebase login returned idToken": () => Boolean(json?.idToken),
    "firebase login returned refreshToken": () => Boolean(json?.refreshToken),
    "firebase login returned localId": () => Boolean(json?.localId)
  });

  if (!success) {
    return stageFailure("firebase_login", response, "Firebase login did not return required token fields.");
  }

  return {
    email: json.email || account.identifier,
    expiresIn: Number.parseInt(json.expiresIn || "3600", 10),
    idToken: json.idToken,
    localId: json.localId,
    refreshToken: json.refreshToken,
    response,
    stage: "firebase_login",
    success: true
  };
}

export function firebaseAccountLookup(config, idToken, metrics) {
  const url = withApiKey(`${config.firebaseIdentityToolkitBaseUrl}${config.firebaseLookupPath}`, config.firebaseApiKey);
  const response = http.post(
    url,
    JSON.stringify({
      idToken
    }),
    {
      headers: firebaseHeaders(config),
      tags: {
        endpoint: "firebase_accounts_lookup",
        operation: "authentication",
        stage: "firebase_lookup"
      },
      timeout: config.requestTimeout
    }
  );

  recordHttp(response, metrics);
  metrics.firebaseLookupDuration.add(response.timings.duration);

  const json = safeJson(response.body);
  const user = Array.isArray(json?.users) ? json.users[0] : null;
  const success = response.status === 200 && Boolean(user?.localId);
  recordStageResult(metrics.firebaseLookupSuccesses, metrics.firebaseLookupFailures, success);
  check(response, {
    "firebase lookup returned 200": (res) => res.status === 200,
    "firebase lookup returned account": () => Boolean(user?.localId)
  });

  if (!success) {
    return stageFailure("firebase_lookup", response, "Firebase lookup did not return account data.");
  }

  return {
    response,
    stage: "firebase_lookup",
    success: true,
    user
  };
}

export function kbeanSocialLoginJwt(config, account, firebaseLogin, lookup, metrics) {
  const currentUser = buildFirebaseCurrentUser(config, account, firebaseLogin, lookup.user);
  const multipart = buildMultipartBody({
    fbtoken: firebaseLogin.idToken,
    currentUser: JSON.stringify(currentUser),
    hasSignedUpWithINSSA: "true",
    password: ""
  });
  const response = http.post(`${config.backendBaseUrl}${config.socialLoginJwtPath}`, multipart.body, {
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": multipart.contentType,
      origin: config.baseUrl,
      referer: `${config.baseUrl}/`
    },
    tags: {
      endpoint: "kbean_social_login_jwt",
      operation: "authentication",
      stage: "social_login_jwt"
    },
    timeout: config.requestTimeout
  });

  recordHttp(response, metrics);
  metrics.socialLoginJwtDuration.add(response.timings.duration);

  const jwt = String(response.body || "").trim();
  const success = response.status === 200 && looksLikeJwt(jwt);
  recordStageResult(metrics.socialLoginJwtSuccesses, metrics.socialLoginJwtFailures, success);
  check(response, {
    "social login jwt returned 200": (res) => res.status === 200,
    "social login jwt returned token": () => looksLikeJwt(jwt)
  });

  if (!success) {
    return stageFailure("social_login_jwt", response, "SocialLoginJWT did not return a JWT.");
  }

  return {
    jwt,
    response,
    stage: "social_login_jwt",
    success: true
  };
}

export function kbeanSocialAuthenticate(config, jwt, metrics) {
  const multipart = buildMultipartBody({
    fbtoken: jwt
  });
  const response = http.post(`${config.backendBaseUrl}${config.socialAuthenticatePath}`, multipart.body, {
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": multipart.contentType,
      origin: config.baseUrl,
      referer: `${config.baseUrl}/`
    },
    tags: {
      endpoint: "kbean_social_authenticate",
      operation: "authentication",
      stage: "social_authenticate"
    },
    timeout: config.requestTimeout
  });

  recordHttp(response, metrics);
  metrics.socialAuthenticateDuration.add(response.timings.duration);

  const json = safeJson(response.body);
  const token = json?.token || "";
  const success = response.status === 200 && Boolean(token);
  recordStageResult(metrics.socialAuthenticateSuccesses, metrics.socialAuthenticateFailures, success);
  check(response, {
    "social authenticate returned 200": (res) => res.status === 200,
    "social authenticate returned token": () => Boolean(token)
  });

  if (!success) {
    return stageFailure("social_authenticate", response, "SocialAuthenticate did not return a token.");
  }

  return {
    response,
    stage: "social_authenticate",
    success: true,
    token
  };
}

export function kbeanGetUserProfileByEmail(config, account, metrics) {
  const response = http.post(
    `${config.backendBaseUrl}${config.profileByEmailPath}`,
    JSON.stringify({
      EmailAddress: account.identifier
    }),
    {
      headers: {
        accept: "application/json, text/plain, */*",
        apikey: config.kbeanPublicApiKey,
        "content-type": "application/json",
        origin: config.baseUrl,
        referer: `${config.baseUrl}/`
      },
      tags: {
        endpoint: "kbean_get_user_profile_by_email",
        operation: "authentication",
        stage: "profile_lookup"
      },
      timeout: config.requestTimeout
    }
  );

  recordHttp(response, metrics);
  metrics.profileLookupDuration.add(response.timings.duration);

  const json = safeJson(response.body);
  const success = response.status === 200 && Boolean(json?.emailAddress || json?.userName || json?.id);
  recordStageResult(metrics.profileLookupSuccesses, metrics.profileLookupFailures, success);
  check(response, {
    "profile lookup returned 200": (res) => res.status === 200,
    "profile lookup returned profile": () => Boolean(json?.emailAddress || json?.userName || json?.id)
  });

  if (!success) {
    return stageFailure("profile_lookup", response, "Profile lookup did not return profile data.");
  }

  return {
    profile: json,
    response,
    stage: "profile_lookup",
    success: true
  };
}

export function summarizeFailure(result) {
  if (!result) return "Authentication failed: stage=unknown";
  const status = result.response?.status ?? 0;
  const duration = result.response?.timings?.duration ? Math.round(result.response.timings.duration) : 0;
  return `Authentication failed: stage=${result.stage}, status=${status}, duration=${duration}ms, reason=${result.reason}`;
}

export function redactResponseForDebug(response) {
  if (!response) return { status: 0, body: "[no response]" };
  return {
    body: "[redacted]",
    headers: "[redacted]",
    status: response.status,
    timings: response.timings ? { duration: Math.round(response.timings.duration) } : {}
  };
}

export function randomThinkTime() {
  return randomIntBetween(3, 8);
}

export function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function recordHttp(response, metrics) {
  if (!response) {
    metrics.networkErrors.add(1);
    return;
  }
  if (response.status === 400) metrics.http400.add(1);
  if (response.status === 401) metrics.http401.add(1);
  if (response.status === 403) metrics.http403.add(1);
  if (response.status === 408) metrics.http408.add(1);
  if (response.status === 429) metrics.http429.add(1);
  if (response.status === 500) metrics.http500.add(1);
  if (response.status === 502) metrics.http502.add(1);
  if (response.status === 503) metrics.http503.add(1);
  if (response.status === 504) metrics.http504.add(1);
  if (response.status >= 500 && response.status <= 599) metrics.http5xx.add(1);
}

export function sleepWithThinkTime() {
  sleep(randomThinkTime());
}

export function safeRateValue(value) {
  return Number.isFinite(value) ? value : 0;
}

export function summaryText(data, config) {
  const metrics = data.metrics || {};
  const authSuccess = metrics.auth_success_rate?.values?.rate ?? 0;
  const e2eDuration = metrics.e2e_login_duration?.values || {};
  const httpFailed = metrics.http_req_failed?.values?.rate ?? 0;
  const totalLogins = metrics.auth_login_requests?.values?.count ?? 0;
  const failedLogins = metrics.auth_failures?.values?.count ?? 0;
  const successfulLogins = metrics.auth_workflow_successes?.values?.count ?? Math.max(0, totalLogins - failedLogins);
  const startedAt = data.state?.testRunDurationMs ? new Date(Date.now() - data.state.testRunDurationMs).toISOString() : "unknown";
  const completedAt = new Date().toISOString();

  return [
    "INSSA Authentication k6 Summary",
    "",
    `Test environment: ${config.baseUrl}`,
    `Firebase endpoint: ${config.firebaseIdentityToolkitBaseUrl}`,
    `Backend endpoint: ${config.backendBaseUrl}`,
    `Test profile: ${config.testProfile}`,
    `Maximum configured VUs: ${config.maxVus}`,
    `Peak active VUs: ${metrics.vus_max?.values?.max ?? config.maxVus}`,
    `Total login workflows: ${totalLogins}`,
    `Successful login workflows: ${successfulLogins}`,
    `Failed login workflows: ${failedLogins}`,
    `Authentication success rate: ${(safeRateValue(authSuccess) * 100).toFixed(2)}%`,
    `Average end-to-end response time: ${(e2eDuration.avg ?? 0).toFixed(2)}ms`,
    `p90 end-to-end response time: ${(e2eDuration["p(90)"] ?? 0).toFixed(2)}ms`,
    `p95 end-to-end response time: ${(e2eDuration["p(95)"] ?? 0).toFixed(2)}ms`,
    `p99 end-to-end response time: ${(e2eDuration["p(99)"] ?? 0).toFixed(2)}ms`,
    `HTTP failure rate: ${(safeRateValue(httpFailed) * 100).toFixed(2)}%`,
    `401 count: ${metrics.http_401_count?.values?.count ?? 0}`,
    `429 count: ${metrics.http_429_count?.values?.count ?? 0}`,
    `5xx count: ${metrics.http_5xx_count?.values?.count ?? 0}`,
    `Firebase login failures: ${metrics.firebase_login_failures?.values?.count ?? 0}`,
    `Firebase lookup failures: ${metrics.firebase_lookup_failures?.values?.count ?? 0}`,
    `SocialLoginJWT failures: ${metrics.social_login_jwt_failures?.values?.count ?? 0}`,
    `SocialAuthenticate failures: ${metrics.social_authenticate_failures?.values?.count ?? 0}`,
    `Profile lookup failures: ${metrics.profile_lookup_failures?.values?.count ?? 0}`,
    `Thresholds passed: see k6 output`,
    `Start time: ${startedAt}`,
    `Completion time: ${completedAt}`,
    config.allowAccountReuse ? "" : null,
    config.allowAccountReuse ? ACCOUNT_REUSE_WARNING : null,
    "",
    "Safety warning: this result only validates the tested traffic profile. It does not prove INSSA supports untested concurrency levels or stable Azure behavior outside this run."
  ].filter((line) => line !== null).join("\n");
}

export function summaryOutputs(data, config) {
  const report = buildProfileReport(data, config);
  const prefix = `results/${safeFileName(config.testProfile)}-summary`;
  return {
    [`${prefix}.json`]: JSON.stringify(report, null, 2),
    [`${prefix}.csv`]: profileReportCsv(report),
    [`${prefix}.html`]: profileReportHtml(report),
    "results/auth-summary.json": JSON.stringify(report, null, 2),
    "results/auth-summary.txt": summaryText(data, config),
    stdout: summaryText(data, config)
  };
}

export function buildProfileReport(data, config) {
  const metrics = data.metrics || {};
  const e2e = trendValues(metrics.e2e_login_duration);
  const httpReqs = values(metrics.http_reqs);
  const authSuccessRate = rate(metrics.auth_success_rate);
  const httpFailureRate = rate(metrics.http_req_failed);
  const totalWorkflows = count(metrics.auth_login_requests);
  const successfulWorkflows = count(metrics.auth_workflow_successes);
  const failedWorkflows = count(metrics.auth_failures);
  const http4xx = count(metrics.http_400_count) + count(metrics.http_401_count) + count(metrics.http_403_count) + count(metrics.http_408_count) + count(metrics.http_429_count);
  const http5xx = count(metrics.http_5xx_count);
  const startedAt = data.state?.testRunDurationMs ? new Date(Date.now() - data.state.testRunDurationMs).toISOString() : "unknown";
  const finishedAt = new Date().toISOString();
  const networkFailureCount = count(metrics.network_error_count);
  const thresholdResults = {
    authSuccessRate: {
      label: "Authentication success rate >= 95%",
      pass: authSuccessRate >= 0.95,
      value: `${(authSuccessRate * 100).toFixed(2)}%`
    },
    httpFailures: {
      label: "HTTP failures < 5%",
      pass: httpFailureRate < 0.05,
      value: `${(httpFailureRate * 100).toFixed(2)}%`
    },
    p95: {
      label: "Latency target: p95 end-to-end < 3000ms",
      pass: (e2e.p95 || 0) < 3000,
      value: `${(e2e.p95 || 0).toFixed(2)}ms`
    },
    p99: {
      label: "Latency target: p99 end-to-end < 5000ms",
      pass: (e2e.p99 || 0) < 5000,
      value: `${(e2e.p99 || 0).toFixed(2)}ms`
    },
    repeated5xx: {
      label: "No sustained 5xx responses",
      pass: http5xx < 5,
      value: String(http5xx)
    },
    networkFailures: {
      label: "No repeated network failures",
      pass: networkFailureCount < 2,
      value: String(networkFailureCount)
    }
  };
  const criticalPassed =
    thresholdResults.authSuccessRate.pass &&
    thresholdResults.httpFailures.pass &&
    thresholdResults.repeated5xx.pass &&
    thresholdResults.networkFailures.pass;
  const latencyTargetsPassed = thresholdResults.p95.pass && thresholdResults.p99.pass;
  const status = criticalPassed ? (latencyTargetsPassed ? "PASS" : "DEGRADED") : "FAIL";

  return {
    generatedAt: finishedAt,
    profile: config.testProfile,
    environment: config.baseUrl,
    backend: config.backendBaseUrl,
    firebase: config.firebaseIdentityToolkitBaseUrl,
    accountReuseEnabled: config.allowAccountReuse,
    accountReuseWarning: config.allowAccountReuse ? ACCOUNT_REUSE_WARNING : "",
    startedAt,
    finishedAt,
    durationMs: data.state?.testRunDurationMs || null,
    maxVus: config.maxVus,
    totalRequests: httpReqs.count || 0,
    requestsPerSecond: httpReqs.rate || 0,
    totalAuthenticationWorkflows: totalWorkflows,
    successfulAuthentications: successfulWorkflows,
    failedAuthentications: failedWorkflows,
    authenticationSuccessRate: authSuccessRate,
    responseTimes: e2e,
    httpFailureRate,
    http4xx,
    http5xx,
    statusCounts: {
      "400": count(metrics.http_400_count),
      "401": count(metrics.http_401_count),
      "403": count(metrics.http_403_count),
      "408": count(metrics.http_408_count),
      "429": count(metrics.http_429_count),
      "500": count(metrics.http_500_count),
      "502": count(metrics.http_502_count),
      "503": count(metrics.http_503_count),
      "504": count(metrics.http_504_count)
    },
    stageTimings: {
      firebaseLogin: trendValues(metrics.firebase_login_duration),
      firebaseLookup: trendValues(metrics.firebase_lookup_duration),
      socialLoginJwt: trendValues(metrics.social_login_jwt_duration),
      socialAuthenticate: trendValues(metrics.social_authenticate_duration),
      getUserProfileByEmail: trendValues(metrics.profile_lookup_duration)
    },
    stageFailures: {
      firebaseLogin: count(metrics.firebase_login_failures),
      firebaseLookup: count(metrics.firebase_lookup_failures),
      socialLoginJwt: count(metrics.social_login_jwt_failures),
      socialAuthenticate: count(metrics.social_authenticate_failures),
      getUserProfileByEmail: count(metrics.profile_lookup_failures)
    },
    thresholdResults,
    status,
    capacityClassification: status === "DEGRADED" ? "COMPLETED WITH DEGRADED PERFORMANCE" : status,
    finalRecommendation: status === "FAIL"
      ? `Profile ${config.testProfile} failed critical capacity safety gates. Stop testing and review failures before increasing load.`
      : `Profile ${config.testProfile} completed. Continue only to the next profile in the approved staged capacity sequence.`
  };
}

function failWorkflow(startedAt, result, metrics) {
  metrics.authFailures.add(1);
  metrics.authSuccessRate.add(false);
  metrics.e2eLoginDuration.add(Date.now() - startedAt);
  return {
    ...result,
    duration: Date.now() - startedAt,
    success: false
  };
}

function profileReportCsv(report) {
  const rows = [
    ["field", "value"],
    ["profile", report.profile],
    ["environment", report.environment],
    ["startedAt", report.startedAt],
    ["finishedAt", report.finishedAt],
    ["durationMs", report.durationMs],
    ["maxVus", report.maxVus],
    ["totalRequests", report.totalRequests],
    ["requestsPerSecond", report.requestsPerSecond],
    ["successfulAuthentications", report.successfulAuthentications],
    ["failedAuthentications", report.failedAuthentications],
    ["authenticationSuccessRate", report.authenticationSuccessRate],
    ["averageResponseTimeMs", report.responseTimes.avg],
    ["medianResponseTimeMs", report.responseTimes.med],
    ["p90ResponseTimeMs", report.responseTimes.p90],
    ["p95ResponseTimeMs", report.responseTimes.p95],
    ["p99ResponseTimeMs", report.responseTimes.p99],
    ["fastestRequestMs", report.responseTimes.min],
    ["slowestRequestMs", report.responseTimes.max],
    ["httpFailureRate", report.httpFailureRate],
    ["http4xx", report.http4xx],
    ["http5xx", report.http5xx],
    ["firebaseLoginAvgMs", report.stageTimings.firebaseLogin.avg],
    ["firebaseLookupAvgMs", report.stageTimings.firebaseLookup.avg],
    ["socialLoginJwtAvgMs", report.stageTimings.socialLoginJwt.avg],
    ["socialAuthenticateAvgMs", report.stageTimings.socialAuthenticate.avg],
    ["getUserProfileByEmailAvgMs", report.stageTimings.getUserProfileByEmail.avg],
    ["status", report.status],
    ["accountReuseEnabled", report.accountReuseEnabled],
    ["accountReuseWarning", report.accountReuseWarning],
    ["recommendation", report.finalRecommendation]
  ];
  return `${rows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function profileReportHtml(report) {
  const statusClass = report.status === "PASS" ? "pass" : report.status === "DEGRADED" ? "warn" : "fail";
  const thresholdRows = Object.keys(report.thresholdResults)
    .map((key) => {
      const threshold = report.thresholdResults[key];
      return `<tr><td>${escapeHtml(threshold.label)}</td><td>${escapeHtml(threshold.value)}</td><td><span class="pill ${threshold.pass ? "pass" : "fail"}">${threshold.pass ? "PASS" : "FAIL"}</span></td></tr>`;
    })
    .join("");
  const stageRows = Object.keys(report.stageTimings)
    .map((key) => {
      const stage = report.stageTimings[key];
      return `<tr><td>${escapeHtml(stageLabel(key))}</td><td>${fmt(stage.avg)}ms</td><td>${fmt(stage.med)}ms</td><td>${fmt(stage.p95)}ms</td><td>${fmt(stage.p99)}ms</td><td>${report.stageFailures[key] || 0}</td></tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>INSSA k6 ${escapeHtml(report.profile)} Summary</title>
  <style>
    :root { color-scheme: dark; --bg:#08111f; --panel:#111c2e; --line:#263850; --text:#edf4ff; --muted:#9fb0c6; --green:#35d07f; --yellow:#ffd166; --red:#ff5c6c; --cyan:#55d6ff; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:linear-gradient(135deg,#07101d,#0e1828); color:var(--text); }
    main { max-width:1180px; margin:0 auto; padding:32px; }
    h1, h2 { margin:0 0 10px; }
    .muted { color:var(--muted); }
    .grid { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:14px; margin:22px 0; }
    .card { background:rgba(17,28,46,.92); border:1px solid var(--line); border-radius:14px; padding:18px; box-shadow:0 12px 40px rgba(0,0,0,.24); }
    .metric-label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    .metric-value { font-size:26px; font-weight:750; margin-top:8px; }
    .pill { display:inline-flex; border-radius:999px; padding:4px 10px; font-weight:700; font-size:12px; }
    .pass { background:rgba(53,208,127,.16); color:var(--green); border:1px solid rgba(53,208,127,.38); }
    .warn { background:rgba(255,209,102,.16); color:var(--yellow); border:1px solid rgba(255,209,102,.38); }
    .fail { background:rgba(255,92,108,.16); color:var(--red); border:1px solid rgba(255,92,108,.38); }
    table { width:100%; border-collapse:collapse; }
    th, td { border-bottom:1px solid var(--line); padding:10px 8px; text-align:left; }
    th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.07em; }
    .two { display:grid; grid-template-columns: 1fr 1fr; gap:16px; }
    svg { width:100%; height:auto; background:#0a1424; border:1px solid var(--line); border-radius:12px; }
    .rec { border-left:4px solid ${report.status === "PASS" ? "var(--green)" : report.status === "DEGRADED" ? "var(--yellow)" : "var(--red)"}; }
  </style>
</head>
<body>
<main>
  <section class="card">
    <div class="pill ${statusClass}">${escapeHtml(report.capacityClassification || report.status)}</div>
    <h1>INSSA Authentication Performance: ${escapeHtml(report.profile)}</h1>
    <p class="muted">Environment: ${escapeHtml(report.environment)} | Started: ${escapeHtml(report.startedAt)} | Finished: ${escapeHtml(report.finishedAt)}</p>
  </section>

  ${accountReuseWarningHtml(report)}

  <section class="grid">
    ${metricCard("Max VUs", report.maxVus)}
    ${metricCard("Total Requests", report.totalRequests)}
    ${metricCard("Auth Success", `${(report.authenticationSuccessRate * 100).toFixed(2)}%`)}
    ${metricCard("p95 E2E", `${fmt(report.responseTimes.p95)}ms`)}
    ${metricCard("Avg E2E", `${fmt(report.responseTimes.avg)}ms`)}
    ${metricCard("Median E2E", `${fmt(report.responseTimes.med)}ms`)}
    ${metricCard("p99 E2E", `${fmt(report.responseTimes.p99)}ms`)}
    ${metricCard("RPS", fmt(report.requestsPerSecond))}
  </section>

  <section class="two">
    <div class="card">
      <h2>Response Time Over Time</h2>
      <p class="muted">Aggregate latency curve from fastest, median, average, p90, p95, p99, and slowest request.</p>
      ${lineSvg([
        report.responseTimes.min,
        report.responseTimes.med,
        report.responseTimes.avg,
        report.responseTimes.p90,
        report.responseTimes.p95,
        report.responseTimes.p99,
        report.responseTimes.max
      ], ["min", "median", "avg", "p90", "p95", "p99", "max"])}
    </div>
    <div class="card">
      <h2>Requests Per Second</h2>
      ${singleBarSvg(report.requestsPerSecond, Math.max(1, report.requestsPerSecond), "RPS")}
    </div>
    <div class="card">
      <h2>Success vs Failure</h2>
      ${barSvg([
        { label: "Success", value: report.successfulAuthentications, color: "#35d07f" },
        { label: "Failure", value: report.failedAuthentications, color: "#ff5c6c" }
      ])}
    </div>
    <div class="card">
      <h2>HTTP Status Distribution</h2>
      ${barSvg(Object.keys(report.statusCounts).map((status) => ({ label: status, value: report.statusCounts[status], color: Number(status) >= 500 ? "#ff5c6c" : "#ffd166" })))}
    </div>
  </section>

  <section class="card">
    <h2>Stage Duration Comparison</h2>
    ${barSvg(Object.keys(report.stageTimings).map((stage) => ({ label: stageLabel(stage), value: report.stageTimings[stage].avg || 0, color: "#55d6ff" })))}
  </section>

  <section class="card">
    <h2>Stage-by-stage Timings</h2>
    <table><thead><tr><th>Stage</th><th>Avg</th><th>Median</th><th>p95</th><th>p99</th><th>Failures</th></tr></thead><tbody>${stageRows}</tbody></table>
  </section>

  <section class="card">
    <h2>Threshold Results</h2>
    <table><thead><tr><th>Threshold</th><th>Value</th><th>Status</th></tr></thead><tbody>${thresholdRows}</tbody></table>
  </section>

  <section class="card rec">
    <h2>Final Recommendation</h2>
    <p>${escapeHtml(report.finalRecommendation)}</p>
  </section>
</main>
</body>
</html>`;
}

function metricCard(label, value) {
  return `<div class="card"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(String(value))}</div></div>`;
}

function accountReuseWarningHtml(report) {
  if (!report.accountReuseEnabled) return "";
  return `<section class="card warn"><h2>Account Reuse Warning</h2><p>${escapeHtml(report.accountReuseWarning || ACCOUNT_REUSE_WARNING)}</p></section>`;
}

function lineSvg(values, labels) {
  const cleaned = values.map((value) => Number.isFinite(value) ? value : 0);
  const max = Math.max(1, ...cleaned);
  const points = cleaned
    .map((value, index) => {
      const x = 35 + index * (520 / Math.max(1, cleaned.length - 1));
      const y = 230 - (value / max) * 180;
      return `${x},${y}`;
    })
    .join(" ");
  const dots = cleaned
    .map((value, index) => {
      const x = 35 + index * (520 / Math.max(1, cleaned.length - 1));
      const y = 230 - (value / max) * 180;
      return `<circle cx="${x}" cy="${y}" r="4" fill="#55d6ff"><title>${escapeHtml(labels[index])}: ${fmt(value)}ms</title></circle>`;
    })
    .join("");
  const axisLabels = labels
    .map((label, index) => {
      const x = 35 + index * (520 / Math.max(1, labels.length - 1));
      return `<text x="${x}" y="260" text-anchor="middle" fill="#9fb0c6" font-size="10">${escapeHtml(label)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 590 280" role="img" aria-label="Response time over time aggregate chart"><polyline fill="none" stroke="#55d6ff" stroke-width="3" points="${points}" />${dots}${axisLabels}<text x="20" y="28" fill="#9fb0c6" font-size="11">max ${fmt(max)}ms</text></svg>`;
}

function singleBarSvg(value, max, label) {
  return barSvg([{ label, value, color: "#55d6ff" }], max);
}

function barSvg(items, forcedMax) {
  const max = forcedMax || Math.max(1, ...items.map((item) => item.value || 0));
  const rows = items.length || 1;
  const height = Math.max(90, 38 * rows + 30);
  const bars = items
    .map((item, index) => {
      const value = Number.isFinite(item.value) ? item.value : 0;
      const y = 24 + index * 38;
      const width = Math.max(2, (value / max) * 360);
      return `<text x="18" y="${y + 15}" fill="#edf4ff" font-size="12">${escapeHtml(item.label)}</text><rect x="180" y="${y}" width="${width}" height="20" rx="6" fill="${item.color}" /><text x="${190 + width}" y="${y + 15}" fill="#9fb0c6" font-size="12">${fmt(value)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 590 ${height}" role="img" aria-label="Bar chart">${bars}</svg>`;
}

function trendValues(metric) {
  const metricValues = values(metric);
  return {
    avg: metricValues.avg || 0,
    med: metricValues.med || 0,
    p90: metricValues["p(90)"] || 0,
    p95: metricValues["p(95)"] || 0,
    p99: metricValues["p(99)"] || 0,
    min: metricValues.min || 0,
    max: metricValues.max || 0
  };
}

function values(metric) {
  return metric?.values || {};
}

function count(metric) {
  return values(metric).count || 0;
}

function rate(metric) {
  return values(metric).rate || 0;
}

function fmt(value) {
  return Number.isFinite(value) ? Number(value).toFixed(2).replace(/\.00$/, "") : "0";
}

function stageLabel(value) {
  const labels = {
    firebaseLogin: "Firebase Login",
    firebaseLookup: "Firebase Lookup",
    socialLoginJwt: "SocialLoginJWT",
    socialAuthenticate: "SocialAuthenticate",
    getUserProfileByEmail: "GetUserProfileByEmail"
  };
  return labels[value] || value;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function safeFileName(value) {
  return String(value || "unknown").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stageFailure(stage, response, reason) {
  return {
    reason,
    response,
    stage,
    success: false
  };
}

function validateVerifiedAuthContract(config) {
  validateRelativePath(config.firebaseLoginPath, "FIREBASE_LOGIN_PATH");
  validateRelativePath(config.firebaseLookupPath, "FIREBASE_LOOKUP_PATH");
  validateRelativePath(config.socialLoginJwtPath, "KBEAN_SOCIAL_LOGIN_JWT_PATH");
  validateRelativePath(config.socialAuthenticatePath, "KBEAN_SOCIAL_AUTHENTICATE_PATH");
  validateRelativePath(config.profileByEmailPath, "KBEAN_PROFILE_BY_EMAIL_PATH");
  if (!config.firebaseApiKey || PLACEHOLDER_PATTERN.test(config.firebaseApiKey)) {
    throw new Error("FIREBASE_API_KEY must be supplied from a local, ignored environment file before running.");
  }
  if (!config.firebaseGmpId || PLACEHOLDER_PATTERN.test(config.firebaseGmpId)) {
    throw new Error("FIREBASE_GMP_ID must be supplied from a local, ignored environment file before running.");
  }
  if (!config.kbeanPublicApiKey || PLACEHOLDER_PATTERN.test(config.kbeanPublicApiKey)) {
    throw new Error("KBEAN_PUBLIC_API_KEY must be supplied from a local, ignored environment file before running.");
  }
}

function validateHttpsUrl(value, name) {
  const host = parseHttpsHost(value);
  if (!host) {
    throw new Error(`${name} must use HTTPS. TLS verification must not be disabled.`);
  }
}

function parseHttpsHost(value) {
  const match = String(value || "").trim().match(/^https:\/\/([^/:?#]+)(?::\d+)?(?:[/?#].*)?$/i);
  return match ? match[1] : "";
}

function validateRelativePath(value, name) {
  if (!value || !value.startsWith("/")) {
    throw new Error(`${name} must be a relative path beginning with '/'.`);
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(`${name} still contains a placeholder value.`);
  }
}

function normalizeUser(user, index) {
  if (!user || typeof user !== "object") {
    throw new Error(`Invalid user entry at index ${index}.`);
  }
  const identifier = String(user.email || user.username || "").trim();
  const password = String(user.password || "").trim();
  return {
    identifier,
    password
  };
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function withApiKey(baseUrl, apiKey) {
  return `${baseUrl}?key=${encodeURIComponent(apiKey)}`;
}

function firebaseHeaders(config) {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: config.baseUrl,
    referer: `${config.baseUrl}/`,
    "x-client-version": "Chrome/JsCore/11.6.0/FirebaseCore-web",
    "x-firebase-gmpid": config.firebaseGmpId
  };
}

function buildFirebaseCurrentUser(config, account, firebaseLogin, lookupUser) {
  const now = Date.now();
  const expiresIn = Number.isFinite(firebaseLogin.expiresIn) ? firebaseLogin.expiresIn : 3600;
  return {
    uid: firebaseLogin.localId,
    email: account.identifier,
    emailVerified: Boolean(lookupUser?.emailVerified),
    isAnonymous: false,
    providerData: [
      {
        providerId: "password",
        uid: account.identifier,
        displayName: lookupUser?.displayName || null,
        email: account.identifier,
        phoneNumber: null,
        photoURL: null
      }
    ],
    stsTokenManager: {
      refreshToken: firebaseLogin.refreshToken,
      accessToken: firebaseLogin.idToken,
      expirationTime: now + expiresIn * 1000
    },
    createdAt: lookupUser?.createdAt || "",
    lastLoginAt: lookupUser?.lastLoginAt || "",
    apiKey: config.firebaseApiKey,
    appName: "[DEFAULT]"
  };
}

function buildMultipartBody(fields) {
  const boundary = `----INSSAk6Boundary${Math.random().toString(36).slice(2)}`;
  const parts = Object.entries(fields).map(([name, value]) =>
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${name}"`,
      "",
      String(value)
    ].join("\r\n")
  );
  return {
    body: `${parts.join("\r\n")}\r\n--${boundary}--\r\n`,
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function recordStageResult(successCounter, failureCounter, success) {
  if (success) {
    successCounter.add(1);
  } else {
    failureCounter.add(1);
  }
}

function looksLikeJwt(value) {
  return typeof value === "string" && value.split(".").length === 3 && value.length > 40;
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
