import type { ActivityEvent, Agent, OfficeState, Project, Task, UsageRecord } from "@/lib/domain";

export interface Collections {
  agents: Agent;
  projects: Project;
  tasks: Task;
  events: ActivityEvent;
  usage: UsageRecord;
}

export type CollectionName = keyof Collections;

export interface OfficeStore {
  readonly kind: "file" | "supabase";
  snapshot(): Promise<OfficeState>;
  insert<C extends CollectionName>(collection: C, record: Collections[C]): Promise<void>;
  update<C extends CollectionName>(
    collection: C,
    id: string,
    patch: Partial<Collections[C]>,
  ): Promise<Collections[C] | null>;
}

/** Bounds keep snapshots small; full history lives in the database. */
export const EVENT_LIMIT = 200;
export const USAGE_LIMIT = 2000;
