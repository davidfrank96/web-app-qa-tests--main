import fs from "node:fs/promises";

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 30_000;

export async function withLocalFileLock<T>(targetPath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${targetPath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf8");
        return await operation();
      } finally {
        await handle.close().catch(() => {});
        await fs.unlink(lockPath).catch(() => {});
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      await removeStaleLock(lockPath);
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for metadata lock: ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

async function removeStaleLock(lockPath: string) {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
      await fs.unlink(lockPath);
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
