export type ProductWrite = { collection: string; fields: string[]; operation: string };

// Firestore's WebChannel payload is form-encoded JSON. Record field names only;
// never record tokens, document IDs, profile values or user message content.
export function firestoreWrites(url: string, body: string): ProductWrite[] {
  const parsed = new URL(url);
  if (parsed.hostname !== "firestore.googleapis.com" || !/\/Write\/channel$|:commit$/.test(parsed.pathname)) return [];
  const payloads: unknown[] = [];
  try { payloads.push(JSON.parse(body)); } catch {
    for (const [key, value] of new URLSearchParams(body)) {
      if (/^req\d+___data__$/.test(key)) {
        try { payloads.push(JSON.parse(value)); } catch { throw new Error("Unrecognized Firestore write payload"); }
      }
    }
  }
  return payloads.flatMap(payload => {
    const writes = (payload as {writes?: Array<{update?: {name?: string;fields?: object};delete?: string;transform?: {document?:string;fieldTransforms?:Array<{fieldPath:string}>};updateTransforms?:Array<{fieldPath:string}>}>})?.writes ?? [];
    return writes.map(write => ({
      collection: (write.update?.name ?? write.delete ?? write.transform?.document ?? "").split("/documents/")[1]?.split("/")[0] ?? "unknown",
      fields: [...Object.keys(write.update?.fields ?? {}), ...(write.updateTransforms ?? write.transform?.fieldTransforms ?? []).map(field=>field.fieldPath)],
      operation: write.delete ? "delete" : write.transform ? "transform" : "update"
    }));
  });
}

export function isExpectedInssaAccountMetadata(write: ProductWrite): boolean {
  return write.collection === "users" && write.operation === "update" && write.fields.length > 0 &&
    write.fields.every(field => field === "lastActive" || field === "fcmSyncStatus");
}
