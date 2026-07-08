import { HeartbeatProfile } from "@/lib/api/projects.types";
import type { HeartbeatFormState } from "./SchedulesTabHeartbeatCard.shared";

interface UseHeartbeatProfileActionsParams {
  readonly projectId: string;
  readonly form: HeartbeatFormState;
  readonly resetForm: () => void;
  readonly onAfterRunNow: (profileId: string) => void;
  readonly onAfterDelete: (deletedProfileId: string) => void;
}

interface UseHeartbeatProfileActionsResult {
  readonly createPending: boolean;
  readonly updatePending: boolean;
  readonly runNowPending: boolean;
  readonly deletePending: boolean;
  readonly handleCreate: () => Promise<void>;
  readonly handleToggleEnabled: (profile: HeartbeatProfile) => Promise<void>;
  readonly handleRunNow: (profileId: string) => Promise<void>;
  readonly handleDelete: (profileId: string) => Promise<void>;
}

export type {
  UseHeartbeatProfileActionsParams,
  UseHeartbeatProfileActionsResult,
};
