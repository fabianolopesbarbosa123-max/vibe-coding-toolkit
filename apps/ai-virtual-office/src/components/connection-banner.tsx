"use client";

import { useOffice } from "@/components/office-provider";

/** Explains degraded sync instead of silently showing stale data. */
export function ConnectionBanner() {
  const { sync, loadError, snapshot, refresh } = useOffice();
  const message =
    sync === "offline"
      ? "Você está offline. As alterações aparecerão quando a conexão voltar."
      : loadError && snapshot
        ? `${loadError} Exibindo os últimos dados carregados.`
        : sync === "polling" && snapshot?.mode === "supabase"
          ? "Tempo real indisponível no momento; atualizando periodicamente."
          : null;
  if (!message) return null;
  return (
    <div role="status" className="border-b border-amber-500/20 bg-amber-500/10">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2 text-sm text-amber-200">
        <span>{message}</span>
        <button type="button" onClick={() => refresh()} className="rounded-md px-2 py-1 text-xs font-medium hover:bg-amber-500/20">Tentar agora</button>
      </div>
    </div>
  );
}
