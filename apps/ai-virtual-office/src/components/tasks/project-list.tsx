"use client";

import type { Agent, Project, Task } from "@/lib/domain";
import { Badge } from "@/components/ui";
import { RunButton } from "@/components/run-button";
import { formatDate, PROJECT_STATUS_LABELS } from "@/lib/labels";
import { PROJECT_STATUS_TONE } from "@/lib/tones";

export function ProjectList({ projects, tasks, limit }: { projects: Project[]; tasks: Task[]; agents?: Agent[]; limit?: number }) {
  const items = [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  if (!items.length) return <p className="text-sm text-slate-500">Nenhum projeto. Faça um pedido ao CEO ou crie um projeto.</p>;
  return (
    <ul className="space-y-3">
      {items.map(project => {
        const own = tasks.filter(task => task.projectId === project.id);
        const done = own.filter(task => task.status === "completed").length;
        const runnable = (project.status === "ready" || project.status === "failed") && own.some(task => task.status !== "completed");
        const progress = own.length ? Math.round((done / own.length) * 100) : 0;
        return (
          <li key={project.id} className="rounded-xl border border-white/10 bg-slate-950/50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-100">{project.name}</p>
                <p className="text-xs text-slate-500">{formatDate(project.createdAt)} · {done}/{own.length} tarefas</p>
              </div>
              <div className="flex shrink-0 items-start gap-2">
                <Badge tone={PROJECT_STATUS_TONE[project.status]}>{PROJECT_STATUS_LABELS[project.status]}</Badge>
                {runnable && <RunButton url={`/api/projects/${project.id}/run`} label={project.status === "failed" ? "Retomar" : "Executar"} />}
              </div>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Progresso de ${project.name}`}>
              <div className="h-full rounded-full bg-indigo-400 transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
            {project.summary && <p className="mt-2 text-sm text-slate-400">{project.summary}</p>}
            {project.result && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-medium text-emerald-300">Resultado final do CEO</summary>
                <div className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-sm text-slate-300">{project.result}</div>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
