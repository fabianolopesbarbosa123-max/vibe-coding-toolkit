"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useOffice } from "@/components/office-provider";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/", label: "Escritório" },
  { href: "/tasks", label: "Tarefas" },
  { href: "/agents", label: "Agentes" },
  { href: "/dashboard", label: "Dashboard" },
];

export function AppNav() {
  const pathname = usePathname();
  const { snapshot, loadError } = useOffice();
  const claude = snapshot?.integrations.find(item => item.id === "claude-api");
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
        <p className="flex items-center gap-2 text-xs text-slate-400" aria-live="polite">
          <span className={cn("size-2 rounded-full", loadError ? "bg-rose-500" : claude?.status === "available" ? "bg-emerald-400" : "bg-amber-400")} aria-hidden />
          {loadError ? "Servidor indisponível" : claude?.status === "available" ? "Claude API conectada" : "IA não configurada"}
        </p>
      </div>
    </header>
  );
}
