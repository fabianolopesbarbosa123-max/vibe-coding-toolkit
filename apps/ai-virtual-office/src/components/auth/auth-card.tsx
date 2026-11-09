import type { ReactNode } from "react";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-slate-900/80 p-6 shadow-2xl shadow-black/40 backdrop-blur">
      <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      <div className="mt-5">
        {isSupabaseConfigured ? (
          children
        ) : (
          <p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-200">
            A autenticação não está configurada. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, ou use OFFICE_LOCAL_MODE=true para o modo local de um único usuário.
          </p>
        )}
      </div>
      {footer && <div className="mt-5 border-t border-white/10 pt-4 text-center text-sm text-slate-400">{footer}</div>}
    </section>
  );
}

export function Notice({ tone, children }: { tone: "success" | "error" | "info"; children: ReactNode }) {
  const styles = {
    success: "bg-emerald-500/10 text-emerald-200",
    error: "bg-rose-500/10 text-rose-200",
    info: "bg-sky-500/10 text-sky-200",
  };
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-lg p-3 text-sm ${styles[tone]}`}>
      {children}
    </p>
  );
}
