import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workflow } from '../../workflow/database/entities/workflow.entity';
import type { ScopedConfigSource } from '../scoped-config-source';
import type { ConfigLayerRecord } from '../effective-config.types';

@Injectable()
export class WorkflowConfigSource implements ScopedConfigSource<Workflow> {
  readonly objectType = 'workflow' as const;

  constructor(
    @InjectRepository(Workflow) private readonly repo: Repository<Workflow>,
  ) {}

  async loadCandidates(
    name: string,
    scopeIds: string[],
  ): Promise<Array<ConfigLayerRecord<Workflow>>> {
    const rows = await this.repo
      .createQueryBuilder('w')
      .where('w.name = :name', { name })
      .andWhere(
        '(w.scope_node_id IS NULL OR w.scope_node_id IN (:...scopeIds))',
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
