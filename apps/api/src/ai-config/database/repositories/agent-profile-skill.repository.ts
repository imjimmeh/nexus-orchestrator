import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentProfileSkill } from '../entities/agent-profile-skill.entity';

@Injectable()
export class AgentProfileSkillRepository {
  constructor(
    @InjectRepository(AgentProfileSkill)
    private readonly repository: Repository<AgentProfileSkill>,
  ) {}

  async findByProfileId(profileId: string): Promise<AgentProfileSkill[]> {
    return this.repository.find({
      where: { agentProfileId: profileId },
      relations: { skill: true },
      order: { assignmentOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async findBySkillId(skillId: string): Promise<AgentProfileSkill[]> {
    return this.repository.find({ where: { skillId } });
  }

  async replaceAssignments(
    profileId: string,
    skillIds: string[],
  ): Promise<void> {
    await this.repository.manager.transaction(async (manager) => {
      await manager.delete(AgentProfileSkill, { agentProfileId: profileId });

      if (skillIds.length === 0) {
        return;
      }

      const nextAssignments = skillIds.map((skillId, index) =>
        manager.create(AgentProfileSkill, {
          agentProfileId: profileId,
          skillId,
          assignmentOrder: index,
        }),
      );

      await manager.save(nextAssignments);
    });
  }

  async removeBySkillId(skillId: string): Promise<void> {
    await this.repository.delete({ skillId });
  }
}
