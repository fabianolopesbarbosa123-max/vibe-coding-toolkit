/**
 * Full-page navigation used after auth changes (sign-in, sign-out, password reset,
 * expired session): the next request must carry the new cookies through proxy.ts,
 * which a client-side router transition would not guarantee.
 */
export function hardNavigate(path: string) {
  window.location.assign(path);
}
