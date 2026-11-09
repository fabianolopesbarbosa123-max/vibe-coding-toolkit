import type { JobKind } from "@/lib/domain";
import { IntegrationUnavailableError, isAbortError, isRetryableError } from "@/server/ai/providers";
import { HttpError } from "@/server/http";
import { claimProject, claimTask, executeProject, executeTask, planProject } from "@/server/orchestrator";
import type { OfficeContext } from "@/server/store";

/** The columns a worker receives from office_claim_job. */
export interface ClaimedJob {
  id: string;
  owner_id: string;
  kind: JobKind;
  project_id: string | null;
  task_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  timeout_seconds: number;
}

/** A job failure plus whether retrying later could succeed. */
export class JobFailure extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "JobFailure";
  }
}

/**
 * Retry only what can succeed later: provider network errors, rate limits, overloads,
 * and server errors, or an agent busy with another job. Never budget refusals, missing
 * integrations, validation errors, model refusals, or cancellations.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof JobFailure) return error.retryable;
  if (isAbortError(error) || error instanceof IntegrationUnavailableError) return false;
  if (error instanceof Error && error.name === "BudgetExceededError") return false;
  if (error instanceof HttpError) return error.status === 409 && /ocupad/.test(error.message);
  return isRetryableError(error);
}

function failureFrom(ctx: OfficeContext, fallback: string): JobFailure {
  const cause = ctx.failures?.at(-1);
  const message = cause instanceof Error ? cause.message : fallback;
  return new JobFailure(message.slice(0, 1000), cause === undefined ? false : isRetryable(cause));
}

function assertNotAborted(ctx: OfficeContext) {
  if (ctx.signal?.aborted) {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  }
}

/** Runs one job for its owner. Throws JobFailure (or the original error) when it did not complete. */
export async function runJob(ctx: OfficeContext, job: ClaimedJob): Promise<Record<string, unknown>> {
  switch (job.kind) {
    case "task_run": {
      await claimTask(ctx, job.task_id!);
      const task = await executeTask(ctx, job.task_id!);
      assertNotAborted(ctx);
      if (task?.status !== "completed") throw failureFrom(ctx, task?.error ?? "A tarefa falhou.");
      return { taskId: task.id, status: task.status };
    }
    case "project_run": {
      await claimProject(ctx, job.project_id!);
      return finishProject(ctx, job.project_id!);
    }
    case "orchestrate": {
      const state = await ctx.store.snapshot();
      const ceo = state.agents.find(agent => agent.role === "ceo");
      if (!ceo) throw new JobFailure("Cadastre um agente com a função CEO.", false);
      const planned = await planProject(ctx, job.project_id!, ceo);
      assertNotAborted(ctx);
      if (!planned) throw failureFrom(ctx, "O planejamento falhou.");
      if (job.payload.autoRun === false) return { projectId: job.project_id, planned: true };
      await claimProject(ctx, job.project_id!);
      return finishProject(ctx, job.project_id!);
    }
  }
}

async function finishProject(ctx: OfficeContext, projectId: string) {
  await executeProject(ctx, projectId);
  assertNotAborted(ctx);
  const project = (await ctx.store.snapshot()).projects.find(item => item.id === projectId);
  if (project?.status !== "completed") throw failureFrom(ctx, "O projeto não foi concluído.");
  return { projectId, status: project.status };
}
