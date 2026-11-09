import "server-only";
import type { Job, JobEvent, JobKind } from "@/lib/domain";
import { HttpError } from "./http";
import type { OfficeContext } from "./store";
import { fromRow } from "./store/supabase-store";

/**
 * User side of the execution queue. Everything goes through the user's JWT, so RLS
 * guarantees each job belongs to the authenticated user. Workers run the jobs.
 */

function requireQueue(ctx: OfficeContext) {
  if (!ctx.supabase) throw new HttpError(409, "A fila de execução requer o Supabase configurado.");
  return ctx.supabase;
}

const JOB_COLUMNS =
  "id, kind, status, project_id, task_id, payload, attempts, max_attempts, timeout_seconds, next_run_at, cancel_requested, last_error, created_at, started_at, finished_at";

export async function enqueueJob(
  ctx: OfficeContext,
  kind: JobKind,
  refs: { projectId?: string | null; taskId?: string | null },
  payload: Record<string, unknown> = {},
): Promise<Job> {
  const supabase = requireQueue(ctx);
  const { data, error } = await supabase
    .from("jobs")
    .insert({ owner_id: ctx.userId, kind, project_id: refs.projectId ?? null, task_id: refs.taskId ?? null, payload })
    .select(JOB_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "Já existe uma execução ativa para este item.");
    if (error.message.includes("queue limit")) throw new HttpError(429, "Fila cheia: no máximo 50 execuções aguardando por usuário.");
    throw new Error(`Supabase job insert failed: ${error.message}`);
  }
  return fromRow<Job>(data);
}

export async function cancelJob(ctx: OfficeContext, jobId: string): Promise<Job> {
  const supabase = requireQueue(ctx);
  const { data, error } = await supabase
    .from("jobs")
    .update({ cancel_requested: true })
    .eq("id", jobId)
    .eq("owner_id", ctx.userId)
    .in("status", ["pending", "queued", "running", "waiting_approval"])
    .select(JOB_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`Supabase job cancel failed: ${error.message}`);
  if (!data) throw new HttpError(404, "Execução não encontrada ou já finalizada.");
  return fromRow<Job>(data);
}

export async function listJobs(ctx: OfficeContext, limit = 30): Promise<Job[]> {
  if (!ctx.supabase) return [];
  const { data, error } = await ctx.supabase.from("jobs").select(JOB_COLUMNS).eq("owner_id", ctx.userId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Supabase jobs read failed: ${error.message}`);
  return (data ?? []).map(row => fromRow<Job>(row));
}

export async function listJobEvents(ctx: OfficeContext, jobId: string): Promise<JobEvent[]> {
  const supabase = requireQueue(ctx);
  const { data, error } = await supabase
    .from("job_events")
    .select("id, job_id, at, level, message, data")
    .eq("job_id", jobId)
    .eq("owner_id", ctx.userId)
    .order("at", { ascending: true })
    .limit(500);
  if (error) throw new Error(`Supabase job events read failed: ${error.message}`);
  return (data ?? []).map(row => fromRow<JobEvent>(row));
}

export async function workerOnline(ctx: OfficeContext): Promise<boolean | null> {
  if (!ctx.supabase) return null;
  const { data, error } = await ctx.supabase.rpc("office_worker_online");
  if (error) return null;
  return Boolean(data);
}
