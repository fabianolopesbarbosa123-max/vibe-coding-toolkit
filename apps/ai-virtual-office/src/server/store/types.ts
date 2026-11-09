import type {
  ActivityEvent,
  Agent,
  AgentConversation,
  AgentMessage,
  OfficeState,
  Project,
  Task,
  UsageRecord,
} from "@/lib/domain";

export interface Collections {
  agents: Agent;
  projects: Project;
  tasks: Task;
  events: ActivityEvent;
  usage: UsageRecord;
  conversations: AgentConversation;
  messages: AgentMessage;
}

export type CollectionName = keyof Collections;

/**
 * Persistence for one owner. Implementations scope every read and write to that
 * owner; the Supabase store additionally relies on RLS with the user's JWT.
 */
export interface OfficeStore {
  readonly kind: "file" | "supabase";
  snapshot(): Promise<OfficeState>;
  insert<C extends CollectionName>(collection: C, record: Collections[C]): Promise<void>;
  update<C extends CollectionName>(
    collection: C,
    id: string,
    patch: Partial<Collections[C]>,
  ): Promise<Collections[C] | null>;
  /**
   * Atomic compare-and-set: applies the patch only when `field` currently holds one
   * of `allowed`. Returns null when the row is missing or another request won.
   */
  claim<C extends CollectionName, K extends keyof Collections[C] & string>(
    collection: C,
    id: string,
    field: K,
    allowed: Collections[C][K][],
    patch: Partial<Collections[C]>,
  ): Promise<Collections[C] | null>;
}

/** Bounds keep snapshots small; full history lives in the database. */
export const EVENT_LIMIT = 200;
export const USAGE_LIMIT = 2000;
export const CONVERSATION_LIMIT = 300;
