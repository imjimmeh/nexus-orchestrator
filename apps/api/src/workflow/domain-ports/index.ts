export * from './chat-session-domain.port.types';
export * from './chat-session-repository.port.types';
export * from './chat-session-memory.port.types';
export * from './agent-communication-domain.port.types';
export * from './subagent-chat-session.port.types';
export * from './domain-port.tokens';
export * from './in-process-chat-session-domain.adapter';
export * from './in-process-chat-session-repository.adapter';
export * from './in-process-chat-session-memory.adapter';
export * from './in-process-agent-communication-domain.adapter';
export * from './in-process-subagent-chat-session.adapter';

// Re-export the entity enums/types that the ports reference so consumers
// can resolve a fully-typed identifier through a single import from
// `domain-ports`.
export type {
  AgentCommunicationThreadStatus,
  AgentCommunicationThreadUrgency,
} from '../../chat/database/entities/agent-communication-thread.entity.types';
export type { AgentCommunicationMessageKind } from '../../chat/database/entities/agent-communication-message.entity.types';
export type { ChatSession } from '../../chat/database/entities/chat-session.entity';
