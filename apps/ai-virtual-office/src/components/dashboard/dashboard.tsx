"use client";

import type { OfficeSnapshot } from "@/lib/api-types";
import { ActivityFeed } from "@/components/activity-feed";
import { IntegrationList } from "@/components/integration-list";
import { ProjectList } from "@/components/tasks/project-list";
import { Card } from "@/components/ui";

const usd = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4 });
const int = (value: number) => value.toLocaleString("pt-BR");

export function Dashboard({ snapshot }: { snapshot: OfficeSnapshot }) {
  const { stats, agents, events } = snapshot;
  const cards = [
    { label: "Total de agentes", value: int(stats.totalAgents) },
    { label: "Agentes ativos", value: int(stats.activeAgents) },
    { label: "Tarefas em andamento", value: int(stats.tasksRunning) },
    { label: "Tarefas pendentes", value: int(stats.tasksPending) },
    { label: "Tarefas concluídas", value: int(stats.tasksCompleted) },
    { label: "Projetos ativos", value: int(stats.activeProjects) },
    { label: "Chamadas de API", value: int(stats.apiCalls) },
    { label: "Custo estimado", value: usd(stats.estimatedCostUsd), hint: stats.unpricedCalls ? `${stats.unpricedCalls} chamada(s) sem preço configurado` : undefined },
  ];
  const alerts = events.filter(event => event.level === "error" || event.level === "warning");

  return (
    <div className="grid gap-4">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map(card => (
          <li key={card.label} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className="mt-1 font-mono text-2xl font-semibold text-slate-100">{card.value}</p>
            {card.hint && <p className="mt-1 text-xs text-amber-300">{card.hint}</p>}
          </li>
        ))}
      </ul>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Consumo de APIs por agente">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr><th className="py-1 pr-2 font-medium">Agente</th><th className="py-1 pr-2 text-right font-medium">Chamadas</th><th className="py-1 pr-2 text-right font-medium">Tokens (entrada/saída)</th><th className="py-1 text-right font-medium">Custo</th></tr>
              </thead>
              <tbody className="text-slate-300">
                {stats.usageByAgent.map(row => (
                  <tr key={row.agentId} className="border-t border-white/5">
                    <td className="py-1.5 pr-2">{agents.find(agent => agent.id === row.agentId)?.name ?? "Removido"}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{int(row.calls)}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{int(row.inputTokens)} / {int(row.outputTokens)}</td>
                    <td className="py-1.5 text-right font-mono">{usd(row.costUsd)}</td>
                  </tr>
                ))}
                {!stats.usageByAgent.length && <tr><td colSpan={4} className="py-2 text-slate-500">Nenhuma chamada real registrada.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">Custos estimados pelos tokens informados pelo provedor e pela tabela de preços local.</p>
        </Card>
        <Card title="Integrações"><IntegrationList integrations={snapshot.integrations} /></Card>
        <Card title={`Erros e alertas (${alerts.length})`}><ActivityFeed events={alerts} limit={10} /></Card>
        <Card title="Histórico de execução"><ActivityFeed events={events} limit={15} /></Card>
      </div>
      <Card title="Projetos"><ProjectList projects={snapshot.projects} tasks={snapshot.tasks} /></Card>
    </div>
  );
}
