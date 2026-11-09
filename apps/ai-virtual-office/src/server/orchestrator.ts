import "server-only";
import { z } from "zod";
import { PRIORITIES, type Agent, type EventLevel, type Project, type Task, type TaskInput } from "@/lib/domain";
import { estimateCostUsd } from "@/lib/pricing";
import { agentSystemPrompt, planPrompt, summaryPrompt, taskPrompt } from "./ai/prompts";
import { describeError, generateObject, generateText, providerStatus, IntegrationUnavailableError, type Generation } from "./ai/providers";
import { getEnv } from "./env";
import { HttpError } from "./http";
import { getStore } from "./store";

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

async function logEvent(level: EventLevel, message: string, refs: { agentId?: string; taskId?: string; projectId?: string } = {}) {
  await getStore().insert("events", {
    id: id("evt"),
    at: now(),
    level,
    message,
    agentId: refs.agentId ?? null,
    taskId: refs.taskId ?? null,
    projectId: refs.projectId ?? null,
  });
}

async function recordUsage(agentId: string, taskId: string | null, generation: Generation<unknown>) {
  const env = getEnv();
  const openaiPrice =
    env.OPENAI_INPUT_PRICE_PER_MTOK !== undefined && env.OPENAI_OUTPUT_PRICE_PER_MTOK !== undefined
      ? { input: env.OPENAI_INPUT_PRICE_PER_MTOK, output: env.OPENAI_OUTPUT_PRICE_PER_MTOK }
      : null;
  await getStore().insert("usage", {
    id: id("use"),
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

async function findCeo(agents?: Agent[]): Promise<Agent> {
  const list = agents ?? (await getStore().snapshot()).agents;
  const ceo = list.find(agent => agent.role === "ceo");
  if (!ceo) throw new HttpError(409, "Cadastre um agente com a função CEO.");
  return ceo;
}

function assertProviderAvailable(agent: Agent) {
  const status = providerStatus(agent.provider);
  if (!status.available) throw new IntegrationUnavailableError(agent.provider, status.detail);
}

export async function createTask(input: TaskInput, order?: number): Promise<Task> {
  const store = getStore();
  const state = await store.snapshot();
  if (!state.agents.some(agent => agent.id === input.agentId)) throw new HttpError(422, "Agente não encontrado.");
  if (input.projectId && !state.projects.some(project => project.id === input.projectId)) {
    throw new HttpError(422, "Projeto não encontrado.");
  }
  const task: Task = {
    id: id("task"),
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
  await logEvent("info", `Tarefa criada: ${task.title}`, { agentId: task.agentId, taskId: task.id, projectId: task.projectId ?? undefined });
  return task;
}

/** Validates and marks a task as running so callers can return before the AI call finishes. */
export async function claimTask(taskId: string): Promise<Task> {
  const store = getStore();
  const state = await store.snapshot();
  const task = state.tasks.find(item => item.id === taskId);
  if (!task) throw new HttpError(404, "Tarefa não encontrada.");
  if (task.status === "running" || task.status === "completed") throw new HttpError(409, "Tarefa já executada ou em execução.");
  const agent = state.agents.find(item => item.id === task.agentId);
  if (!agent) throw new HttpError(409, "O agente responsável não existe mais.");
  if (agent.status === "working") throw new HttpError(409, `${agent.name} está ocupado(a) com outra tarefa.`);
  assertProviderAvailable(agent);
  const claimed = await store.update("tasks", taskId, { status: "running", startedAt: now(), error: null });
  await store.update("agents", agent.id, { status: "working", currentTaskId: taskId });
  await logEvent("info", `${agent.name} começou: ${task.title}`, { agentId: agent.id, taskId, projectId: task.projectId ?? undefined });
  return claimed!;
}

/** Runs a claimed task. Never throws: failures are stored on the task and as alerts. */
export async function executeTask(taskId: string): Promise<Task | null> {
  const store = getStore();
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
    const generation = await generateText(agent, agentSystemPrompt(agent), taskPrompt(task, project, previous));
    await recordUsage(agent.id, task.id, generation);
    const updated = await store.update("tasks", task.id, { status: "completed", result: generation.output, completedAt: now() });
    await store.update("agents", agent.id, { status: "done", currentTaskId: null });
    await logEvent("success", `${agent.name} concluiu: ${task.title}`, { agentId: agent.id, taskId: task.id, projectId: task.projectId ?? undefined });
    return updated;
  } catch (error) {
    const message = describeError(error);
    const updated = await store.update("tasks", task.id, { status: "failed", error: message, completedAt: now() });
    await store.update("agents", agent.id, { status: "error", currentTaskId: null });
    await logEvent("error", `${agent.name} falhou em "${task.title}": ${message}`, { agentId: agent.id, taskId: task.id, projectId: task.projectId ?? undefined });
    return updated;
  }
}

export async function createProject(name: string, request: string, status: Project["status"] = "ready"): Promise<Project> {
  const project: Project = { id: id("proj"), name, request, status, summary: null, result: null, createdAt: now() };
  await getStore().insert("projects", project);
  await logEvent("info", `Projeto criado: ${name}`, { projectId: project.id });
  return project;
}

/** Validates the CEO integration before creating anything, so nothing is simulated. */
export async function startOrchestration(request: string): Promise<{ project: Project; ceo: Agent }> {
  const ceo = await findCeo();
  assertProviderAvailable(ceo);
  const name = request.length > 60 ? `${request.slice(0, 57)}...` : request;
  const project = await createProject(name, request, "planning");
  return { project, ceo };
}

const activeProjects = new Set<string>();

export async function planProject(projectId: string, ceo: Agent): Promise<boolean> {
  const store = getStore();
  const state = await store.snapshot();
  const project = state.projects.find(item => item.id === projectId);
  const team = state.agents.filter(agent => agent.role !== "ceo");
  if (!project || !team.length) return false;
  const attendees = [ceo, ...team].filter(agent => agent.status !== "working");
  await Promise.all(attendees.map(agent => store.update("agents", agent.id, { status: "meeting" })));
  await logEvent("info", `${ceo.name} convocou uma reunião de planejamento`, { agentId: ceo.id, projectId });
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
    const generation = await generateObject(ceo, agentSystemPrompt(ceo), planPrompt(project.request, team), planSchema);
    await recordUsage(ceo.id, null, generation);
    const plan = generation.output;
    for (const [index, item] of plan.tasks.entries()) {
      await createTask(
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
    await logEvent("success", `${ceo.name} distribuiu ${plan.tasks.length} tarefas`, { agentId: ceo.id, projectId });
    return true;
  } catch (error) {
    const message = describeError(error);
    await store.update("projects", projectId, { status: "failed", summary: `Falha no planejamento: ${message}` });
    await logEvent("error", `Planejamento falhou: ${message}`, { agentId: ceo.id, projectId });
    return false;
  } finally {
    await Promise.all(attendees.map(agent => store.update("agents", agent.id, { status: "idle" })));
  }
}

export async function claimProject(projectId: string): Promise<Project> {
  if (activeProjects.has(projectId)) throw new HttpError(409, "Projeto já está em execução.");
  const store = getStore();
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
  activeProjects.add(projectId);
  return (await store.update("projects", projectId, { status: "running" }))!;
}

/** Runs remaining tasks in order, sharing results, then asks the CEO for a final summary. */
export async function executeProject(projectId: string) {
  activeProjects.add(projectId);
  const store = getStore();
  try {
    const state = await store.snapshot();
    const tasks = state.tasks
      .filter(task => task.projectId === projectId && task.status !== "completed")
      .sort((a, b) => a.order - b.order);
    for (const task of tasks) {
      let result: Task | null;
      try {
        await claimTask(task.id);
        result = await executeTask(task.id);
      } catch (error) {
        const message = describeError(error);
        result = await store.update("tasks", task.id, { status: "failed", error: message, completedAt: now() });
        await logEvent("error", `Não foi possível iniciar "${task.title}": ${message}`, { taskId: task.id, projectId });
      }
      if (result?.status !== "completed") {
        await store.update("projects", projectId, { status: "failed" });
        return;
      }
    }
    await summarizeProject(projectId);
  } finally {
    activeProjects.delete(projectId);
  }
}

async function summarizeProject(projectId: string) {
  const store = getStore();
  const state = await store.snapshot();
  const project = state.projects.find(item => item.id === projectId)!;
  const ceo = state.agents.find(agent => agent.role === "ceo");
  const results = state.tasks
    .filter(task => task.projectId === projectId)
    .sort((a, b) => a.order - b.order)
    .map(task => ({ task, agent: state.agents.find(agent => agent.id === task.agentId) }));
  if (!ceo || !providerStatus(ceo.provider).available) {
    await store.update("projects", projectId, { status: "completed", result: null });
    await logEvent("warning", "Projeto concluído sem resumo: integração do CEO indisponível.", { projectId });
    return;
  }
  await store.update("agents", ceo.id, { status: "working" });
  try {
    const generation = await generateText(ceo, agentSystemPrompt(ceo), summaryPrompt(project, results));
    await recordUsage(ceo.id, null, generation);
    await store.update("projects", projectId, { status: "completed", result: generation.output });
    await store.update("agents", ceo.id, { status: "done" });
    await logEvent("success", `${ceo.name} apresentou o resultado de "${project.name}"`, { agentId: ceo.id, projectId });
  } catch (error) {
    const message = describeError(error);
    await store.update("projects", projectId, { status: "completed", result: null });
    await store.update("agents", ceo.id, { status: "error" });
    await logEvent("error", `Resumo final falhou: ${message}`, { agentId: ceo.id, projectId });
  }
}
