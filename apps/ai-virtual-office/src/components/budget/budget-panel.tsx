"use client";

import type { BudgetStatus } from "@/lib/budget";
import { cn } from "@/lib/cn";
import { Badge, Card } from "@/components/ui";

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const int = (value: number) => value.toLocaleString("pt-BR");
const SOURCE = { default: "padrão do servidor", operator: "definido pelo administrador", personal: "seu limite pessoal" } as const;

function Meter({ label, used, limit, format }: { label: string; used: number; limit: number | null; format: (value: number) => string }) {
  const percent = limit ? Math.min(100, (used / limit) * 100) : limit === 0 ? 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span className="font-mono text-slate-300">{format(used)} / {limit === null ? "sem limite" : format(limit)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
        <div className={cn("h-full rounded-full transition-all", percent >= 100 ? "bg-rose-500" : percent >= 80 ? "bg-amber-400" : "bg-emerald-400")} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function BudgetPanel({ budget }: { budget: BudgetStatus }) {
  const { limits, usage } = budget;
  const tone = budget.level === "exceeded" ? "red" : budget.level === "warning" ? "amber" : "green";
  const label = budget.level === "exceeded" ? "Limite atingido" : budget.level === "warning" ? "Alerta" : "Dentro do limite";
  return (
    <Card title="Consumo de IA neste mês" action={<Badge tone={tone}>{label}</Badge>}>
      <div className="grid gap-3">
        <Meter label="Custo estimado" used={usage.monthCostUsd} limit={limits.monthlyBudgetUsd} format={usd} />
        <Meter label="Tokens" used={usage.monthTokens} limit={limits.monthlyTokenLimit} format={int} />
        <Meter label="Chamadas hoje" used={usage.dayRequests} limit={limits.dailyRequestLimit} format={int} />
        <Meter label="Execuções simultâneas" used={usage.activeRuns} limit={limits.maxConcurrentRuns} format={int} />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Orçamento: {SOURCE[limits.source]}. Alerta em {limits.alertPercent}%. Cada chamada é bloqueada antes do envio se o pior caso
        (prompt + {int(16000)} tokens de saída) puder ultrapassar o limite. Custos estimados pela tabela de preços publicada; o valor faturado pelo provedor é a referência final.
        {usage.unpricedRequests > 0 && ` ${usage.unpricedRequests} chamada(s) sem preço configurado não entram no custo.`}
      </p>
    </Card>
  );
}
