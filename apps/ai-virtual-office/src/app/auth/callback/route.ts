import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin, safeNext } from "@/lib/safe-next";
import { createRequestClient } from "@/server/supabase";


/**
 * Landing point for e-mail links (sign-up confirmation and password recovery).
 * Exchanges the PKCE code for a session cookie, then continues to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const origin = requestOrigin(request);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));
  if (code) {
    const supabase = await createRequestClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  const description = searchParams.get("error_description");
  const url = new URL("/login", origin);
  url.searchParams.set("error", description ? "link" : "callback");
  return NextResponse.redirect(url);
}
