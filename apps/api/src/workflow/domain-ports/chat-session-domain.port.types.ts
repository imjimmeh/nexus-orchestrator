import type { PiSessionTree } from '../../runtime/database/entities/pi-session-tree.entity';

export interface ChatSessionDomainPort {
  dehydrateSession(containerId: string, workflowRunId: string): Promise<string>;
  findSessionTreeByWorkflowRunId(
    workflowRunId: string,
  ): Promise<PiSessionTree | null>;
  saveSessionForChat(
    containerId: string,
    chatSessionId: string,
  ): Promise<string>;
  saveSessionForWorkflowChat(
    containerId: string,
    workflowRunId: string,
    chatSessionId: string,
  ): Promise<string>;
  saveSessionFromExitedContainer(
    containerId: string,
    workflowRunId: string,
  ): Promise<string>;
  saveSessionFromJsonl(
    jsonlString: string,
    ownerRef: { workflow_run_id?: string; chat_session_id?: string },
    options?: { containerTier?: number },
  ): Promise<string>;
  rehydrateSession(
    sessionTreeId: string,
    containerId: string,
    nodeId?: string,
  ): Promise<string>;
  injectSessionIntoContainer(
    containerId: string,
    sessionTreeIdOrJsonl: string,
  ): Promise<void>;
  appendSystemResultNode(
    sessionTreeId: string,
    content: string,
    explicitParentId?: string,
  ): Promise<string>;
}
