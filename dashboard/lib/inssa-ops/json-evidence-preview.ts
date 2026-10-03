const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

export async function loadJsonEvidence(href: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<string> {
  if (!/^\/api\/artifacts\/[a-zA-Z0-9-]+\/(?:file|bundle\/[^?#]+)$/.test(href) || href.includes("..")) {
    throw new Error("Unsupported evidence preview URL.");
  }
  const response = await request(href, { credentials: "same-origin", signal, redirect: "error" });
  if (!response.ok) throw new Error(`Evidence preview unavailable (${response.status}).`);
  if (!response.body) throw new Error("Evidence preview has no content.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PREVIEW_BYTES) throw new Error("Evidence is too large to preview. Use Download Evidence.");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.stringify(JSON.parse(text), null, 2);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
