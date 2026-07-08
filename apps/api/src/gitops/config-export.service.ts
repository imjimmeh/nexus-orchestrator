import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { stringify as toYaml } from 'yaml';
import {
  GITOPS_API_VERSION,
  serializeDesiredState,
  type DesiredState,
  type RoleDoc,
  type AgentProfileDoc,
  type WorkflowDoc,
  type SkillDoc,
  type AgentOverrideDoc,
  type WorkflowOverrideDoc,
  type SkillOverrideDoc,
} from '@nexus/gitops-contracts';
import { ScopeService } from '../scope/scope.service';
import { GLOBAL_SCOPE_NODE_ID } from '../scope/scope.constants';
import { ScopeNode } from '../scope/database/entities/scope-node.entity';
import { Role } from '../auth/database/entities/role.entity';
import { RoleAssignment } from '../auth/database/entities/role-assignment.entity';
import { Workflow } from '../workflow/database/entities/workflow.entity';
import { AgentProfile } from '../ai-config/database/entities/agent-profile.entity';
import { Skill } from '../ai-config/database/entities/skill.entity';
import type { ExportedFile } from './config-export.service.types';

interface RolePermissionRow {
  role_id: string;
  name: string;
}

interface AssignmentRow {
  scope_node_id: string;
  username: string;
  role_name: string;
}

function fromDbArray(
  value: string | string[] | null | undefined,
): string[] | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return null;
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function scopedOnly<T extends { scope_node_id: string | null }>(
  rows: T[],
  idToPath: Map<string, string>,
): T[] {
  return rows.filter(
    (row) => row.scope_node_id != null && idToPath.has(row.scope_node_id),
  );
}

function defaultOnly<T extends { scope_node_id: string | null }>(
  rows: T[],
): T[] {
  return rows.filter((row) => row.scope_node_id == null);
}

function toAgentDefinition(agent: AgentProfile): AgentProfileDoc {
  return {
    apiVersion: GITOPS_API_VERSION,
    kind: 'AgentProfile',
    name: agent.name,
    source: agent.source,
    locked: agent.locked,
    definition: {
      system_prompt: agent.system_prompt ?? null,
      model_name: agent.model_name ?? null,
      provider_name: agent.provider_name ?? null,
      provider_id: agent.provider_id ?? null,
      provider_source: agent.provider_source ?? null,
      tier_preference: agent.tier_preference ?? null,
      supports_vision: agent.supports_vision ?? null,
      allowed_mount_aliases: fromDbArray(agent.allowed_mount_aliases),
      denied_mount_aliases: fromDbArray(agent.denied_mount_aliases),
      allow_rw_mount_aliases: fromDbArray(agent.allow_rw_mount_aliases),
      assigned_skills: fromDbArray(agent.assigned_skills),
      tool_policy: agent.tool_policy ?? null,
    },
  };
}

function toWorkflowDefinition(workflow: Workflow): WorkflowDoc {
  return {
    apiVersion: GITOPS_API_VERSION,
    kind: 'Workflow',
    name: workflow.name,
    source: workflow.source,
    locked: workflow.locked,
    definition: { yaml_definition: workflow.yaml_definition },
  };
}

function toSkillDefinition(skill: Skill): SkillDoc {
  return {
    apiVersion: GITOPS_API_VERSION,
    kind: 'Skill',
    name: skill.name,
    source: skill.source,
    locked: skill.locked,
    definition: {
      description: skill.description,
      skill_markdown: skill.skill_markdown,
      category: skill.category ?? null,
      tags: fromDbArray(skill.tags),
      metadata: skill.metadata ?? null,
      version: skill.version,
    },
  };
}

function toAgentOverride(
  agent: AgentProfile,
  idToPath: Map<string, string>,
): AgentOverrideDoc {
  return {
    apiVersion: GITOPS_API_VERSION,
    kind: 'AgentOverride',
    name: agent.name,
    scope: idToPath.get(agent.scope_node_id ?? '') ?? '/',
    source: agent.source,
    locked: agent.locked,
    strategy: agent.overrides ? 'merge' : 'replace',
    definition: agent.overrides
      ? null
      : { tool_policy: agent.tool_policy ?? null },
    overrides: agent.overrides ?? null,
  };
}

function toWorkflowOverride(
  workflow: Workflow,
  idToPath: Map<string, string>,
): WorkflowOverrideDoc {
  return {
    apiVersion: GITOPS_API_VERSION,
    kind: 'WorkflowOverride',
    name: workflow.name,
    scope: idToPath.get(workflow.scope_node_id ?? '') ?? '/',
    source: workflow.source,
    locked: workflow.locked,
    strategy: workflow.overrides ? 'merge' : 'replace',
    definition: workflow.overrides
      ? null
      : { yaml_definition: workflow.yaml_definition },
    overrides: workflow.overrides ?? null,
  };
}

function toSkillOverride(
  skill: Skill,
  idToPath: Map<string, string>,
): SkillOverrideDoc {
  return {
    apiVersion: GITOPS_API_VERSION,
    kind: 'SkillOverride',
    name: skill.name,
    scope: idToPath.get(skill.scope_node_id ?? '') ?? '/',
    source: skill.source,
    locked: skill.locked,
    strategy: skill.overrides ? 'merge' : 'replace',
    definition: skill.overrides
      ? null
      : { skill_markdown: skill.skill_markdown },
    overrides: skill.overrides ?? null,
  };
}

@Injectable()
export class ConfigExportService {
  constructor(
    private readonly scopeService: ScopeService,
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(RoleAssignment)
    private readonly assignmentRepo: Repository<RoleAssignment>,
    @InjectRepository(Workflow)
    private readonly workflowRepo: Repository<Workflow>,
    @InjectRepository(AgentProfile)
    private readonly agentRepo: Repository<AgentProfile>,
    @InjectRepository(Skill) private readonly skillRepo: Repository<Skill>,
  ) {}

  async exportToFiles(): Promise<ExportedFile[]> {
    const { idToPath, nodes } = await this.buildScopePathMap();
    const state = await this.buildDesiredState(idToPath, nodes);
    return serializeDesiredState(state).map((f) => ({
      path: f.path,
      yaml: toYaml(f.content),
    }));
  }

  private async buildScopePathMap(): Promise<{
    idToPath: Map<string, string>;
    nodes: ScopeNode[];
  }> {
    const descendantIds =
      await this.scopeService.getDescendantIds(GLOBAL_SCOPE_NODE_ID);
    const allIds = Array.from(
      new Set([GLOBAL_SCOPE_NODE_ID, ...descendantIds]),
    );
    const nodes = await this.scopeService.getNodesByIds(allIds);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const cache = new Map<string, string>();

    const pathOf = (id: string): string => {
      if (id === GLOBAL_SCOPE_NODE_ID) return '/';
      const cached = cache.get(id);
      if (cached) return cached;
      const node = byId.get(id);
      if (!node) return '/';
      const parentPath = node.parentId ? pathOf(node.parentId) : '/';
      const p =
        parentPath === '/' ? `/${node.slug}` : `${parentPath}/${node.slug}`;
      cache.set(id, p);
      return p;
    };

    const idToPath = new Map<string, string>();
    for (const n of nodes) idToPath.set(n.id, pathOf(n.id));
    return { idToPath, nodes };
  }

  private async buildDesiredState(
    idToPath: Map<string, string>,
    nodes: ScopeNode[],
  ): Promise<DesiredState> {
    const placedNodes = nodes.map((n) => ({
      path: idToPath.get(n.id) ?? '/',
      doc: {
        apiVersion: GITOPS_API_VERSION,
        kind: 'ScopeNode' as const,
        type: n.type,
        name: n.name,
        slug: n.slug,
        metadata: n.metadata ?? null,
      },
    }));

    const allRoles = await this.roleRepo.find();
    const customRoles = allRoles.filter((r) => r.ownerScopeNodeId != null);

    const permRows: RolePermissionRow[] = await this.roleRepo.query(
      `SELECT rp.role_id, p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id`,
    );
    const permsByRole = new Map<string, string[]>();
    for (const row of permRows) {
      const list = permsByRole.get(row.role_id) ?? [];
      list.push(row.name);
      permsByRole.set(row.role_id, list);
    }

    const roleDocs: RoleDoc[] = customRoles.map((r) => ({
      apiVersion: GITOPS_API_VERSION,
      kind: 'Role',
      name: r.name,
      description: r.description ?? undefined,
      ownerScope: r.ownerScopeNodeId
        ? (idToPath.get(r.ownerScopeNodeId) ?? null)
        : null,
      permissions: permsByRole.get(r.id) ?? [],
    }));

    const assignmentRows: AssignmentRow[] = await this.assignmentRepo.query(
      `SELECT u.username, ro.name AS role_name, ra.scope_node_id
         FROM role_assignments ra
         JOIN users u ON u.id = ra.user_id
         JOIN roles ro ON ro.id = ra.role_id`,
    );
    const assignments = assignmentRows
      .filter((a) => idToPath.has(a.scope_node_id))
      .map((a) => ({
        user: a.username,
        role: a.role_name,
        scope: idToPath.get(a.scope_node_id) ?? '/',
      }));

    const agentRows = await this.agentRepo.find();
    const workflowRows = await this.workflowRepo.find();
    const skillRows = await this.skillRepo.find();

    const agents = defaultOnly(agentRows).map(toAgentDefinition);
    const workflows = defaultOnly(workflowRows).map(toWorkflowDefinition);
    const skills = defaultOnly(skillRows).map(toSkillDefinition);

    const agentOverrides = scopedOnly(agentRows, idToPath).map((agent) =>
      toAgentOverride(agent, idToPath),
    );
    const workflowOverrides = scopedOnly(workflowRows, idToPath).map(
      (workflow) => toWorkflowOverride(workflow, idToPath),
    );
    const skillOverrides = scopedOnly(skillRows, idToPath).map((skill) =>
      toSkillOverride(skill, idToPath),
    );

    return {
      apiVersion: GITOPS_API_VERSION,
      nodes: placedNodes,
      roles: roleDocs,
      assignments,
      agents,
      workflows,
      skills,
      agentOverrides,
      workflowOverrides,
      skillOverrides,
    };
  }
}
