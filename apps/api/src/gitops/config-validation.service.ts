import { Injectable } from '@nestjs/common';
import {
  parseDesiredStateFiles,
  validateDesiredState,
  type ValidationResult,
  type DesiredState as ContractsDesiredState,
  type ValidationContext,
} from '@nexus/gitops-contracts';
import type { DesiredObject, DesiredState } from './reconciliation.types';
import type {
  GitOpsFileLoader,
  ValidationContextProvider,
  GitOpsLoadYamlTreeOptions,
} from './config-validation.service.types';

@Injectable()
export class ConfigValidationService {
  constructor(
    private readonly fileLoader: GitOpsFileLoader,
    private readonly contextProvider: ValidationContextProvider,
  ) {}

  async lint(
    dir: string,
    context?: ValidationContext,
    loadOptions?: GitOpsLoadYamlTreeOptions,
  ): Promise<ValidationResult> {
    const files = await this.fileLoader.loadYamlTree(dir, loadOptions);
    const parsed = parseDesiredStateFiles(files);
    if (!parsed.ok) {
      return {
        ok: false,
        errors: parsed.errors.map((e) => ({
          code: 'schema.invalid',
          ref: e.path,
          message: e.message,
        })),
      };
    }
    const ctx = await this.resolveContext(context);
    return validateDesiredState(parsed.state, ctx);
  }

  async loadAndValidate(
    dir: string,
    context?: ValidationContext,
    loadOptions?: GitOpsLoadYamlTreeOptions,
  ): Promise<DesiredState> {
    const files = await this.fileLoader.loadYamlTree(dir, loadOptions);
    const parsed = parseDesiredStateFiles(files);
    if (!parsed.ok) {
      throw new Error(parsed.errors.map((e) => e.message).join('; '));
    }
    const ctx = await this.resolveContext(context);
    const result = validateDesiredState(parsed.state, ctx);
    if (!result.ok) {
      throw new Error(result.errors.map((e) => e.message).join('; '));
    }
    return this.toLocalDesiredState(parsed.state);
  }

  private toLocalDesiredState(state: ContractsDesiredState): DesiredState {
    const objects: DesiredObject[] = [];

    for (const node of state.nodes) {
      objects.push({
        type: 'scope_node',
        key: node.path,
        fields: { ...node.doc },
      });
    }

    for (const role of state.roles) {
      objects.push({
        type: 'role',
        key: role.name,
        fields: { ...role },
      });
    }

    for (const assignment of state.assignments) {
      objects.push({
        type: 'role_assignment',
        key: `${assignment.user}:${assignment.role}:${assignment.scope}`,
        fields: { ...assignment },
      });
    }

    for (const agent of state.agents) {
      objects.push({
        type: 'agent_profile',
        key: agent.name,
        fields: this.agentDefinitionFields(agent),
      });
    }

    for (const workflow of state.workflows) {
      objects.push({
        type: 'workflow',
        key: workflow.name,
        fields: this.workflowDefinitionFields(workflow),
      });
    }

    for (const skill of state.skills) {
      objects.push({
        type: 'skill',
        key: skill.name,
        fields: this.skillDefinitionFields(skill),
      });
    }

    for (const override of state.agentOverrides) {
      objects.push({
        type: 'agent_profile',
        key: this.configObjectKey(override.scope, override.name),
        fields: { ...override },
      });
    }

    for (const override of state.workflowOverrides) {
      objects.push({
        type: 'workflow',
        key: this.configObjectKey(override.scope, override.name),
        fields: { ...override },
      });
    }

    for (const override of state.skillOverrides) {
      objects.push({
        type: 'skill',
        key: this.configObjectKey(override.scope, override.name),
        fields: { ...override },
      });
    }

    return { prune: false, objects };
  }

  private configObjectKey(
    scope: string | null | undefined,
    name: string,
  ): string {
    return scope ? `${scope}:${name}` : name;
  }

  private agentDefinitionFields(
    agent: ContractsDesiredState['agents'][number],
  ): Record<string, unknown> {
    return {
      name: agent.name,
      scope: null,
      strategy: 'replace',
      source: agent.source,
      locked: agent.locked,
      systemPrompt: agent.definition['system_prompt'] ?? null,
      modelName: agent.definition['model_name'] ?? null,
      providerName: agent.definition['provider_name'] ?? null,
      providerId: agent.definition['provider_id'] ?? null,
      providerSource: agent.definition['provider_source'] ?? null,
      tierPreference: agent.definition['tier_preference'] ?? null,
      supportsVision: agent.definition['supports_vision'] ?? null,
      allowedMountAliases: agent.definition['allowed_mount_aliases'] ?? null,
      deniedMountAliases: agent.definition['denied_mount_aliases'] ?? null,
      allowRwMountAliases: agent.definition['allow_rw_mount_aliases'] ?? null,
      assignedSkills: agent.definition['assigned_skills'] ?? null,
      toolPolicy: agent.definition['tool_policy'] ?? null,
    };
  }

  private workflowDefinitionFields(
    workflow: ContractsDesiredState['workflows'][number],
  ): Record<string, unknown> {
    return {
      name: workflow.name,
      scope: null,
      strategy: 'replace',
      source: workflow.source,
      locked: workflow.locked,
      definition: workflow.definition['yaml_definition'] ?? '',
    };
  }

  private skillDefinitionFields(
    skill: ContractsDesiredState['skills'][number],
  ): Record<string, unknown> {
    return {
      name: skill.name,
      scope: null,
      strategy: 'replace',
      source: skill.source,
      locked: skill.locked,
      description: skill.definition['description'] ?? '',
      skillMarkdown: skill.definition['skill_markdown'] ?? '',
      category: skill.definition['category'] ?? null,
      tags: skill.definition['tags'] ?? null,
      metadata: skill.definition['metadata'] ?? null,
      version: skill.definition['version'] ?? 1,
    };
  }

  private async resolveContext(
    context?: ValidationContext,
  ): Promise<ValidationContext> {
    return context ?? (await this.contextProvider.build());
  }
}
