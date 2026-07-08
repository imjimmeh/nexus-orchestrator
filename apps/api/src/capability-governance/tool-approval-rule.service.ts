import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ToolApprovalRuleRepository } from '../tool/database/repositories/tool-approval-rule.repository';
import type {
  ArgumentPattern,
  ToolApprovalRule,
  ToolApprovalRuleEffect,
} from '../tool/database/entities/tool-approval-rule.entity';
import type { RuleContext } from './tool-approval-rule.service.types';
import { ScopeService } from '../scope/scope.service';

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replaceAll('\\', String.raw`\\`)
    .replaceAll('.', String.raw`\.`)
    .replaceAll('?', '.')
    .replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesPattern(value: unknown, pattern: ArgumentPattern): boolean {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean' &&
    typeof value !== 'bigint'
  ) {
    return false;
  }

  const str = `${value}`;
  switch (pattern.operator) {
    case 'eq':
      return str === pattern.value;
    case 'contains':
      return str.includes(pattern.value);
    case 'glob':
      return globToRegex(pattern.value).test(str);
    case 'regex':
      return new RegExp(pattern.value).test(str);
    default:
      return false;
  }
}

function ruleMatchesScope(
  rule: ToolApprovalRule,
  context: RuleContext,
  ancestorIds: Set<string>,
): boolean {
  switch (rule.scopeType) {
    case 'global':
      return true;
    case 'project':
      return context.scopeId === rule.scopeId;
    case 'scope_node':
      return rule.scopeId !== null && ancestorIds.has(rule.scopeId);
    case 'agent_profile':
      return context.agentProfile === rule.scopeId;
    case 'workflow_run':
      return context.workflowRunId === rule.scopeId;
    case 'chat_session':
      return context.chatSessionId === rule.scopeId;
    default:
      return false;
  }
}

function scopePriority(scopeType: ToolApprovalRule['scopeType']): number {
  switch (scopeType) {
    case 'workflow_run':
      return 5;
    case 'chat_session':
      return 4;
    case 'project':
      return 3;
    case 'agent_profile':
      return 2;
    case 'scope_node':
      return 2.5;
    case 'global':
      return 1;
    default:
      return 0;
  }
}

@Injectable()
export class ToolApprovalRuleService {
  constructor(
    private readonly ruleRepo: ToolApprovalRuleRepository,
    private readonly scope: ScopeService,
  ) {}

  async listRules(params: {
    scopeType?: ToolApprovalRule['scopeType'];
    scopeId?: string;
    toolName?: string;
    effect?: ToolApprovalRuleEffect;
  }): Promise<ToolApprovalRule[]> {
    return this.ruleRepo.findByFilters(params);
  }

  async getRuleOrThrow(id: string): Promise<ToolApprovalRule> {
    const rule = await this.ruleRepo.findOne({ where: { id } });
    if (!rule) {
      throw new NotFoundException(`Tool approval rule ${id} not found`);
    }
    return rule;
  }

  async createRule(params: {
    scopeType: ToolApprovalRule['scopeType'];
    scopeId?: string | null;
    toolName: string;
    effect: ToolApprovalRuleEffect;
    priority?: number;
    argumentPatterns?: ArgumentPattern[] | null;
    createdBy?: string | null;
    expiresAt?: Date | null;
  }): Promise<ToolApprovalRule> {
    const normalized = this.normalizeAndValidateRuleInput({
      scopeType: params.scopeType,
      scopeId: params.scopeId ?? null,
      toolName: params.toolName,
      effect: params.effect,
      priority: params.priority,
      argumentPatterns: params.argumentPatterns ?? null,
      expiresAt: params.expiresAt ?? null,
    });

    const rule = this.ruleRepo.create({
      scopeType: normalized.scopeType,
      scopeId: normalized.scopeId,
      toolName: normalized.toolName,
      effect: normalized.effect,
      priority: normalized.priority,
      argumentPatterns: normalized.argumentPatterns,
      createdBy: params.createdBy ?? null,
      expiresAt: normalized.expiresAt,
    });
    return this.ruleRepo.save(rule);
  }

  async updateRule(
    id: string,
    params: {
      scopeType?: ToolApprovalRule['scopeType'];
      scopeId?: string | null;
      toolName?: string;
      effect?: ToolApprovalRuleEffect;
      priority?: number;
      argumentPatterns?: ArgumentPattern[] | null;
      expiresAt?: Date | null;
    },
  ): Promise<ToolApprovalRule> {
    const existing = await this.getRuleOrThrow(id);
    const normalized = this.normalizeAndValidateRuleInput({
      scopeType: params.scopeType ?? existing.scopeType,
      scopeId: this.resolveUpdatedValue(
        params.scopeId,
        existing.scopeId ?? null,
      ),
      toolName: params.toolName ?? existing.toolName,
      effect: params.effect ?? existing.effect,
      priority: params.priority ?? existing.priority,
      argumentPatterns: this.resolveUpdatedValue(
        params.argumentPatterns,
        existing.argumentPatterns ?? null,
      ),
      expiresAt: this.resolveUpdatedValue(params.expiresAt, existing.expiresAt),
    });

    existing.scopeType = normalized.scopeType;
    existing.scopeId = normalized.scopeId;
    existing.toolName = normalized.toolName;
    existing.effect = normalized.effect;
    existing.priority = normalized.priority;
    existing.argumentPatterns = normalized.argumentPatterns;
    existing.expiresAt = normalized.expiresAt;

    return this.ruleRepo.save(existing);
  }

  async deleteRule(id: string): Promise<void> {
    const rule = await this.getRuleOrThrow(id);
    await this.ruleRepo.remove(rule);
  }

  async resolveToolEffectPreflight(
    context: RuleContext,
    toolName: string,
  ): Promise<ToolApprovalRuleEffect | null> {
    const rules = await this.ruleRepo.findActiveByToolName(toolName);
    const ancestorIds = await this.resolveAncestorIds(rules, context);
    const matching = this.findBestMatchingRule(
      rules,
      context,
      null,
      ancestorIds,
    );
    return matching?.effect ?? null;
  }

  async resolveToolEffectExecution(
    context: RuleContext,
    toolName: string,
    payload: Record<string, unknown>,
  ): Promise<ToolApprovalRuleEffect | null> {
    const rules = await this.ruleRepo.findActiveByToolName(toolName);
    const ancestorIds = await this.resolveAncestorIds(rules, context);
    const matching = this.findBestMatchingRule(
      rules,
      context,
      payload,
      ancestorIds,
    );
    return matching?.effect ?? null;
  }

  async createRuleFromApproval(params: {
    context: RuleContext;
    toolName: string;
    argumentPatterns: ArgumentPattern[];
    effect: ToolApprovalRuleEffect;
    createdBy: string;
    scopeType: ToolApprovalRule['scopeType'];
    expiresAt?: Date | null;
  }): Promise<ToolApprovalRule> {
    this.validateArgumentPatterns(params.argumentPatterns);
    const rule = this.ruleRepo.create({
      scopeType: params.scopeType,
      scopeId: this.resolveScopeId(params.context, params.scopeType),
      toolName: params.toolName,
      effect: params.effect,
      priority: 0,
      argumentPatterns: params.argumentPatterns,
      createdBy: params.createdBy,
      expiresAt: params.expiresAt ?? null,
    });
    return this.ruleRepo.save(rule);
  }

  private resolveScopeId(
    context: RuleContext,
    scopeType: ToolApprovalRule['scopeType'],
  ): string | null {
    switch (scopeType) {
      case 'project':
        return context.scopeId ?? null;
      case 'agent_profile':
        return context.agentProfile ?? null;
      case 'workflow_run':
        return context.workflowRunId ?? null;
      case 'chat_session':
        return context.chatSessionId ?? null;
      default:
        return null;
    }
  }

  private async resolveAncestorIds(
    rules: ToolApprovalRule[],
    context: RuleContext,
  ): Promise<Set<string>> {
    const hasScopeNodeRule = rules.some((r) => r.scopeType === 'scope_node');
    if (!hasScopeNodeRule || !context.scopeId) return new Set<string>();
    return new Set(await this.scope.getAncestorIds(context.scopeId));
  }

  private findBestMatchingRule(
    rules: ToolApprovalRule[],
    context: RuleContext,
    payload: Record<string, unknown> | null,
    ancestorIds: Set<string>,
  ): ToolApprovalRule | null {
    const scoped = rules.filter((r) =>
      ruleMatchesScope(r, context, ancestorIds),
    );
    scoped.sort((a, b) => {
      const scopeDiff = scopePriority(b.scopeType) - scopePriority(a.scopeType);
      if (scopeDiff !== 0) return scopeDiff;
      return b.priority - a.priority;
    });

    if (payload === null) {
      const hasArgumentRules = scoped.some(
        (r) => r.argumentPatterns && r.argumentPatterns.length > 0,
      );
      const firstNoPattern = scoped.find(
        (r) => !r.argumentPatterns || r.argumentPatterns.length === 0,
      );

      if (firstNoPattern?.effect === 'deny' && hasArgumentRules) {
        return null;
      }
      if (firstNoPattern) return firstNoPattern;
      return null;
    }

    for (const rule of scoped) {
      if (!rule.argumentPatterns || rule.argumentPatterns.length === 0) {
        return rule;
      }
      if (
        rule.argumentPatterns.every((p) => matchesPattern(payload[p.path], p))
      ) {
        return rule;
      }
    }
    return null;
  }

  private normalizeAndValidateRuleInput(params: {
    scopeType: ToolApprovalRule['scopeType'];
    scopeId: string | null;
    toolName: string;
    effect: ToolApprovalRuleEffect;
    priority?: number;
    argumentPatterns: ArgumentPattern[] | null;
    expiresAt: Date | null;
  }): {
    scopeType: ToolApprovalRule['scopeType'];
    scopeId: string | null;
    toolName: string;
    effect: ToolApprovalRuleEffect;
    priority: number;
    argumentPatterns: ArgumentPattern[] | null;
    expiresAt: Date | null;
  } {
    const toolName = this.normalizeToolName(params.toolName);
    const scopeId = this.normalizeScopeId(params.scopeType, params.scopeId);
    const priority = this.normalizePriority(params.priority);
    const expiresAt = this.normalizeExpiresAt(params.expiresAt);

    this.validateArgumentPatterns(params.argumentPatterns ?? []);

    return {
      scopeType: params.scopeType,
      scopeId,
      toolName,
      effect: params.effect,
      priority,
      argumentPatterns: params.argumentPatterns,
      expiresAt,
    };
  }

  private normalizeToolName(toolName: string): string {
    const normalized = toolName.trim();
    if (normalized.length === 0) {
      throw new BadRequestException('toolName must be a non-empty string');
    }
    return normalized;
  }

  private normalizeScopeId(
    scopeType: ToolApprovalRule['scopeType'],
    scopeId: string | null,
  ): string | null {
    if (scopeType === 'global') {
      return null;
    }

    const normalized = scopeId?.trim() ?? null;
    if (!normalized) {
      throw new BadRequestException(
        `scopeId is required for scopeType ${scopeType}`,
      );
    }

    return normalized;
  }

  private normalizePriority(priority = 0): number {
    const normalized = priority;
    if (!Number.isInteger(normalized)) {
      throw new BadRequestException('priority must be an integer');
    }
    return normalized;
  }

  private normalizeExpiresAt(expiresAt: Date | null): Date | null {
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('expiresAt must be a valid date');
    }
    return expiresAt;
  }

  private validateArgumentPatterns(patterns: ArgumentPattern[]): void {
    for (const pattern of patterns) {
      const path = pattern.path.trim();
      if (path.length === 0) {
        throw new BadRequestException(
          'argument pattern path must be a non-empty string',
        );
      }

      if (pattern.value.trim().length === 0) {
        throw new BadRequestException(
          `argument pattern value must be non-empty for path ${path}`,
        );
      }

      if (pattern.operator === 'regex') {
        try {
          const compiledRegex = new RegExp(pattern.value);
          if (!compiledRegex.source) {
            throw new Error('regex missing source');
          }
        } catch {
          throw new BadRequestException(
            `invalid regex argument pattern for path ${path}`,
          );
        }
      }
    }
  }

  private resolveUpdatedValue<T>(
    nextValue: T | undefined,
    fallbackValue: T,
  ): T {
    if (nextValue !== undefined) {
      return nextValue;
    }

    return fallbackValue;
  }
}
