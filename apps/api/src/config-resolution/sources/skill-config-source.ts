import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Skill } from '../../ai-config/database/entities/skill.entity';
import type { ScopedConfigSource } from '../scoped-config-source';
import type { ConfigLayerRecord } from '../effective-config.types';

@Injectable()
export class SkillConfigSource implements ScopedConfigSource<Skill> {
  readonly objectType = 'skill' as const;

  constructor(
    @InjectRepository(Skill) private readonly repo: Repository<Skill>,
  ) {}

  async loadCandidates(
    name: string,
    scopeIds: string[],
  ): Promise<Array<ConfigLayerRecord<Skill>>> {
    const rows = await this.repo
      .createQueryBuilder('s')
      .where('s.name = :name', { name })
      .andWhere(
        '(s.scope_node_id IS NULL OR s.scope_node_id IN (:...scopeIds))',
        { scopeIds },
      )
      .getMany();

    return rows.map((r) => ({
      rowId: r.id,
      scopeNodeId: r.scope_node_id ?? null,
      source: r.source,
      locked: r.locked,
      strategy: r.overrides ? 'merge' : 'replace',
      definition: r.overrides ? null : r,
      overrides: r.overrides ?? null,
      baseRef: r.base_ref ?? null,
    }));
  }
}
