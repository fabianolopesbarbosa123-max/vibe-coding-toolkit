import "server-only";
import type { z } from "zod";
import { crossedThreshold, type UsageTotals } from "@/lib/budget";
import type { Agent, EventLevel } from "@/lib/domain";
import { estimateCostUsd } from "@/lib/pricing";
import { getAiConfig } from "./ai/config";
import { generateObject, generateText, type Generation } from "./ai/providers";
import type { OfficeContext } from "./store";
import { assertCallAllowed, getLimits, getUsage } from "./usage";

/**
 * Every AI call goes through here: budget check before sending, then usage, cost,
 * budget alerts, and the exact conversation are recorded for the calling user.
 */

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
export type Refs = { agentId?: string; taskId?: string; projectId?: string };
type ConversationKind = "planning" | "task" | "summary";
interface CallRefs {
  agentId: string;
  projectId: string | null;
  taskId: string | null;
}

export async function logEvent(ctx: OfficeContext, level: EventLevel, message: string, refs: Refs = {}) {
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

/** Cost of a call: each billed attempt at its own model's price; null if any attempt is unpriced. */
export function generationCost(generation: Generation<unknown>): number | null {
  const openaiPrice = getAiConfig().openaiPrice;
  let total = 0;
  for (const attempt of generation.billed) {
    const cost = estimateCostUsd(generation.provider, attempt.model, attempt.inputTokens, attempt.outputTokens, openaiPrice);
    if (cost === null) return null;
    total += cost;
  }
  return total;
}

async function recordUsage(ctx: OfficeContext, refs: CallRefs, generation: Generation<unknown>) {
  const inputTokens = generation.billed.reduce((sum, attempt) => sum + attempt.inputTokens, 0);
  const outputTokens = generation.billed.reduce((sum, attempt) => sum + attempt.outputTokens, 0);
  const costUsd = generationCost(generation);
  await ctx.store.insert("usage", {
    id: newId(),
    at: now(),
    agentId: refs.agentId,
    taskId: refs.taskId,
    projectId: refs.projectId,
    provider: generation.provider,
    model: generation.model,
    inputTokens,
    outputTokens,
    costUsd,
  });
  await alertOnThreshold(ctx, { costUsd: costUsd ?? 0, tokens: inputTokens + outputTokens });
}

async function alertOnThreshold(ctx: OfficeContext, call: { costUsd: number; tokens: number }) {
  try {
    const [limits, after] = await Promise.all([getLimits(ctx), getUsage(ctx)]);
    const before: UsageTotals = { ...after, monthCostUsd: after.monthCostUsd - call.costUsd, monthTokens: after.monthTokens - call.tokens };
    const crossed = crossedThreshold(limits, before, after);
    if (crossed === "warning") {
      await logEvent(ctx, "warning", `Alerta de orçamento: ${limits.alertPercent}% do limite mensal de IA foi atingido.`);
    } else if (crossed === "exceeded") {
      await logEvent(ctx, "error", "Limite mensal de IA atingido. Novas execuções ficam bloqueadas até o próximo mês ou até o limite ser ampliado.");
    }
  } catch {
    // Alerts are best effort; the limit itself is enforced before every call.
  }
}

async function recordConversation(ctx: OfficeContext, kind: ConversationKind, refs: CallRefs, system: string, prompt: string, output: string) {
  const conversationId = newId();
  const createdAt = now();
  await ctx.store.insert("conversations", { id: conversationId, kind, createdAt, ...refs });
  for (const [role, content] of [["system", system], ["user", prompt], ["assistant", output]] as const) {
    await ctx.store.insert("messages", { id: newId(), conversationId, role, content, createdAt });
  }
}

export async function runText(ctx: OfficeContext, kind: ConversationKind, agent: Agent, refs: CallRefs, system: string, prompt: string) {
  await assertCallAllowed(ctx, agent, system, prompt);
  const generation = await generateText(agent, system, prompt);
  await recordUsage(ctx, refs, generation);
  await recordConversation(ctx, kind, refs, system, prompt, generation.output);
  return generation;
}

export async function runObject<T extends z.ZodType>(ctx: OfficeContext, agent: Agent, refs: CallRefs, system: string, prompt: string, schema: T) {
  await assertCallAllowed(ctx, agent, system, prompt);
  const generation = await generateObject(agent, system, prompt, schema);
  await recordUsage(ctx, refs, generation);
  await recordConversation(ctx, "planning", refs, system, prompt, JSON.stringify(generation.output, null, 2));
  return generation;
}
