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
import type { UsageTotals } from "@/lib/budget";

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
  /**
   * Deletes a project that is not planning or running, with its tasks and conversations.
   * Returns false when it does not exist, belongs to someone else, or is busy.
   * Usage and activity history are kept. Files must be removed first (see account.ts).
   */
  deleteProject(projectId: string): Promise<boolean>;
  /** Raw inputs for budget checks: operator limits, user settings, and usage totals. */
  budgetInputs(monthStart: string, dayStart: string): Promise<BudgetInputs>;
}

export interface BudgetInputs {
  operator: { monthlyBudgetUsd: number | null; monthlyTokenLimit: number | null; dailyRequestLimit: number | null; maxConcurrentRuns: number | null } | null;
  settings: { budgetAlertPercent: number; personalMonthlyBudgetUsd: number | null } | null;
  totals: UsageTotals;
}

/** Bounds keep snapshots small; full history lives in the database. */
export const EVENT_LIMIT = 200;
export const USAGE_LIMIT = 2000;
export const CONVERSATION_LIMIT = 300;
