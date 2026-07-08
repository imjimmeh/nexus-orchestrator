interface HeartbeatFormState {
  name: string;
  intervalSecondsText: string;
  workflowId: string;
  payloadText: string;
  enabled: boolean;
}

interface WorkflowOption {
  id: string;
  name: string;
}

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS_TEXT = "300";

function buildInitialHeartbeatFormState(
  defaultWorkflowId: string,
): HeartbeatFormState {
  return {
    name: "",
    intervalSecondsText: DEFAULT_HEARTBEAT_INTERVAL_SECONDS_TEXT,
    workflowId: defaultWorkflowId,
    payloadText: "",
    enabled: true,
  };
}

export {
  buildInitialHeartbeatFormState,
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS_TEXT,
};
export type { HeartbeatFormState, WorkflowOption };
