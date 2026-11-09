import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { OfficeState } from "@/lib/domain";
import { createSeedState } from "@/lib/seed";
import { EVENT_LIMIT, USAGE_LIMIT, type CollectionName, type Collections, type OfficeStore } from "./types";

const TABLES: Record<CollectionName, string> = {
  agents: "agents",
  projects: "projects",
  tasks: "tasks",
  events: "activity_events",
  usage: "usage_records",
};

const toSnake = (key: string) => key.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());

function mapKeys<T>(record: object, convert: (key: string) => string): T {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [convert(key), value])) as T;
}

/** Server-only store. The service-role key must never reach the browser. */
export class SupabaseStore implements OfficeStore {
  readonly kind = "supabase" as const;
  private readonly client: SupabaseClient;
  private seeded = false;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  private async select<C extends CollectionName>(collection: C, orderBy: string, limit?: number) {
    let query = this.client.from(TABLES[collection]).select("*").order(orderBy, { ascending: !limit });
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw new Error(`Supabase ${TABLES[collection]} select failed: ${error.message}`);
    const rows = (data ?? []).map(row => mapKeys<Collections[C]>(row, toCamel));
    return limit ? rows.reverse() : rows;
  }

  private async ensureSeed() {
    if (this.seeded) return;
    const { count, error } = await this.client.from(TABLES.agents).select("id", { count: "exact", head: true });
    if (error) throw new Error(`Supabase agents count failed: ${error.message}`);
    if (!count) {
      for (const agent of createSeedState().agents) await this.insert("agents", agent);
    }
    this.seeded = true;
  }

  async snapshot(): Promise<OfficeState> {
    await this.ensureSeed();
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
    const { error } = await this.client.from(TABLES[collection]).insert(mapKeys<Record<string, unknown>>(record, toSnake) as never);
    if (error) throw new Error(`Supabase ${TABLES[collection]} insert failed: ${error.message}`);
  }

  async update<C extends CollectionName>(collection: C, id: string, patch: Partial<Collections[C]>) {
    const { data, error } = await this.client
      .from(TABLES[collection])
      .update(mapKeys<Record<string, unknown>>(patch, toSnake) as never)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw new Error(`Supabase ${TABLES[collection]} update failed: ${error.message}`);
    return data ? mapKeys<Collections[C]>(data, toCamel) : null;
  }
}
