"use client";

import Link from "next/link";
import { useOffice } from "@/components/office-provider";

/** Persistent notice when the monthly AI budget is close to or past its limit. */
export function BudgetBanner() {
  const { snapshot } = useOffice();
  const budget = snapshot?.budget;
  if (!budget || budget.level === "ok") return null;
  const exceeded = budget.level === "exceeded";
  return (
    <div role="status" className={exceeded ? "border-b border-rose-500/20 bg-rose-500/10" : "border-b border-amber-500/20 bg-amber-500/10"}>
      <div className={`mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm ${exceeded ? "text-rose-200" : "text-amber-200"}`}>
        <span>
          {exceeded
            ? "Limite mensal de IA atingido: novas execuções estão bloqueadas."
            : `Alerta de orçamento: ${Math.floor(budget.percentUsed ?? 0)}% do limite mensal de IA usado.`}
        </span>
        <Link href="/dashboard" className="rounded-md px-2 py-1 text-xs font-medium hover:bg-white/10">Ver consumo</Link>
      </div>
    </div>
  );
}
