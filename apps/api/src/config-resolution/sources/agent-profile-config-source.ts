import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentProfile } from '../../ai-config/database/entities/agent-profile.entity';
import type { ScopedConfigSource } from '../scoped-config-source';
import type { ConfigLayerRecord } from '../effective-config.types';

@Injectable()
export class AgentProfileConfigSource implements ScopedConfigSource<AgentProfile> {
  readonly objectType = 'agent_profile' as const;

  constructor(
    @InjectRepository(AgentProfile)
    private readonly repo: Repository<AgentProfile>,
  ) {}

  async loadCandidates(
    name: string,
    scopeIds: string[],
  ): Promise<Array<ConfigLayerRecord<AgentProfile>>> {
    const rows = await this.repo
      .createQueryBuilder('ap')
      .where('ap.name = :name', { name })
      .andWhere(
        '(ap.scope_node_id IS NULL OR ap.scope_node_id IN (:...scopeIds))',
        { scopeIds },
      )
      .getMany();

    return rows.map((r) => ({
      rowId: r.id,
      scopeNodeId: r.scope_node_id,
      source: r.source,
      locked: r.locked,
      strategy: r.overrides ? 'merge' : 'replace',
      definition: r.overrides ? null : r,
      overrides: r.overrides,
      baseRef: r.base_ref,
    }));
  }
}
