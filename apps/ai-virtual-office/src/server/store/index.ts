import "server-only";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthMode, Provider } from "@/lib/domain";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAiConfig } from "../ai/config";
import { getEnv } from "../env";
import { HttpError } from "../http";
import { createTokenClient, requireUser } from "../supabase";
import { FileStore } from "./file-store";
import { SupabaseStore } from "./supabase-store";
import type { OfficeStore } from "./types";

/** Everything a request (or its background run) needs to act for one user. */
export interface OfficeContext {
  mode: AuthMode;
  userId: string;
  email: string | null;
  store: OfficeStore;
  /** Present in Supabase mode: a client bound to the user's JWT. */
  supabase: SupabaseClient | null;
  /** Epoch ms when that JWT expires (null in local mode and for queue workers). */
  sessionExpiresAt: number | null;
  /** Web server in Supabase mode: AI providers the queue workers reported (they hold the keys). */
  remoteProviders?: ReadonlySet<Provider>;
  /** Queue workers only: aborts in-flight AI calls on cancellation or timeout. */
  signal?: AbortSignal;
  /** Queue workers only: failures seen during the job, used to decide on retries. */
  failures?: unknown[];
  /** Queue workers only: mirrors activity into the job's log. */
  jobLog?: (level: "info" | "success" | "warning" | "error", message: string, data?: Record<string, unknown>) => Promise<void>;
}

const globalStore = globalThis as typeof globalThis & { __officeFileStore?: FileStore };

export const LOCAL_USER_ID = "local";

/**
 * Resolves the caller. Supabase mode requires a verified session; local mode is an
 * explicit single-user development switch (OFFICE_LOCAL_MODE=true).
 */
export async function getOfficeContext(): Promise<OfficeContext> {
  if (isSupabaseConfigured) {
    const user = await requireUser();
    const supabase = createTokenClient(user.accessToken);
    const providers = await supabase.rpc("office_available_providers");
    return {
      mode: "supabase",
      userId: user.id,
      email: user.email,
      store: new SupabaseStore(supabase, user.id, getAiConfig().OFFICE_STALE_AFTER_MINUTES),
      supabase,
      sessionExpiresAt: user.expiresAt,
      remoteProviders: new Set((providers.error ? [] : (providers.data as Provider[] | null)) ?? []),
    };
  }
  const env = getEnv();
  if (!env.OFFICE_LOCAL_MODE) {
    throw new HttpError(503, "Configure o Supabase (NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ou ative OFFICE_LOCAL_MODE=true para desenvolvimento.");
  }
  globalStore.__officeFileStore ??= new FileStore(path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.OFFICE_DATA_FILE));
  return { mode: "local", userId: LOCAL_USER_ID, email: null, store: globalStore.__officeFileStore, supabase: null, sessionExpiresAt: null };
}

export type { OfficeStore } from "./types";
