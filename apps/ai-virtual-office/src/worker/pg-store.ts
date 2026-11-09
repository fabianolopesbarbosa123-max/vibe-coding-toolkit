import type { Pool } from "pg";
import type { OfficeState } from "@/lib/domain";
import { budgetInputsFromRows, fromRow, TABLES } from "@/server/store/supabase-store";
import { EVENT_LIMIT, USAGE_LIMIT, type BudgetInputs, type CollectionName, type Collections, type OfficeStore } from "@/server/store/types";

const toSnake = (key: string) => key.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`);
const IDENTIFIER = /^[a-z_]+$/;

/** Column names come from domain objects, never from input; still refuse anything unexpected. */
function column(key: string) {
  const name = toSnake(key);
  if (!IDENTIFIER.test(name)) throw new Error(`Unexpected column ${name}`);
  return `"${name}"`;
}

/** pg returns Date objects; normalize to ISO strings like the REST API does. */
function normalize(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
}

/**
 * Store used by queue workers. It connects as a worker login role (member of
 * office_worker) and acts for one owner. RLS lets that role see and change the owner's
 * rows only while it holds a live lease on one of the owner's jobs, so a worker cannot
 * read or write other users' data even with a bug in this class.
 */
export class PgStore implements OfficeStore {
  readonly kind = "supabase" as const;

  constructor(
    private readonly pool: Pool,
    readonly ownerId: string,
  ) {}

  private async rows(sql: string, params: unknown[]) {
    const result = await this.pool.query(sql, params);
    return result.rows.map(normalize);
  }

  private async select<C extends CollectionName>(collection: C, orderBy: string, limit?: number) {
    const order = limit ? "desc" : "asc";
    const rows = await this.rows(
      `select * from public.${TABLES[collection]} where owner_id = $1 order by ${column(orderBy)} ${order}${limit ? ` limit ${Number(limit)}` : ""}`,
      [this.ownerId],
    );
    const mapped = rows.map(row => fromRow<Collections[C]>(row));
    return limit ? mapped.reverse() : mapped;
  }

  async snapshot(): Promise<OfficeState> {
    const [agents, projects, tasks, events, usage] = await Promise.all([
      this.select("agents", "createdAt"),
      this.select("projects", "createdAt"),
      this.select("tasks", "createdAt"),
      this.select("events", "at", EVENT_LIMIT),
      this.select("usage", "at", USAGE_LIMIT),
    ]);
    return { agents, projects, tasks, events, usage };
  }

  async insert<C extends CollectionName>(collection: C, record: Collections[C]) {
    const entries = Object.entries(record as object);
    const columns = [...entries.map(([key]) => column(key)), '"owner_id"'];
    const values = [...entries.map(([, value]) => value), this.ownerId];
    await this.pool.query(
      `insert into public.${TABLES[collection]} (${columns.join(", ")}) values (${values.map((_, index) => `$${index + 1}`).join(", ")})`,
      values,
    );
  }

  private async updateWhere<C extends CollectionName>(
    collection: C,
    id: string,
    patch: Partial<Collections[C]>,
    extra?: { field: string; allowed: unknown[] },
  ) {
    const entries = Object.entries(patch as object).filter(([key]) => key !== "id");
    if (!entries.length) return null;
    const values: unknown[] = entries.map(([, value]) => value);
    const sets = entries.map(([key], index) => `${column(key)} = $${index + 1}`);
    values.push(id, this.ownerId);
    let where = `id = $${values.length - 1} and owner_id = $${values.length}`;
    if (extra) {
      values.push(extra.allowed);
      where += ` and ${column(extra.field)} = any($${values.length})`;
    }
    const rows = await this.rows(`update public.${TABLES[collection]} set ${sets.join(", ")} where ${where} returning *`, values);
    return rows[0] ? fromRow<Collections[C]>(rows[0]) : null;
  }

  update<C extends CollectionName>(collection: C, id: string, patch: Partial<Collections[C]>) {
    return this.updateWhere(collection, id, patch);
  }

  claim<C extends CollectionName, K extends keyof Collections[C] & string>(
    collection: C,
    id: string,
    field: K,
    allowed: Collections[C][K][],
    patch: Partial<Collections[C]>,
  ) {
    return this.updateWhere(collection, id, patch, { field, allowed });
  }

  async deleteProject(): Promise<boolean> {
    throw new Error("Workers do not delete projects.");
  }

  /** Concurrency is enforced when jobs are claimed, so workers report no active runs here. */
  async budgetInputs(monthStart: string, dayStart: string): Promise<BudgetInputs> {
    const [operator, settings, summary] = await Promise.all([
      this.rows("select monthly_budget_usd, monthly_token_limit, daily_request_limit, max_concurrent_runs from public.usage_limits where user_id = $1", [this.ownerId]),
      this.rows("select budget_alert_percent, personal_monthly_budget_usd from public.user_settings where user_id = $1", [this.ownerId]),
      this.rows(
        `select coalesce(sum(cost_usd) filter (where at >= $2), 0) as month_cost_usd,
                coalesce(sum(input_tokens + output_tokens) filter (where at >= $2), 0) as month_tokens,
                count(*) filter (where at >= $2) as month_requests,
                count(*) filter (where at >= $3) as day_requests,
                count(*) filter (where at >= $2 and cost_usd is null) as unpriced_requests
           from public.usage_records where owner_id = $1`,
        [this.ownerId, monthStart, dayStart],
      ),
    ]);
    return budgetInputsFromRows(operator[0] ?? null, settings[0] ?? null, summary[0], 0);
  }
}
