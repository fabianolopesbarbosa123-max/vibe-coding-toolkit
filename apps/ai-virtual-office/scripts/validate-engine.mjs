/**
 * Production validation of the execution engine against a real Supabase project and a real worker.
 *
 *   node --env-file=.env.validation scripts/validate-engine.mjs               # full validation
 *   node --env-file=.env.validation scripts/validate-engine.mjs --persistence # start with the worker STOPPED
 *
 * Required variables (in a local, git-ignored env file — never commit it):
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   VALIDATION_USER_A_EMAIL, VALIDATION_USER_A_PASSWORD   (test account created in the app)
 *   VALIDATION_USER_B_EMAIL, VALIDATION_USER_B_PASSWORD   (second test account)
 * Optional: WORKER_DATABASE_URL — enables read-only checks of the worker role's privileges.
 *
 * Cost: one real AI call with a minimal prompt (a few cents at most). The script never prints keys,
 * passwords, or connection strings, never claims or reaps jobs, and deletes what it creates.
 */
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const env = process.env;
const persistence = process.argv.includes("--persistence");
const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "VALIDATION_USER_A_EMAIL", "VALIDATION_USER_A_PASSWORD", "VALIDATION_USER_B_EMAIL", "VALIDATION_USER_B_PASSWORD"];
const missing = required.filter(name => !env[name]);
if (missing.length) {
  console.error(`Variáveis ausentes: ${missing.join(", ")}`);
  process.exit(2);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const results = [];
const evidence = {};
const stamp = new Date().toISOString();
const mask = email => email.replace(/^(.).*(@.*)$/, "$1***$2");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function check(name, fn) {
  try {
    const note = await fn();
    results.push(["PASS", name, note ?? ""]);
    console.log(`PASS  ${name}${note ? ` — ${note}` : ""}`);
    return true;
  } catch (error) {
    results.push(["FAIL", name, error.message]);
    console.log(`FAIL  ${name}\n      ${String(error.message).split("\n")[0]}`);
    return false;
  }
}

async function signIn(label, email, password) {
  const client = createClient(url, key, options);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login do usuário ${label} (${mask(email)}) falhou: ${error.message}`);
  return { client, id: data.user.id, label };
}

async function waitFor(client, jobId, statuses, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let job;
  while (Date.now() < deadline) {
    ({ data: job } = await client.from("jobs").select("*").eq("id", jobId).single());
    if (job && statuses.includes(job.status)) return job;
    await sleep(2000);
  }
  throw new Error(`a execução não chegou a ${statuses.join("/")} em ${timeoutMs / 1000}s (estado atual: ${job?.status ?? "?"})`);
}

const created = { projectId: null, agentId: null };
let a;
let b;

console.log(`Validação do Execution Engine — ${stamp}\nProjeto Supabase: ${new URL(url).host}\n`);

await check("login dos dois usuários de teste", async () => {
  [a, b] = await Promise.all([
    signIn("A", env.VALIDATION_USER_A_EMAIL, env.VALIDATION_USER_A_PASSWORD),
    signIn("B", env.VALIDATION_USER_B_EMAIL, env.VALIDATION_USER_B_PASSWORD),
  ]);
  assert.notEqual(a.id, b.id, "use duas contas diferentes");
  return `A=${mask(env.VALIDATION_USER_A_EMAIL)}, B=${mask(env.VALIDATION_USER_B_EMAIL)}`;
});
if (!a || !b) process.exit(1);

await check("migrations aplicadas (tabelas e funções da fila)", async () => {
  for (const table of ["jobs", "job_events", "usage_limits", "agents", "tasks"]) {
    const { error } = await a.client.from(table).select("*", { head: true, count: "exact" });
    assert.equal(error, null, `${table}: ${error?.message}`);
  }
  for (const fn of ["office_worker_online", "office_available_providers"]) {
    const { error } = await a.client.rpc(fn);
    assert.equal(error, null, `${fn}: ${error?.message}`);
  }
});

await check("visitante anônimo não lê a fila", async () => {
  const anon = createClient(url, key, options);
  const { data, error } = await anon.from("jobs").select("id").limit(1);
  assert.ok(error || (data ?? []).length === 0);
});

if (env.WORKER_DATABASE_URL) {
  await check("papel do worker com permissões mínimas", async () => {
    const pool = new pg.Pool({ connectionString: env.WORKER_DATABASE_URL, max: 1, statement_timeout: 10_000 });
    try {
      const { rows } = await pool.query(
        "select session_user as role, pg_has_role('office_worker', 'member') as member, r.rolsuper, r.rolbypassrls, r.rolcreaterole from pg_roles r where r.rolname = session_user",
      );
      const role = rows[0];
      assert.ok(role.member, "o papel precisa ser membro de office_worker");
      assert.ok(!role.rolsuper && !role.rolbypassrls && !role.rolcreaterole, "o papel não pode ser superuser, ignorar RLS ou criar papéis");
      assert.notEqual(role.role, "postgres", "não use o usuário postgres no worker");
      for (const query of ["select 1 from auth.users limit 1", "select 1 from public.files limit 1", "select 1 from storage.objects limit 1", "select 1 from public.jobs limit 1"]) {
        await assert.rejects(pool.query(query), /permission denied/, `deveria negar: ${query}`);
      }
      // Every row the worker can see must belong to a user whose job it is leasing right now.
      for (const table of ["tasks", "projects", "agents", "agent_messages", "usage_records"]) {
        const outside = await pool.query(`select count(*)::int as n from public.${table} t where not public.office_holds_lease(t.owner_id)`);
        assert.equal(outside.rows[0].n, 0, `o worker vê ${table} de usuários sem lease`);
      }
      return `papel ${role.role}`;
    } finally {
      await pool.end();
    }
  });
}

await check(persistence ? "worker parado (modo persistência)" : "worker ativo e com a Claude API configurada", async () => {
  const [{ data: online }, { data: providers }] = await Promise.all([a.client.rpc("office_worker_online"), a.client.rpc("office_available_providers")]);
  if (persistence) {
    assert.equal(online, false, "pare o worker antes de rodar com --persistence");
    return "a execução ficará na fila até você iniciar o worker";
  }
  assert.equal(online, true, "nenhum worker reportou nos últimos 30 s — inicie o worker");
  assert.ok((providers ?? []).includes("anthropic"), "o worker não tem ANTHROPIC_API_KEY configurada");
  return `providers: ${(providers ?? []).join(", ")}`;
});

let agent;
let taskId;
let jobId;
const passed = await check("criação de projeto e tarefa pelo usuário A", async () => {
  const { data: agents } = await a.client.from("agents").select("id, name, role").eq("owner_id", a.id);
  agent = agents?.find(item => item.role === "programmer") ?? agents?.find(item => item.role !== "ceo");
  assert.ok(agent, "o usuário A não tem agentes: entre no app uma vez com essa conta");
  const project = await a.client.from("projects").insert({ owner_id: a.id, name: `Validação do Execution Engine ${stamp}`.slice(0, 80), request: "Validação automática", status: "ready" }).select("id").single();
  assert.equal(project.error, null, project.error?.message);
  created.projectId = project.data.id;
  const task = await a.client
    .from("tasks")
    .insert({ owner_id: a.id, project_id: created.projectId, agent_id: agent.id, title: "Validação: resposta curta", description: "Responda somente com a palavra OK.", priority: "low", status: "pending" })
    .select("id")
    .single();
  assert.equal(task.error, null, task.error?.message);
  taskId = task.data.id;
  return `agente ${agent.name}`;
});

if (passed) {
  await check("tarefa enfileirada, processada pelo worker e concluída (chamada real de IA)", async () => {
    const enqueued = await a.client.from("jobs").insert({ owner_id: a.id, kind: "task_run", task_id: taskId, project_id: created.projectId }).select("*").single();
    assert.equal(enqueued.error, null, enqueued.error?.message);
    jobId = enqueued.data.id;
    assert.equal(enqueued.data.status, "queued");
    if (persistence) console.log("      Execução na fila. Inicie o worker agora; aguardando até 15 min…");
    const started = Date.now();
    const job = await waitFor(a.client, jobId, ["completed", "failed", "cancelled"], persistence ? 900_000 : 300_000);
    assert.equal(job.status, "completed", `estado final ${job.status}: ${job.last_error ?? ""}`);
    const task = await a.client.from("tasks").select("status, result").eq("id", taskId).single();
    assert.equal(task.data.status, "completed");
    assert.ok(task.data.result?.trim(), "a tarefa não tem resultado");
    evidence.job = { id: jobId, attempts: job.attempts, seconds: Math.round((Date.now() - started) / 1000), result: task.data.result.trim().slice(0, 60) };
    return `job ${jobId.slice(0, 8)}…, ${evidence.job.seconds}s, resposta: "${evidence.job.result}"`;
  });

  await check("logs da execução registrados", async () => {
    const { data } = await a.client.from("job_events").select("message").eq("job_id", jobId).order("at");
    const messages = (data ?? []).map(event => event.message);
    for (const expected of ["Execução enfileirada.", "Estado: queued → running", "Estado: running → completed"]) assert.ok(messages.includes(expected), `falta: ${expected}`);
    assert.ok(messages.some(message => message.startsWith("Chamada de IA")), "falta o registro da chamada de IA");
    return `${messages.length} eventos`;
  });

  await check("consumo, custo e conversa persistidos", async () => {
    const usage = await a.client.from("usage_records").select("model, input_tokens, output_tokens, cost_usd").eq("task_id", taskId);
    assert.equal(usage.data?.length, 1, "esperado 1 registro de consumo");
    const record = usage.data[0];
    assert.ok(record.input_tokens > 0 && record.output_tokens > 0);
    const conversation = await a.client.from("agent_conversations").select("id").eq("task_id", taskId).single();
    const messages = await a.client.from("agent_messages").select("role").eq("conversation_id", conversation.data.id);
    assert.equal(messages.data?.length, 3);
    evidence.usage = record;
    return `${record.model}: ${record.input_tokens} entrada / ${record.output_tokens} saída, US$ ${Number(record.cost_usd ?? 0).toFixed(4)}`;
  });

  await check("isolamento: o usuário B não vê nem altera nada do usuário A", async () => {
    for (const [table, column, value] of [["jobs", "id", jobId], ["job_events", "job_id", jobId], ["tasks", "id", taskId], ["usage_records", "task_id", taskId], ["agent_conversations", "task_id", taskId]]) {
      const { data } = await b.client.from(table).select("*").eq(column, value);
      assert.deepEqual(data, [], `B leu ${table}`);
    }
    const cancel = await b.client.from("jobs").update({ cancel_requested: true }).eq("id", jobId).select();
    assert.deepEqual(cancel.data ?? [], []);
    const forged = await b.client.from("jobs").insert({ owner_id: b.id, kind: "task_run", task_id: taskId });
    assert.ok(forged.error, "B conseguiu enfileirar a tarefa de A");
  });

  await check("limites: execução duplicada recusada e cancelamento", async () => {
    const task = await a.client.from("tasks").insert({ owner_id: a.id, project_id: created.projectId, agent_id: agent.id, title: "Validação: cancelamento", description: "Responda somente com a palavra OK.", priority: "low", status: "pending" }).select("id").single();
    const first = await a.client.from("jobs").insert({ owner_id: a.id, kind: "task_run", task_id: task.data.id }).select("id").single();
    const duplicate = await a.client.from("jobs").insert({ owner_id: a.id, kind: "task_run", task_id: task.data.id });
    assert.equal(duplicate.error?.code, "23505", "a segunda execução ativa deveria ser recusada");
    await a.client.from("jobs").update({ cancel_requested: true }).eq("id", first.data.id);
    const job = await waitFor(a.client, first.data.id, ["cancelled", "completed", "failed"], 60_000);
    assert.equal(job.status, "cancelled");
    return "duplicata recusada; execução cancelada";
  });

  await check("falha permanente sem retentativa e sem gasto (modelo não autorizado)", async () => {
    const custom = await a.client
      .from("agents")
      .insert({ owner_id: a.id, name: "Validação", role: "custom", title: "Validação", room: "support", color: "#64748b", provider: "anthropic", model: "validation-model-not-allowed", instructions: "Agente temporário da validação." })
      .select("id")
      .single();
    assert.equal(custom.error, null, custom.error?.message);
    created.agentId = custom.data.id;
    const task = await a.client.from("tasks").insert({ owner_id: a.id, project_id: created.projectId, agent_id: created.agentId, title: "Validação: falha esperada", description: "x", priority: "low", status: "pending" }).select("id").single();
    const enqueued = await a.client.from("jobs").insert({ owner_id: a.id, kind: "task_run", task_id: task.data.id }).select("id").single();
    const job = await waitFor(a.client, enqueued.data.id, ["failed", "completed", "cancelled"], 120_000);
    assert.equal(job.status, "failed");
    assert.equal(job.attempts, 1, "falhas permanentes não devem ser retentadas");
    assert.match(job.last_error ?? "", /não está autorizado/);
    const usage = await a.client.from("usage_records").select("id").eq("task_id", task.data.id);
    assert.deepEqual(usage.data, [], "não deveria haver consumo");
    return job.last_error;
  });
}

await check("limpeza dos dados de validação", async () => {
  if (created.projectId) {
    const { error } = await a.client.from("projects").delete().eq("id", created.projectId);
    assert.equal(error, null, error?.message);
  }
  if (created.agentId) {
    const { error } = await a.client.from("agents").delete().eq("id", created.agentId);
    assert.equal(error, null, error?.message);
  }
  return "projeto, tarefas, execuções e agente temporário removidos (o histórico de consumo é mantido)";
});

const failed = results.filter(([status]) => status === "FAIL").length;
console.log(`\nResultado: ${results.length - failed}/${results.length} verificações aprovadas${evidence.job ? ` · evidência: job ${evidence.job.id}` : ""}`);
process.exit(failed ? 1 : 0);
