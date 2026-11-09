"use client";

import Link from "next/link";
import type { Agent, Task } from "@/lib/domain";
import { Badge, Card } from "@/components/ui";
import { PROVIDER_LABELS, ROOM_LABELS, STATUS_LABELS, TASK_STATUS_LABELS } from "@/lib/labels";
import { AGENT_STATUS_TONE, TASK_STATUS_TONE } from "@/lib/tones";

export function AgentPanel({ agent, tasks }: { agent: Agent | undefined; tasks: Task[] }) {
  if (!agent) {
    return (
      <Card title="Agente">
        <p className="text-sm text-slate-400">Clique em um personagem no escritório para ver detalhes.</p>
      </Card>
    );
  }
  const own = tasks.filter(task => task.agentId === agent.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const current = own.find(task => task.id === agent.currentTaskId);
  return (
    <Card title={`${agent.name} — ${agent.title}`} action={<Badge tone={AGENT_STATUS_TONE[agent.status]}>{STATUS_LABELS[agent.status]}</Badge>}>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <dt className="text-slate-500">Sala</dt>
        <dd className="text-slate-200">{ROOM_LABELS[agent.room]}</dd>
        <dt className="text-slate-500">Integração</dt>
        <dd className="text-slate-200">{PROVIDER_LABELS[agent.provider]}{agent.model ? ` · ${agent.model}` : ""}</dd>
      </dl>
      {current && <p className="mt-3 text-sm text-sky-300">Agora: {current.title}</p>}
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Tarefas recentes</h3>
      <ul className="mt-2 space-y-1.5">
        {own.slice(0, 5).map(task => (
          <li key={task.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate text-slate-300">{task.title}</span>
            <Badge tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABELS[task.status]}</Badge>
          </li>
        ))}
        {!own.length && <li className="text-sm text-slate-500">Nenhuma tarefa ainda.</li>}
      </ul>
      <Link href="/tasks" className="mt-3 inline-block text-xs text-indigo-300 hover:underline">Abrir painel de tarefas →</Link>
    </Card>
  );
}
