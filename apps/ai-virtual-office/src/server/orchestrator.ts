import "server-only";
import { z } from "zod";
import { PRIORITIES, type Agent, type OfficeState, type Project, type Task, type TaskInput } from "@/lib/domain";
import { agentSystemPrompt, planPrompt, summaryPrompt, taskPrompt } from "./ai/prompts";
import { describeError, providerStatus, IntegrationUnavailableError } from "./ai/providers";
import { HttpError } from "./http";
import { logEvent, runObject, runText } from "./ledger";
import type { OfficeContext } from "./store";
import { assertAdmission, assertCallAllowed } from "./usage";

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

/**
 * Background runs act with the requesting user's JWT. Stop cleanly before it expires,
 * while writes still succeed, so nothing is left stuck in "running".
 */
const SESSION_MARGIN_MS = 10 * 60 * 1000;
async function stopIfSessionEnding(ctx: OfficeContext, projectId: string): Promise<boolean> {
  if (ctx.sessionExpiresAt === null || ctx.sessionExpiresAt - Date.now() > SESSION_MARGIN_MS) return false;
  await ctx.store.update("projects", projectId, { status: "failed" });
  await logEvent(ctx, "warning", "Execução pausada: a sessão está perto de expirar. Use “Retomar” para continuar.", { projectId });
  return true;
}

async function findCeo(ctx: OfficeContext, agents?: Agent[]): Promise<Agent> {
  const list = agents ?? (await ctx.store.snapshot()).agents;
  const ceo = list.find(agent => agent.role === "ceo");
  if (!ceo) throw new HttpError(409, "Cadastre um agente com a função CEO.");
  return ceo;
}

function assertProviderAvailable(agent: Agent) {
  const status = providerStatus(agent.provider);
  if (!status.available) throw new IntegrationUnavailableError(agent.provider, status.detail);
}

export async function createTask(ctx: OfficeContext, input: TaskInput, order?: number): Promise<Task> {
  const { store } = ctx;
  const state = await store.snapshot();
  if (!state.agents.some(agent => agent.id === input.agentId)) throw new HttpError(422, "Agente não encontrado.");
  if (input.projectId && !state.projects.some(project => project.id === input.projectId)) {
    throw new HttpError(422, "Projeto não encontrado.");
  }
  const task: Task = {
    id: newId(),
    ...input,
    status: "pending",
    order: order ?? state.tasks.filter(item => item.projectId === input.projectId).length,
    result: null,
    error: null,
    createdAt: now(),
    startedAt: null,
    completedAt: null,
  };
  await store.insert("tasks", task);
  await logEvent(ctx, "info", `Tarefa criada: ${task.title}`, { agentId: task.agentId, taskId: task.id, projectId: task.projectId ?? undefined });
  return task;
}

/** The exact prompt a task will send: its description plus results shared by earlier tasks. */
function taskRequest(state: OfficeState, task: Task, agent: Agent) {
  const project = state.projects.find(item => item.id === task.projectId) ?? null;
  const previous = state.tasks
    .filter(item => item.projectId && item.projectId === task.projectId && item.status === "completed" && item.order < task.order)
    .sort((a, b) => a.order - b.order)
    .map(item => ({ task: item, agent: state.agents.find(member => member.id === item.agentId) }));
  return { system: agentSystemPrompt(agent), prompt: taskPrompt(task, project, previous) };
}

/** Validates and marks a task as running so callers can return before the AI call finishes. */
export async function claimTask(ctx: OfficeContext, taskId: string): Promise<Task> {
  const { store } = ctx;
  const state = await store.snapshot();
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new HttpError(404, "Tarefa não encontrada.");
  if (task.status === "running" || task.status === "completed") throw new HttpError(409, "Tarefa já executada ou em execução.");
  const agent = state.agents.find(item => item.id === task.agentId);
  if (!agent) throw new HttpError(409, "O agente responsável não existe mais.");
  assertProviderAvailable(agent);
  await assertAdmission(ctx);
  const request = taskRequest(state, task, agent);
  await assertCallAllowed(ctx, agent, request.system, request.prompt);
  const busy = await store.claim("agents", agent.id, "status", ["idle", "done", "error"], { status: "working", currentTaskId: taskId });
  if (!busy) throw new HttpError(409, `${agent.name} está ocupado(a) com outra tarefa.`);
  const claimed = await store.claim("tasks", taskId, "status", ["pending", "failed"], { status: "running", startedAt: now(), error: null });
  if (!claimed) {
    await store.update("agents", agent.id, { status: "idle", currentTaskId: null });
    throw new HttpError(409, "Tarefa já executada ou em execução.");
  }
  await logEvent(ctx, "info", `${agent.name} começou: ${task.title}`, { agentId: agent.id, taskId, projectId: task.projectId ?? undefined });
  return claimed;
}

/** Runs a claimed task. Never throws: failures are stored on the task and as alerts. */
export async function executeTask(ctx: OfficeContext, taskId: string): Promise<Task | null> {
  const { store } = ctx;
  const state = await store.snapshot();
  const task = state.tasks.find(item => item.id === taskId);
  const agent = task && state.agents.find(item => item.id === task.agentId);
  if (!task || !agent) return null;
  try {
    const { system, prompt } = taskRequest(state, task, agent);
    const generation = await runText(ctx, "task", agent, { agentId: agent.id, projectId: task.projectId, taskId: task.id }, system, prompt);
    const updated = await store.update("tasks", task.id, { status: "completed", result: generation.output, completedAt: now() });
    await store.update("agents", agent.id, { status: "done", currentTaskId: null });
    await logEvent(ctx, "success", `${agent.name} concluiu: ${task.title}`, { agentId: agent.id, taskId: task.id, projectId: task.projectId ?? undefined });
    return updated;
  } catch (error) {
    const message = describeError(error);
    const updated = await store.update("tasks", task.id, { status: "failed", error: message, completedAt: now() });
    await store.update("agents", agent.id, { status: "error", currentTaskId: null });
    await logEvent(ctx, "error", `${agent.name} falhou em "${task.title}": ${message}`, { agentId: agent.id, taskId: task.id, projectId: task.projectId ?? undefined });
    return updated;
  }
}

export async function createProject(ctx: OfficeContext, name: string, request: string, status: Project["status"] = "ready"): Promise<Project> {
  const project: Project = { id: newId(), name, request, status, summary: null, result: null, createdAt: now() };
  await ctx.store.insert("projects", project);
  await logEvent(ctx, "info", `Projeto criado: ${name}`, { projectId: project.id });
  return project;
}

/** Validates the CEO integration before creating anything, so nothing is simulated. */
export async function startOrchestration(ctx: OfficeContext, request: string): Promise<{ project: Project; ceo: Agent }> {
  const state = await ctx.store.snapshot();
  const ceo = await findCeo(ctx, state.agents);
  assertProviderAvailable(ceo);
  await assertAdmission(ctx);
  // Same prompt the planner will send, so an over-budget request is refused before anything is created.
  await assertCallAllowed(ctx, ceo, agentSystemPrompt(ceo), planPrompt(request, state.agents.filter(agent => agent.role !== "ceo")));
  const name = request.length > 60 ? `${request.slice(0, 57)}...` : request;
  const project = await createProject(ctx, name, request, "planning");
  return { project, ceo };
}

/** In-process guard against double runs; the database claim is the cross-instance guard. */
const activeProjects = new Set<string>();
const projectKey = (ctx: OfficeContext, projectId: string) => `${ctx.userId}:${projectId}`;

export async function planProject(ctx: OfficeContext, projectId: string, ceo: Agent): Promise<boolean> {
  const { store } = ctx;
  const state = await store.snapshot();
  const project = state.projects.find(item => item.id === projectId);
  const team = state.agents.filter(agent => agent.role !== "ceo");
  if (!project || !team.length) return false;
  const attendees = [ceo, ...team].filter(agent => agent.status !== "working");
  await Promise.all(attendees.map(agent => store.update("agents", agent.id, { status: "meeting" })));
  await logEvent(ctx, "info", `${ceo.name} convocou uma reunião de planejamento`, { agentId: ceo.id, projectId });
  const planSchema = z.object({
    projectName: z.string(),
    summary: z.string(),
    tasks: z
      .array(
        z.object({
          title: z.string(),
          description: z.string(),
          assigneeId: z.enum(team.map(agent => agent.id) as [string, ...string[]]),
          priority: z.enum(PRIORITIES),
        }),
      )
      .min(1)
      .max(6),
  });
  try {
    const system = agentSystemPrompt(ceo);
    const prompt = planPrompt(project.request, team);
    const generation = await runObject(ctx, ceo, { agentId: ceo.id, projectId, taskId: null }, system, prompt, planSchema);
    const plan = generation.output;
    for (const [index, item] of plan.tasks.entries()) {
      await createTask(
        ctx,
        {
          title: item.title.slice(0, 120),
          description: item.description.slice(0, 4000),
          agentId: item.assigneeId,
          priority: item.priority,
          projectId,
        },
        index,
      );
    }
    await store.update("projects", projectId, { name: plan.projectName.slice(0, 80), summary: plan.summary, status: "ready" });
    await logEvent(ctx, "success", `${ceo.name} distribuiu ${plan.tasks.length} tarefas`, { agentId: ceo.id, projectId });
    return true;
  } catch (error) {
    const message = describeError(error);
    await store.update("projects", projectId, { status: "failed", summary: `Falha no planejamento: ${message}` });
    await logEvent(ctx, "error", `Planejamento falhou: ${message}`, { agentId: ceo.id, projectId });
    return false;
  } finally {
    await Promise.all(attendees.map(agent => store.update("agents", agent.id, { status: "idle" })));
  }
}

export async function claimProject(ctx: OfficeContext, projectId: string): Promise<Project> {
  if (activeProjects.has(projectKey(ctx, projectId))) throw new HttpError(409, "Projeto já está em execução.");
  const { store } = ctx;
  const state = await store.snapshot();
  const project = state.projects.find(item => item.id === projectId);
  if (!project) throw new HttpError(404, "Projeto não encontrado.");
  if (project.status === "planning" || project.status === "running") throw new HttpError(409, "Projeto ocupado.");
  const pending = state.tasks.filter(task => task.projectId === projectId && task.status !== "completed");
  if (!pending.length) throw new HttpError(409, "Não há tarefas pendentes neste projeto.");
  for (const task of pending) {
    const agent = state.agents.find(item => item.id === task.agentId);
    if (agent) assertProviderAvailable(agent);
  }
  await assertAdmission(ctx);
  const claimed = await store.claim("projects", projectId, "status", ["ready", "failed"], { status: "running" });
  if (!claimed) throw new HttpError(409, "Projeto ocupado.");
  activeProjects.add(projectKey(ctx, projectId));
  return claimed;
}

/** Runs remaining tasks in order, sharing results, then asks the CEO for a final summary. */
export async function executeProject(ctx: OfficeContext, projectId: string) {
  activeProjects.add(projectKey(ctx, projectId));
  const { store } = ctx;
  try {
    const state = await store.snapshot();
    const tasks = state.tasks
      .filter(task => task.projectId === projectId && task.status !== "completed")
      .sort((a, b) => a.order - b.order);
    for (const task of tasks) {
      if (await stopIfSessionEnding(ctx, projectId)) return;
      let result: Task | null;
      try {
        await claimTask(ctx, task.id);
        result = await executeTask(ctx, task.id);
      } catch (error) {
        const message = describeError(error);
        result = await store.update("tasks", task.id, { status: "failed", error: message, completedAt: now() });
        await logEvent(ctx, "error", `Não foi possível iniciar "${task.title}": ${message}`, { taskId: task.id, projectId });
      }
      if (result?.status !== "completed") {
        await store.update("projects", projectId, { status: "failed" });
        return;
      }
    }
    if (await stopIfSessionEnding(ctx, projectId)) return;
    await summarizeProject(ctx, projectId);
  } finally {
    activeProjects.delete(projectKey(ctx, projectId));
  }
}

async function summarizeProject(ctx: OfficeContext, projectId: string) {
  const { store } = ctx;
  const state = await store.snapshot();
  const project = state.projects.find(item => item.id === projectId)!;
  const ceo = state.agents.find(agent => agent.role === "ceo");
  const results = state.tasks
    .filter(task => task.projectId === projectId)
    .sort((a, b) => a.order - b.order)
    .map(task => ({ task, agent: state.agents.find(agent => agent.id === task.agentId) }));
  if (!ceo || !providerStatus(ceo.provider).available) {
    await store.update("projects", projectId, { status: "completed", result: null });
    await logEvent(ctx, "warning", "Projeto concluído sem resumo: integração do CEO indisponível.", { projectId });
    return;
  }
  await store.update("agents", ceo.id, { status: "working" });
  try {
    const system = agentSystemPrompt(ceo);
    const prompt = summaryPrompt(project, results);
    const generation = await runText(ctx, "summary", ceo, { agentId: ceo.id, projectId, taskId: null }, system, prompt);
    await store.update("projects", projectId, { status: "completed", result: generation.output });
    await store.update("agents", ceo.id, { status: "done" });
    await logEvent(ctx, "success", `${ceo.name} apresentou o resultado de "${project.name}"`, { agentId: ceo.id, projectId });
  } catch (error) {
    const message = describeError(error);
    await store.update("projects", projectId, { status: "completed", result: null });
    await store.update("agents", ceo.id, { status: "error" });
    await logEvent(ctx, "error", `Resumo final falhou: ${message}`, { agentId: ceo.id, projectId });
  }
}
