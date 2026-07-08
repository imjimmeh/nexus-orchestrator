import { describe, expect, it } from 'vitest';
import { resolveEffectiveSkills } from './effective-skills.helpers';

describe('resolveEffectiveSkills', () => {
  it('unions all sources, dedupes by name, and tags most-specific origin', () => {
    const result = resolveEffectiveSkills({
      profileSkills: ['a', 'shared'],
      workflowYamlSkills: ['b'],
      stepYamlSkills: ['c', 'shared'],
      workflowBindings: ['d'],
      stepBindings: ['e'],
    });
    const byName = Object.fromEntries(
      result.map((r) => [r.name, r.specificity]),
    );
    expect(byName).toEqual({
      c: 'step',
      e: 'step',
      shared: 'step', // step wins for 'shared'
      b: 'workflow',
      d: 'workflow',
      a: 'profile',
    });
  });

  it('orders step skills before workflow before profile', () => {
    const result = resolveEffectiveSkills({
      profileSkills: ['p'],
      workflowYamlSkills: ['w'],
      stepYamlSkills: ['s'],
      workflowBindings: [],
      stepBindings: [],
    });
    expect(result.map((r) => r.name)).toEqual(['s', 'w', 'p']);
  });

  it('normalizes names before dedupe so case/underscore variants collapse to one skill', () => {
    const result = resolveEffectiveSkills({
      profileSkills: ['test_generator'],
      workflowYamlSkills: [],
      stepYamlSkills: ['Test-Generator'],
      workflowBindings: [],
      stepBindings: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].specificity).toBe('step');
  });

  it('returns an empty array when all sources are empty', () => {
    const result = resolveEffectiveSkills({
      profileSkills: [],
      workflowYamlSkills: [],
      stepYamlSkills: [],
      workflowBindings: [],
      stepBindings: [],
    });
    expect(result).toEqual([]);
  });
});
