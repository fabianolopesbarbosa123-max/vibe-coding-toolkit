import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRole, OfficeState } from "@/lib/domain";
import { createSeedState } from "@/lib/seed";
import { EVENT_LIMIT, USAGE_LIMIT, type BudgetInputs, type CollectionName, type Collections, type OfficeStore } from "./types";

const lastRecovery = new Map<string, number>();

export const TABLES: Record<CollectionName, string> = {
  agents: "agents",
  projects: "projects",
  tasks: "tasks",
  events: "activity_events",
  usage: "usage_records",
  conversations: "agent_conversations",
  messages: "agent_messages",
};

const toSnake = (key: string) => key.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());

export function mapKeys<T>(record: object, convert: (key: string) => string): T {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [convert(key), value])) as T;
}

/** Rows carry owner_id in the database; the app's domain objects do not. */
export function fromRow<T>(row: Record<string, unknown>): T {
  const { owner_id: _owner, ...rest } = row;
  void _owner;
  const mapped = mapKeys<Record<string, unknown>>(rest, toCamel);
  if (typeof mapped.costUsd === "string") mapped.costUsd = Number(mapped.costUsd);
  return mapped as T;
}

/** Deterministic per-user seed ids (UUID v5 layout), so concurrent first loads cannot duplicate the team. */
export function seedAgentId(ownerId: string, role: AgentRole): string {
  const hex = createHash("sha1").update(`ai-virtual-office:${ownerId}:${role}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Store for one authenticated user. The client carries that user's JWT, so RLS
 * enforces isolation; every query also filters by owner_id explicitly.
 */
export class SupabaseStore implements OfficeStore {
  readonly kind = "supabase" as const;
  private seeded = false;

  constructor(
    private readonly client: SupabaseClient,
    readonly ownerId: string,
    private readonly staleAfterMinutes = 20,
  ) {}

  /**
   * Fails work that stopped reporting progress (server restart, expired session), so it
   * can be retried. Throttled per user and process; RLS limits it to the caller's rows.
   */
  private async recoverStale() {
    const key = this.ownerId;
    const last = lastRecovery.get(key) ?? 0;
    if (Date.now() - last < 60_000) return;
    lastRecovery.set(key, Date.now());
    const { error } = await this.client.rpc("recover_stale_work", { p_stale_after: `${this.staleAfterMinutes} minutes` });
    if (error) throw new Error(`Supabase stale-work recovery failed: ${error.message}`);
  }

  private table(collection: CollectionName) {
    return this.client.from(TABLES[collection]);
  }

  private fail(collection: CollectionName, action: string, message: string): never {
    throw new Error(`Supabase ${TABLES[collection]} ${action} failed: ${message}`);
  }

  private async select<C extends CollectionName>(collection: C, orderBy: string, limit?: number) {
    let query = this.table(collection).select("*").eq("owner_id", this.ownerId).order(orderBy, { ascending: !limit });
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) this.fail(collection, "select", error.message);
    const rows = (data ?? []).map(row => fromRow<Collections[C]>(row));
    return limit ? rows.reverse() : rows;
  }

  private async ensureSeed() {
    if (this.seeded) return;
    const agents = createSeedState(undefined, role => seedAgentId(this.ownerId, role)).agents;
    const { count, error } = await this.table("agents").select("id", { count: "exact", head: true }).eq("owner_id", this.ownerId);
    if (error) this.fail("agents", "count", error.message);
    if (!count) {
      const rows = agents.map(agent => ({ ...mapKeys<Record<string, unknown>>(agent, toSnake), owner_id: this.ownerId }));
      const { error: seedError } = await this.table("agents").upsert(rows as never, { onConflict: "id", ignoreDuplicates: true });
      if (seedError) this.fail("agents", "seed", seedError.message);
    }
    this.seeded = true;
  }

  async snapshot(): Promise<OfficeState> {
    await this.ensureSeed();
    await this.recoverStale();
    const [agents, projects, tasks, events, usage] = await Promise.all([
      this.select("agents", "created_at"),
      this.select("projects", "created_at"),
      this.select("tasks", "created_at"),
      this.select("events", "at", EVENT_LIMIT),
      this.select("usage", "at", USAGE_LIMIT),
    ]);
    return { agents, projects, tasks, events, usage };
  }

  async insert<C extends CollectionName>(collection: C, record: Collections[C]) {
    const row = { ...mapKeys<Record<string, unknown>>(record, toSnake), owner_id: this.ownerId };
    const { error } = await this.table(collection).insert(row as never);
    if (error) this.fail(collection, "insert", error.message);
  }

  async update<C extends CollectionName>(collection: C, id: string, patch: Partial<Collections[C]>) {
    const { data, error } = await this.table(collection)
      .update(mapKeys<Record<string, unknown>>(patch, toSnake) as never)
      .eq("id", id)
      .eq("owner_id", this.ownerId)
      .select()
      .maybeSingle();
    if (error) this.fail(collection, "update", error.message);
    return data ? fromRow<Collections[C]>(data) : null;
  }

  async claim<C extends CollectionName, K extends keyof Collections[C] & string>(
    collection: C,
    id: string,
    field: K,
    allowed: Collections[C][K][],
    patch: Partial<Collections[C]>,
  ) {
    const { data, error } = await this.table(collection)
      .update(mapKeys<Record<string, unknown>>(patch, toSnake) as never)
      .eq("id", id)
      .eq("owner_id", this.ownerId)
      .in(toSnake(field), allowed as unknown[])
      .select()
      .maybeSingle();
    if (error) this.fail(collection, "claim", error.message);
    return data ? fromRow<Collections[C]>(data) : null;
  }

  async deleteProject(projectId: string) {
    const { data, error } = await this.table("projects")
      .delete()
      .eq("id", projectId)
      .eq("owner_id", this.ownerId)
      .not("status", "in", "(planning,running)")
      .select("id");
    if (error) this.fail("projects", "delete", error.message);
    return (data ?? []).length === 1;
  }

  async budgetInputs(monthStart: string, dayStart: string): Promise<BudgetInputs> {
    const [operator, settings, summary, active] = await Promise.all([
      this.client.from("usage_limits").select("monthly_budget_usd, monthly_token_limit, daily_request_limit, max_concurrent_runs").eq("user_id", this.ownerId).maybeSingle(),
      this.client.from("user_settings").select("budget_alert_percent, personal_monthly_budget_usd").eq("user_id", this.ownerId).maybeSingle(),
      this.client.rpc("usage_summary", { p_month_start: monthStart, p_day_start: dayStart }).single(),
      this.client.from("jobs").select("id", { count: "exact", head: true }).eq("owner_id", this.ownerId).in("status", ["running", "waiting_approval"]),
    ]);
    if (operator.error || settings.error || summary.error || active.error) throw new Error("Supabase budget read failed");
    return budgetInputsFromRows(operator.data, settings.data, summary.data as Record<string, unknown>, active.count ?? 0);
  }
}

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/** Shared by the Supabase (REST) and Postgres (worker) stores. */
export function budgetInputsFromRows(
  operator: Record<string, unknown> | null,
  settings: Record<string, unknown> | null,
  summary: Record<string, unknown>,
  activeRuns: number,
): BudgetInputs {
  return {
    operator: operator && {
      monthlyBudgetUsd: num(operator.monthly_budget_usd),
      monthlyTokenLimit: num(operator.monthly_token_limit),
      dailyRequestLimit: num(operator.daily_request_limit),
      maxConcurrentRuns: num(operator.max_concurrent_runs),
    },
    settings: settings && {
      budgetAlertPercent: Number(settings.budget_alert_percent ?? 80),
      personalMonthlyBudgetUsd: num(settings.personal_monthly_budget_usd),
    },
    totals: {
      monthCostUsd: Number(summary.month_cost_usd ?? 0),
      monthTokens: Number(summary.month_tokens ?? 0),
      monthRequests: Number(summary.month_requests ?? 0),
      dayRequests: Number(summary.day_requests ?? 0),
      unpricedRequests: Number(summary.unpriced_requests ?? 0),
      activeRuns,
    },
  };
}
