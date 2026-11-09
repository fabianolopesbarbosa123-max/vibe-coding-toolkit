import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";
import { HttpError } from "./http";

/** Cookie-backed client for route handlers. Create one per request. */
export async function createRequestClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a context that cannot set cookies; proxy.ts refreshes the session.
        }
      },
    },
  });
}

/**
 * Client bound to one user's access token. Used for request work and for the
 * background runs started with `after()`, so every query still passes through RLS.
 */
export function createTokenClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  accessToken: string;
}

/** Verifies the session JWT (signature and expiry) before trusting the user id. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const supabase = await createRequestClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) throw new HttpError(401, "Sessão expirada. Entre novamente.");
  const { data: session } = await supabase.auth.getSession();
  const accessToken = session.session?.access_token;
  if (!accessToken) throw new HttpError(401, "Sessão expirada. Entre novamente.");
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null, accessToken };
}
