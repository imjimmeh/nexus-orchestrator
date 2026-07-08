import { describe, expect, it } from 'vitest';
import { decideScopeApplication } from './skill-scope-auto-apply.decide';

describe('decideScopeApplication', () => {
  const nonEmptyScope = { projects: ['project-abc'] };
  const agentScope = { agents: ['architect'] };
  const workflowScope = { workflows: ['wf-1'] };
  const emptyScope = {};

  it('returns auto_apply with confirmedScope when mode is auto and scope has projects', () => {
    const result = decideScopeApplication({
      recommendedScope: nonEmptyScope,
      mode: 'auto',
      originScopeId: 'project-abc',
    });

    expect(result.action).toBe('auto_apply');
    expect(result.confirmedScope).toEqual({
      projects: ['project-abc'],
      agents: [],
      workflows: [],
    });
  });

  it('returns stage (never auto_apply) when mode is auto and scope has agents, even matching origin projects', () => {
    const result = decideScopeApplication({
      recommendedScope: { projects: ['project-abc'], ...agentScope },
      mode: 'auto',
      originScopeId: 'project-abc',
    });

    expect(result.action).toBe('stage');
    expect(result.confirmedScope).toBeUndefined();
    expect(result.reason).toContain('agents or workflows');
  });

  it('returns stage (never auto_apply) when mode is auto and scope has workflows, even matching origin projects', () => {
    const result = decideScopeApplication({
      recommendedScope: { projects: ['project-abc'], ...workflowScope },
      mode: 'auto',
      originScopeId: 'project-abc',
    });

    expect(result.action).toBe('stage');
    expect(result.confirmedScope).toBeUndefined();
    expect(result.reason).toContain('agents or workflows');
  });

  it('returns stage when mode is auto but scope is an empty object', () => {
    const result = decideScopeApplication({
      recommendedScope: emptyScope,
      mode: 'auto',
      originScopeId: 'project-abc',
    });

    expect(result.action).toBe('stage');
  });

  it('returns stage when mode is auto but scope is null', () => {
    const result = decideScopeApplication({
      recommendedScope: null,
      mode: 'auto',
      originScopeId: 'project-abc',
    });

    expect(result.action).toBe('stage');
  });

  it('returns stage when mode is auto but scope is undefined', () => {
    const result = decideScopeApplication({
      recommendedScope: undefined,
      mode: 'auto',
      originScopeId: 'project-abc',
    });

    expect(result.action).toBe('stage');
  });

  it('returns stage regardless of scope content when mode is manual', () => {
    const result = decideScopeApplication({
      recommendedScope: nonEmptyScope,
      mode: 'manual',
      originScopeId: 'project-abc',
    });

    expect(result.action).toBe('stage');
  });

  it('returns stage regardless of scope content when mode is staged', () => {
    const result = decideScopeApplication({
      recommendedScope: nonEmptyScope,
      mode: 'staged',
      originScopeId: 'project-abc',
    });

    expect(result.action).toBe('stage');
  });

  it('includes a non-empty reason string in all decisions', () => {
    const autoDecision = decideScopeApplication({
      recommendedScope: nonEmptyScope,
      mode: 'auto',
      originScopeId: 'project-abc',
    });
    const manualDecision = decideScopeApplication({
      recommendedScope: nonEmptyScope,
      mode: 'manual',
      originScopeId: 'project-abc',
    });
    const emptyAutoDecision = decideScopeApplication({
      recommendedScope: null,
      mode: 'auto',
      originScopeId: 'project-abc',
    });

    expect(autoDecision.reason).toBeTruthy();
    expect(manualDecision.reason).toBeTruthy();
    expect(emptyAutoDecision.reason).toBeTruthy();
  });

  it('does not set confirmedScope when returning stage', () => {
    const result = decideScopeApplication({
      recommendedScope: nonEmptyScope,
      mode: 'manual',
      originScopeId: 'project-abc',
    });

    expect(result.confirmedScope).toBeUndefined();
  });
});

describe('decideScopeApplication — origin-aware widening', () => {
  it('auto-applies and clamps projects to the origin scope when the recommendation is projects-only', () => {
    const decision = decideScopeApplication({
      recommendedScope: {
        projects: ['scope-1'],
        agents: [],
        workflows: [],
      },
      mode: 'auto',
      originScopeId: 'scope-1',
    });

    expect(decision.action).toBe('auto_apply');
    expect(decision.confirmedScope).toEqual({
      projects: ['scope-1'],
      agents: [],
      workflows: [],
    });
  });

  it('stages (never auto-applies) when the recommendation names an agent, even though projects matches the origin exactly', () => {
    const decision = decideScopeApplication({
      recommendedScope: {
        projects: ['scope-1'],
        agents: ['backend-engineer'],
        workflows: [],
      },
      mode: 'auto',
      originScopeId: 'scope-1',
    });

    expect(decision.action).toBe('stage');
    expect(decision.confirmedScope).toBeUndefined();
    expect(decision.reason).toContain('agents or workflows');
  });

  it('stages (never auto-applies) when the recommendation names a workflow, even though projects matches the origin exactly', () => {
    const decision = decideScopeApplication({
      recommendedScope: {
        projects: ['scope-1'],
        agents: [],
        workflows: ['wf-1'],
      },
      mode: 'auto',
      originScopeId: 'scope-1',
    });

    expect(decision.action).toBe('stage');
    expect(decision.confirmedScope).toBeUndefined();
    expect(decision.reason).toContain('agents or workflows');
  });

  it('stages (never auto-applies) when the recommendation names a different project than the origin', () => {
    const decision = decideScopeApplication({
      recommendedScope: { projects: ['scope-2'], agents: [], workflows: [] },
      mode: 'auto',
      originScopeId: 'scope-1',
    });

    expect(decision.action).toBe('stage');
    expect(decision.reason).toContain('widens beyond origin scope');
  });

  it('stages when the recommendation has no project restriction (implicit global widening)', () => {
    const decision = decideScopeApplication({
      recommendedScope: {
        projects: [],
        agents: ['backend-engineer'],
        workflows: [],
      },
      mode: 'auto',
      originScopeId: 'scope-1',
    });

    expect(decision.action).toBe('stage');
    expect(decision.reason).toContain('widens beyond origin scope');
  });

  it('stages when there is no known origin scope, even in auto mode', () => {
    const decision = decideScopeApplication({
      recommendedScope: { projects: ['scope-1'], agents: [], workflows: [] },
      mode: 'auto',
      originScopeId: null,
    });

    expect(decision.action).toBe('stage');
    expect(decision.reason).toContain('no known origin scope');
  });
});
