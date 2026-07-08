import type { HeartbeatFormSetters } from "./useSchedulesTabHeartbeatCard.types";
import type { HeartbeatFormState, WorkflowOption } from "./SchedulesTabHeartbeatCard.shared";

interface UseHeartbeatProfileFormParams {
  readonly workflows: ReadonlyArray<WorkflowOption>;
}

interface UseHeartbeatProfileFormResult {
  readonly form: HeartbeatFormState;
  readonly setters: HeartbeatFormSetters;
  readonly resetForm: () => void;
}

export type { UseHeartbeatProfileFormParams, UseHeartbeatProfileFormResult };
