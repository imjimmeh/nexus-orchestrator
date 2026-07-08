import type { HarnessRuntimeConfig } from "@nexus/core";

export type OrchestratorCommand =
  | "dehydrate"
  | "abort"
  | "prompt"
  | "question_response"
  | "step_complete_result"
  | "spawn_subagent_async_result"
  | "wait_for_subagents_result"
  | "check_subagent_status_result"
  | "open_war_room_result"
  | "invite_war_room_participant_result"
  | "post_war_room_message_result"
  | "update_war_room_blackboard_result"
  | "submit_war_room_signoff_result"
  | "get_war_room_state_result"
  | "close_war_room_result";

export interface QuestionAnswer {
  questionIndex: number;
  selectedOption: string | null;
  freeTextAnswer: string | null;
}

export interface SpawnSubagentAsyncResultPayload {
  type: "spawn_subagent_async_result";
  success: boolean;
  execution_id?: string;
  error?: string;
}

export interface WaitForSubagentsResultPayload {
  type: "wait_for_subagents_result";
  success: boolean;
  status?: string;
  results?: Record<string, unknown>;
  pending_execution_ids?: string[];
  timeout_seconds?: number;
  elapsed_seconds?: number;
  error?: string;
}

export interface CheckSubagentStatusResultPayload {
  type: "check_subagent_status_result";
  success: boolean;
  execution_id?: string;
  status?: string;
  normalized_status?: string;
  terminal?: boolean;
  failure_reason?: string;
  latest_response?: string;
  latest_stop_reason?: string;
  latest_turn_at?: string;
  result?: unknown;
  assigned_files?: string[];
  started_at?: string;
  completed_at?: string;
  error?: string;
}

type WarRoomResultStatus =
  | "opened"
  | "invited"
  | "posted"
  | "updated"
  | "submitted"
  | "found"
  | "closed"
  | "denied"
  | "conflict"
  | "not_found";

interface WarRoomResultPayloadBase {
  success?: boolean;
  status?: WarRoomResultStatus;
  error?: string;
  denial_reason?: string;
  session_id?: string;
  workflow_run_id?: string;
  [key: string]: unknown;
}

export interface OpenWarRoomResultPayload extends WarRoomResultPayloadBase {
  type: "open_war_room_result";
}

export interface InviteWarRoomParticipantResultPayload extends WarRoomResultPayloadBase {
  type: "invite_war_room_participant_result";
}

export interface PostWarRoomMessageResultPayload extends WarRoomResultPayloadBase {
  type: "post_war_room_message_result";
}

export interface UpdateWarRoomBlackboardResultPayload extends WarRoomResultPayloadBase {
  type: "update_war_room_blackboard_result";
}

export interface SubmitWarRoomSignoffResultPayload extends WarRoomResultPayloadBase {
  type: "submit_war_room_signoff_result";
}

export interface GetWarRoomStateResultPayload extends WarRoomResultPayloadBase {
  type: "get_war_room_state_result";
}

export interface CloseWarRoomResultPayload extends WarRoomResultPayloadBase {
  type: "close_war_room_result";
}

export interface StepCompleteResultPayload {
  type: "step_complete_result";
  success: boolean;
  ok?: boolean;
  error?: string;
  missing_fields?: string[];
  remediation_prompt?: string;
}

export type CommandPayload =
  | { type: "dehydrate" }
  | { type: "abort" }
  | { type: "prompt"; message: string }
  | { type: "question_response"; answers: QuestionAnswer[] }
  | StepCompleteResultPayload
  | SpawnSubagentAsyncResultPayload
  | WaitForSubagentsResultPayload
  | CheckSubagentStatusResultPayload
  | OpenWarRoomResultPayload
  | InviteWarRoomParticipantResultPayload
  | PostWarRoomMessageResultPayload
  | UpdateWarRoomBlackboardResultPayload
  | SubmitWarRoomSignoffResultPayload
  | GetWarRoomStateResultPayload
  | CloseWarRoomResultPayload;
export type CommandHandler = (payload: CommandPayload) => void | Promise<void>;

export interface WaitForCommandOptions<T extends CommandPayload["type"]> {
  timeoutMs?: number;
  match?: (payload: Extract<CommandPayload, { type: T }>) => boolean;
}

export interface OrchestratorClient {
  /** Establish WebSocket connection and wait for authentication. */
  connect(): Promise<void>;
  /** Wait for the orchestrator to send model/provider configuration. */
  waitForConfig(): Promise<HarnessRuntimeConfig>;
  /** Emit a telemetry event to the gateway. */
  emit(event: string, data: unknown): void;
  /** Register a handler for an orchestrator command. */
  onCommand(command: OrchestratorCommand, handler: CommandHandler): void;
  /** Wait for a single occurrence of a command, returning its payload. */
  waitForCommand<T extends CommandPayload["type"]>(
    command: T,
    timeoutOrOptions?: number | WaitForCommandOptions<T>,
  ): Promise<Extract<CommandPayload, { type: T }>>;
  /** Disconnect the socket cleanly. */
  disconnect(): Promise<void>;
  /** Whether the socket is currently connected. */
  readonly connected: boolean;
}
