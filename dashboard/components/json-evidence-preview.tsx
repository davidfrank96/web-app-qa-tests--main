"use client";
import { useEffect, useState } from "react";
import { loadJsonEvidence } from "../lib/inssa-ops/json-evidence-preview";

export function JsonEvidencePreview({ href }: { href: string }) {
  const [result, setResult] = useState<{ href: string; text?: string; error?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void loadJsonEvidence(href, controller.signal).then(text => {
      if (!controller.signal.aborted) setResult({ href, text });
    }).catch(error => {
      if (!controller.signal.aborted) setResult({ href, error: error instanceof Error ? error.message : "Evidence preview failed." });
    });
    return () => controller.abort();
  }, [href]);
  return <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4" aria-label="JSON evidence preview">
    <a className="text-cyan-200" download href={href}>Download Evidence</a>
    {result?.href !== href ? <p role="status">Loading JSON evidence…</p> : result.error ?
      <p role="alert">{result.error}</p> : <pre className="mt-4 max-h-[36rem] overflow-auto whitespace-pre-wrap break-words text-xs">{result.text}</pre>}
  </section>;
}
