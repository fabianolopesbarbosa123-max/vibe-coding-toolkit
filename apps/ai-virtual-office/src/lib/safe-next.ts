/** Only same-site relative paths are allowed as post-login destinations (blocks //evil.example). */
export function safeNext(value: string | null | undefined): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}

/**
 * The origin the browser actually used. `nextUrl.origin` can report a normalized
 * hostname (e.g. "localhost" for 127.0.0.1), which would drop host-only cookies on redirect.
 */
export function requestOrigin(request: { headers: Headers; nextUrl: URL }): string {
  // In production set NEXT_PUBLIC_SITE_URL so redirects never depend on request headers.
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  const proto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}
