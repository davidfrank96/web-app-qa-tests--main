import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { InssaEvidenceItemRecord } from "./types";
import { providerForEvidenceItem } from "./evidence-storage";

// Verify the complete original object before releasing any bytes. Disk spooling keeps
// large video/trace reads bounded in RAM while retaining the existing SHA-256 contract.
export async function verifiedEvidenceResponse(
  item: InssaEvidenceItemRecord,
  headers: Headers,
  rangeHeader: string | null,
  signal?: AbortSignal,
) {
  const range = parseEvidenceRange(rangeHeader, item.sizeBytes);
  if (range === "invalid") {
    headers.set("content-range", `bytes */${item.sizeBytes}`);
    return new Response(null, { status: 416, headers });
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-private-evidence-"));
  const file = path.join(dir, "object");
  const clean = () => fs.rm(dir, { recursive: true, force: true });
  try {
    const hash = createHash("sha256");
    let size = 0;
    const verifier = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > item.sizeBytes)
          return callback(
            new Error("Durable evidence size verification failed."),
          );
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      await providerForEvidenceItem(item, signal).get(item.storageKey),
      verifier,
      createWriteStream(file, { mode: 0o600 }),
      { signal },
    );
    if (size !== item.sizeBytes || hash.digest("hex") !== item.sha256)
      throw new Error("Durable evidence integrity verification failed.");
    headers.set("accept-ranges", "bytes");
    headers.set(
      "content-length",
      String(range ? range.end - range.start + 1 : size),
    );
    if (range)
      headers.set("content-range", `bytes ${range.start}-${range.end}/${size}`);
    const stream = createReadStream(file, range || {});
    stream.once("close", () => {
      void clean();
    });
    if (signal) {
      const abort = () =>
        stream.destroy(new Error("Evidence response cancelled."));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      stream.once("close", () => signal.removeEventListener("abort", abort));
    }
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: range ? 206 : 200,
      headers,
    });
  } catch (error) {
    await clean();
    throw error;
  }
}
export function parseEvidenceRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return "invalid";
  const start = m[1] ? Number(m[1]) : Math.max(size - Number(m[2]), 0);
  const end = m[1] ? (m[2] ? Number(m[2]) : size - 1) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size ||
    (!m[1] && Number(m[2]) <= 0)
  )
    return "invalid";
  return { start, end: Math.min(end, size - 1) };
}
