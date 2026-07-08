import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AgentProfile } from '../entities/agent-profile.entity';

@Injectable()
export class AgentProfileRepository {
  constructor(
    @InjectRepository(AgentProfile)
    private readonly repository: Repository<AgentProfile>,
  ) {}

  async findByName(name: string): Promise<AgentProfile | null> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        name,
      );
    if (isUuid) {
      return this.findById(name);
    }
    return this.repository.findOne({ where: { name, is_active: true } });
  }

  async findByNameInsensitive(name: string): Promise<AgentProfile | null> {
    return this.repository
      .createQueryBuilder('agent_profile')
      .where('LOWER(agent_profile.name) = LOWER(:name)', { name })
      .getOne();
  }

  async findById(id: string): Promise<AgentProfile | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findAll(options?: { scopeIds?: string[] }): Promise<AgentProfile[]> {
    const queryBuilder = this.repository
      .createQueryBuilder('agent_profile')
      .orderBy('agent_profile.created_at', 'DESC');

    // NULL scope_node_id denotes platform/global agent profiles, visible to
    // any agents:read holder. Scoped profiles are visible only within the
    // caller's accessible scopes.
    if (options?.scopeIds !== undefined) {
      if (options.scopeIds.length > 0) {
        queryBuilder.andWhere(
          '(agent_profile.scope_node_id IS NULL OR agent_profile.scope_node_id = ANY(:scopeIds))',
          { scopeIds: options.scopeIds },
        );
      } else {
        queryBuilder.andWhere('agent_profile.scope_node_id IS NULL');
      }
    }

    return queryBuilder.getMany();
  }

  async findActiveNames(): Promise<string[]> {
    const rows = await this.repository
      .createQueryBuilder('agent_profile')
      .select('agent_profile.name', 'name')
      .where('agent_profile.is_active = :isActive', { isActive: true })
      .orderBy('agent_profile.name', 'ASC')
      .getRawMany<{ name: string }>();

    return rows
      .map((row) => row.name)
      .filter((name): name is string => typeof name === 'string');
  }

  async findPaged(
    pagination: {
      limit: number;
      offset: number;
    },
    options?: {
      includeInactive?: boolean;
    },
  ): Promise<{ data: AgentProfile[]; total: number }> {
    const [data, total] = await this.repository.findAndCount({
      ...(options?.includeInactive ? {} : { where: { is_active: true } }),
      order: { created_at: 'DESC' },
      take: pagination.limit,
      skip: pagination.offset,
    });
    return { data, total };
  }

  async create(data: Partial<AgentProfile>): Promise<AgentProfile> {
    const profile = this.repository.create({
      ...data,
      source: data.source ?? 'admin',
      created_by_profile: data.created_by_profile ?? null,
      created_by_workflow_run_id: data.created_by_workflow_run_id ?? null,
      factory_context: data.factory_context ?? null,
    });
    return this.repository.save(profile);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<AgentProfile>,
  ): Promise<AgentProfile | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
