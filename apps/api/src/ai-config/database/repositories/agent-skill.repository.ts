import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AgentSkill } from '../entities/agent-skill.entity';

@Injectable()
export class AgentSkillRepository {
  constructor(
    @InjectRepository(AgentSkill)
    private readonly repository: Repository<AgentSkill>,
  ) {}

  async findById(id: string): Promise<AgentSkill | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByName(name: string): Promise<AgentSkill | null> {
    return this.repository.findOne({ where: { name } });
  }

  async findAll(params?: { includeInactive?: boolean }): Promise<AgentSkill[]> {
    return this.repository.find({
      where: params?.includeInactive ? {} : { isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findByIds(
    ids: string[],
    params?: { includeInactive?: boolean },
  ): Promise<AgentSkill[]> {
    if (ids.length === 0) {
      return [];
    }

    const where = params?.includeInactive
      ? { id: In(ids) }
      : { id: In(ids), isActive: true };

    return this.repository.find({ where });
  }

  async create(data: Partial<AgentSkill>): Promise<AgentSkill> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async save(entity: AgentSkill): Promise<AgentSkill> {
    return this.repository.save(entity);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<AgentSkill>,
  ): Promise<AgentSkill | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
