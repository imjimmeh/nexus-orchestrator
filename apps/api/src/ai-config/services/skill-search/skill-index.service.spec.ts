import { describe, it, expect, beforeEach } from 'vitest';
import { SkillIndexService } from './skill-index.service';
import type { SkillLibraryRecord } from '../agent-skill-library.service.types';

function makeSkill(
  overrides: Partial<SkillLibraryRecord> = {},
): SkillLibraryRecord {
  return {
    id: 'test-id',
    name: 'my-skill',
    description: 'A useful skill for testing',
    skillMarkdown: '',
    compatibility: null,
    category: 'testing',
    tags: ['unit'],
    metadata: null,
    isActive: true,
    version: 1,
    source: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
    rootPath: '/tmp',
    ...overrides,
  };
}

describe('SkillIndexService', () => {
  let service: SkillIndexService;

  beforeEach(() => {
    service = new SkillIndexService();
  });

  it('starts unbuilt', () => {
    expect(service.isBuilt()).toBe(false);
  });

  it('isBuilt() returns true after build()', () => {
    service.build([makeSkill()]);
    expect(service.isBuilt()).toBe(true);
  });

  it('getAll() returns all indexed skills', () => {
    const skills = [
      makeSkill({ name: 'skill-a' }),
      makeSkill({ name: 'skill-b' }),
    ];
    service.build(skills);
    expect(service.getAll()).toHaveLength(2);
  });

  it('get() returns the skill by name', () => {
    const skill = makeSkill({ name: 'target-skill' });
    service.build([skill]);
    expect(service.get('target-skill')).toEqual(skill);
  });

  it('get() returns undefined for unknown skill', () => {
    service.build([]);
    expect(service.get('ghost')).toBeUndefined();
  });

  it('searchTokens() returns skill names matching any of the words', () => {
    const skill = makeSkill({
      name: 'orchestration-runner',
      description: 'runs pipelines',
    });
    service.build([skill]);
    const results = service.searchTokens(['orchestration']);
    expect(results.has('orchestration-runner')).toBe(true);
  });

  it('searchTokens() with empty words returns all skill names', () => {
    service.build([
      makeSkill({ name: 'skill-a' }),
      makeSkill({ name: 'skill-b' }),
    ]);
    expect(service.searchTokens([])).toEqual(new Set(['skill-a', 'skill-b']));
  });

  it('invalidate() removes the skill from index and inverted index', () => {
    const skill = makeSkill({
      name: 'removable-skill',
      description: 'this will be removed',
    });
    service.build([skill]);
    service.invalidate('removable-skill');
    expect(service.get('removable-skill')).toBeUndefined();
    expect(service.searchTokens(['removable']).has('removable-skill')).toBe(
      false,
    );
  });

  it('invalidate() on unknown name is a no-op', () => {
    service.build([makeSkill({ name: 'safe-skill' })]);
    expect(() => {
      service.invalidate('ghost');
    }).not.toThrow();
    expect(service.getAll()).toHaveLength(1);
  });

  it('invalidateAll() resets the index to unbuilt state', () => {
    service.build([makeSkill()]);
    service.invalidateAll();
    expect(service.isBuilt()).toBe(false);
    expect(service.getAll()).toHaveLength(0);
  });

  it('handles skill with empty tags array without throwing', () => {
    const skill = makeSkill({ name: 'no-tags-skill', tags: [] });
    expect(() => {
      service.build([skill]);
    }).not.toThrow();
    expect(service.get('no-tags-skill')).toBeDefined();
  });

  it('handles skill with null category without throwing', () => {
    const skill = makeSkill({ name: 'no-category-skill', category: null });
    expect(() => {
      service.build([skill]);
    }).not.toThrow();
    expect(service.get('no-category-skill')).toBeDefined();
  });
});
