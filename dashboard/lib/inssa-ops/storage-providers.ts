import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  safeBucket,
  safeStorageKey,
  type DurableEvidenceProviderId,
} from "./storage-provider-model";

export type ObjectHead = {
  sizeBytes: number;
  contentType: string;
  etag?: string;
  sha256?: string;
  modifiedAt?: string;
};
export type StorageObject = ObjectHead & { key: string };
export interface EvidenceStorageProvider {
  readonly id: DurableEvidenceProviderId;
  readonly bucket: string;
  put(
    key: string,
    body: Buffer,
    contentType: string,
    sha256: string,
  ): Promise<void>;
  get(key: string): Promise<Readable>;
  head(key: string): Promise<ObjectHead | null>;
  exists(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<void>;
  createReadAccess(key: string, expiresIn?: number): Promise<string>;
  listPrefix(prefix: string, limit?: number): Promise<StorageObject[]>;
}
export class EvidenceStorageError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "CONFLICT" | "UNAVAILABLE",
    operation: string,
  ) {
    super(`Evidence storage ${operation} failed (${code}).`);
  }
}
const statusOf = (e: unknown) =>
  Number(
    (e as { $metadata?: { httpStatusCode?: number }; statusCode?: number })
      ?.$metadata?.httpStatusCode ?? (e as { statusCode?: number })?.statusCode,
  );
function failure(e: unknown, operation: string): never {
  const status = statusOf(e);
  throw new EvidenceStorageError(
    status === 404
      ? "NOT_FOUND"
      : status === 409 || status === 412
        ? "CONFLICT"
        : "UNAVAILABLE",
    operation,
  );
}
function ttl(seconds: number) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300)
    throw new Error("Read access lifetime must be 1–300 seconds.");
  return seconds;
}
function validatePut(key: string, body: Buffer, digest: string) {
  safeStorageKey(key);
  if (
    !/^[a-f0-9]{64}$/.test(digest) ||
    createHash("sha256").update(body).digest("hex") !== digest
  )
    throw new Error("Upload checksum mismatch.");
}
function validateKeys(keys: string[]) {
  if (!keys.length || keys.length > 100)
    throw new Error("Invalid exact deletion keys.");
  keys.forEach(safeStorageKey);
}
function prefixLimit(prefix: string, limit: number) {
  if (prefix)
    safeStorageKey(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000)
    throw new Error("Invalid inventory bound.");
}

export class SpacesEvidenceStorage implements EvidenceStorageProvider {
  readonly id = "spaces" as const;
  readonly bucket: string;
  constructor(
    private readonly client: S3Client,
    bucket: string,
    private readonly signal?: AbortSignal,
  ) {
    this.bucket = safeBucket(bucket);
  }
  private async send<T>(
    operation: string,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    try {
      return await work(
        AbortSignal.any([
          AbortSignal.timeout(60_000),
          ...(this.signal ? [this.signal] : []),
        ]),
      );
    } catch (e) {
      if (this.signal?.aborted) throw this.signal.reason;
      failure(e, operation);
    }
  }
  async put(key: string, body: Buffer, contentType: string, sha256: string) {
    validatePut(key, body, sha256);
    await this.send("put", (signal) =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
          ACL: "private",
          IfNoneMatch: "*",
          Metadata: { sha256 },
        }),
        { abortSignal: signal },
      ),
    );
  }
  async get(key: string): Promise<Readable> {
    safeStorageKey(key);
    const result = await this.send("get", (signal) =>
      this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: signal },
      ),
    );
    if (!(result.Body instanceof Readable))
      throw new EvidenceStorageError("UNAVAILABLE", "stream");
    return result.Body;
  }
  async head(key: string): Promise<ObjectHead | null> {
    safeStorageKey(key);
    try {
      const r = await this.send("head", (signal) =>
        this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
          { abortSignal: signal },
        ),
      );
      if (!Number.isSafeInteger(r.ContentLength) || r.ContentLength! < 0)
        throw new Error("Invalid object size.");
      return {
        sizeBytes: r.ContentLength!,
        contentType: r.ContentType ?? "application/octet-stream",
        etag: r.ETag,
        sha256: r.Metadata?.sha256,
        modifiedAt: r.LastModified?.toISOString(),
      };
    } catch (e) {
      if (e instanceof EvidenceStorageError && e.code === "NOT_FOUND")
        return null;
      throw e;
    }
  }
  async exists(key: string) {
    return (await this.head(key)) !== null;
  }
  async delete(keys: string[]) {
    validateKeys(keys);
    for (const key of keys)
      await this.send("delete", (signal) =>
        this.client.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
          { abortSignal: signal },
        ),
      );
  }
  async createReadAccess(key: string, expiresIn = 60) {
    safeStorageKey(key);
    ttl(expiresIn);
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { expiresIn },
      );
    } catch {
      throw new EvidenceStorageError("UNAVAILABLE", "sign");
    }
  }
  async listPrefix(prefix: string, limit = 5000) {
    prefixLimit(prefix, limit);
    const objects: StorageObject[] = [];
    let token: string | undefined;
    do {
      const r = await this.send("list", (signal) =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: token,
            MaxKeys: Math.min(1000, limit + 1 - objects.length),
          }),
          { abortSignal: signal },
        ),
      );
      for (const o of r.Contents ?? []) {
        if (!o.Key || !Number.isSafeInteger(o.Size) || o.Size! < 0)
          throw new Error("Incomplete object inventory.");
        objects.push({
          key: safeStorageKey(o.Key),
          sizeBytes: o.Size!,
          contentType: "application/octet-stream",
          etag: o.ETag,
          modifiedAt: o.LastModified?.toISOString(),
        });
      }
      if (objects.length > limit || (objects.length === limit && r.IsTruncated))
        throw new Error("Evidence inventory exceeds its safe bound.");
      if (
        r.IsTruncated &&
        (!r.NextContinuationToken || r.NextContinuationToken === token)
      )
        throw new Error("Incomplete object inventory pagination.");
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return objects;
  }
}

export class SupabaseEvidenceStorage implements EvidenceStorageProvider {
  readonly id = "supabase" as const;
  readonly bucket: string;
  private readonly client;
  private privateBucketCheck?: Promise<void>;
  constructor(
    private readonly url: string,
    private readonly key: string,
    bucket: string,
    private readonly signal?: AbortSignal,
  ) {
    this.bucket = safeBucket(bucket);
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            redirect: "error",
            signal: this.requestSignal(init?.signal),
          }),
      },
    });
  }
  private requestSignal(signal?: AbortSignal | null) {
    return AbortSignal.any([
      AbortSignal.timeout(60_000),
      ...(this.signal ? [this.signal] : []),
      ...(signal ? [signal] : []),
    ]);
  }
  private objectUrl(key: string) {
    safeStorageKey(key);
    return `${this.url.replace(/\/$/, "")}/storage/v1/object/${this.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  async put(key: string, body: Buffer, contentType: string, sha256: string) {
    validatePut(key, body, sha256);
    await (this.privateBucketCheck ??= this.checkPrivateBucket());
    const result = await this.client.storage
      .from(this.bucket)
      .upload(key, body, { contentType, upsert: false });
    if (result.error) failure(result.error, "put");
  }
  private async checkPrivateBucket() {
    const existing = await this.client.storage.getBucket(this.bucket);
    if (existing.error) {
      const created = await this.client.storage.createBucket(this.bucket, {
        public: false,
      });
      if (created.error)
        throw new EvidenceStorageError("UNAVAILABLE", "private bucket check");
    } else if (existing.data.public !== false)
      throw new Error("Evidence requires a private Storage bucket.");
  }
  private async request(method: string, key: string) {
    try {
      return await fetch(this.objectUrl(key), {
        method,
        // CDN compression can remove Content-Length on HEAD and change the ETag.
        // Integrity metadata must describe the original stored bytes for both reads.
        headers: { apikey: this.key, authorization: `Bearer ${this.key}`, "accept-encoding": "identity" },
        redirect: "error",
        signal: this.requestSignal(),
        cache: "no-store",
      });
    } catch {
      throw new EvidenceStorageError("UNAVAILABLE", method);
    }
  }
  private async missing(response: Response, key: string, isHead = false): Promise<boolean> {
    if (response.status === 404) return true;
    if (response.status !== 400) return false;
    // Supabase returns HTTP 400 for missing objects. A HEAD has no error body,
    // so confirm the precise object-not-found response; never treat bad credentials
    // or a missing bucket as absence just because the status is 400.
    const detail = isHead ? await this.request("GET", key) : response;
    if (detail.status !== 400) { await detail.body?.cancel(); return false; }
    try {
      const error = await detail.json();
      return error.statusCode === "404" && error.error === "not_found" && error.message === "Object not found";
    } catch { return false; }
  }
  async get(key: string): Promise<Readable> {
    const r = await this.request("GET", key);
    if (!r.ok && await this.missing(r,key)) throw new EvidenceStorageError("NOT_FOUND","get");
    if (!r.ok || !r.body) failure({ statusCode: r.status }, "get");
    return Readable.fromWeb(r.body as import("node:stream/web").ReadableStream);
  }
  async head(key: string): Promise<ObjectHead | null> {
    const r = await this.request("HEAD", key);
    if (await this.missing(r,key,true)) return null;
    if (!r.ok) failure({ statusCode: r.status }, "head");
    const size = r.headers.get("content-length");
    if (
      size === null ||
      !Number.isSafeInteger(Number(size)) ||
      Number(size) < 0
    )
      throw new Error("Incomplete object metadata.");
    return {
      sizeBytes: Number(size),
      contentType: r.headers.get("content-type") ?? "application/octet-stream",
      etag: r.headers.get("etag") ?? undefined,
      modifiedAt: r.headers.get("last-modified")
        ? new Date(r.headers.get("last-modified")!).toISOString()
        : undefined,
    };
  }
  async exists(key: string) {
    const r = await this.request("HEAD", key);
    if (await this.missing(r,key,true)) return false;
    if (!r.ok) failure({ statusCode: r.status }, "exists");
    return true;
  }
  async delete(keys: string[]) {
    validateKeys(keys);
    const r = await this.client.storage.from(this.bucket).remove(keys);
    if (r.error) throw new EvidenceStorageError("UNAVAILABLE", "delete");
  }
  async createReadAccess(key: string, expiresIn = 60) {
    safeStorageKey(key);
    ttl(expiresIn);
    const r = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(key, expiresIn);
    if (r.error) throw new EvidenceStorageError("UNAVAILABLE", "sign");
    return r.data.signedUrl;
  }
  async listPrefix(prefix: string, limit = 5000) {
    prefixLimit(prefix, limit);
    const output: StorageObject[] = [];
    let visited = 0;
    const visit = async (folder: string) => {
      if (++visited > 5000)
        throw new Error("Evidence inventory exceeds its safe bound.");
      for (let offset = 0; ; offset += 100) {
        const r = await this.client.storage
          .from(this.bucket)
          .list(folder, {
            limit: 100,
            offset,
            sortBy: { column: "name", order: "asc" },
          });
        if (r.error) throw new EvidenceStorageError("UNAVAILABLE", "list");
        for (const o of r.data) {
          if (
            !o.name ||
            o.name.includes("/") ||
            o.name === "." ||
            o.name === ".."
          )
            throw new Error("Invalid inventory entry.");
          const key = safeStorageKey(
            [folder, o.name].filter(Boolean).join("/"),
          );
          if (!o.id) await visit(key);
          else {
            output.push({
              key,
              sizeBytes: Number(o.metadata?.size),
              contentType: o.metadata?.mimetype ?? "application/octet-stream",
              modifiedAt: o.updated_at ?? undefined,
            });
            if (
              output.length > limit ||
              !Number.isSafeInteger(Number(o.metadata?.size))
            )
              throw new Error("Incomplete or excessive object inventory.");
          }
        }
        if (r.data.length < 100) break;
      }
    };
    await visit(prefix.replace(/\/$/, ""));
    return output;
  }
}

export function spacesConfiguration() {
  const region = process.env.DO_SPACES_REGION?.trim(),
    endpoint = process.env.DO_SPACES_ENDPOINT?.trim();
  const bucket = process.env.DO_SPACES_BUCKET?.trim(),
    accessKeyId = process.env.DO_SPACES_ACCESS_KEY_ID?.trim(),
    secretAccessKey = process.env.DO_SPACES_SECRET_ACCESS_KEY?.trim();
  if (
    !region ||
    !/^[a-z]+\d+$/.test(region) ||
    endpoint !== `https://${region}.digitaloceanspaces.com` ||
    !bucket ||
    !accessKeyId ||
    !secretAccessKey
  )
    throw new Error("Spaces server configuration is incomplete or invalid.");
  return {
    region,
    endpoint,
    bucket: safeBucket(bucket),
    credentials: { accessKeyId, secretAccessKey },
  };
}
export function storageProvider(
  id: DurableEvidenceProviderId,
  bucket?: string,
  signal?: AbortSignal,
): EvidenceStorageProvider {
  if (id === "spaces") {
    const config = spacesConfiguration();
    if (bucket && bucket !== config.bucket)
      throw new Error(
        "Spaces evidence bucket does not match configured destination.",
      );
    return new SpacesEvidenceStorage(
      new S3Client({
        ...config,
        maxAttempts: 2,
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      }),
      config.bucket,
      signal,
    );
  }
  if (id !== "supabase")
    throw new Error("Unsupported durable evidence provider.");
  const url = process.env.SUPABASE_URL?.trim(),
    key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key)
    throw new Error(
      "Supabase evidence storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; refusing an implicit local fallback.",
    );
  return new SupabaseEvidenceStorage(
    url,
    key,
    bucket ??
      (process.env.INSSA_EVIDENCE_SUPABASE_BUCKET?.trim() || "inssa-evidence"),
    signal,
  );
}
