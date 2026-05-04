import { expect, type Page, type Response } from "@playwright/test";

const DEFAULT_IMAGE_SIZE_LIMIT_BYTES = 1_048_576;

export type ImageAssetStatus = "fail" | "pass";

export type ImageAssetEntry = {
  contentType?: string;
  httpStatus: number;
  route: string;
  sizeBytes: number;
  status: ImageAssetStatus;
  thresholdBytes: number;
  timestamp: string;
  url: string;
};

export function createImageAssetMonitor(
  page: Page,
  options: {
    label?: string;
    sizeLimitBytes?: number;
  } = {}
) {
  const label = options.label ?? "localman-image-assets";
  const sizeLimitBytes = options.sizeLimitBytes ?? DEFAULT_IMAGE_SIZE_LIMIT_BYTES;
  const entries: ImageAssetEntry[] = [];

  page.on("response", async (response) => {
    if (!(await isImageResponse(response))) {
      return;
    }

    await response.finished().catch(() => undefined);
    const sizeBytes = await resolveImageSizeBytes(response);
    const entry: ImageAssetEntry = {
      contentType: response.headers()["content-type"] ?? undefined,
      httpStatus: response.status(),
      route: toRoute(page.url()),
      sizeBytes,
      status: sizeBytes > sizeLimitBytes ? "fail" : "pass",
      thresholdBytes: sizeLimitBytes,
      timestamp: new Date().toISOString(),
      url: response.url()
    };

    entries.push(entry);
    logImageAssetEntry(label, entry);
  });

  return {
    entries,
    async waitForImageResponses(
      options: {
        minimum?: number;
        timeoutMs?: number;
      } = {}
    ): Promise<ImageAssetEntry[]> {
      const minimum = options.minimum ?? 1;
      const timeoutMs = options.timeoutMs ?? 10_000;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() <= deadline) {
        if (entries.length >= minimum) {
          return entries.slice();
        }

        await page.waitForTimeout(100);
      }

      throw new Error(`Expected at least ${minimum} image responses within ${timeoutMs}ms.`);
    },

    expectNoOversizedImages(options: { minimum?: number } = {}) {
      const minimum = options.minimum ?? 1;

      expect(
        entries.length,
        `Expected at least ${minimum} image responses to be recorded for asset performance validation.`
      ).toBeGreaterThanOrEqual(minimum);

      const oversized = entries.filter((entry) => entry.status === "fail");

      expect(
        oversized,
        oversized.length === 0
          ? "Expected all monitored images to stay under the configured size limit."
          : `Oversized image assets detected:\n${oversized.map(formatEntry).join("\n")}`
      ).toEqual([]);
    }
  };
}

async function isImageResponse(response: Response): Promise<boolean> {
  const request = response.request();
  if (request.resourceType() === "image") {
    return true;
  }

  const contentType = response.headers()["content-type"] ?? "";
  return /^image\//i.test(contentType);
}

async function resolveImageSizeBytes(response: Response): Promise<number> {
  const contentLengthHeader = response.headers()["content-length"];
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;

  if (Number.isFinite(contentLength) && contentLength >= 0) {
    return contentLength;
  }

  const body = await response.body().catch(() => Buffer.alloc(0));
  return body.byteLength;
}

function toRoute(urlOrPath: string): string {
  if (!urlOrPath) {
    return "/";
  }

  try {
    const url = new URL(urlOrPath);
    return `${url.pathname}${url.search}`;
  } catch {
    return urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`;
  }
}

function logImageAssetEntry(label: string, entry: ImageAssetEntry): void {
  console.log(`LOCALMAN_ASSET_PERF ${JSON.stringify({ label, ...entry })}`);
}

function formatEntry(entry: ImageAssetEntry): string {
  const contentType = entry.contentType ? ` contentType=${entry.contentType}` : "";
  return `${entry.url} route=${entry.route} size=${entry.sizeBytes}B threshold=${entry.thresholdBytes}B status=${entry.httpStatus}${contentType}`;
}
