import { expect, type Page, type Request } from "@playwright/test";

export type MixedContentStatus = "fail";

export type MixedContentEntry = {
  assetUrl: string;
  pageUrl: string;
  resourceType: string;
  route: string;
  status: MixedContentStatus;
  timestamp: string;
};

export function createMixedContentMonitor(
  page: Page,
  options: {
    label?: string;
  } = {}
) {
  const label = options.label ?? "localman-mixed-content";
  const entries: MixedContentEntry[] = [];

  page.on("request", (request) => {
    if (!isMixedContentRequest(request, page)) {
      return;
    }

    const entry: MixedContentEntry = {
      assetUrl: request.url(),
      pageUrl: currentPageUrl(page, request),
      resourceType: request.resourceType(),
      route: toRoute(currentPageUrl(page, request)),
      status: "fail",
      timestamp: new Date().toISOString()
    };

    entries.push(entry);
    logEntry(label, entry);
  });

  return {
    entries,
    expectNoMixedContent() {
      expect(
        entries,
        entries.length === 0
          ? "Expected the HTTPS page to avoid loading HTTP assets."
          : `Mixed-content requests detected:\n${entries.map(formatEntry).join("\n")}`
      ).toEqual([]);
    }
  };
}

function isMixedContentRequest(request: Request, page: Page): boolean {
  if (request.isNavigationRequest()) {
    return false;
  }

  const assetUrl = request.url();
  if (!assetUrl.toLowerCase().startsWith("http://")) {
    return false;
  }

  const pageUrl = currentPageUrl(page, request);
  return pageUrl.toLowerCase().startsWith("https://");
}

function currentPageUrl(page: Page, request: Request): string {
  return request.frame()?.url() || page.url() || "about:blank";
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

function logEntry(label: string, entry: MixedContentEntry): void {
  console.log(`LOCALMAN_MIXED_CONTENT ${JSON.stringify({ label, ...entry })}`);
}

function formatEntry(entry: MixedContentEntry): string {
  return `${entry.assetUrl} page=${entry.pageUrl} route=${entry.route} resource=${entry.resourceType}`;
}
