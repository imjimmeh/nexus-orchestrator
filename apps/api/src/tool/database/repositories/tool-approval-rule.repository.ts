import { DataSource, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { ToolApprovalRule } from '../entities/tool-approval-rule.entity';

@Injectable()
export class ToolApprovalRuleRepository extends Repository<ToolApprovalRule> {
  constructor(private readonly dataSource: DataSource) {
    super(ToolApprovalRule, dataSource.createEntityManager());
  }

  async findActiveByToolName(toolName: string): Promise<ToolApprovalRule[]> {
    return this.createQueryBuilder('rule')
      .where('rule.tool_name = :toolName OR rule.tool_name = :wildcard', {
        toolName,
        wildcard: '*',
      })
      .andWhere('(rule.expires_at IS NULL OR rule.expires_at > NOW())')
      .orderBy('rule.priority', 'DESC')
      .addOrderBy('rule.created_at', 'ASC')
      .getMany();
  }

  async findByFilters(params: {
    scopeType?: ToolApprovalRule['scopeType'];
    scopeId?: string;
    toolName?: string;
    effect?: ToolApprovalRule['effect'];
  }): Promise<ToolApprovalRule[]> {
    const query = this.createQueryBuilder('rule').orderBy(
      'rule.created_at',
      'DESC',
    );

    if (params.scopeType) {
      query.andWhere('rule.scope_type = :scopeType', {
        scopeType: params.scopeType,
      });
    }

    if (params.scopeId) {
      query.andWhere('rule.scope_id = :scopeId', {
        scopeId: params.scopeId,
      });
    }

    if (params.toolName) {
      query.andWhere('rule.tool_name = :toolName', {
        toolName: params.toolName,
      });
    }

    if (params.effect) {
      query.andWhere('rule.effect = :effect', { effect: params.effect });
    }

    return query.getMany();
  }
}
