import "server-only";
import type { Agent } from "@/lib/domain";
import {
  budgetLevel,
  checkAdmission,
  checkCall,
  percentUsed,
  periodStarts,
  type BudgetStatus,
  type UsageLimits,
  type UsageTotals,
} from "@/lib/budget";
import { worstCaseCostUsd } from "@/lib/pricing";
import { getAiConfig, MAX_OUTPUT_TOKENS, worstPrice } from "./ai/config";
import type { OfficeContext } from "./store";

export class BudgetExceededError extends Error {
  readonly status = 429;
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/** Fixed per-request framing allowance added to the byte-based input bound. */
const FRAMING_TOKENS = 200;

function defaults(): Omit<UsageLimits, "alertPercent" | "source"> {
  const config = getAiConfig();
  return {
    monthlyBudgetUsd: config.OFFICE_DEFAULT_MONTHLY_BUDGET_USD,
    monthlyTokenLimit: config.OFFICE_DEFAULT_MONTHLY_TOKEN_LIMIT,
    dailyRequestLimit: config.OFFICE_DEFAULT_DAILY_REQUEST_LIMIT,
    maxConcurrentRuns: config.OFFICE_DEFAULT_MAX_CONCURRENT_RUNS,
  };
}

/**
 * Effective limits and usage for the context's user: app defaults, replaced field by
 * field by the operator's row in public.usage_limits (users cannot write it), then
 * tightened by the user's personal budget. One read through the store, so request
 * handlers and queue workers apply the same rules.
 */
export async function loadBudget(ctx: OfficeContext): Promise<{ limits: UsageLimits; usage: UsageTotals }> {
  const base = defaults();
  const { month, day } = periodStarts();
  const { operator, settings, totals } = await ctx.store.budgetInputs(month, day);
  const limits: UsageLimits = {
    monthlyBudgetUsd: operator?.monthlyBudgetUsd ?? base.monthlyBudgetUsd,
    monthlyTokenLimit: operator?.monthlyTokenLimit ?? base.monthlyTokenLimit,
    dailyRequestLimit: operator?.dailyRequestLimit ?? base.dailyRequestLimit,
    maxConcurrentRuns: operator?.maxConcurrentRuns ?? base.maxConcurrentRuns,
    alertPercent: settings?.budgetAlertPercent ?? 80,
    source: operator ? "operator" : "default",
  };
  const personal = settings?.personalMonthlyBudgetUsd ?? null;
  if (personal !== null && (limits.monthlyBudgetUsd === null || personal < limits.monthlyBudgetUsd)) {
    limits.monthlyBudgetUsd = personal;
    limits.source = "personal";
  }
  return { limits, usage: totals };
}

export const getLimits = async (ctx: OfficeContext) => (await loadBudget(ctx)).limits;
export const getUsage = async (ctx: OfficeContext) => (await loadBudget(ctx)).usage;

export async function getBudgetStatus(ctx: OfficeContext): Promise<BudgetStatus> {
  const { limits, usage } = await loadBudget(ctx);
  return { limits, usage, percentUsed: percentUsed(limits, usage), level: budgetLevel(limits, usage), periodStart: periodStarts().month };
}

/**
 * Refuses to start new work when any limit is already reached. With the execution queue
 * (Supabase mode) concurrency is enforced when a worker claims a job, so it is not checked here.
 */
export async function assertAdmission(ctx: OfficeContext) {
  const { limits, usage } = await loadBudget(ctx);
  const verdict = checkAdmission(ctx.mode === "supabase" ? { ...limits, maxConcurrentRuns: null } : limits, usage);
  if (!verdict.ok) throw new BudgetExceededError(verdict.reason);
}

/** Refuses one AI call if its worst case could exceed what is left. Call right before sending. */
export async function assertCallAllowed(ctx: OfficeContext, agent: Pick<Agent, "provider" | "model">, system: string, prompt: string) {
  const config = getAiConfig();
  const model = agent.model ?? (agent.provider === "anthropic" ? config.ANTHROPIC_MODEL : config.OPENAI_MODEL);
  if (!model || !config.allowedModels.has(model)) {
    throw new BudgetExceededError(`O modelo "${model ?? "—"}" não está autorizado. Ajuste OFFICE_ALLOWED_MODELS ou o modelo do agente.`);
  }
  const promptBytes = Buffer.byteLength(system) + Buffer.byteLength(prompt) + FRAMING_TOKENS;
  const price = worstPrice(agent, promptBytes);
  const estimate = {
    worstCostUsd: price ? worstCaseCostUsd(price, promptBytes, MAX_OUTPUT_TOKENS) : null,
    worstTokens: promptBytes + MAX_OUTPUT_TOKENS,
  };
  const { limits, usage } = await loadBudget(ctx);
  const verdict = checkCall(limits, usage, estimate);
  if (!verdict.ok) throw new BudgetExceededError(verdict.reason);
}
