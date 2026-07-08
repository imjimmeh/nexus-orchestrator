import { describe, it, expect, vi } from 'vitest';
import { ConfigValidationService } from './config-validation.service';

function makeService(
  files: Array<{ path: string; content: Record<string, unknown> }>,
) {
  const fileLoader = { loadYamlTree: vi.fn().mockResolvedValue(files) } as any;
  const ctxProvider = {
    build: vi.fn().mockResolvedValue({
      knownPermissions: new Set(['workflows:manage']),
      knownSystemRoles: new Set(['org_admin']),
      knownUsers: new Set(['alice']),
      knownDefaultAgents: new Set(['ceo-agent']),
      knownDefaultWorkflows: new Set(['hotfix-flow']),
      knownDefaultSkills: new Set<string>(),
    }),
  } as any;
  return new ConfigValidationService(fileLoader, ctxProvider);
}

const root = {
  path: 'scopes/scope.yaml',
  content: {
    apiVersion: 'nexus.gitops/v1',
    kind: 'ScopeNode',
    type: 'platform',
    name: 'Platform',
    slug: 'platform',
  },
};
const acme = {
  path: 'scopes/acme/scope.yaml',
  content: {
    apiVersion: 'nexus.gitops/v1',
    kind: 'ScopeNode',
    type: 'org',
    name: 'Acme',
    slug: 'acme',
  },
};

describe('ConfigValidationService.lint', () => {
  it('passes a clean tree', async () => {
    const svc = makeService([root, acme]);
    const res = await svc.lint('/repo');
    expect(res.ok).toBe(true);
  });

  it('FAILS with a schema error for a malformed scope file', async () => {
    const svc = makeService([
      {
        path: 'scopes/scope.yaml',
        content: {
          apiVersion: 'nexus.gitops/v1',
          kind: 'ScopeNode',
          type: 'galaxy',
          name: 'X',
          slug: 'x',
        },
      },
    ]);
    const res = await svc.lint('/repo');
    expect(res.ok).toBe(false);
  });

  it('FAILS with a referential error: assignment to an unknown scope', async () => {
    const svc = makeService([
      root,
      acme,
      {
        path: 'assignments.yaml',
        content: {
          apiVersion: 'nexus.gitops/v1',
          kind: 'AssignmentList',
          assignments: [{ user: 'alice', role: 'org_admin', scope: '/ghost' }],
        },
      },
    ]);
    const res = await svc.lint('/repo');
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'assignment.unknown_scope')).toBe(
      true,
    );
  });
});

describe('ConfigValidationService.loadAndValidate', () => {
  it('maps workflow, agent, and skill override documents to real object types', async () => {
    const svc = makeService([
      root,
      acme,
      {
        path: 'scopes/acme/workflows/hotfix-flow.yaml',
        content: {
          apiVersion: 'nexus.gitops/v1',
          kind: 'WorkflowOverride',
          name: 'hotfix-flow',
          scope: '/acme',
          source: 'repository',
          locked: false,
          strategy: 'merge',
          overrides: { timeout: 30 },
        },
      },
      {
        path: 'scopes/acme/agents/ceo-agent.yaml',
        content: {
          apiVersion: 'nexus.gitops/v1',
          kind: 'AgentOverride',
          name: 'ceo-agent',
          scope: '/acme',
          source: 'repository',
          locked: false,
          strategy: 'merge',
          overrides: { providerName: 'openai' },
        },
      },
      {
        path: 'scopes/acme/skills/review.yaml',
        content: {
          apiVersion: 'nexus.gitops/v1',
          kind: 'SkillOverride',
          name: 'review',
          scope: '/acme',
          source: 'repository',
          locked: false,
          strategy: 'replace',
          definition: { skillMarkdown: '# Review' },
        },
      },
    ]);

    const state = await svc.loadAndValidate('/repo', {
      knownPermissions: new Set(['workflows:manage']),
      knownSystemRoles: new Set(['org_admin']),
      knownUsers: new Set(['alice']),
      knownDefaultAgents: new Set(['ceo-agent']),
      knownDefaultWorkflows: new Set(['hotfix-flow']),
      knownDefaultSkills: new Set(['review']),
    });

    expect(state.objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'workflow', key: '/acme:hotfix-flow' }),
        expect.objectContaining({
          type: 'agent_profile',
          key: '/acme:ceo-agent',
        }),
        expect.objectContaining({ type: 'skill', key: '/acme:review' }),
      ]),
    );
    expect(
      state.objects.some((object) => object.type === 'config_override'),
    ).toBe(false);
  });
});
