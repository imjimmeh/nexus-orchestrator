import { describe, expect, it } from 'vitest';
import { renderSkillSection } from './skill-catalog-prompt.helpers';

const skills = [
  { id: 'abc', name: 'git-flow', description: 'Branch and PR hygiene.' },
  { id: 'def', name: 'tdd', description: 'Red-green-refactor.' },
];

describe('renderSkillSection', () => {
  it('native: lists assigned skills and omits the search guidance', () => {
    const out = renderSkillSection({
      mode: 'native',
      assignedSkills: skills,
      availableCategories: ['dev'],
    });
    expect(out).toContain('git-flow');
    expect(out).toContain('Branch and PR hygiene.');
    expect(out).toContain('read_skill_manifest');
    expect(out).not.toContain('search_skills');
    expect(out).not.toContain('Available skill categories');
  });

  it('search: emits the discovery guidance + categories and no skill list', () => {
    const out = renderSkillSection({
      mode: 'search',
      assignedSkills: skills,
      availableCategories: ['dev'],
    });
    expect(out).toContain('search_skills');
    expect(out).toContain('Available skill categories include: dev.');
    expect(out).not.toContain('git-flow');
  });

  it('returns empty string when there are no skills and no categories', () => {
    expect(renderSkillSection({ mode: 'native', assignedSkills: [] })).toBe('');
    expect(renderSkillSection({ mode: 'search', assignedSkills: [] })).toBe('');
  });

  it('native with no skills returns empty even if categories exist', () => {
    expect(
      renderSkillSection({
        mode: 'native',
        assignedSkills: [],
        availableCategories: ['dev'],
      }),
    ).toBe('');
  });
});
