"use client";

import { useOffice } from "@/components/office-provider";
import { cn } from "@/lib/cn";

export function Toasts() {
  const { toasts, dismiss } = useOffice();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:left-auto">
      {toasts.map(toast => (
        <div
          key={toast.id}
          role={toast.tone === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur",
            toast.tone === "success" && "border-emerald-500/30 bg-emerald-950/90 text-emerald-100",
            toast.tone === "error" && "border-rose-500/30 bg-rose-950/90 text-rose-100",
            toast.tone === "info" && "border-sky-500/30 bg-slate-900/90 text-slate-100",
          )}
        >
          <span className="flex-1">{toast.message}</span>
          <button type="button" onClick={() => dismiss(toast.id)} aria-label="Fechar aviso" className="text-current opacity-70 hover:opacity-100">✕</button>
        </div>
      ))}
    </div>
  );
}
