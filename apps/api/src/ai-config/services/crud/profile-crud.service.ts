import { Injectable } from '@nestjs/common';
import type {
  CreateAgentProfileRequest,
  UpdateAgentProfileRequest,
} from '@nexus/core';
import { AgentProfileRepository } from '../../database/repositories/agent-profile.repository';
import { AgentProfile } from '../../database/entities/agent-profile.entity';
import { BaseCrudService } from './base-crud.service';

/**
 * Profile CRUD Service
 *
 * Handles CRUD operations for Agent Profile configurations.
 */
@Injectable()
export class ProfileCrudService extends BaseCrudService<
  AgentProfile,
  CreateAgentProfileRequest,
  UpdateAgentProfileRequest
> {
  constructor(private readonly profileRepository: AgentProfileRepository) {
    super(profileRepository, 'Agent profile');
  }

  /**
   * Confines the listing to the caller's accessible scope subtree
   * (default-deny). Platform (NULL-scoped) agent profiles remain visible to
   * any `agents:read` holder, matching `WorkflowController.findAll`.
   */
  async findAll(options?: { scopeIds?: string[] }): Promise<AgentProfile[]> {
    return this.profileRepository.findAll(options);
  }
}
