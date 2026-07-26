import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getInssaPhase1Command } from "./command-registry";
import { createInssaSupabaseServerClient } from "./supabase-server";
import type { InssaCommandDefinition } from "./types";

export type InssaOpsRole = "admin" | "operator" | "viewer";

export type InssaAuthenticatedUser = {
  email: string;
  id: string;
  role: InssaOpsRole;
};

const ROLE_ORDER: Record<InssaOpsRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3
};

export async function getInssaAuthenticatedUser(): Promise<InssaAuthenticatedUser | null> {
  try {
    const supabase = await createInssaSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return null;
    }

    return toInssaAuthenticatedUser(data.user);
  } catch {
    return null;
  }
}

export async function requireInssaAuthenticatedUser(minRole: InssaOpsRole = "viewer") {
  const user = await getInssaAuthenticatedUser();
  if (!user) {
    return {
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 }),
      user: null
    };
  }

  if (!hasInssaRole(user.role, minRole)) {
    return {
      response: NextResponse.json({ error: `Role ${minRole} or higher is required.` }, { status: 403 }),
      user: null
    };
  }

  return { response: null, user };
}

export function hasInssaRole(actual: InssaOpsRole, required: InssaOpsRole) {
  return ROLE_ORDER[actual] >= ROLE_ORDER[required];
}

export function canStartInssaCommand(role: InssaOpsRole, command: InssaCommandDefinition) {
  if (role === "admin") return true;
  if (role !== "operator") return false;
  return command.key !== "platform_healthcheck";
}

export function getInssaCommandAuthorization(role: InssaOpsRole, campaignKey: string) {
  const command = getInssaPhase1Command(campaignKey);
  if (!command) {
    return { allowed: false, command: null, reason: `Unknown campaign key: ${campaignKey}` };
  }

  if (!command.phase1Enabled || command.mutatesStaging) {
    return { allowed: false, command, reason: `Campaign is not enabled for Phase 1 safe execution: ${campaignKey}` };
  }

  if (!canStartInssaCommand(role, command)) {
    return { allowed: false, command, reason: `Role ${role} is not allowed to start ${campaignKey}.` };
  }

  return { allowed: true, command, reason: null };
}

export function toInssaAuthenticatedUser(user: User): InssaAuthenticatedUser {
  const email = user.email ?? "";
  return {
    email,
    id: user.id,
    role: resolveRole(user, email)
  };
}

function resolveRole(user: User, email: string): InssaOpsRole {
  const appMetadataRole = user.app_metadata?.inssa_ops_role;
  if (isInssaOpsRole(appMetadataRole)) {
    return appMetadataRole;
  }

  if (emailMatchesEnvList(email, "INSSA_OPS_ADMIN_EMAILS")) return "admin";
  if (emailMatchesEnvList(email, "INSSA_OPS_OPERATOR_EMAILS")) return "operator";
  if (emailMatchesEnvList(email, "INSSA_OPS_VIEWER_EMAILS")) return "viewer";

  return "viewer";
}

function isInssaOpsRole(value: unknown): value is InssaOpsRole {
  return value === "admin" || value === "operator" || value === "viewer";
}

function emailMatchesEnvList(email: string, envName: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return false;

  return (process.env[envName] ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalizedEmail);
}
