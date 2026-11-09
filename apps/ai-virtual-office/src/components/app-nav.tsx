"use client";

import { hardNavigate } from "@/lib/hard-navigate";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useOffice, type SyncStatus } from "@/components/office-provider";
import { cn } from "@/lib/cn";
import { getBrowserSupabase } from "@/lib/supabase/browser";

const LINKS = [
  { href: "/", label: "Escritório" },
  { href: "/tasks", label: "Tarefas" },
  { href: "/agents", label: "Agentes" },
  { href: "/dashboard", label: "Dashboard" },
];

const SYNC: Record<SyncStatus, { label: string; dot: string }> = {
  connecting: { label: "Conectando…", dot: "bg-slate-400 animate-pulse" },
  live: { label: "Tempo real", dot: "bg-emerald-400" },
  polling: { label: "Atualização periódica", dot: "bg-amber-400" },
  offline: { label: "Offline", dot: "bg-rose-500" },
};

export function AppNav() {
  const pathname = usePathname();
  const { snapshot, sync, loadError } = useOffice();
  const [signingOut, setSigningOut] = useState(false);
  const status = loadError && !snapshot ? { label: "Servidor indisponível", dot: "bg-rose-500" } : SYNC[sync];
  const supabaseMode = snapshot?.mode === "supabase";
  const name = snapshot?.profile.fullName || snapshot?.profile.email || "";

  async function signOut() {
    setSigningOut(true);
    await getBrowserSupabase().auth.signOut();
    hardNavigate("/login");
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold text-slate-100">
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-xs font-black">AI</span>
          AI Virtual Office
        </Link>
        <nav aria-label="Principal" className="flex flex-wrap gap-1">
          {LINKS.map(link => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname === link.href ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition",
                pathname === link.href ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1.5" aria-live="polite">
            <span className={cn("size-2 rounded-full", status.dot)} aria-hidden />
            {status.label}
          </span>
          {supabaseMode && (
            <>
              <Link href="/profile" aria-current={pathname === "/profile" ? "page" : undefined} className="max-w-40 truncate rounded-lg px-2 py-1 text-slate-200 hover:bg-white/5">
                {name || "Perfil"}
              </Link>
              <button type="button" onClick={signOut} disabled={signingOut} className="rounded-lg border border-white/10 px-2 py-1 text-slate-300 hover:bg-white/10 disabled:opacity-50">
                {signingOut ? "Saindo…" : "Sair"}
              </button>
            </>
          )}
          {snapshot?.mode === "local" && <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-300">Modo local</span>}
        </div>
      </div>
    </header>
  );
}
