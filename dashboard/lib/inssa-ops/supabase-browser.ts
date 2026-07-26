"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createInssaSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !publishableKey) {
    throw new Error("Supabase Auth is not configured for the browser client.");
  }

  return createBrowserClient(url, publishableKey);
}
