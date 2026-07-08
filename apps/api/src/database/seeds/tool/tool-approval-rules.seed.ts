import { Injectable, Logger } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ToolApprovalRule } from '../../../tool/database/entities/tool-approval-rule.entity';
import type {
  ArgumentPattern,
  ToolApprovalRuleEffect,
  ToolApprovalRuleScope,
} from '../../../tool/database/entities/tool-approval-rule.types';
import { ToolApprovalRuleRepository } from '../../../tool/database/repositories/tool-approval-rule.repository';

const TOOL_APPROVAL_RULES_SEED_PATH = 'seed/tool-approval-rules';
const TOOL_APPROVAL_RULES_FILE_EXTENSION = '.json';

const VALID_TOOL_APPROVAL_SCOPES = new Set<ToolApprovalRuleScope>([
  'global',
  'project',
  'agent_profile',
  'workflow_run',
  'chat_session',
]);

const VALID_TOOL_APPROVAL_EFFECTS = new Set<ToolApprovalRuleEffect>([
  'allow',
  'deny',
  'require_approval',
]);

const VALID_ARGUMENT_OPERATORS = new Set<ArgumentPattern['operator']>([
  'eq',
  'contains',
  'regex',
  'glob',
]);

type ToolApprovalRuleSeed = Pick<
  ToolApprovalRule,
  'scopeType' | 'toolName' | 'effect' | 'priority' | 'argumentPatterns'
> & { scopeId: string | null };

@Injectable()
export class ToolApprovalRulesSeedService {
  private readonly logger = new Logger(ToolApprovalRulesSeedService.name);
  private readonly configuredSeedPath: string | null;

  constructor(private readonly repository: ToolApprovalRuleRepository) {
    this.configuredSeedPath =
      process.env.NEXUS_TOOL_APPROVAL_RULES_SEED_PATH?.trim() || null;
  }

  async seed(): Promise<void> {
    const rules = this.loadRuleDefinitions();

    for (const rule of rules) {
      await this.upsertRule(rule);
    }
  }

  private async upsertRule(rule: ToolApprovalRuleSeed): Promise<void> {
    const scopeIdFilter = rule.scopeId === null ? IsNull() : rule.scopeId;

    const existing = await this.repository.findOne({
      where: {
        scopeType: rule.scopeType,
        scopeId: scopeIdFilter,
        toolName: rule.toolName,
        priority: rule.priority,
      },
    });

    if (existing) {
      await this.repository.save(Object.assign(existing, rule));
      this.logger.log(
        `Updated tool approval rule: ${rule.scopeId}:${rule.toolName}:${rule.priority}`,
      );
      return;
    }

    await this.repository.save(this.repository.create(rule));
    this.logger.log(
      `Created tool approval rule: ${rule.scopeId}:${rule.toolName}:${rule.priority}`,
    );
  }

  private loadRuleDefinitions(): ToolApprovalRuleSeed[] {
    const seedDir = this.resolveSeedDirectory();
    if (!seedDir) {
      return [];
    }

    const definitions: ToolApprovalRuleSeed[] = [];
    const files = this.listSeedFiles(seedDir);

    for (const file of files) {
      const filePath = path.join(seedDir, file);
      const fileDefinitions = this.loadSeedFile(filePath);
      if (!fileDefinitions) {
        continue;
      }

      definitions.push(...fileDefinitions);
    }

    return definitions;
  }

  private loadSeedFile(filePath: string): ToolApprovalRuleSeed[] | null {
    const parsed = this.parseSeedFile(filePath);
    if (!parsed) {
      return null;
    }

    return parsed;
  }

  private parseSeedFile(filePath: string): ToolApprovalRuleSeed[] | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      const result = this.validateSeedDefinition(filePath, parsed);
      if (result === null) {
        return null;
      }

      if (result.length > 0) {
        return result;
      }

      this.logger.warn(
        `Skipping empty tool approval rule seed: ${filePath} has no rule entries`,
      );
      return [];
    } catch (error) {
      const err = error as Error;
      this.logger.warn(
        `Failed to parse tool approval rule seed ${filePath}: ${err.message}`,
      );
      return null;
    }
  }

  private validateSeedDefinition(
    filePath: string,
    raw: unknown,
  ): ToolApprovalRuleSeed[] | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      this.logger.warn(
        `Skipping tool approval rule seed ${filePath}: seed must be a JSON object`,
      );
      return null;
    }

    const record = raw as Record<string, unknown>;

    const scopeType = this.parseScopeType(record.scopeType, filePath);
    if (!scopeType) {
      return null;
    }

    const scopeId = this.parseScopeId(record.scopeId, scopeType, filePath);
    if (scopeType !== 'global' && !scopeId) {
      return null;
    }

    const toolName = this.parseStringValue(
      record.toolName,
      'toolName',
      filePath,
    );
    if (!toolName) {
      return null;
    }

    if (!Array.isArray(record.rules)) {
      this.logger.warn(
        `Skipping tool approval rule seed ${filePath}: rules must be an array`,
      );
      return null;
    }

    const rules: ToolApprovalRuleSeed[] = [];
    for (const rawRule of record.rules) {
      const rule = this.parseRule(
        rawRule,
        { scopeType, scopeId, toolName },
        filePath,
      );
      if (!rule) {
        return null;
      }

      rules.push(rule);
    }

    return rules;
  }

  private parseRule(
    rawRule: unknown,
    base: Pick<ToolApprovalRuleSeed, 'scopeType' | 'scopeId' | 'toolName'>,
    filePath: string,
  ): ToolApprovalRuleSeed | null {
    if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) {
      this.logger.warn(
        `Skipping tool approval rule seed ${filePath}: each rule entry must be an object`,
      );
      return null;
    }

    const rule = rawRule as Record<string, unknown>;

    const effect = this.parseEffect(rule.effect, filePath);
    if (!effect) {
      return null;
    }

    if (typeof rule.priority !== 'number' || !Number.isInteger(rule.priority)) {
      this.logger.warn(
        `Skipping tool approval rule seed ${filePath}: rule priority must be an integer`,
      );
      return null;
    }

    const argumentPatterns = this.parseArgumentPatterns(
      rule.argumentPatterns,
      filePath,
    );
    if (argumentPatterns === undefined) {
      return null;
    }

    return {
      ...base,
      effect,
      priority: rule.priority,
      argumentPatterns,
    };
  }

  private parseScopeType(
    value: unknown,
    filePath: string,
  ): ToolApprovalRuleScope | null {
    if (
      typeof value === 'string' &&
      VALID_TOOL_APPROVAL_SCOPES.has(value as ToolApprovalRuleScope)
    ) {
      return value as ToolApprovalRuleScope;
    }

    this.logger.warn(
      `Skipping tool approval rule seed ${filePath}: scopeType must be a valid scope`,
    );
    return null;
  }

  private parseScopeId(
    value: unknown,
    scopeType: ToolApprovalRuleScope,
    filePath: string,
  ): string | null {
    if (scopeType === 'global') {
      return null;
    }

    return this.parseStringValue(value, 'scopeId', filePath);
  }

  private parseStringValue(
    value: unknown,
    fieldName: 'scopeId' | 'toolName',
    filePath: string,
  ): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    this.logger.warn(
      `Skipping tool approval rule seed ${filePath}: ${fieldName} must be a non-empty string`,
    );
    return null;
  }

  private parseEffect(
    value: unknown,
    filePath: string,
  ): ToolApprovalRuleEffect | null {
    if (
      typeof value === 'string' &&
      VALID_TOOL_APPROVAL_EFFECTS.has(value as ToolApprovalRuleEffect)
    ) {
      return value as ToolApprovalRuleEffect;
    }

    this.logger.warn(
      `Skipping tool approval rule seed ${filePath}: effect must be one of allow, deny, or require_approval`,
    );
    return null;
  }

  private parseArgumentPatterns(
    rawPatterns: unknown,
    filePath: string,
  ): ArgumentPattern[] | null | undefined {
    if (rawPatterns === null) {
      return null;
    }

    if (!Array.isArray(rawPatterns)) {
      this.logger.warn(
        `Skipping tool approval rule seed ${filePath}: argumentPatterns must be null or an array`,
      );
      return undefined;
    }

    const argumentPatterns: ArgumentPattern[] = [];
    for (const pattern of rawPatterns) {
      if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern)) {
        this.logger.warn(
          `Skipping tool approval rule seed ${filePath}: argumentPatterns entries must have path, operator, and value`,
        );
        return undefined;
      }

      const rulePattern = pattern as Record<string, unknown>;
      const trimmedPath = this.parseRequiredPatternString(
        rulePattern.path,
        filePath,
      );
      if (!trimmedPath) {
        return undefined;
      }

      const operator = rulePattern.operator;
      if (typeof operator !== 'string') {
        this.logger.warn(
          `Skipping tool approval rule seed ${filePath}: argumentPatterns entries must have path, operator, and value`,
        );
        return undefined;
      }

      if (
        !VALID_ARGUMENT_OPERATORS.has(operator as ArgumentPattern['operator'])
      ) {
        this.logger.warn(
          `Skipping tool approval rule seed ${filePath}: unsupported argument pattern operator`,
        );
        return undefined;
      }

      const trimmedValue = this.parseRequiredPatternString(
        rulePattern.value,
        filePath,
      );
      if (!trimmedValue) {
        return undefined;
      }

      if (operator === 'regex') {
        try {
          new RegExp(trimmedValue);
        } catch {
          this.logger.warn(
            `Skipping tool approval rule seed ${filePath}: argumentPatterns has invalid regex value`,
          );
          return undefined;
        }
      }

      argumentPatterns.push({
        path: trimmedPath,
        operator: operator as ArgumentPattern['operator'],
        value: trimmedValue,
      });
    }

    return argumentPatterns;
  }

  private parseRequiredPatternString(
    value: unknown,
    filePath: string,
  ): string | null {
    if (typeof value !== 'string') {
      this.logger.warn(
        `Skipping tool approval rule seed ${filePath}: argumentPatterns entries must have path, operator, and value`,
      );
      return null;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      this.logger.warn(
        `Skipping tool approval rule seed ${filePath}: argumentPatterns entries must have path, operator, and value`,
      );
      return null;
    }

    return trimmed;
  }

  private resolveSeedDirectory(): string | undefined {
    const candidates = this.listSeedDirectoryCandidates();

    return candidates.find((candidate) => {
      if (!fs.existsSync(candidate)) {
        return false;
      }

      if (!fs.statSync(candidate).isDirectory()) {
        return false;
      }

      return this.listSeedFiles(candidate).length > 0;
    });
  }

  private listSeedDirectoryCandidates(): string[] {
    return [
      this.configuredSeedPath,
      path.join(process.cwd(), TOOL_APPROVAL_RULES_SEED_PATH),
      path.join(process.cwd(), '..', TOOL_APPROVAL_RULES_SEED_PATH),
      path.join(process.cwd(), '..', '..', TOOL_APPROVAL_RULES_SEED_PATH),
      path.resolve(
        __dirname,
        `../../../../../../${TOOL_APPROVAL_RULES_SEED_PATH}`,
      ),
    ].filter((candidate): candidate is string => Boolean(candidate));
  }

  private listSeedFiles(seedDir: string): string[] {
    return fs
      .readdirSync(seedDir)
      .filter((file) => file.endsWith(TOOL_APPROVAL_RULES_FILE_EXTENSION))
      .sort((a, b) => a.localeCompare(b));
  }
}

export async function seedToolApprovalRules(
  dataSource: DataSource,
): Promise<void> {
  const service = new ToolApprovalRulesSeedService(
    new ToolApprovalRuleRepository(dataSource),
  );
  await service.seed();
}
