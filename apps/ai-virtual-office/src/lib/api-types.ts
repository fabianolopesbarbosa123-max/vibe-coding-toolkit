import type { AuthMode, Integration, OfficeFile, OfficeState, Profile, UserSettings } from "./domain";
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
}
