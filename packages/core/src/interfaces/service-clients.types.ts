import type {
  ChatEventPayloadV1,
  ChatEventTypeV1,
  CoreWorkflowEventTypeV1,
  CoreWorkflowRunEventPayloadV1,
  EventEnvelopeV1,
} from "../schemas/events/event-envelope.schema";
import type {
  WorkflowRunAcceptedV1,
  WorkflowRunControlRequestV1,
  WorkflowRunControlResultV1,
  WorkflowRunScopeCancelRequestV1,
  WorkflowRunScopeCancelResultV1,
  WorkflowRunRequestV1,
  WorkflowRunStatusV1,
} from "../schemas/workflow-run/workflow-run-contracts.schema";

export interface CoreClient {
  requestWorkflowRun(
    request: WorkflowRunRequestV1,
  ): Promise<WorkflowRunAcceptedV1>;
  getWorkflowRunStatus(
    runId: string,
    correlationId: string,
  ): Promise<WorkflowRunStatusV1>;
  controlWorkflowRun(
    request: WorkflowRunControlRequestV1,
  ): Promise<WorkflowRunControlResultV1>;
  cancelWorkflowRunsByScope(
    scopeId: string,
    request: WorkflowRunScopeCancelRequestV1,
  ): Promise<WorkflowRunScopeCancelResultV1>;
  publishCoreEvent(
    event: EventEnvelopeV1<
      CoreWorkflowEventTypeV1,
      CoreWorkflowRunEventPayloadV1
    >,
  ): Promise<void>;
}

export interface ChatClient {
  publishChatEvent(
    event: EventEnvelopeV1<ChatEventTypeV1, ChatEventPayloadV1>,
  ): Promise<void>;
}
