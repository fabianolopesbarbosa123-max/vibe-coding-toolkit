/**
 * Execution queue against a real Supabase stack. Two worker login roles are created with the
 * local superuser connection (test setup only); users act through the REST API with their JWT.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_TEST_URL!;
const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_TEST_SECRET_KEY!;
const dbUrl = process.env.SUPABASE_TEST_DB_URL!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secretKey, options);
const run = Date.now();

interface TestUser {
  id: string;
  client: SupabaseClient;
}

let superuser: Pool;
let worker1: Pool;
let worker2: Pool;
let a: TestUser;
let b: TestUser;

async function makeUser(label: string): Promise<TestUser> {
  const email = `queue-${label}-${run}@example.test`;
  const created = await admin.auth.admin.createUser({ email, password: "Queue-Pass1", email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(url, publishableKey, options);
  const { data, error } = await client.auth.signInWithPassword({ email, password: "Queue-Pass1" });
  if (error) throw error;
  return { id: data.user.id, client };
}

async function workerPool(role: string) {
  const password = `it-${crypto.randomUUID()}`;
  await superuser.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} login in role office_worker; end if; end $$`);
  await superuser.query(`alter role ${role} login password '${password}'`);
  const target = new URL(dbUrl);
  target.username = role;
  target.password = password;
  return new Pool({ connectionString: target.toString(), max: 3 });
}

/** A user-owned agent and n tasks, created through the REST API with the user's JWT. */
async function seedTasks(user: TestUser, n: number) {
  const agent = await user.client
    .from("agents")
    .insert({ owner_id: user.id, name: "QA", role: "custom", title: "QA", room: "support", color: "#123456", provider: "anthropic", instructions: "i" })
    .select("id")
    .single();
  const project = await user.client.from("projects").insert({ owner_id: user.id, name: "Fila", request: "r", status: "ready" }).select("id").single();
  const rows = Array.from({ length: n }, (_, index) => ({
    owner_id: user.id,
    agent_id: agent.data!.id,
    project_id: project.data!.id,
    title: `t${index}`,
    description: "d",
    priority: "low",
    status: "pending",
  }));
  const tasks = await user.client.from("tasks").insert(rows).select("id");
  if (tasks.error) throw tasks.error;
  return { agentId: agent.data!.id as string, projectId: project.data!.id as string, taskIds: tasks.data.map(task => task.id as string) };
}

const enqueue = (user: TestUser, taskId: string, extra: Record<string, unknown> = {}) =>
  user.client.from("jobs").insert({ owner_id: user.id, kind: "task_run", task_id: taskId, ...extra }).select().single();
const claim = async (pool: Pool, cap: number | null = 2, lease = 60) => (await pool.query("select * from public.office_claim_job($1, $2)", [cap, lease])).rows[0] ?? null;
const jobStatus = async (id: string) => (await superuser.query("select status, attempts, last_error, next_run_at, locked_by from public.jobs where id = $1", [id])).rows[0];
/** Test-only: make retried jobs runnable now and free every job of both test users. */
const releaseAll = () =>
  superuser.query("update public.jobs set status = 'cancelled', cancel_requested = true, finished_at = now() where owner_id = any($1) and status in ('queued', 'running')", [[a.id, b.id]]);

beforeAll(async () => {
  superuser = new Pool({ connectionString: dbUrl, max: 2 });
  [worker1, worker2] = await Promise.all([workerPool("office_worker_it1"), workerPool("office_worker_it2")]);
  [a, b] = await Promise.all([makeUser("a"), makeUser("b")]);
});

afterAll(async () => {
  for (const user of [a, b]) if (user) await admin.auth.admin.deleteUser(user.id);
  await Promise.all([worker1?.end(), worker2?.end()]);
  await superuser?.end();
});

describe("enqueueing (user side)", () => {
  it("forces server-side state and limits whatever the client sends", async () => {
    const { taskIds } = await seedTasks(a, 1);
    const job = await enqueue(a, taskIds[0], { status: "running", attempts: 4, max_attempts: 5, timeout_seconds: 3600, locked_by: "me" });
    expect(job.error).toBeNull();
    expect(job.data).toMatchObject({ status: "queued", attempts: 0, max_attempts: 3, timeout_seconds: 600, locked_by: null });
    const logs = await a.client.from("job_events").select("message").eq("job_id", job.data!.id);
    expect(logs.data?.map(event => event.message)).toContain("Execução enfileirada.");
    await releaseAll();
  });

  it("refuses duplicates, status changes, forged ownership, log forgery, and worker functions", async () => {
    const { taskIds } = await seedTasks(a, 1);
    const job = await enqueue(a, taskIds[0]);
    expect((await enqueue(a, taskIds[0])).error?.code).toBe("23505");
    expect((await a.client.from("jobs").update({ status: "completed" }).eq("id", job.data!.id)).error).not.toBeNull();
    expect((await b.client.from("jobs").insert({ owner_id: a.id, kind: "task_run", task_id: taskIds[0] })).error).not.toBeNull();
    expect((await a.client.from("job_events").insert({ owner_id: a.id, job_id: job.data!.id, level: "info", message: "x" })).error).not.toBeNull();
    expect((await a.client.rpc("office_claim_job", { p_default_max_concurrent: 2, p_lease_seconds: 60 })).error).not.toBeNull();
    expect((await b.client.from("jobs").select("id").eq("id", job.data!.id)).data).toEqual([]);
    expect((await b.client.from("job_events").select("id").eq("job_id", job.data!.id)).data).toEqual([]);
    expect((await b.client.from("jobs").update({ cancel_requested: true }).eq("id", job.data!.id).select()).data).toEqual([]);
    await releaseAll();
  });

  it("cancels waiting jobs at once and never un-cancels", async () => {
    const { taskIds } = await seedTasks(a, 1);
    const job = await enqueue(a, taskIds[0]);
    const cancelled = await a.client.from("jobs").update({ cancel_requested: true }).eq("id", job.data!.id).select().single();
    expect(cancelled.data?.status).toBe("cancelled");
    expect((await a.client.from("jobs").update({ cancel_requested: false }).eq("id", job.data!.id)).error).not.toBeNull();
  });

  it("caps waiting jobs per user and blocks deleting a project with active jobs", async () => {
    const { taskIds, projectId } = await seedTasks(a, 51);
    const first = await a.client.from("jobs").insert(taskIds.slice(0, 50).map(task_id => ({ owner_id: a.id, kind: "task_run", task_id }))).select("id");
    expect(first.error).toBeNull();
    expect((await enqueue(a, taskIds[50])).error?.message).toMatch(/queue limit/);
    expect((await a.client.from("projects").delete().eq("id", projectId)).error?.message).toMatch(/active jobs/);
    await releaseAll();
  });
});

describe("worker identity and leases", () => {
  it("sees an owner's data only while holding that owner's job", async () => {
    const seededA = await seedTasks(a, 1);
    await seedTasks(b, 1);
    const tasksVisible = async () => (await worker1.query("select owner_id from public.tasks")).rows.map(row => row.owner_id as string);
    expect(await tasksVisible()).toEqual([]);
    expect((await worker1.query("select count(*)::int as n from public.files").catch(error => error)).message).toMatch(/permission denied/);
    const job = await enqueue(a, seededA.taskIds[0]);
    const claimed = await claim(worker1);
    expect(claimed.id).toBe(job.data!.id);
    const visible = await tasksVisible();
    expect(visible.length).toBeGreaterThan(0);
    expect(new Set(visible)).toEqual(new Set([a.id]));
    expect((await worker2.query("select count(*)::int as n from public.tasks")).rows[0].n).toBe(0);
    await expect(worker2.query("select public.office_heartbeat_job($1, 60)", [claimed.id])).rejects.toThrow(/lease lost/);
    await expect(worker2.query("select public.office_log_job($1, 'info', 'forjado', null)", [claimed.id])).rejects.toThrow(/lease lost/);
    await worker1.query("select public.office_finish_job($1, 'completed', '{}')", [claimed.id]);
    expect(await tasksVisible()).toEqual([]);
    expect((await jobStatus(claimed.id)).status).toBe("completed");
  });

  it("cannot write rows for an owner it holds no lease for", async () => {
    const seededA = await seedTasks(a, 1);
    const seededB = await seedTasks(b, 1);
    await enqueue(a, seededA.taskIds[0]);
    const claimed = await claim(worker1);
    await expect(
      worker1.query("insert into public.activity_events (owner_id, level, message) values ($1, 'info', 'x')", [b.id]),
    ).rejects.toThrow(/row-level security/);
    const update = await worker1.query("update public.tasks set title = 'x' where id = $1", [seededB.taskIds[0]]);
    expect(update.rowCount).toBe(0);
    await worker1.query("select public.office_finish_job($1, 'completed', null)", [claimed.id]);
  });
});

describe("concurrency, retries, cancellation, and timeouts", () => {
  it("honors each owner's concurrency limit, also across racing workers", async () => {
    await releaseAll();
    await admin.from("usage_limits").upsert({ user_id: a.id, max_concurrent_runs: 1 });
    const seededA = await seedTasks(a, 3);
    const seededB = await seedTasks(b, 1);
    for (const task of seededA.taskIds) await enqueue(a, task);
    await enqueue(b, seededB.taskIds[0]);
    const [first, second] = await Promise.all([claim(worker1, 5), claim(worker2, 5)]);
    const owners = [first?.owner_id, second?.owner_id].sort();
    expect(owners).toEqual([a.id, b.id].sort()); // one A job (cap 1) and the B job
    expect(await claim(worker1, 5)).toBeNull();
    const aJob = first.owner_id === a.id ? first : second;
    await worker1.query("select public.office_finish_job($1, 'completed', null)", [aJob.id]).catch(() =>
      worker2.query("select public.office_finish_job($1, 'completed', null)", [aJob.id]),
    );
    expect((await claim(worker1, 5))?.owner_id).toBe(a.id);
    await admin.from("usage_limits").delete().eq("user_id", a.id);
    await releaseAll();
  });

  it("retries transient failures with backoff, then fails for good", async () => {
    const { taskIds } = await seedTasks(a, 1);
    const job = await enqueue(a, taskIds[0]);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const claimed = await claim(worker1);
      expect(claimed?.id).toBe(job.data!.id);
      const outcome = (await worker1.query("select public.office_fail_job($1, 'HTTP 529', true) as o", [claimed.id])).rows[0].o;
      const state = await jobStatus(claimed.id);
      if (attempt < 3) {
        expect(outcome).toBe("queued");
        expect(new Date(state.next_run_at).getTime()).toBeGreaterThan(Date.now() + 20_000);
        expect(await claim(worker1)).toBeNull(); // backoff respected
        await superuser.query("update public.jobs set next_run_at = now() where id = $1", [claimed.id]);
      } else {
        expect(outcome).toBe("failed");
        expect(state).toMatchObject({ attempts: 3, last_error: "HTTP 529" });
      }
    }
  });

  it("does not retry permanent failures", async () => {
    const { taskIds } = await seedTasks(a, 1);
    await enqueue(a, taskIds[0]);
    const claimed = await claim(worker1);
    expect((await worker1.query("select public.office_fail_job($1, 'orçamento', false) as o", [claimed.id])).rows[0].o).toBe("failed");
  });

  it("delivers cancellation of a running job through the heartbeat", async () => {
    const { taskIds } = await seedTasks(a, 1);
    const job = await enqueue(a, taskIds[0]);
    const claimed = await claim(worker1);
    expect((await worker1.query("select public.office_heartbeat_job($1, 60) as c", [claimed.id])).rows[0].c).toBe(false);
    const requested = await a.client.from("jobs").update({ cancel_requested: true }).eq("id", job.data!.id).select().single();
    expect(requested.data?.status).toBe("running");
    expect((await worker1.query("select public.office_heartbeat_job($1, 60) as c", [claimed.id])).rows[0].c).toBe(true);
    await worker1.query("select public.office_finish_job($1, 'cancelled', null)", [claimed.id]);
    expect((await jobStatus(claimed.id)).status).toBe("cancelled");
    const logs = await a.client.from("job_events").select("message").eq("job_id", job.data!.id).order("at");
    expect(logs.data?.map(event => event.message)).toEqual(
      expect.arrayContaining(["Cancelamento solicitado.", "Estado: running → cancelled"]),
    );
  });

  it("requeues jobs whose worker vanished, releases what it left running, and rejects that worker", async () => {
    const { taskIds, agentId } = await seedTasks(a, 1);
    await enqueue(a, taskIds[0]);
    const claimed = await claim(worker1, 2, 1);
    // What a worker does when it starts the task, before crashing.
    await worker1.query("update public.agents set status = 'working', current_task_id = $1 where id = $2", [taskIds[0], agentId]);
    await worker1.query("update public.tasks set status = 'running' where id = $1", [taskIds[0]]);
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect((await worker2.query("select public.office_reap_jobs() as n")).rows[0].n).toBeGreaterThanOrEqual(1);
    expect(await jobStatus(claimed.id)).toMatchObject({ status: "queued", last_error: "O worker parou de responder.", locked_by: null });
    expect((await a.client.from("tasks").select("status").eq("id", taskIds[0]).single()).data?.status).toBe("failed");
    expect((await a.client.from("agents").select("status, current_task_id").eq("id", agentId).single()).data).toEqual({ status: "idle", current_task_id: null });
    await expect(worker1.query("select public.office_heartbeat_job($1, 60)", [claimed.id])).rejects.toThrow(/lease lost/);
    await releaseAll();
  });

  it("enforces the state machine even for privileged writers", async () => {
    const { taskIds } = await seedTasks(a, 1);
    await enqueue(a, taskIds[0]);
    const claimed = await claim(worker1);
    await worker1.query("select public.office_finish_job($1, 'completed', null)", [claimed.id]);
    await expect(superuser.query("update public.jobs set status = 'running' where id = $1", [claimed.id])).rejects.toThrow(/invalid job transition/);
  });
});

describe("worker capabilities", () => {
  it("workers report provider names; users read them but cannot report or forge", async () => {
    await worker1.query("select public.office_worker_register($1)", [["anthropic"]]);
    const providers = await a.client.rpc("office_available_providers");
    expect(providers.data).toContain("anthropic");
    expect((await a.client.rpc("office_worker_register", { p_providers: ["openai"] })).error).not.toBeNull();
    await expect(worker1.query("select public.office_worker_register($1)", [["anthropic", "sk-ant-not-a-provider"]])).rejects.toThrow(/check constraint/);
    expect((await a.client.from("office_workers").select("*")).error).not.toBeNull();
  });
});
