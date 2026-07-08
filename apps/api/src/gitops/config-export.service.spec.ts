import { describe, it, expect, vi } from 'vitest';
import { ConfigExportService } from './config-export.service';
import { GLOBAL_SCOPE_NODE_ID } from '../scope/scope.constants';

const ROOT = GLOBAL_SCOPE_NODE_ID;
const ACME = 'acme-uuid';
const WEB = 'web-uuid';

function makeDeps() {
  const scopeService = {
    getDescendantIds: vi.fn().mockResolvedValue([ROOT, ACME, WEB]),
    getNodesByIds: vi.fn().mockResolvedValue([
      {
        id: ROOT,
        parentId: null,
        type: 'platform',
        name: 'Platform',
        slug: 'platform',
        metadata: null,
      },
      {
        id: ACME,
        parentId: ROOT,
        type: 'org',
        name: 'Acme',
        slug: 'acme',
        metadata: null,
      },
      {
        id: WEB,
        parentId: ACME,
        type: 'project',
        name: 'Web App',
        slug: 'web-app',
        metadata: null,
      },
    ]),
  } as any;
  const roleRepo = {
    find: vi.fn().mockResolvedValue([
      {
        id: 'r1',
        name: 'release-manager',
        description: 'rm',
        ownerScopeNodeId: ACME,
      },
      {
        id: 'sys',
        name: 'org_admin',
        description: 'system',
        ownerScopeNodeId: null,
      }, // excluded
    ]),
    query: vi
      .fn()
      .mockResolvedValue([{ role_id: 'r1', name: 'workflows:manage' }]),
  } as any;
  const assignmentRepo = {
    query: vi.fn().mockResolvedValue([
      {
        username: 'alice',
        role_name: 'release-manager',
        scope_node_id: ACME,
      },
    ]),
  } as any;
  const workflowRepo = {
    find: vi.fn().mockResolvedValue([
      {
        id: 'w-ovr',
        name: 'hotfix-flow',
        scope_node_id: WEB,
        source: 'admin',
        locked: false,
        overrides: { is_active: false },
        yaml_definition: null,
      },
      {
        id: 'w-def',
        name: 'hotfix-flow',
        scope_node_id: null,
        source: 'seeded',
        locked: false,
        overrides: null,
        yaml_definition: 'name: hotfix',
      },
    ]),
  } as any;
  const agentRepo = {
    find: vi.fn().mockResolvedValue([
      {
        id: 'a-def',
        name: 'ceo-agent',
        scope_node_id: null,
        source: 'seeded',
        locked: false,
        overrides: null,
        system_prompt: 'Lead the team.',
        model_name: 'gpt-4',
        provider_name: 'openai',
        provider_id: null,
        provider_source: 'global',
        tier_preference: 'heavy',
        supports_vision: false,
        allowed_mount_aliases: 'workspace',
        denied_mount_aliases: null,
        allow_rw_mount_aliases: null,
        assigned_skills: 'code-review',
        tool_policy: { allow: ['read'] },
      },
      {
        id: 'a-ovr',
        name: 'ceo-agent',
        scope_node_id: ACME,
        source: 'admin',
        locked: false,
        overrides: { tierPreference: 'light' },
        tool_policy: null,
      },
    ]),
  } as any;
  const skillRepo = {
    find: vi.fn().mockResolvedValue([
      {
        id: 's-def',
        name: 'code-review',
        scope_node_id: null,
        source: 'seeded',
        locked: false,
        overrides: null,
        description: 'Review code',
        skill_markdown: '# Review\n',
        category: 'quality',
        tags: 'review,quality',
        metadata: { owner: 'platform' },
        version: 1,
      },
      {
        id: 's-ovr',
        name: 'code-review',
        scope_node_id: ACME,
        source: 'admin',
        locked: false,
        overrides: { description: 'Scoped review' },
        skill_markdown: '# Scoped\n',
      },
    ]),
  } as any;
  return {
    scopeService,
    roleRepo,
    assignmentRepo,
    workflowRepo,
    agentRepo,
    skillRepo,
  };
}

describe('ConfigExportService.exportToFiles', () => {
  it('emits scope files for every node addressed by slug path', async () => {
    const d = makeDeps();
    const svc = new ConfigExportService(
      d.scopeService,
      d.roleRepo,
      d.assignmentRepo,
      d.workflowRepo,
      d.agentRepo,
      d.skillRepo,
    );
    const files = await svc.exportToFiles();
    const paths = files.map((f) => f.path);
    expect(paths).toContain('scopes/scope.yaml');
    expect(paths).toContain('scopes/acme/scope.yaml');
    expect(paths).toContain('scopes/acme/web-app/scope.yaml');
  });

  it('excludes system roles (ownerScopeNodeId=null), includes custom roles', async () => {
    const d = makeDeps();
    const svc = new ConfigExportService(
      d.scopeService,
      d.roleRepo,
      d.assignmentRepo,
      d.workflowRepo,
      d.agentRepo,
      d.skillRepo,
    );
    const files = await svc.exportToFiles();
    expect(files.some((f) => f.path === 'roles/release-manager.yaml')).toBe(
      true,
    );
    expect(files.some((f) => f.path === 'roles/org_admin.yaml')).toBe(false);
  });

  it('exports assignments.yaml with username/role/scope-path', async () => {
    const d = makeDeps();
    const svc = new ConfigExportService(
      d.scopeService,
      d.roleRepo,
      d.assignmentRepo,
      d.workflowRepo,
      d.agentRepo,
      d.skillRepo,
    );
    const files = await svc.exportToFiles();
    const a = files.find((f) => f.path === 'assignments.yaml');
    expect(a?.yaml).toContain('alice');
    expect(a?.yaml).toContain('/acme');
  });

  it('exports platform defaults and scoped override rows for configurable objects', async () => {
    const d = makeDeps();
    const svc = new ConfigExportService(
      d.scopeService,
      d.roleRepo,
      d.assignmentRepo,
      d.workflowRepo,
      d.agentRepo,
      d.skillRepo,
    );
    const files = await svc.exportToFiles();
    const paths = files.map((file) => file.path);
    expect(paths).toContain('workflows/hotfix-flow.yaml');
    expect(paths).toContain('agents/ceo-agent.yaml');
    expect(paths).toContain('skills/code-review.yaml');
    expect(paths).toContain('scopes/acme/web-app/workflows/hotfix-flow.yaml');
    expect(paths).toContain('scopes/acme/agents/ceo-agent.yaml');
    expect(paths).toContain('scopes/acme/skills/code-review.yaml');
    expect(
      files.find((file) => file.path === 'workflows/hotfix-flow.yaml')?.yaml,
    ).toContain('kind: Workflow');
    expect(
      files.find((file) => file.path === 'agents/ceo-agent.yaml')?.yaml,
    ).toContain('kind: AgentProfile');
    expect(
      files.find((file) => file.path === 'skills/code-review.yaml')?.yaml,
    ).toContain('kind: Skill');
  });
});
