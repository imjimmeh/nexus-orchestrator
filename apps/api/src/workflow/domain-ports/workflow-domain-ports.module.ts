import { forwardRef, Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DatabaseModule as ChatDatabaseModule } from '../../chat/database/database.module';
import { SessionModule } from '../../session/session.module';
import {
  AGENT_COMMUNICATION_DOMAIN_PORT,
  CHAT_SESSION_DOMAIN_PORT,
  CHAT_SESSION_MEMORY_PORT,
  CHAT_SESSION_REPOSITORY_PORT,
  SUBAGENT_CHAT_SESSION_PORT,
} from './domain-port.tokens';
import { InProcessAgentCommunicationDomainAdapter } from './in-process-agent-communication-domain.adapter';
import { InProcessChatSessionDomainAdapter } from './in-process-chat-session-domain.adapter';
import { InProcessChatSessionMemoryAdapter } from './in-process-chat-session-memory.adapter';
import { InProcessChatSessionRepositoryAdapter } from './in-process-chat-session-repository.adapter';
import { InProcessSubagentChatSessionAdapter } from './in-process-subagent-chat-session.adapter';

/**
 * Adapter-layer module for the workflow<->chat domain ports.
 *
 * This module is the single sanctioned place that wires the in-process
 * adapters bridging the workflow domain to concrete chat-domain persistence
 * and session-hydration code. Living inside `domain-ports/`, it is the only
 * workflow module permitted to import chat-domain code directly (enforced by
 * `workflow-project-boundary.spec.ts`). Every other workflow module reaches
 * these capabilities through the exported port tokens, never through the
 * concrete chat repositories.
 *
 * It imports:
 * - the main `DatabaseModule` for `ChatSessionRepository` and the
 *   agent-communication thread/message repositories,
 * - the chat-domain `DatabaseModule` (aliased `ChatDatabaseModule`) for
 *   `ChatSessionMemoryRepository`,
 * - `SessionModule` (via `forwardRef` to break the existing transitive
 *   session<->workflow cycle) for `SessionHydrationService`.
 */
@Module({
  imports: [
    DatabaseModule,
    ChatDatabaseModule,
    forwardRef(() => SessionModule),
  ],
  providers: [
    InProcessChatSessionDomainAdapter,
    {
      provide: CHAT_SESSION_DOMAIN_PORT,
      useExisting: InProcessChatSessionDomainAdapter,
    },
    InProcessChatSessionRepositoryAdapter,
    {
      provide: CHAT_SESSION_REPOSITORY_PORT,
      useExisting: InProcessChatSessionRepositoryAdapter,
    },
    InProcessChatSessionMemoryAdapter,
    {
      provide: CHAT_SESSION_MEMORY_PORT,
      useExisting: InProcessChatSessionMemoryAdapter,
    },
    InProcessAgentCommunicationDomainAdapter,
    {
      provide: AGENT_COMMUNICATION_DOMAIN_PORT,
      useExisting: InProcessAgentCommunicationDomainAdapter,
    },
    InProcessSubagentChatSessionAdapter,
    {
      provide: SUBAGENT_CHAT_SESSION_PORT,
      useExisting: InProcessSubagentChatSessionAdapter,
    },
  ],
  exports: [
    InProcessChatSessionDomainAdapter,
    CHAT_SESSION_DOMAIN_PORT,
    InProcessChatSessionRepositoryAdapter,
    CHAT_SESSION_REPOSITORY_PORT,
    InProcessChatSessionMemoryAdapter,
    CHAT_SESSION_MEMORY_PORT,
    InProcessAgentCommunicationDomainAdapter,
    AGENT_COMMUNICATION_DOMAIN_PORT,
    InProcessSubagentChatSessionAdapter,
    SUBAGENT_CHAT_SESSION_PORT,
  ],
})
export class WorkflowDomainPortsModule {
  protected readonly _moduleName = 'WorkflowDomainPortsModule';
}
