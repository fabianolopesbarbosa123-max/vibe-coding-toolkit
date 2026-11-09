/**
 * Execution queue worker. Run as its own process (npm run worker), never inside the web
 * server. It connects to Postgres as a worker login role (member of office_worker); it does
 * not use the Supabase service-role key. See docs/execution-engine.md.
 */
import { Pool } from "pg";
import { z } from "zod";
import { configuredProviders, getAiConfig } from "@/server/ai/config";
import { describeError } from "@/server/ai/providers";
import type { OfficeContext } from "@/server/store";
import { PgStore } from "./pg-store";
import { isRetryable, runJob, type ClaimedJob } from "./runner";

const env = z
  .object({
    WORKER_DATABASE_URL: z.string().min(1, "WORKER_DATABASE_URL is required"),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(600).default(60),
    WORKER_POLL_MS: z.coerce.number().int().min(250).max(30_000).default(2000),
  })
  .safeParse(process.env);
if (!env.success) {
  console.error(`Invalid worker configuration: ${env.error.issues.map(issue => issue.path.join(".")).join(", ")}`);
  process.exit(1);
}
const config = env.data;
/** Frequent enough for prompt cancellation; well inside the lease. */
const HEARTBEAT_MS = Math.min(3000, Math.floor((config.WORKER_LEASE_SECONDS * 1000) / 4));
const REAP_MS = 30_000;

const pool = new Pool({ connectionString: config.WORKER_DATABASE_URL, max: config.WORKER_CONCURRENCY + 2, application_name: "ai-virtual-office-worker" });
pool.on("error", error => console.error("Postgres pool error:", error.message));

type StopReason = "cancelled" | "timeout" | "lease_lost" | "shutdown";
const active = new Map<string, { controller: AbortController; done: Promise<void>; reason: { value: StopReason | null } }>();
let stopping = false;

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function claim(): Promise<ClaimedJob | null> {
  const defaultCap = getAiConfig().OFFICE_DEFAULT_MAX_CONCURRENT_RUNS;
  const { rows } = await pool.query("select * from public.office_claim_job($1, $2)", [defaultCap, config.WORKER_LEASE_SECONDS]);
  return (rows[0] as ClaimedJob | undefined) ?? null;
}

async function jobLog(jobId: string, level: string, message: string, data?: Record<string, unknown>) {
  await pool.query("select public.office_log_job($1, $2, $3, $4)", [jobId, level, message, data ? JSON.stringify(data) : null]).catch(() => undefined);
}

function start(job: ClaimedJob) {
  const controller = new AbortController();
  const reason: { value: StopReason | null } = { value: null };
  const stop = (why: StopReason) => {
    if (!reason.value) reason.value = why;
    controller.abort(why);
  };
  const heartbeat = setInterval(async () => {
    try {
      const { rows } = await pool.query("select public.office_heartbeat_job($1, $2) as cancel", [job.id, config.WORKER_LEASE_SECONDS]);
      if (rows[0]?.cancel) stop("cancelled");
    } catch {
      stop("lease_lost");
    }
  }, HEARTBEAT_MS);
  const timeout = setTimeout(() => stop("timeout"), job.timeout_seconds * 1000);

  const ctx: OfficeContext = {
    mode: "supabase",
    userId: job.owner_id,
    email: null,
    store: new PgStore(pool, job.owner_id),
    supabase: null,
    sessionExpiresAt: null,
    signal: controller.signal,
    failures: [],
    jobLog: (level, message, data) => jobLog(job.id, level, message, data),
  };

  const done = (async () => {
    log(`job ${job.id} (${job.kind}) attempt ${job.attempts}/${job.max_attempts} started`);
    await jobLog(job.id, "info", `Tentativa ${job.attempts} de ${job.max_attempts} iniciada.`);
    try {
      const result = await runJob(ctx, job);
      if (reason.value === "cancelled") throw Object.assign(new Error("aborted"), { name: "AbortError" });
      await pool.query("select public.office_finish_job($1, 'completed', $2)", [job.id, JSON.stringify(result)]);
      log(`job ${job.id} completed`);
    } catch (error) {
      await settleFailure(job, reason.value, error);
    } finally {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      active.delete(job.id);
    }
  })();
  active.set(job.id, { controller, done, reason });
}

async function settleFailure(job: ClaimedJob, reason: StopReason | null, error: unknown) {
  try {
    if (reason === "lease_lost") {
      log(`job ${job.id} lost its lease; another worker or the reaper owns it now`);
      return;
    }
    if (reason === "cancelled") {
      await pool.query("select public.office_finish_job($1, 'cancelled', null)", [job.id]);
      log(`job ${job.id} cancelled`);
      return;
    }
    const message =
      reason === "timeout" ? `Tempo limite de ${job.timeout_seconds} s excedido.` : reason === "shutdown" ? "Worker encerrado; a execução será retomada." : describeError(error);
    const retryable = reason === "shutdown" || (reason !== "timeout" && isRetryable(error));
    const { rows } = await pool.query("select public.office_fail_job($1, $2, $3) as outcome", [job.id, message, retryable]);
    log(`job ${job.id} ${rows[0]?.outcome === "queued" ? "will retry" : "failed"}: ${message}`);
  } catch (settleError) {
    log(`job ${job.id} could not be settled (${settleError instanceof Error ? settleError.message : "unknown"}); the reaper will recover it`);
  }
}

async function reap() {
  try {
    const { rows } = await pool.query("select public.office_reap_jobs() as n");
    if (rows[0]?.n > 0) log(`reaped ${rows[0].n} expired job(s)`);
  } catch (error) {
    log(`reaper failed: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

/** Announces this worker and the providers it holds keys for (names only, never the keys). */
async function register() {
  try {
    await pool.query("select public.office_worker_register($1)", [configuredProviders()]);
  } catch (error) {
    log(`register failed: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

async function loop() {
  const providers = configuredProviders();
  log(`worker started (concurrency ${config.WORKER_CONCURRENCY}, lease ${config.WORKER_LEASE_SECONDS}s, providers: ${providers.join(", ") || "none"})`);
  if (!providers.length) log("warning: no AI provider key configured; AI jobs will fail as unavailable");
  await register();
  const registration = setInterval(register, 15_000);
  await reap();
  const reaper = setInterval(reap, REAP_MS);
  while (!stopping) {
    try {
      if (active.size < config.WORKER_CONCURRENCY) {
        const job = await claim();
        if (job) {
          start(job);
          continue;
        }
      }
    } catch (error) {
      log(`claim failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
    await sleep(config.WORKER_POLL_MS);
  }
  clearInterval(reaper);
  clearInterval(registration);
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal} received; stopping ${active.size} running job(s)`);
  for (const entry of active.values()) {
    if (!entry.reason.value) entry.reason.value = "shutdown";
    entry.controller.abort("shutdown");
  }
  await Promise.allSettled([...active.values()].map(entry => entry.done));
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
loop().catch(error => {
  console.error("Worker crashed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
