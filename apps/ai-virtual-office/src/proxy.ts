import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin } from "@/lib/safe-next";
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from "@/lib/supabase/config";

/** Pages reachable without a session. Everything else requires login. */
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/auth/callback"];
/** Signed-in users are sent away from these. */
const GUEST_ONLY = ["/login", "/signup", "/forgot-password"];

const isPublic = (path: string) => PUBLIC_PATHS.some(prefix => path === prefix || path.startsWith(`${prefix}/`));

/**
 * Refreshes the Supabase session cookie on every request and redirects anonymous
 * visitors to /login. This is an optimistic gate: route handlers verify the user
 * again and the database enforces RLS.
 */
export async function proxy(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list, headers) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;

  if (!signedIn && !isPublic(path)) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
    }
    const url = new URL("/login", requestOrigin(request));
    if (path !== "/") url.searchParams.set("next", path + request.nextUrl.search);
    return withCookies(NextResponse.redirect(url), response);
  }
  if (signedIn && GUEST_ONLY.includes(path)) {
    return withCookies(NextResponse.redirect(new URL("/", requestOrigin(request))), response);
  }
  return response;
}

/** Keeps refreshed session cookies when answering with a redirect. */
function withCookies(target: NextResponse, source: NextResponse) {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  return target;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
