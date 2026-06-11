"use client";

import { useState } from "react";

type LoginFormProps = {
  authConfigured: boolean;
};

export function LoginForm({ authConfigured }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function signInWithPassword() {
    await submitAuthRequest("/api/auth/password", { email, password });
  }

  async function sendMagicLink() {
    await submitAuthRequest("/api/auth/magic-link", { email });
  }

  async function submitAuthRequest(url: string, body: Record<string, string>) {
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch(url, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error ?? "Authentication request failed.");
        return;
      }

      if (payload.redirectTo) {
        window.location.assign(payload.redirectTo);
        return;
      }

      setMessage(payload.message ?? "Check your email for the magic link.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg items-center px-4 py-12">
      <section className="w-full rounded-3xl border border-slate-800 bg-slate-900/85 p-6 text-slate-100 shadow-2xl shadow-slate-950/50">
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">INSSA QA Operations</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Sign in</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Access is restricted to authorized QA Operations users. Password sign-in and magic links are backed by Supabase Auth.
        </p>

        {!authConfigured ? (
          <div className="mt-5 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">
            Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="text-slate-300">Email</span>
            <input
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-cyan-300/0 transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/10"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </label>

          <label className="block text-sm">
            <span className="text-slate-300">Password</span>
            <input
              autoComplete="current-password"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-cyan-300/0 transition focus:border-cyan-300 focus:ring-4 focus:ring-cyan-300/10"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              disabled={!authConfigured || submitting || !email || !password}
              onClick={() => void signInWithPassword()}
              type="button"
            >
              Sign in
            </button>
            <button
              className="rounded-xl border border-cyan-300/40 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
              disabled={!authConfigured || submitting || !email}
              onClick={() => void sendMagicLink()}
              type="button"
            >
              Send magic link
            </button>
          </div>

          {message ? <p className="rounded-xl bg-slate-950 px-3 py-2 text-sm text-slate-300">{message}</p> : null}
        </div>
      </section>
    </div>
  );
}
