import { isDeepStrictEqual } from "node:util";
import type { BrowserContext, Request, Route } from "@playwright/test";

const WRITE_CHANNEL = "/google.firestore.v1.Firestore/Write/channel";
const PROFILE_FIELDS = ["bio", "displayName", "profileImage", "publicHandle", "searchTokens"];
type Fields = Record<string, unknown>;
export type FirestoreWrite = {
  update?: { name?: string; fields?: Fields };
  updateMask?: { fieldPaths?: string[] };
  currentDocument?: { exists?: boolean; updateTime?: string };
  updateTransforms?: Array<{ fieldPath: string; setToServerValue?: string }>;
  delete?: string;
  transform?: unknown;
};
export type SafeWriteClassification = "SESSION_ACTIVITY" | "FCM_NOTIFICATION_METADATA" | "AUTH_PROFILE_INITIALIZATION_NO_CHANGE" | "PRODUCT_MUTATION_OR_UNKNOWN" | "READ_ONLY_DEPENDENCY" | "BENIGN_SESSION_INITIALIZATION" | "BENIGN_NOTIFICATION_METADATA" | "BENIGN_ACCOUNT_INITIALIZATION" | "UNKNOWN" | "PRODUCT_MUTATION";
export type SafeWriteOutcome = "ALLOWED_READ_ONLY" | "ALLOWED_BENIGN_INITIALIZATION" | "BLOCKED_UNEXPECTED_WRITE";
export type SafeWriteRecord = { observedAt?: string; method: string; endpoint: string; collection: string; fields: string[]; classification: SafeWriteClassification; outcome: SafeWriteOutcome; blocked: boolean; serviceWorker?: boolean };

export function parseSafeWritePayload(url: string, method: string, body: string): FirestoreWrite[] {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.hostname !== "firestore.googleapis.com" || method !== "POST" ||
      !(target.pathname === WRITE_CHANNEL || /^\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents:commit$/.test(target.pathname))) {
    throw new Error("Unrecognized Safe Suite write destination or method");
  }
  const payloads: unknown[] = [];
  if (target.pathname !== WRITE_CHANNEL) payloads.push(JSON.parse(body));
  else {
    const params = new URLSearchParams(body);
    for (const [key, value] of params) if (/^req\d+___data__$/.test(key)) payloads.push(JSON.parse(value));
    // WebChannel termination has no payload; all other nonempty envelopes must be understood.
    if (!payloads.length && body && target.searchParams.get("TYPE") !== "terminate") throw new Error("Unrecognized write envelope");
  }
  return payloads.flatMap(payload => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid write envelope");
    const value = payload as { writes?: FirestoreWrite[]; database?: string; streamToken?: string };
    if (value.writes === undefined) {
      if (typeof value.database === "string" || typeof value.streamToken === "string") return [];
      throw new Error("Unknown write envelope purpose");
    }
    if (!Array.isArray(value.writes)) throw new Error("Invalid writes array");
    return value.writes;
  });
}

// Only the current authenticated account is eligible. No IDs, values or tokens
// are returned in audit records. The hydration exception requires a server read.
export function classifySafeWrite(write: FirestoreWrite, ownDocument: string, currentFields?: Fields): SafeWriteClassification {
  const deny = "PRODUCT_MUTATION_OR_UNKNOWN";
  if (!write || Object.keys(write).some(key => !["update", "updateMask", "currentDocument", "updateTransforms"].includes(key)) ||
      write.update?.name !== ownDocument || write.currentDocument?.exists !== true ||
      Object.keys(write.currentDocument).some(key => key !== "exists")) return deny;
  const fields = write.update.fields ?? {};
  const keys = Object.keys(fields).sort();
  const mask = write.updateMask?.fieldPaths;
  if (!Array.isArray(mask) || !isDeepStrictEqual([...mask].sort(), keys)) return deny;
  const transforms = write.updateTransforms ?? [];
  if (!keys.length && transforms.length === 1 &&
      isDeepStrictEqual(transforms[0], { fieldPath: "lastActive", setToServerValue: "REQUEST_TIME" })) return "SESSION_ACTIVITY";
  if (transforms.length) return deny;
  if (isDeepStrictEqual(keys, ["fcmSyncStatus"])) {
    const value = fields.fcmSyncStatus as { mapValue?: { fields?: Fields } };
    const map = value?.mapValue?.fields;
    return map && Object.keys(map).every(key => ["state", "permission", "errorMessage", "updatedAt"].includes(key)) &&
      ["state", "updatedAt"].every(key => key in map) ? "FCM_NOTIFICATION_METADATA" : deny;
  }
  // Observed product bootstrap retries hydration when displayName is empty.
  // A real content change, extra field, transform, deletion or missing baseline fails.
  if (!currentFields || !isDeepStrictEqual(keys, PROFILE_FIELDS) ||
      !["displayName", "bio", "profileImage"].every(key => isDeepStrictEqual(currentFields[key], { stringValue: "" })) ||
      !keys.every(key => isDeepStrictEqual(fields[key], currentFields[key]))) return deny;
  return "AUTH_PROFILE_INITIALIZATION_NO_CHANGE";
}

export function classifySafeDependency(url: string, method: string, body: string, contentType?: string): { classification: SafeWriteClassification; outcome: SafeWriteOutcome } {
  const target = new URL(url);
  const result = (classification: SafeWriteClassification, outcome: SafeWriteOutcome) => ({ classification, outcome });
  const unknown = () => result("UNKNOWN", "BLOCKED_UNEXPECTED_WRITE");
  if (method !== "POST" || target.protocol !== "https:") return unknown();
  const host = target.hostname, path = target.pathname;
  if ((host === "identitytoolkit.googleapis.com" && path === "/v1/accounts:lookup") ||
      (host === "kbeanbetastaging.azurewebsites.net" && path === "/api/public/GetUserProfileByEmail")) {
    return result("READ_ONLY_DEPENDENCY", "ALLOWED_READ_ONLY");
  }
  if (host === "securetoken.googleapis.com" && path === "/v1/token") return result("BENIGN_SESSION_INITIALIZATION", "ALLOWED_BENIGN_INITIALIZATION");
  if (host === "firebaseinstallations.googleapis.com" && /^\/v1\/projects\/[^/]+\/installations$/.test(path)) return result("BENIGN_NOTIFICATION_METADATA", "ALLOWED_BENIGN_INITIALIZATION");
  if ((host === "region1.google-analytics.com" && path === "/g/collect") ||
      (host === "o4509804097699840.ingest.us.sentry.io" && path === "/api/4509804098945024/envelope/")) return result("BENIGN_SESSION_INITIALIZATION", "ALLOWED_BENIGN_INITIALIZATION");
  // Saved Media trace: this report matches the report-only policy returned by
  // Google's reCAPTCHA frame. Recognize that exact telemetry envelope only.
  if (host === "csp.withgoogle.com" && path === "/csp/frame-ancestors/38fac9d5b82543fc4729580d18ff2d3d" &&
      !target.search && !target.hash && contentType?.split(";")[0].trim().toLowerCase() === "application/csp-report") {
    try {
      const payload = JSON.parse(body);
      const report = payload?.["csp-report"];
      const policy = report?.["original-policy"];
      if (payload && isDeepStrictEqual(Object.keys(payload), ["csp-report"]) && report &&
          typeof policy === "string" && isDeepStrictEqual(policy.split(";").map(part => part.trim()).filter(Boolean), ["frame-ancestors 'self'", `report-uri ${target.href}`]) &&
          isDeepStrictEqual(report, {
            "document-uri": "https://www.google.com/", "referrer": "",
            "violated-directive": "frame-ancestors", "effective-directive": "frame-ancestors",
            "original-policy": policy, "disposition": "report", "blocked-uri": "https://www.google.com/",
            "status-code": 200, "script-sample": ""
          })) return result("BENIGN_SESSION_INITIALIZATION", "ALLOWED_BENIGN_INITIALIZATION");
    } catch { /* An unknown report remains blocked. */ }
  }
  if (host === "maps.googleapis.com" && path === "/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo") {
    try {
      const values = JSON.parse(body);
      const coordinate = (value: unknown) => Array.isArray(value) && value.length === 2 && value.every(item => typeof item === "number" && Number.isFinite(item));
      const types = ["number", "null", "string", "number", "string", "number", "number", "null", "null", "null", "number", "string", "number", "null", "null", "string"];
      if (Array.isArray(values) && values.length === 17 && Array.isArray(values[0]) && values[0].length === 2 && values[0].every(coordinate) &&
          types.every((type, index) => type === "null" ? values[index + 1] === null : typeof values[index + 1] === type)) {
        return result("READ_ONLY_DEPENDENCY", "ALLOWED_READ_ONLY");
      }
    } catch { /* An unrecognized RPC shape does not inherit an allowance. */ }
  }
  // Deployed backend source audit: claims only reads studio collections;
  // Quick Find creates/patches published capsules and can hydrate stored media.
  if (host === "us-central1-kbean-stg-fcm.cloudfunctions.net") {
    if (path === "/listMyRaffleClaims") return result("READ_ONLY_DEPENDENCY", "ALLOWED_READ_ONLY");
    if (path === "/discover_seedQuickFindCategories") return result("PRODUCT_MUTATION", "BLOCKED_UNEXPECTED_WRITE");
  }
  if (host === "identitytoolkit.googleapis.com" && path === "/v1/accounts:signInWithPassword") {
    return result("BENIGN_SESSION_INITIALIZATION", "ALLOWED_BENIGN_INITIALIZATION");
  }
  return unknown();
}

export async function installSafeWriteAudit(context: BrowserContext, identity: string | { email: string }) {
  const records: SafeWriteRecord[] = [];
  const failures: string[] = [];
  // Credentials remain in memory, bound to the exact WebChannel database.
  const sessions = new Map<string, { token: string; ownDocument: string }>();
  const pattern = "**/*";
  const pending = new Set<Promise<void>>();
  const handle = async (route: Route, request: Request) => {
    const url = new URL(request.url());
    const method = request.method();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) { await route.continue(); return; }
    if (url.hostname !== "firestore.googleapis.com") {
      const decision = classifySafeDependency(url.href, method, request.postData() ?? "", request.headers?.()["content-type"]);
      const blocked = decision.outcome === "BLOCKED_UNEXPECTED_WRITE";
      records.push({ observedAt: new Date().toISOString(), method, endpoint: `${url.origin}${url.pathname.replace(/(@|%40)[^/]+/g, "<redacted>")}`, collection: "dependency", fields: [], ...decision, blocked, serviceWorker: Boolean(request.serviceWorker?.()) });
      if (blocked) {
        failures.push(decision.classification === "PRODUCT_MUTATION" ? "Blocked known product mutation" : "Blocked unclassified non-read request");
        await route.abort("blockedbyclient");
      } else await route.continue();
      return;
    }
    if (method === "POST" && url.pathname === "/google.firestore.v1.Firestore/Listen/channel") { await route.continue(); return; }
    try {
      const body = request.postData() ?? "";
      const database = url.searchParams.get("database") ?? url.pathname.match(/^\/v1\/(projects\/[^/]+\/databases\/\(default\))\/documents:commit$/)?.[1];
      if (!database || !/^projects\/[^/]+\/databases\/\(default\)$/.test(database)) throw new Error("Unknown Firestore database");
      const embeddedHeaders = new URLSearchParams(body).get("headers") ?? "";
      const bearer = request.headers().authorization ?? embeddedHeaders.match(/^Authorization:\s*(Bearer [^\r\n]+)$/mi)?.[1];
      if (bearer) {
        const token = bearer.replace(/^Bearer /, "");
        const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
        const expectedUid = typeof identity === "string" ? identity :
          (typeof claims.email === "string" && claims.email.toLowerCase() === identity.email.toLowerCase() ? claims.sub : null);
        if (!expectedUid || claims.sub !== expectedUid || database !== `projects/${claims.aud}/databases/(default)`) throw new Error("Session identity mismatch");
        sessions.set(database, { token, ownDocument: `${database}/documents/users/${expectedUid}` });
      }
      const writes = parseSafeWritePayload(url.href, method, body);
      const session = sessions.get(database);
      let blocked = false;
      for (const write of writes) {
        let classification = session ? classifySafeWrite(write, session.ownDocument) : "PRODUCT_MUTATION_OR_UNKNOWN" as SafeWriteClassification;
        if (session && classification === "PRODUCT_MUTATION_OR_UNKNOWN" && write.update?.name === session.ownDocument &&
            isDeepStrictEqual(Object.keys(write.update.fields ?? {}).sort(), PROFILE_FIELDS)) {
          // Read before forwarding this request, never after a possible mutation.
          const response = await context.request.get(`https://firestore.googleapis.com/v1/${session.ownDocument}`, {
            headers: { Authorization: `Bearer ${session.token}` }, timeout: 10_000
          });
          try {
            if (!response.ok()) throw new Error("Authenticated profile baseline unavailable");
            const document = await response.json();
            if (document.name !== session.ownDocument) throw new Error("Profile baseline identity mismatch");
            classification = classifySafeWrite(write, session.ownDocument, document.fields);
          } finally { await response.dispose(); }
        }
        const denied = classification === "PRODUCT_MUTATION_OR_UNKNOWN";
        blocked ||= denied;
        records.push({ observedAt: new Date().toISOString(), method, endpoint: `${url.origin}${url.pathname.replace(/\/projects\/[^/]+\//, "/projects/<project>/")}`,
          collection: (write.update?.name ?? write.delete ?? "").split("/documents/")[1]?.split("/")[0] ?? "unknown",
          fields: [...Object.keys(write.update?.fields ?? {}), ...(write.updateTransforms ?? []).map(item => item.fieldPath)], classification, outcome: denied ? "BLOCKED_UNEXPECTED_WRITE" : "ALLOWED_BENIGN_INITIALIZATION", blocked: denied, serviceWorker: Boolean(request.serviceWorker?.()) });
      }
      if (blocked) { failures.push("Blocked unexpected product write"); await route.abort("blockedbyclient"); }
      else await route.continue();
    } catch {
      records.push({ observedAt: new Date().toISOString(), method, endpoint: `${url.origin}${url.pathname.replace(/\/projects\/[^/]+\//, "/projects/<project>/")}`, collection: "unknown", fields: [], classification: "UNKNOWN", outcome: "BLOCKED_UNEXPECTED_WRITE", blocked: true, serviceWorker: Boolean(request.serviceWorker?.()) });
      failures.push("Could not safely classify Firestore request");
      await route.abort("blockedbyclient");
    }
  };
  const tracked = (route: Route, request: Request) => {
    const task = handle(route, request);
    pending.add(task);
    void task.finally(() => pending.delete(task)).catch(() => {});
    return task;
  };
  await context.route(pattern, tracked);
  return { records, failures, dispose: async () => {
    await context.unroute(pattern, tracked);
    await Promise.all([...pending]);
  } };

}
