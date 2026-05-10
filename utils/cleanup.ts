import type { Page } from "@playwright/test";

const ADMIN_QA_VENDOR_CLEANUP_PATH = "/api/admin/vendors/cleanup-qa-admin";
const ADMIN_SESSION_STORAGE_KEY = "local-man-admin-session";

export type QaCleanupReport = {
  deletedUsers: number;
  deletedVendors: number;
  deletedPayloads: number;
};

export type QaTaggedEntity = {
  deleted?: boolean | null;
  email?: string | null;
  is_test?: boolean | null;
  isTest?: boolean | null;
  name?: string | null;
  slug?: string | null;
};

type CleanupQaUsersOptions<T extends QaTaggedEntity> = {
  deleteIfVisible: (page: Page, entity: T) => Promise<boolean>;
  entities: readonly T[];
};

type CleanupQaVendorOptions<T extends QaTaggedEntity> = {
  cleanupPath?: string;
  entities: readonly T[];
  storageKey?: string;
};

export function createQaCleanupReport(): QaCleanupReport {
  return {
    deletedPayloads: 0,
    deletedUsers: 0,
    deletedVendors: 0
  };
}

export function mergeQaCleanupReport(
  current: QaCleanupReport,
  update: Partial<QaCleanupReport>
): QaCleanupReport {
  return {
    deletedPayloads: current.deletedPayloads + (update.deletedPayloads ?? 0),
    deletedUsers: current.deletedUsers + (update.deletedUsers ?? 0),
    deletedVendors: current.deletedVendors + (update.deletedVendors ?? 0)
  };
}

export function logQaCleanupReport(
  report: QaCleanupReport,
  options: {
    scope: string;
  }
) {
  console.log(
    `LOCALMAN_QA_CLEANUP ${JSON.stringify({
      ...report,
      scope: options.scope,
      timestamp: new Date().toISOString()
    })}`
  );
}

export function isQaTaggedValue(value: string | null | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return normalized.startsWith("qa_") || normalized.startsWith("QA_TEST_");
}

export function isQaTaggedEntity(entity: QaTaggedEntity): boolean {
  return (
    entity.isTest === true ||
    entity.is_test === true ||
    isQaTaggedValue(entity.email) ||
    isQaTaggedValue(entity.name) ||
    isQaTaggedValue(entity.slug)
  );
}

export async function cleanupQaUsers<T extends QaTaggedEntity>(
  page: Page,
  options: CleanupQaUsersOptions<T>
): Promise<QaCleanupReport> {
  let deletedUsers = 0;

  for (const entity of options.entities) {
    if (!isPendingQaEntity(entity)) {
      continue;
    }

    if (await options.deleteIfVisible(page, entity)) {
      deletedUsers += 1;
    }
  }

  return {
    deletedPayloads: 0,
    deletedUsers,
    deletedVendors: 0
  };
}

export async function cleanupQaVendors<T extends QaTaggedEntity>(
  page: Page,
  options: CleanupQaVendorOptions<T>
): Promise<QaCleanupReport & { actualDeletedCount: number }> {
  const targets = options.entities.filter(isPendingQaEntity);

  if (targets.length === 0) {
    return {
      actualDeletedCount: 0,
      deletedPayloads: 0,
      deletedUsers: 0,
      deletedVendors: 0
    };
  }

  const response = await deleteQaTaggedVendors(page, {
    cleanupPath: options.cleanupPath,
    storageKey: options.storageKey
  });

  return {
    actualDeletedCount: response.actualDeletedCount,
    deletedPayloads: 0,
    deletedUsers: 0,
    deletedVendors: targets.length
  };
}

export async function cleanupQaPayloads<T extends QaTaggedEntity>(
  page: Page,
  options: CleanupQaVendorOptions<T>
): Promise<QaCleanupReport & { actualDeletedCount: number }> {
  const targets = options.entities.filter(isPendingQaEntity);

  if (targets.length === 0) {
    return {
      actualDeletedCount: 0,
      deletedPayloads: 0,
      deletedUsers: 0,
      deletedVendors: 0
    };
  }

  const response = await deleteQaTaggedVendors(page, {
    cleanupPath: options.cleanupPath,
    storageKey: options.storageKey
  });

  return {
    actualDeletedCount: response.actualDeletedCount,
    deletedPayloads: targets.length,
    deletedUsers: 0,
    deletedVendors: 0
  };
}

function isPendingQaEntity(entity: QaTaggedEntity): boolean {
  if (entity.deleted) {
    return false;
  }

  return isQaTaggedEntity(entity);
}

async function deleteQaTaggedVendors(
  page: Page,
  options: {
    cleanupPath?: string;
    storageKey?: string;
  }
): Promise<{ actualDeletedCount: number }> {
  const accessToken = await readAdminAccessToken(page, options.storageKey ?? ADMIN_SESSION_STORAGE_KEY);
  const response = await page.context().request.delete(options.cleanupPath ?? ADMIN_QA_VENDOR_CLEANUP_PATH, {
    failOnStatusCode: false,
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok()) {
    const responseText = normalizeText(await response.text().catch(() => ""));
    throw new Error(
      `Expected Local Man QA cleanup to succeed. Received ${response.status()} ${response.statusText()}. Response: ${
        responseText || "empty body"
      }`
    );
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        data?: {
          deletedCount?: number;
        } | null;
      }
    | null;

  return {
    actualDeletedCount: payload?.data?.deletedCount ?? 0
  };
}

async function readAdminAccessToken(page: Page, storageKey: string): Promise<string> {
  const accessToken = await page.evaluate((sessionStorageKey) => {
    const rawValue = window.localStorage.getItem(sessionStorageKey);

    if (!rawValue) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawValue) as { accessToken?: unknown };
      return typeof parsed.accessToken === "string" && parsed.accessToken.trim().length > 0
        ? parsed.accessToken
        : null;
    } catch {
      return null;
    }
  }, storageKey);

  if (!accessToken) {
    throw new Error("Expected the Local Man admin session to persist an access token for QA cleanup.");
  }

  return accessToken;
}

function normalizeText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}
