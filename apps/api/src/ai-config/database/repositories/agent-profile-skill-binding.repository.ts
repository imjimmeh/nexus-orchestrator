import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AgentProfileSkillBinding } from '../entities/agent-profile-skill-binding.entity';
import type {
  AgentProfileSkillBindingKey,
  InsertAgentProfileSkillBindingInput,
} from './agent-profile-skill-binding.repository.types';

/**
 * Persistence surface for `agent_profile_skill_bindings`. `findExisting`
 * mirrors the migration's
 * `(COALESCE(agent_profile_id, '00000000-...-000000'), scope_node_id, skill_name)`
 * unique index at the query level: `IsNull()` is used when `agentProfileId`
 * is `null` so a whole-scope binding is never matched against (or by) a
 * profile-scoped one.
 */
@Injectable()
export class AgentProfileSkillBindingRepository {
  constructor(
    @InjectRepository(AgentProfileSkillBinding)
    private readonly repo: Repository<AgentProfileSkillBinding>,
  ) {}

  findExisting(
    key: AgentProfileSkillBindingKey,
  ): Promise<AgentProfileSkillBinding | null> {
    return this.repo.findOne({
      where: {
        agent_profile_id:
          key.agentProfileId === null ? IsNull() : key.agentProfileId,
        scope_node_id: key.scopeNodeId,
        skill_name: key.skillName,
      },
    });
  }

  async upsert(
    input: InsertAgentProfileSkillBindingInput,
  ): Promise<AgentProfileSkillBinding> {
    const existing = await this.findExisting({
      agentProfileId: input.agent_profile_id,
      scopeNodeId: input.scope_node_id,
      skillName: input.skill_name,
    });
    if (existing) return existing;
    return this.repo.save(this.repo.create(input));
  }

  listForScopeNodeIds(
    scopeNodeIds: string[],
  ): Promise<AgentProfileSkillBinding[]> {
    if (scopeNodeIds.length === 0) return Promise.resolve([]);
    return this.repo.find({
      where: { scope_node_id: In(scopeNodeIds) },
      order: { created_at: 'ASC' },
    });
  }
}
