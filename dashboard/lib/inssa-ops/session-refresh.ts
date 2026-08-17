import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseBrowserConfig } from "./auth-config";

type SessionClientFactory = typeof createServerClient;

export async function refreshInssaSession(
  request: NextRequest,
  createClient: SessionClientFactory = createServerClient
) {
  const config = getSupabaseBrowserConfig();
  if (!config.configured) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, responseHeaders) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, options, value }) => response.cookies.set(name, value, options));
        Object.entries(responseHeaders).forEach(([name, value]) => response.headers.set(name, value));
      }
    }
  });

  // This is the supported SSR refresh boundary. Authorization still happens in
  // page and API guards with getUser(), not from unverified cookie state.
  await supabase.auth.getClaims().catch(() => null);
  return response;
}
