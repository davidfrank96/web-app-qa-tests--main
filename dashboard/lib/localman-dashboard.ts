import fs from "node:fs/promises";
import path from "node:path";

export type FeatureKey = "admin" | "api" | "discovery" | "map" | "ui";
export type ResultStatus = "fail" | "pass" | "slow";

export type RawLocalManResult = {
  consoleErrors?: string[];
  durationMs: number;
  errors: string[];
  feature: FeatureKey;
  loadTimes?: Array<{
    durationMs: number;
    metric: string;
    route: string;
    status: ResultStatus;
    timestamp: string;
  }>;
  networkFailures?: string[];
  pageErrors?: string[];
  route: string;
  skipped?: boolean;
  status: ResultStatus;
  test: string;
  timestamp: string;
};

export type FeatureHealth = {
  count: number;
  feature: FeatureKey;
  flaky: number;
  label: string;
  score: number;
  status: ResultStatus | "none";
};

export type RouteRow = {
  avgLoadTimeMs: number;
  errors: string[];
  feature: FeatureKey;
  flaky: boolean;
  route: string;
  status: ResultStatus;
  test: string;
  timestamp: string;
};

export type LocalManDashboardPayload = {
  featureHealth: FeatureHealth[];
  featureScores: Record<FeatureKey, number>;
  generatedAt: string;
  overview: {
    avgLoadTimeMs: number;
    fail: number;
    flaky: number;
    pass: number;
    slow: number;
    total: number;
  };
  rows: RouteRow[];
};

const REPORT_PATH = path.resolve(process.cwd(), "..", "reports", "localman-results.json");
const FEATURE_LABELS: Record<FeatureKey, string> = {
  admin: "Admin",
  api: "API",
  discovery: "Discovery",
  map: "Map",
  ui: "UI"
};

export async function getLocalManDashboardPayload(): Promise<LocalManDashboardPayload> {
  const history = await readResults();
  const latest = latestResultsByTest(history);
  const flakies = flakyTests(history);
  const rows = latest
    .map((result) => toRow(result, flakies.has(result.test)))
    .sort((left, right) => compareStatus(right.status, left.status) || right.timestamp.localeCompare(left.timestamp));

  const overview = {
    avgLoadTimeMs: average(rows.map((row) => row.avgLoadTimeMs)),
    fail: rows.filter((row) => row.status === "fail").length,
    flaky: rows.filter((row) => row.flaky).length,
    pass: rows.filter((row) => row.status === "pass").length,
    slow: rows.filter((row) => row.status === "slow").length,
    total: rows.length
  };

  const featureHealth = (Object.keys(FEATURE_LABELS) as FeatureKey[]).map((feature) => {
    const featureRows = rows.filter((row) => row.feature === feature);
    const featureFlaky = featureRows.filter((row) => row.flaky).length;

    return {
      count: featureRows.length,
      feature,
      flaky: featureFlaky,
      label: FEATURE_LABELS[feature],
      score: scoreFeature(featureRows),
      status: summarizeFeatureStatus(featureRows)
    };
  });
  const featureScores = Object.fromEntries(
    featureHealth.map((feature) => [feature.feature, feature.score])
  ) as Record<FeatureKey, number>;

  return {
    featureHealth,
    featureScores,
    generatedAt: new Date().toISOString(),
    overview,
    rows
  };
}

async function readResults(): Promise<RawLocalManResult[]> {
  try {
    const raw = await fs.readFile(REPORT_PATH, "utf8");
    if (raw.trim() === "") {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isRawLocalManResult);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function latestResultsByTest(history: RawLocalManResult[]) {
  const byTest = new Map<string, RawLocalManResult>();

  for (const result of history) {
    const current = byTest.get(result.test);
    if (!current || current.timestamp.localeCompare(result.timestamp) < 0) {
      byTest.set(result.test, result);
    }
  }

  return [...byTest.values()];
}

function flakyTests(history: RawLocalManResult[]) {
  const statusesByTest = new Map<string, Set<ResultStatus>>();

  for (const result of history) {
    const statuses = statusesByTest.get(result.test) ?? new Set<ResultStatus>();
    statuses.add(result.status);
    statusesByTest.set(result.test, statuses);
  }

  return new Set(
    [...statusesByTest.entries()]
      .filter(([, statuses]) => statuses.has("fail") && (statuses.has("pass") || statuses.has("slow")))
      .map(([test]) => test)
  );
}

function toRow(result: RawLocalManResult, flaky: boolean): RouteRow {
  return {
    avgLoadTimeMs: average(result.loadTimes?.map((item) => item.durationMs) ?? [result.durationMs]),
    errors: unique([
      ...(result.errors ?? []),
      ...(result.consoleErrors ?? []),
      ...(result.networkFailures ?? []),
      ...(result.pageErrors ?? [])
    ]),
    feature: result.feature,
    flaky,
    route: result.route,
    status: result.status,
    test: result.test,
    timestamp: result.timestamp
  };
}

function summarizeFeatureStatus(rows: RouteRow[]): ResultStatus | "none" {
  if (rows.length === 0) {
    return "none";
  }

  if (rows.some((row) => row.status === "fail")) {
    return "fail";
  }

  if (rows.some((row) => row.status === "slow")) {
    return "slow";
  }

  return "pass";
}

function scoreFeature(rows: RouteRow[]) {
  if (rows.length === 0) {
    return 0;
  }

  const total = rows.reduce((sum, row) => sum + scoreStatus(row.status), 0);
  return Math.round(total / rows.length);
}

function scoreStatus(status: ResultStatus) {
  if (status === "pass") {
    return 100;
  }

  if (status === "slow") {
    return 70;
  }

  return 0;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function compareStatus(left: ResultStatus, right: ResultStatus) {
  const rank: Record<ResultStatus, number> = {
    fail: 3,
    slow: 2,
    pass: 1
  };

  return rank[left] - rank[right];
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function isRawLocalManResult(value: unknown): value is RawLocalManResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as RawLocalManResult).test === "string" &&
      typeof (value as RawLocalManResult).route === "string" &&
      typeof (value as RawLocalManResult).feature === "string" &&
      typeof (value as RawLocalManResult).status === "string"
  );
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
