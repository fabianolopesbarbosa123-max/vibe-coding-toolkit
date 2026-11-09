import "server-only";
import path from "node:path";
import { getEnv } from "../env";
import { FileStore } from "./file-store";
import { SupabaseStore } from "./supabase-store";
import type { OfficeStore } from "./types";

const globalStore = globalThis as typeof globalThis & { __officeStore?: OfficeStore };

/** Supabase when configured; otherwise a local JSON file for development. */
export function getStore(): OfficeStore {
  if (globalStore.__officeStore) return globalStore.__officeStore;
  const env = getEnv();
  globalStore.__officeStore =
    env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
      : new FileStore(path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.OFFICE_DATA_FILE));
  return globalStore.__officeStore;
}

export type { OfficeStore } from "./types";
