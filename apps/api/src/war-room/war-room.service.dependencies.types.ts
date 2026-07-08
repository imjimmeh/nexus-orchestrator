import type { AgentProfileRepository } from '../ai-config/database/repositories/agent-profile.repository';
import type { AgentWarRoomBlackboardRepository } from './database/repositories/agent-war-room-blackboard.repository';
import type { AgentWarRoomMessageRepository } from './database/repositories/agent-war-room-message.repository';
import type { AgentWarRoomParticipantRepository } from './database/repositories/agent-war-room-participant.repository';
import type { AgentWarRoomSessionRepository } from './database/repositories/agent-war-room-session.repository';
import type { AgentWarRoomSignoffRepository } from './database/repositories/agent-war-room-signoff.repository';
import type { IWorkflowRunRepository } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { SystemSettingsService } from '../settings/system-settings.service';
import type { WarRoomEventLogPort } from './ports/event-log.types';

export interface WarRoomServiceDependencies {
  workflowRunRepository: IWorkflowRunRepository;
  agentProfileRepository: AgentProfileRepository;
  sessionRepository: AgentWarRoomSessionRepository;
  participantRepository: AgentWarRoomParticipantRepository;
  messageRepository: AgentWarRoomMessageRepository;
  blackboardRepository: AgentWarRoomBlackboardRepository;
  signoffRepository: AgentWarRoomSignoffRepository;
  systemSettings: SystemSettingsService;
  workflowEventLog: WarRoomEventLogPort;
}
