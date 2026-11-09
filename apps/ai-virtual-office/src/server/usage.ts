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

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/**
 * Effective limits: app defaults, replaced field by field by the operator's row in
 * public.usage_limits (users cannot write it), then tightened by the user's personal budget.
 */
export async function getLimits(ctx: OfficeContext): Promise<UsageLimits> {
  const base = defaults();
  if (!ctx.supabase) return { ...base, alertPercent: 80, source: "default" };
  const [operator, settings] = await Promise.all([
    ctx.supabase.from("usage_limits").select("monthly_budget_usd, monthly_token_limit, daily_request_limit, max_concurrent_runs").eq("user_id", ctx.userId).maybeSingle(),
    ctx.supabase.from("user_settings").select("budget_alert_percent, personal_monthly_budget_usd").eq("user_id", ctx.userId).maybeSingle(),
  ]);
  if (operator.error || settings.error) throw new Error("Supabase limits read failed");
  const row = operator.data;
  const limits: UsageLimits = {
    monthlyBudgetUsd: num(row?.monthly_budget_usd) ?? base.monthlyBudgetUsd,
    monthlyTokenLimit: num(row?.monthly_token_limit) ?? base.monthlyTokenLimit,
    dailyRequestLimit: num(row?.daily_request_limit) ?? base.dailyRequestLimit,
    maxConcurrentRuns: num(row?.max_concurrent_runs) ?? base.maxConcurrentRuns,
    alertPercent: settings.data?.budget_alert_percent ?? 80,
    source: row ? "operator" : "default",
  };
  const personal = num(settings.data?.personal_monthly_budget_usd);
  if (personal !== null && (limits.monthlyBudgetUsd === null || personal < limits.monthlyBudgetUsd)) {
    limits.monthlyBudgetUsd = personal;
    limits.source = "personal";
  }
  return limits;
}

export async function getUsage(ctx: OfficeContext): Promise<UsageTotals> {
  const { month, day } = periodStarts();
  if (!ctx.supabase) {
    const state = await ctx.store.snapshot();
    const monthRecords = state.usage.filter(record => record.at >= month);
    return {
      monthCostUsd: monthRecords.reduce((sum, record) => sum + (record.costUsd ?? 0), 0),
      monthTokens: monthRecords.reduce((sum, record) => sum + record.inputTokens + record.outputTokens, 0),
      monthRequests: monthRecords.length,
      dayRequests: monthRecords.filter(record => record.at >= day).length,
      unpricedRequests: monthRecords.filter(record => record.costUsd === null).length,
      activeRuns: state.tasks.filter(task => task.status === "running").length + state.projects.filter(project => project.status === "planning").length,
    };
  }
  const [summary, running, planning] = await Promise.all([
    ctx.supabase.rpc("usage_summary", { p_month_start: month, p_day_start: day }).single(),
    ctx.supabase.from("tasks").select("id", { count: "exact", head: true }).eq("owner_id", ctx.userId).eq("status", "running"),
    ctx.supabase.from("projects").select("id", { count: "exact", head: true }).eq("owner_id", ctx.userId).eq("status", "planning"),
  ]);
  if (summary.error || running.error || planning.error) throw new Error("Supabase usage read failed");
  const row = summary.data as Record<string, number | string>;
  return {
    monthCostUsd: Number(row.month_cost_usd),
    monthTokens: Number(row.month_tokens),
    monthRequests: Number(row.month_requests),
    dayRequests: Number(row.day_requests),
    unpricedRequests: Number(row.unpriced_requests),
    activeRuns: (running.count ?? 0) + (planning.count ?? 0),
  };
}

export async function getBudgetStatus(ctx: OfficeContext): Promise<BudgetStatus> {
  const [limits, usage] = await Promise.all([getLimits(ctx), getUsage(ctx)]);
  return { limits, usage, percentUsed: percentUsed(limits, usage), level: budgetLevel(limits, usage), periodStart: periodStarts().month };
}

/** Refuses to start new work when any limit is already reached. */
export async function assertAdmission(ctx: OfficeContext, ignoreActiveRuns = 0) {
  const [limits, usage] = await Promise.all([getLimits(ctx), getUsage(ctx)]);
  const verdict = checkAdmission(limits, { ...usage, activeRuns: Math.max(0, usage.activeRuns - ignoreActiveRuns) });
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
  const [limits, usage] = await Promise.all([getLimits(ctx), getUsage(ctx)]);
  const verdict = checkCall(limits, usage, estimate);
  if (!verdict.ok) throw new BudgetExceededError(verdict.reason);
}
