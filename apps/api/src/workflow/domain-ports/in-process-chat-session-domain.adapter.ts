import { Injectable } from '@nestjs/common';
import { SessionHydrationService } from '../../session/session-hydration.service';
import type { ChatSessionDomainPort } from './chat-session-domain.port.types';

@Injectable()
export class InProcessChatSessionDomainAdapter implements ChatSessionDomainPort {
  constructor(private readonly hydration: SessionHydrationService) {}

  dehydrateSession(
    containerId: string,
    workflowRunId: string,
  ): Promise<string> {
    return this.hydration.dehydrateSession(containerId, workflowRunId);
  }

  findSessionTreeByWorkflowRunId(workflowRunId: string) {
    return this.hydration.findSessionTreeByWorkflowRunId(workflowRunId);
  }

  saveSessionForChat(
    containerId: string,
    chatSessionId: string,
  ): Promise<string> {
    return this.hydration.saveSessionForChat(containerId, chatSessionId);
  }

  saveSessionForWorkflowChat(
    containerId: string,
    workflowRunId: string,
    chatSessionId: string,
  ): Promise<string> {
    return this.hydration.saveSessionForWorkflowChat(
      containerId,
      workflowRunId,
      chatSessionId,
    );
  }

  saveSessionFromExitedContainer(
    containerId: string,
    workflowRunId: string,
  ): Promise<string> {
    return this.hydration.saveSessionFromExitedContainer(
      containerId,
      workflowRunId,
    );
  }

  saveSessionFromJsonl(
    jsonlString: string,
    ownerRef: { workflow_run_id?: string; chat_session_id?: string },
    options?: { containerTier?: number },
  ): Promise<string> {
    return this.hydration.saveSessionFromJsonl(jsonlString, ownerRef, options);
  }

  rehydrateSession(
    sessionTreeId: string,
    containerId: string,
    nodeId?: string,
  ): Promise<string> {
    return this.hydration.rehydrateSession(sessionTreeId, containerId, nodeId);
  }

  injectSessionIntoContainer(
    containerId: string,
    sessionTreeIdOrJsonl: string,
  ): Promise<void> {
    return this.hydration.injectSessionIntoContainer(
      containerId,
      sessionTreeIdOrJsonl,
    );
  }

  appendSystemResultNode(
    sessionTreeId: string,
    content: string,
    explicitParentId?: string,
  ): Promise<string> {
    return this.hydration.appendSystemResultNode(
      sessionTreeId,
      content,
      explicitParentId,
    );
  }
}
