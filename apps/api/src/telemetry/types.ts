import type { Socket } from 'socket.io';
import type { StepCompletionFinalizerService } from '../workflow/workflow-step-execution/step-completion-finalizer.service';
import type {
  CheckAgentMentionsInput,
  CheckSubagentStatusInput,
  CloseWarRoomInput,
  GetWarRoomStateInput,
  InviteAgentToChatInput,
  InviteWarRoomParticipantInput,
  MentionAgentInput,
  OpenWarRoomInput,
  PostWarRoomMessageInput,
  ResolveAgentThreadInput,
  SpawnSubagentAsyncInput,
  SubmitWarRoomSignoffInput,
  UpdateWarRoomBlackboardInput,
  WaitForSubagentsInput,
} from '@nexus/core';

export type GatewayEventPayload = Record<string, unknown>;

export type StepCompletionFinalizerDep = Pick<
  StepCompletionFinalizerService,
  'finalizeFromAgentEnd'
>;

export type GatewayWorkflowEvent = {
  event_type: string;
  payload: GatewayEventPayload;
};

export type AuthenticatedSocket = Socket & {
  workflowRunId?: string;
  streamId?: string;
  chatSessionId?: string;
  scopeId?: string;
  jobId?: string;
  stepId?: string;
  agentProfileName?: string;
  /** Provider/model resolved from the runner config at connect, for per-turn cost attribution. */
  providerName?: string;
  modelName?: string;
  role?: 'agent' | 'ui';
  pubsubCallback?: (eventStr: string) => void;
  isSubagent?: boolean;
  containerId?: string;
  subagentExecutionId?: string;
  /**
   * Outcome of the most recent turn_end on this connection. agent_end events
   * from some engines hardcode `ok:true`, so the agent-level outcome is derived
   * from the final turn rather than trusting the agent_end payload alone.
   */
  lastTurnFailed?: boolean;
  lastTurnFailureMessage?: string;
  /**
   * Step identity that has already accepted `step_complete` on this socket.
   * Non-finalizing telemetry for the same key is stale and should be ignored.
   */
  completedStepKey?: string;
};

export type SpawnSubagentAsyncPayload = Omit<SpawnSubagentAsyncInput, 'action'>;

export type WaitForSubagentsPayload = Omit<WaitForSubagentsInput, 'action'>;

export type CheckSubagentStatusPayload = Omit<
  CheckSubagentStatusInput,
  'action'
>;

export type MentionAgentGatewayPayload = Omit<MentionAgentInput, 'action'>;

export type CheckAgentMentionsGatewayPayload = Omit<
  CheckAgentMentionsInput,
  'action'
>;

export type ResolveAgentThreadGatewayPayload = Omit<
  ResolveAgentThreadInput,
  'action'
>;

export type InviteAgentToChatGatewayPayload = Omit<
  InviteAgentToChatInput,
  'action' | 'chat_role'
> & {
  role?: InviteAgentToChatInput['chat_role'];
};

export type OpenWarRoomGatewayPayload = Omit<OpenWarRoomInput, 'action'>;

export type InviteWarRoomParticipantGatewayPayload = Omit<
  InviteWarRoomParticipantInput,
  'action'
>;

export type PostWarRoomMessageGatewayPayload = Omit<
  PostWarRoomMessageInput,
  'action'
>;

export type UpdateWarRoomBlackboardGatewayPayload = Omit<
  UpdateWarRoomBlackboardInput,
  'action'
>;

export type SubmitWarRoomSignoffGatewayPayload = Omit<
  SubmitWarRoomSignoffInput,
  'action'
>;

export type GetWarRoomStateGatewayPayload = Omit<
  GetWarRoomStateInput,
  'action'
>;

export type CloseWarRoomGatewayPayload = Omit<CloseWarRoomInput, 'action'>;

export type QuestionResponseAnswer = {
  questionIndex: number;
  selectedOption: string | null;
  freeTextAnswer: string | null;
};

export const TELEMETRY_GATEWAY_PORT = (() => {
  const raw = process.env.WEBSOCKET_GATEWAY_PORT;
  if (!raw) {
    return 3001;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 3001;
  }
  return parsed;
})();
