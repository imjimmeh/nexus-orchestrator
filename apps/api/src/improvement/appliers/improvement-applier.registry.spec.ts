import { describe, expect, it, vi } from 'vitest';
import type { ImprovementProposalKind } from '@nexus/core';
import { ImprovementApplierRegistry } from './improvement-applier.registry';
import type { IImprovementApplier } from './improvement-applier.types';
import { SkillAssignmentApplier } from './skill-assignment.applier';
import { AgentProfileChangeApplier } from './agent-profile-change.applier';
import { CodeChangeApplier } from './code-change.applier';

const fakeApplier = (kind: ImprovementProposalKind): IImprovementApplier => ({
  kind,
  apply: async () => ({ ok: true }),
});

describe('ImprovementApplierRegistry', () => {
  it('resolves an applier by kind', () => {
    const registry = new ImprovementApplierRegistry([
      fakeApplier('skill_create'),
    ]);
    expect(registry.get('skill_create')?.kind).toBe('skill_create');
    expect(registry.get('code_change')).toBeUndefined();
  });

  it('require throws for an unregistered kind', () => {
    const registry = new ImprovementApplierRegistry([]);
    expect(() => registry.require('skill_create')).toThrow(
      /no applier registered/i,
    );
  });

  it('resolves skill_assignment to the real SkillAssignmentApplier', () => {
    const skillAssignmentApplier = new SkillAssignmentApplier(
      {
        skillExists: vi.fn(() => true),
        addProfileSkills: vi.fn(async () => undefined),
        removeProfileSkills: vi.fn(async () => undefined),
      },
      {
        addBinding: vi.fn(async () => undefined),
        removeBinding: vi.fn(async () => undefined),
      },
      { updateById: vi.fn(async () => null) } as any,
    );

    const registry = new ImprovementApplierRegistry([
      fakeApplier('skill_create'),
      skillAssignmentApplier,
    ]);

    expect(registry.get('skill_assignment')).toBe(skillAssignmentApplier);
    expect(registry.require('skill_assignment').kind).toBe('skill_assignment');
  });

  it('resolves agent_profile_change to the real AgentProfileChangeApplier', () => {
    const agentProfileChangeApplier = new AgentProfileChangeApplier(
      { updateAgentProfile: vi.fn(async () => undefined) } as any,
      {
        addProfileSkills: vi.fn(async () => undefined),
        removeProfileSkills: vi.fn(async () => undefined),
      } as any,
      {
        findByName: vi.fn(async () => null),
        update: vi.fn(async () => null),
      } as any,
      { update: vi.fn(async () => undefined) } as any,
    );

    const registry = new ImprovementApplierRegistry([
      fakeApplier('skill_create'),
      agentProfileChangeApplier,
    ]);

    expect(registry.get('agent_profile_change')).toBe(
      agentProfileChangeApplier,
    );
    expect(registry.require('agent_profile_change').kind).toBe(
      'agent_profile_change',
    );
  });

  it('resolves code_change to the real CodeChangeApplier', () => {
    const codeChangeApplier = new CodeChangeApplier(
      { publish: vi.fn(async () => '1-1') } as any,
      { emitBestEffort: vi.fn(async () => undefined) } as any,
    );

    const registry = new ImprovementApplierRegistry([
      fakeApplier('skill_create'),
      codeChangeApplier,
    ]);

    expect(registry.get('code_change')).toBe(codeChangeApplier);
    expect(registry.require('code_change').kind).toBe('code_change');
  });

  it('throws when two appliers register the same kind', () => {
    expect(
      () =>
        new ImprovementApplierRegistry([
          fakeApplier('skill_create'),
          fakeApplier('skill_create'),
        ]),
    ).toThrow(/duplicate improvement applier registration.*skill_create/i);
  });

  it('registers distinct kinds without throwing', () => {
    expect(
      () =>
        new ImprovementApplierRegistry([
          fakeApplier('skill_create'),
          fakeApplier('skill_assignment'),
          fakeApplier('code_change'),
        ]),
    ).not.toThrow();
  });
});
