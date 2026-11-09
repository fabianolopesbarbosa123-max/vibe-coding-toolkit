"use client";

import type { Agent, Project, Task, TaskStatus } from "@/lib/domain";
import { Badge } from "@/components/ui";
import { RunButton } from "@/components/run-button";
import { formatDate, PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/labels";
import { TASK_STATUS_TONE } from "@/lib/tones";

const COLUMNS: { status: TaskStatus[]; title: string }[] = [
  { status: ["pending"], title: "Pendentes" },
  { status: ["running"], title: "Em execução" },
  { status: ["completed", "failed"], title: "Concluídas / falhas" },
];

const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

export function TaskBoard({ tasks, agents, projects }: { tasks: Task[]; agents: Agent[]; projects: Project[] }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-3">
      {COLUMNS.map(column => {
        const items = tasks
          .filter(task => column.status.includes(task.status))
          .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.createdAt.localeCompare(a.createdAt));
        return (
          <section key={column.title} className="rounded-2xl border border-white/10 bg-slate-900/60 p-3" aria-label={column.title}>
            <h2 className="mb-3 flex items-center justify-between text-sm font-semibold text-slate-200">
              {column.title} <Badge>{items.length}</Badge>
            </h2>
            <ul className="space-y-2">
              {items.map(task => (
                <TaskCard key={task.id} task={task} agent={agents.find(a => a.id === task.agentId)} project={projects.find(p => p.id === task.projectId)} />
              ))}
              {!items.length && <li className="text-sm text-slate-500">Vazio.</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TaskCard({ task, agent, project }: { task: Task; agent?: Agent; project?: Project }) {
  const inProject = project && (project.status === "running" || project.status === "planning");
  return (
    <li className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-slate-100">{task.title}</p>
        <Badge tone={TASK_STATUS_TONE[task.status]}>{TASK_STATUS_LABELS[task.status]}</Badge>
      </div>
      <p className="mt-1 line-clamp-3 text-sm text-slate-400">{task.description}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ background: agent?.color }} aria-hidden />
          {agent?.name ?? "Agente removido"}
        </span>
        <span>· {PRIORITY_LABELS[task.priority]}</span>
        <span>· {formatDate(task.createdAt)}</span>
        {project && <span className="truncate">· {project.name}</span>}
      </div>
      {task.error && <p className="mt-2 text-xs text-rose-300">{task.error}</p>}
      {task.result && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-emerald-300">Resultado</summary>
          <div className="mt-1 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-2 text-sm text-slate-300">{task.result}</div>
        </details>
      )}
      {(task.status === "pending" || task.status === "failed") && !inProject && (
        <div className="mt-2 flex justify-end">
          <RunButton url={`/api/tasks/${task.id}/run`} label={task.status === "failed" ? "Tentar novamente" : "Executar"} />
        </div>
      )}
    </li>
  );
}
