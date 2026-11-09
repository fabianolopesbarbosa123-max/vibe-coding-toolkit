"use client";

import { useState } from "react";
import { useOffice } from "@/components/office-provider";
import { Badge, Button, Card, type Tone } from "@/components/ui";
import type { OfficeSnapshot } from "@/lib/api-types";
import { ACTIVE_JOB_STATUSES, type Job, type JobEvent, type JobStatus } from "@/lib/domain";
import { formatDate } from "@/lib/labels";
import { cn } from "@/lib/cn";

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  pending: "Aguardando",
  queued: "Na fila",
  running: "Executando",
  waiting_approval: "Aguardando aprovação",
  completed: "Concluída",
  failed: "Falhou",
  cancelled: "Cancelada",
};
const TONE: Record<JobStatus, Tone> = {
  pending: "slate",
  queued: "amber",
  running: "blue",
  waiting_approval: "violet",
  completed: "green",
  failed: "red",
  cancelled: "slate",
};
const KIND = { task_run: "Tarefa", project_run: "Projeto", orchestrate: "Pedido ao CEO" } as const;
const LEVEL_DOT = { info: "bg-sky-400", success: "bg-emerald-400", warning: "bg-amber-400", error: "bg-rose-500" } as const;

export const isActiveJob = (job: Job) => ACTIVE_JOB_STATUSES.includes(job.status);

/** Execution queue: status, attempts, logs, and cancellation of the user's jobs. */
export function JobList({ snapshot }: { snapshot: OfficeSnapshot }) {
  if (snapshot.mode !== "supabase") return null;
  const waiting = snapshot.jobs.some(job => job.status === "queued");
  return (
    <Card title={`Execuções (${snapshot.jobs.filter(isActiveJob).length} ativas)`}>
      {snapshot.workerOnline === false && (
        <p role="status" className="mb-3 rounded-lg bg-amber-500/10 p-2 text-sm text-amber-200">
          Nenhum worker de execução está ativo{waiting ? ": as execuções ficam na fila até um worker iniciar" : ""}. Veja docs/execution-engine.md.
        </p>
      )}
      <ul className="space-y-2">
        {snapshot.jobs.map(job => (
          <JobRow key={job.id} job={job} target={targetName(snapshot, job)} />
        ))}
        {!snapshot.jobs.length && <li className="text-sm text-slate-500">Nenhuma execução ainda.</li>}
      </ul>
    </Card>
  );
}

function targetName(snapshot: OfficeSnapshot, job: Job) {
  if (job.taskId) return snapshot.tasks.find(task => task.id === job.taskId)?.title ?? "Tarefa removida";
  return snapshot.projects.find(project => project.id === job.projectId)?.name ?? "Projeto removido";
}

function JobRow({ job, target }: { job: Job; target: string }) {
  const { post, notify } = useOffice();
  const [events, setEvents] = useState<JobEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  async function toggleLogs() {
    if (events) {
      setEvents(null);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/jobs/${job.id}/events`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao carregar logs.");
      setEvents(data.events);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Falha ao carregar logs.", "error");
    } finally {
      setLoading(false);
    }
  }

  async function cancel() {
    setCancelling(true);
    try {
      await post(`/api/jobs/${job.id}/cancel`);
      notify(job.status === "running" ? "Cancelamento solicitado; a execução para em instantes." : "Execução cancelada.", "info");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Falha ao cancelar.", "error");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <li className="rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-100">{KIND[job.kind]}: {target}</p>
          <p className="text-xs text-slate-500">
            {formatDate(job.createdAt)} · tentativa {job.attempts}/{job.maxAttempts} · limite {Math.round(job.timeoutSeconds / 60)} min
            {job.status === "queued" && job.attempts > 0 && ` · nova tentativa ${formatDate(job.nextRunAt)}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={TONE[job.status]}>{job.cancelRequested && isActiveJob(job) ? "Cancelando…" : JOB_STATUS_LABELS[job.status]}</Badge>
          {isActiveJob(job) && !job.cancelRequested && (
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={cancel} disabled={cancelling} aria-label={`Cancelar execução: ${target}`}>
              {cancelling ? "Cancelando…" : "Cancelar"}
            </Button>
          )}
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={toggleLogs} disabled={loading} aria-expanded={events !== null}>
            {loading ? "Carregando…" : events ? "Ocultar logs" : "Logs"}
          </Button>
        </div>
      </div>
      {job.lastError && <p className="mt-1 text-xs text-rose-300">{job.lastError}</p>}
      {events && (
        <ol className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-lg bg-slate-900 p-2 font-mono text-xs" aria-label="Logs da execução">
          {events.map(event => (
            <li key={event.id} className="flex gap-2">
              <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", LEVEL_DOT[event.level])} aria-hidden />
              <span className="text-slate-500">{new Date(event.at).toLocaleTimeString("pt-BR")}</span>
              <span className="text-slate-300">{event.message}</span>
            </li>
          ))}
          {!events.length && <li className="text-slate-500">Sem registros.</li>}
        </ol>
      )}
    </li>
  );
}
