import type { Integration, OfficeState } from "./domain";
import type { OfficeStats } from "./stats";

export interface OfficeSnapshot extends OfficeState {
  integrations: Integration[];
  stats: OfficeStats;
  storeKind: "file" | "supabase";
}
