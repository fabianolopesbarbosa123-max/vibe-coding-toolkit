"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from "./config";

let client: SupabaseClient | null = null;

/** Browser client: session in cookies (shared with the server), PKCE for e-mail links. */
export function getBrowserSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) throw new Error("Supabase não está configurado.");
  client ??= createBrowserClient(supabaseUrl, supabasePublishableKey);
  return client;
}
