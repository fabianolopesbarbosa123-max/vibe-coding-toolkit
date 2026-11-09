/**
 * Stage 2 end-to-end check against a running app and the local Supabase stack.
 * Usage: scripts/with-local-supabase.sh node scripts/e2e-auth.mjs
 *   (APP_URL and MAILPIT_URL default to the local stack.) With SUPABASE_TEST_SECRET_KEY set, the
 *   script also verifies Storage cleanup and budgets; budget steps need the app started with the
 *   fake Claude API fixture (E2E_AI_FIXTURE=1, see scripts/fixtures/fake-claude-api.mjs).
 * Requires Playwright with Chromium (local dependency, or global with NODE_PATH="$(npm root -g)"). Creates throwaway users on the local stack only.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// CommonJS resolution so a globally installed Playwright works via NODE_PATH.
const { chromium } = createRequire(import.meta.url)("playwright");

const app = process.env.APP_URL ?? "http://127.0.0.1:3000";
const mailpit = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const shots = process.env.SHOTS_DIR;
const run = Date.now();
const results = [];
const secretKey = process.env.SUPABASE_TEST_SECRET_KEY;
const supabaseUrl = process.env.SUPABASE_TEST_URL;
const aiFixture = process.env.E2E_AI_FIXTURE === "1";
/** Operator actions (setting limits, inspecting Storage) use the local stack's secret key. */
async function operator(path, init = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: { apikey: secretKey, authorization: `Bearer ${secretKey}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const setLimits = (userId, limits) =>
  operator("/rest/v1/usage_limits?on_conflict=user_id", { method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id: userId, ...limits }) });
const state = async target => (await target.request.get(`${app}/api/state`)).json();

async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push(["FAIL", name]);
    console.log(`FAIL ${name}\n  ${error.message.split("\n").slice(0, 4).join("\n  ")}`);
  }
}

/** Polls Mailpit for the newest message to `email` whose subject matches, and returns its link. */
async function mailLink(email, subject) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const message = list.messages?.find(item => subject.test(item.Subject));
    if (message) {
      const body = await (await fetch(`${mailpit}/api/v1/message/${message.ID}`)).json();
      const link = body.Text.match(/https?:\/\/\S+verify\S+/)?.[0] ?? body.HTML.match(/href="([^"]+verify[^"]+)"/)?.[1];
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`No e-mail matching ${subject} for ${email}`);
}

async function signUp(page, name, email, password) {
  await page.goto(`${app}/signup`);
  await page.getByLabel("Nome").fill(name);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByLabel("Confirmar senha").fill(password);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByText("Enviamos um link de confirmação").waitFor();
}

async function login(page, email, password) {
  await page.goto(`${app}/login`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

const browser = await chromium.launch();
const device1 = await browser.newContext();
const page = await device1.newPage();
const user1 = { name: "Ana Teste", email: `ana-${run}@example.test`, password: "Senha-Forte1" };
const user2 = { name: "Beto Teste", email: `beto-${run}@example.test`, password: "Outra-Senha2" };
const newPassword = "Nova-Senha3";
const projectName = `Projeto da Ana ${run}`;

await step("route protection: anonymous visitor is redirected to /login and API returns 401", async () => {
  await page.goto(`${app}/tasks`);
  assert.equal(page.url(), `${app}/login?next=%2Ftasks`);
  const api = await page.request.get(`${app}/api/state`);
  assert.equal(api.status(), 401);
});

await step("sign-up with name, e-mail, and password sends a confirmation e-mail", async () => {
  await signUp(page, user1.name, user1.email, user1.password);
});

await step("login is refused before the e-mail is confirmed", async () => {
  await login(page, user1.email, user1.password);
  await page.getByText("Confirme seu e-mail").waitFor();
});

await step("confirmation link signs the user in and opens the office", async () => {
  await page.goto(await mailLink(user1.email, /confirm/i));
  await page.waitForURL(`${app}/`);
  await page.getByRole("link", { name: user1.name }).waitFor();
  await page.getByRole("group", { name: "Escritório virtual" }).waitFor();
});

await step("session persists after reloading the page", async () => {
  await page.reload();
  await page.getByRole("link", { name: user1.name }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
});

await step("realtime indicator is live", async () => {
  await page.getByText("Tempo real", { exact: true }).waitFor({ timeout: 15000 });
});

await step("project creation shows success feedback and persists", async () => {
  await page.goto(`${app}/tasks`);
  await page.getByRole("textbox", { name: "Nome" }).nth(1).fill(projectName);
  await page.getByLabel("Objetivo").fill("Validar a Stage 2");
  await page.getByRole("button", { name: "Criar projeto" }).click();
  await page.getByRole("status").filter({ hasText: "Projeto criado." }).waitFor();
  await page.reload();
  await page.locator("li p", { hasText: projectName }).first().waitFor();
});

const device2 = await browser.newContext();
const page2 = await device2.newPage();
await step("realtime: a task created on device 1 appears on device 2 without reload", async () => {
  await login(page2, user1.email, user1.password);
  await page2.waitForURL(`${app}/`);
  await page2.goto(`${app}/tasks`);
  await page2.getByText("Tempo real", { exact: true }).waitFor({ timeout: 15000 });
  await new Promise(resolve => setTimeout(resolve, 1500));
  const title = `Tarefa sincronizada ${run}`;
  await page.getByRole("textbox", { name: "Nome" }).first().fill(title);
  await page.getByLabel("Descrição").fill("Criada no dispositivo 1");
  await page.getByLabel("Agente responsável").selectOption({ label: "Rafael — Programador" });
  await page.getByRole("button", { name: "Criar tarefa" }).click();
  await page2.getByText(title).first().waitFor({ timeout: 10000 });
  if (shots) await page2.screenshot({ path: `${shots}/realtime-device2.png`, fullPage: true });
});

await step("profile: name and preferences are saved per user", async () => {
  await page.goto(`${app}/profile`);
  await page.getByLabel("Nome").fill("Ana Atualizada");
  await page.getByLabel("Reduzir animações do escritório").check();
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await page.getByRole("status").filter({ hasText: "Perfil atualizado." }).waitFor();
  await page.reload();
  await page.getByRole("link", { name: "Ana Atualizada" }).waitFor();
  assert.equal(await page.getByLabel("Reduzir animações do escritório").isChecked(), true);
});

await step("files: private upload, download, and delete", async () => {
  await page.goto(`${app}/tasks`);
  await page.getByLabel("Selecionar arquivo").setInputFiles({ name: "briefing.txt", mimeType: "text/plain", buffer: Buffer.from("conteúdo do briefing") });
  await page.getByRole("status").filter({ hasText: "Arquivo enviado." }).waitFor();
  const link = page.getByRole("link", { name: "briefing.txt" });
  const download = await page.request.get(`${app}${await link.getAttribute("href")}`);
  assert.equal(await download.text(), "conteúdo do briefing");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Excluir arquivo briefing.txt" }).click();
  await page.getByRole("status").filter({ hasText: "Arquivo excluído." }).waitFor();
  await page.getByText("Nenhum arquivo enviado.").waitFor();
});

await step("project deletion removes tasks, conversations, and Storage files", async () => {
  const name = `Projeto para excluir ${run}`;
  await page.goto(`${app}/tasks`);
  await page.getByRole("textbox", { name: "Nome" }).nth(1).fill(name);
  await page.getByLabel("Objetivo").fill("Será excluído");
  await page.getByRole("button", { name: "Criar projeto" }).click();
  await page.getByRole("status").filter({ hasText: "Projeto criado." }).waitFor();
  let snapshot = await state(page);
  const project = snapshot.projects.find(item => item.name === name);
  await page.getByRole("textbox", { name: "Nome" }).first().fill("Tarefa do projeto excluído");
  await page.getByLabel("Descrição").fill("x");
  await page.getByLabel("Agente responsável").selectOption({ label: "Rafael — Programador" });
  await page.getByLabel("Projeto (opcional)").selectOption({ label: name });
  await page.getByRole("button", { name: "Criar tarefa" }).click();
  await page.getByRole("status").filter({ hasText: "Tarefa criada." }).waitFor();
  await page.getByLabel("Projeto do arquivo").selectOption({ label: name });
  await page.getByLabel("Selecionar arquivo").setInputFiles({ name: "anexo.txt", mimeType: "text/plain", buffer: Buffer.from("anexo") });
  await page.getByRole("status").filter({ hasText: "Arquivo enviado." }).waitFor();
  snapshot = await state(page);
  const file = snapshot.files.find(item => item.projectId === project.id);
  assert.ok(file, "file linked to project");
  if (secretKey) {
    const before = await operator(`/storage/v1/object/list/office-files`, { method: "POST", body: JSON.stringify({ prefix: `${snapshot.profile.id}/${file.id}` }) });
    assert.equal(before.body.length, 1, "object present before deletion");
  }
  page.once("dialog", dialog => {
    assert.match(dialog.message(), /1 arquivo/);
    dialog.accept();
  });
  await page.getByRole("button", { name: `Excluir projeto ${name}` }).first().click();
  await page.getByRole("status").filter({ hasText: "excluído" }).first().waitFor();
  snapshot = await state(page);
  assert.equal(snapshot.projects.some(item => item.id === project.id), false);
  assert.equal(snapshot.tasks.some(item => item.projectId === project.id), false);
  assert.equal(snapshot.files.some(item => item.id === file.id), false);
  if (secretKey) {
    const after = await operator(`/storage/v1/object/list/office-files`, { method: "POST", body: JSON.stringify({ prefix: `${snapshot.profile.id}/${file.id}` }) });
    assert.deepEqual(after.body, [], "no orphan object in Storage");
    const conversations = await operator(`/rest/v1/agent_conversations?project_id=eq.${project.id}&select=id`);
    assert.deepEqual(conversations.body, []);
  }
});

if (secretKey) {
  await step("deleting another user's project or file through the API is refused", async () => {
    const snapshot = await state(page);
    const target = snapshot.projects[0];
    const context = await browser.newContext();
    const intruder = await context.newPage();
    await operator("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: `intruso-${run}@example.test`, password: "Intruso-Pass1", email_confirm: true }) });
    await login(intruder, `intruso-${run}@example.test`, "Intruso-Pass1");
    await intruder.waitForURL(`${app}/`);
    const response = await intruder.request.delete(`${app}/api/projects/${target.id}`, { headers: { origin: app } });
    assert.equal(response.status(), 404);
    assert.ok((await state(page)).projects.some(item => item.id === target.id), "project survives");
    await context.close();
  });
}

if (secretKey && aiFixture) {
  const waitForJob = async (predicate, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await state(page);
      const job = snapshot.jobs.find(predicate);
      if (job) return { job, snapshot };
      await page.waitForTimeout(500);
    }
    throw new Error("job condition not reached");
  };

  await step("queue: a task run is enqueued, executed by the worker, and logged", async () => {
    const title = `Tarefa na fila ${run}`;
    await page.goto(`${app}/tasks`);
    await page.getByRole("textbox", { name: "Nome" }).first().fill(title);
    await page.getByLabel("Descrição").fill("Executada pelo worker");
    await page.getByLabel("Agente responsável").selectOption({ label: "Rafael — Programador" });
    await page.getByRole("button", { name: "Criar tarefa" }).click();
    await page.getByRole("status").filter({ hasText: "Tarefa criada." }).waitFor();
    const task = (await state(page)).tasks.find(item => item.title === title);
    await page.locator("li", { hasText: title }).getByRole("button", { name: "Executar" }).click();
    await page.getByRole("status").filter({ hasText: "Execução iniciada." }).waitFor();
    const { job, snapshot } = await waitForJob(item => item.taskId === task.id && item.status === "completed");
    assert.equal(snapshot.tasks.find(item => item.id === task.id).status, "completed");
    const logs = (await (await page.request.get(`${app}/api/jobs/${job.id}/events`)).json()).events.map(event => event.message);
    for (const expected of ["Execução enfileirada.", "Estado: queued → running", "Estado: running → completed"]) assert.ok(logs.includes(expected), expected);
    assert.ok(logs.some(message => /^Chamada de IA \(Rafael/.test(message)), "AI call logged");
    await page.getByRole("button", { name: "Logs" }).first().click();
    await page.getByLabel("Logs da execução").waitFor();
  });

  await step("queue: cancelling a running project stops it between steps", async () => {
    await page.goto(`${app}/`);
    await page.getByLabel("Solicitação para o CEO").fill("Projeto para cancelar");
    await page.getByRole("button", { name: "Enviar ao CEO" }).click();
    const { job } = await waitForJob(item => item.kind === "orchestrate" && item.status === "running");
    await waitForJob(() => true).then(async () => {
      for (let attempt = 0; attempt < 120; attempt++) {
        const snapshot = await state(page);
        if (snapshot.tasks.some(task => task.projectId === job.projectId && task.status === "completed")) return;
        await page.waitForTimeout(250);
      }
      throw new Error("no task completed");
    });
    await page.goto(`${app}/tasks`);
    await page.getByRole("button", { name: /^Cancelar execução: / }).first().click();
    const done = await waitForJob(item => item.id === job.id && item.status === "cancelled", 30_000);
    const project = done.snapshot.projects.find(item => item.id === job.projectId);
    assert.equal(project.status, "failed");
    assert.equal(project.result, null, "summary not produced after cancellation");
    const remaining = done.snapshot.tasks.filter(task => task.projectId === job.projectId && task.status !== "completed");
    assert.ok(remaining.length > 0, "later tasks did not run");
  });

  await step("usage control: per-project cost, budget alert, and refusal before spending", async () => {
    const me = (await state(page)).profile.id;
    assert.equal((await setLimits(me, { monthly_budget_usd: 0.5 })).status < 300, true);
    await page.goto(`${app}/profile`);
    await page.getByLabel("Alertar ao atingir (% do limite mensal)").fill("10");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await page.getByRole("status").filter({ hasText: "Perfil atualizado." }).waitFor();
    await page.goto(`${app}/`);
    const known = new Set((await state(page)).projects.map(item => item.id));
    await page.getByLabel("Solicitação para o CEO").fill("Planeje um app de finanças");
    await page.getByRole("button", { name: "Enviar ao CEO" }).click();
    let snapshot;
    let project;
    for (let attempt = 0; attempt < 90; attempt++) {
      snapshot = await state(page);
      project = snapshot.projects.find(item => !known.has(item.id));
      if (project && (project.status === "completed" || project.status === "failed")) break;
      await page.waitForTimeout(1000);
    }
    assert.equal(project.status, "completed", project.summary ?? "");
    assert.ok(snapshot.stats.costByProject[project.id] > 0, "cost recorded for the project");
    assert.ok(snapshot.budget.usage.monthCostUsd > 0.05);
    assert.ok(snapshot.events.some(event => /Alerta de orçamento: 10%/.test(event.message)), "budget alert event");
    // Banner (the same alert also appears in the activity feed).
    await page.getByRole("status").filter({ hasText: /Alerta de orçamento: \d+% do limite mensal de IA usado/ }).waitFor();

    assert.equal((await setLimits(me, { monthly_budget_usd: 0.1 })).status < 300, true);
    const projectsBefore = snapshot.projects.length;
    await page.getByLabel("Solicitação para o CEO").fill("Outro pedido caro");
    await page.getByRole("button", { name: "Enviar ao CEO" }).click();
    await page.getByText(/Orçamento insuficiente/).waitFor();
    assert.equal((await state(page)).projects.length, projectsBefore, "nothing created when refused");

    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await operator("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: `consumo-${run}@example.test`, password: "Consumo-Pass1", email_confirm: true }) });
    await login(otherPage, `consumo-${run}@example.test`, "Consumo-Pass1");
    await otherPage.waitForURL(`${app}/`);
    const theirs = await state(otherPage);
    assert.equal(theirs.budget.usage.monthCostUsd, 0, "usage is per user");
    await other.close();
    await operator(`/rest/v1/usage_limits?user_id=eq.${me}`, { method: "DELETE" });
  });
}

await step("logout ends the session and protects the office again", async () => {
  await page.getByRole("button", { name: "Sair" }).click();
  await page.waitForURL(/\/login/);
  await page.goto(`${app}/`);
  assert.match(page.url(), /\/login/);
});

await step("password recovery: e-mail link leads to a new password that works", async () => {
  await page.goto(`${app}/forgot-password`);
  await page.getByLabel("E-mail").fill(user1.email);
  await page.getByRole("button", { name: "Enviar link" }).click();
  await page.getByText("Se existir uma conta").waitFor();
  await page.goto(await mailLink(user1.email, /reset/i));
  await page.waitForURL(`${app}/reset-password`);
  await page.getByLabel("Nova senha", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirmar nova senha").fill(newPassword);
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await page.waitForURL(/\/login\?reset=1/);
  await login(page, user1.email, user1.password);
  await page.getByText("E-mail ou senha incorretos.").waitFor();
  await login(page, user1.email, newPassword);
  await page.waitForURL(`${app}/`);
});

await step("data isolation: a second user sees none of the first user's data", async () => {
  const context = await browser.newContext();
  const other = await context.newPage();
  await signUp(other, user2.name, user2.email, user2.password);
  await other.goto(await mailLink(user2.email, /confirm/i));
  await other.waitForURL(`${app}/`);
  const state = await (await other.request.get(`${app}/api/state`)).json();
  assert.equal(state.profile.fullName, user2.name);
  assert.equal(state.projects.length, 0);
  assert.equal(state.tasks.length, 0);
  assert.equal(state.agents.length, 6);
  await other.goto(`${app}/tasks`);
  await other.getByText("Nenhum projeto").first().waitFor();
  assert.equal(await other.getByText(projectName).count(), 0);
  await context.close();
});

await step("cross-site requests are rejected even with a valid session", async () => {
  const response = await page.request.post(`${app}/api/projects`, {
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    data: { name: "x", request: "y" },
  });
  assert.equal(response.status(), 403);
});

if (shots) {
  await page.goto(`${app}/`);
  await page.getByText("Tempo real", { exact: true }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${shots}/office.png`, fullPage: true });
  await page.goto(`${app}/profile`);
  await page.getByText("Meu perfil").waitFor();
  await page.screenshot({ path: `${shots}/profile.png`, fullPage: true });
  const anon = await browser.newPage();
  await anon.goto(`${app}/login`);
  await anon.screenshot({ path: `${shots}/login.png` });
  await anon.goto(`${app}/signup`);
  await anon.screenshot({ path: `${shots}/signup.png` });
}

await browser.close();
const failed = results.filter(([status]) => status === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
