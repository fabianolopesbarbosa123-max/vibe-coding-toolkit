import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRole, OfficeState } from "@/lib/domain";
import { createSeedState } from "@/lib/seed";
import { EVENT_LIMIT, USAGE_LIMIT, type CollectionName, type Collections, type OfficeStore } from "./types";

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
function fromRow<T>(row: Record<string, unknown>): T {
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
  ) {}

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
}
