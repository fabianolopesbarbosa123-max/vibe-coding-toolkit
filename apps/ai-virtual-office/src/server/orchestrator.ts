import "server-only";
import { z } from "zod";
import { PRIORITIES, type Agent, type EventLevel, type Project, type Task, type TaskInput } from "@/lib/domain";
import { estimateCostUsd } from "@/lib/pricing";
import { agentSystemPrompt, planPrompt, summaryPrompt, taskPrompt } from "./ai/prompts";
import { describeError, generateObject, generateText, providerStatus, IntegrationUnavailableError, type Generation } from "./ai/providers";
import { getEnv } from "./env";
import { HttpError } from "./http";
import type { OfficeContext } from "./store";

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
type Refs = { agentId?: string; taskId?: string; projectId?: string };

async function logEvent(ctx: OfficeContext, level: EventLevel, message: string, refs: Refs = {}) {
  await ctx.store.insert("events", {
    id: newId(),
    at: now(),
    level,
    message: message.slice(0, 1000),
    agentId: refs.agentId ?? null,
    taskId: refs.taskId ?? null,
    projectId: refs.projectId ?? null,
  });
}

async function recordUsage(ctx: OfficeContext, agentId: string, taskId: string | null, generation: Generation<unknown>) {
  const env = getEnv();
  const openaiPrice =
    env.OPENAI_INPUT_PRICE_PER_MTOK !== undefined && env.OPENAI_OUTPUT_PRICE_PER_MTOK !== undefined
      ? { input: env.OPENAI_INPUT_PRICE_PER_MTOK, output: env.OPENAI_OUTPUT_PRICE_PER_MTOK }
      : null;
  await ctx.store.insert("usage", {
    id: newId(),
    at: now(),
    agentId,
    taskId,
    provider: generation.provider,
    model: generation.model,
    inputTokens: generation.inputTokens,
    outputTokens: generation.outputTokens,
    costUsd: estimateCostUsd(generation.provider, generation.model, generation.inputTokens, generation.outputTokens, openaiPrice),
  });
}

/** Keeps the exact exchange with the model so results can be audited later. */
async function recordConversation(
  ctx: OfficeContext,
  kind: "planning" | "task" | "summary",
  refs: { agentId: string; projectId: string | null; taskId: string | null },
  messages: { system: string; prompt: string; output: string },
) {
  const conversationId = newId();
  const createdAt = now();
  await ctx.store.insert("conversations", { id: conversationId, kind, createdAt, ...refs });
  for (const [role, content] of [["system", messages.system], ["user", messages.prompt], ["assistant", messages.output]] as const) {
    await ctx.store.insert("messages", { id: newId(), conversationId, role, content, createdAt });
  }
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
  const project = state.projects.find(item => item.id === task.projectId) ?? null;
  const previous = state.tasks
    .filter(item => item.projectId && item.projectId === task.projectId && item.status === "completed" && item.order < task.order)
    .sort((a, b) => a.order - b.order)
    .map(item => ({ task: item, agent: state.agents.find(member => member.id === item.agentId) }));
  try {
    const system = agentSystemPrompt(agent);
    const prompt = taskPrompt(task, project, previous);
    const generation = await generateText(agent, system, prompt);
    await recordUsage(ctx, agent.id, task.id, generation);
    await recordConversation(ctx, "task", { agentId: agent.id, projectId: task.projectId, taskId: task.id }, { system, prompt, output: generation.output });
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
  const ceo = await findCeo(ctx);
  assertProviderAvailable(ceo);
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
    const generation = await generateObject(ceo, system, prompt, planSchema);
    await recordUsage(ctx, ceo.id, null, generation);
    await recordConversation(ctx, "planning", { agentId: ceo.id, projectId, taskId: null }, { system, prompt, output: JSON.stringify(generation.output, null, 2) });
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
    const generation = await generateText(ceo, system, prompt);
    await recordUsage(ctx, ceo.id, null, generation);
    await recordConversation(ctx, "summary", { agentId: ceo.id, projectId, taskId: null }, { system, prompt, output: generation.output });
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
