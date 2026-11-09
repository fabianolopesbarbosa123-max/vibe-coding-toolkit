import type { AuthMode, Integration, Job, OfficeFile, OfficeState, Profile, UserSettings } from "./domain";
import type { BudgetStatus } from "./budget";
import type { OfficeStats } from "./stats";

export interface OfficeSnapshot extends OfficeState {
  integrations: Integration[];
  stats: OfficeStats;
  storeKind: "file" | "supabase";
  mode: AuthMode;
  profile: Profile;
  settings: UserSettings;
  files: OfficeFile[];
  budget: BudgetStatus;
  /** Recent executions (Supabase mode); empty in local mode. */
  jobs: Job[];
  /** Whether a queue worker reported in the last 30 s (null in local mode). */
  workerOnline: boolean | null;
}
