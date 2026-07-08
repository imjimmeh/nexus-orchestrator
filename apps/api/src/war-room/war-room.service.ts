import { Inject, Injectable } from '@nestjs/common';
import { AgentProfileRepository } from '../ai-config/database/repositories/agent-profile.repository';
import { AgentWarRoomBlackboardRepository } from './database/repositories/agent-war-room-blackboard.repository';
import { AgentWarRoomMessageRepository } from './database/repositories/agent-war-room-message.repository';
import { AgentWarRoomParticipantRepository } from './database/repositories/agent-war-room-participant.repository';
import { AgentWarRoomSessionRepository } from './database/repositories/agent-war-room-session.repository';
import { AgentWarRoomSignoffRepository } from './database/repositories/agent-war-room-signoff.repository';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowRunRepository } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import { SystemSettingsService } from '../settings/system-settings.service';
import { closeWarRoomSession } from './war-room.service.close';
import type { WarRoomServiceDependencies } from './war-room.service.dependencies';
import { inviteWarRoomParticipant } from './war-room.service.invite';
import { openWarRoomSession } from './war-room.service.open';
import { postWarRoomMessage } from './war-room.service.post-message';
import {
  getWarRoomState,
  listWarRoomSessionsByRun,
} from './war-room.service.state';
import { submitWarRoomSignoff } from './war-room.service.submit-signoff';
import type {
  CloseWarRoomParams,
  CloseWarRoomResult,
  GetWarRoomStateParams,
  GetWarRoomStateResult,
  InviteWarRoomParticipantParams,
  InviteWarRoomParticipantResult,
  ListWarRoomSessionsByRunParams,
  ListWarRoomSessionsByRunResult,
  OpenWarRoomParams,
  OpenWarRoomResult,
  PostWarRoomMessageParams,
  PostWarRoomMessageResult,
  SubmitWarRoomSignoffParams,
  SubmitWarRoomSignoffResult,
  UpdateWarRoomBlackboardParams,
  UpdateWarRoomBlackboardResult,
} from './war-room.service.types';
import { updateWarRoomBlackboard } from './war-room.service.update-blackboard';
import { WAR_ROOM_EVENT_LOG_PORT } from './ports/event-log.port';
import type { WarRoomEventLogPort } from './ports/event-log.types';

export type {
  CloseWarRoomParams,
  CloseWarRoomResult,
  GetWarRoomStateParams,
  GetWarRoomStateResult,
  InviteWarRoomParticipantParams,
  InviteWarRoomParticipantResult,
  ListWarRoomSessionsByRunParams,
  ListWarRoomSessionsByRunResult,
  OpenWarRoomParams,
  OpenWarRoomResult,
  PostWarRoomMessageParams,
  PostWarRoomMessageResult,
  SubmitWarRoomSignoffParams,
  SubmitWarRoomSignoffResult,
  UpdateWarRoomBlackboardParams,
  UpdateWarRoomBlackboardResult,
} from './war-room.service.types';

@Injectable()
export class WarRoomService {
  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly workflowRunRepository: IWorkflowRunRepository,
    private readonly agentProfileRepository: AgentProfileRepository,
    private readonly sessionRepository: AgentWarRoomSessionRepository,
    private readonly participantRepository: AgentWarRoomParticipantRepository,
    private readonly messageRepository: AgentWarRoomMessageRepository,
    private readonly blackboardRepository: AgentWarRoomBlackboardRepository,
    private readonly signoffRepository: AgentWarRoomSignoffRepository,
    private readonly systemSettings: SystemSettingsService,
    @Inject(WAR_ROOM_EVENT_LOG_PORT)
    private readonly workflowEventLog: WarRoomEventLogPort,
  ) {}

  private getDependencies(): WarRoomServiceDependencies {
    return {
      workflowRunRepository: this.workflowRunRepository,
      agentProfileRepository: this.agentProfileRepository,
      sessionRepository: this.sessionRepository,
      participantRepository: this.participantRepository,
      messageRepository: this.messageRepository,
      blackboardRepository: this.blackboardRepository,
      signoffRepository: this.signoffRepository,
      systemSettings: this.systemSettings,
      workflowEventLog: this.workflowEventLog,
    };
  }

  async openSession(params: OpenWarRoomParams): Promise<OpenWarRoomResult> {
    return openWarRoomSession(this.getDependencies(), params);
  }

  async inviteParticipant(
    params: InviteWarRoomParticipantParams,
  ): Promise<InviteWarRoomParticipantResult> {
    return inviteWarRoomParticipant(this.getDependencies(), params);
  }

  async postMessage(
    params: PostWarRoomMessageParams,
  ): Promise<PostWarRoomMessageResult> {
    return postWarRoomMessage(this.getDependencies(), params);
  }

  async updateBlackboard(
    params: UpdateWarRoomBlackboardParams,
  ): Promise<UpdateWarRoomBlackboardResult> {
    return updateWarRoomBlackboard(this.getDependencies(), params);
  }

  async submitSignoff(
    params: SubmitWarRoomSignoffParams,
  ): Promise<SubmitWarRoomSignoffResult> {
    return submitWarRoomSignoff(this.getDependencies(), params);
  }

  async getState(
    params: GetWarRoomStateParams,
  ): Promise<GetWarRoomStateResult> {
    return getWarRoomState(this.getDependencies(), params);
  }

  async closeSession(params: CloseWarRoomParams): Promise<CloseWarRoomResult> {
    return closeWarRoomSession(this.getDependencies(), params);
  }

  async listSessionsByRun(
    params: ListWarRoomSessionsByRunParams,
  ): Promise<ListWarRoomSessionsByRunResult> {
    return listWarRoomSessionsByRun(this.getDependencies(), params);
  }
}
