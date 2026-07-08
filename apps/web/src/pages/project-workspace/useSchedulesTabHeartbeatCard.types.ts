import { HeartbeatProfile, HeartbeatRun } from "@/lib/api/projects.types";
import type {
  HeartbeatFormState,
  WorkflowOption,
} from "./SchedulesTabHeartbeatCard.shared";

export interface HeartbeatFormSetters {
  readonly setName: (value: string) => void;
  readonly setIntervalSecondsText: (value: string) => void;
  readonly setWorkflowId: (value: string) => void;
  readonly setPayloadText: (value: string) => void;
  readonly setEnabled: (value: boolean) => void;
  readonly resetForm: () => void;
}

export interface UseSchedulesTabHeartbeatCardParams {
  readonly projectId: string;
  readonly workflows: ReadonlyArray<WorkflowOption>;
}

export interface UseSchedulesTabHeartbeatCardResult {
  readonly form: HeartbeatFormState;
  readonly formSetters: HeartbeatFormSetters;
  readonly selectedRunsProfileId: string | null;
  readonly toggleSelectedRunsProfileId: (profileId: string) => void;
  readonly profiles: HeartbeatProfile[];
  readonly profilesLoading: boolean;
  readonly runsLoading: boolean;
  readonly runs: HeartbeatRun[];
  readonly createPending: boolean;
  readonly updatePending: boolean;
  readonly runNowPending: boolean;
  readonly deletePending: boolean;
  readonly handleCreate: () => Promise<void>;
  readonly handleToggleEnabled: (profile: HeartbeatProfile) => Promise<void>;
  readonly handleRunNow: (profileId: string) => Promise<void>;
  readonly handleDelete: (profileId: string) => Promise<void>;
}
