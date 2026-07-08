import { describe, it, expect, beforeEach } from 'vitest';
import { TokenMatchStrategy } from './token-match.strategy';
import type { SkillLibraryRecord } from '../../agent-skill-library.service.types';

function makeSkill(
  overrides: Partial<SkillLibraryRecord> = {},
): SkillLibraryRecord {
  return {
    id: 'test-id',
    name: 'my-skill',
    description: 'A useful skill for testing',
    skillMarkdown: '',
    compatibility: null,
    category: null,
    tags: [],
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

describe('TokenMatchStrategy', () => {
  let strategy: TokenMatchStrategy;

  beforeEach(() => {
    strategy = new TokenMatchStrategy();
  });

  it('has name "token-match"', () => {
    expect(strategy.name).toBe('token-match');
  });

  it('returns empty array for empty skills list', () => {
    expect(strategy.search('orchestration', [])).toEqual([]);
  });

  it('returns empty array for empty query', () => {
    expect(strategy.search('', [makeSkill()])).toEqual([]);
  });

  it('scores a name match higher than a description-only match', () => {
    const nameMatch = makeSkill({
      name: 'orchestration-runner',
      description: 'executes things',
    });
    const descMatch = makeSkill({
      name: 'workflow-engine',
      description: 'orchestration helper',
    });
    const results = strategy.search('orchestration', [nameMatch, descMatch]);
    const nr = results.find((r) => r.skill.name === 'orchestration-runner')!;
    const dr = results.find((r) => r.skill.name === 'workflow-engine')!;
    expect(nr.score).toBeGreaterThan(dr.score);
  });

  it('includes "name" in matchedFields when name matches', () => {
    const skill = makeSkill({ name: 'orchestration-runner' });
    const [result] = strategy.search('orchestration', [skill]);
    expect(result.matchDetails.matchedFields).toContain('name');
  });

  it('includes "description" in matchedFields when description matches', () => {
    const skill = makeSkill({
      name: 'other-skill',
      description: 'handles orchestration',
    });
    const [result] = strategy.search('orchestration', [skill]);
    expect(result.matchDetails.matchedFields).toContain('description');
  });

  it('includes "tags" in matchedFields when a tag matches', () => {
    const skill = makeSkill({
      name: 'some-skill',
      description: 'does things',
      tags: ['orchestration'],
    });
    const [result] = strategy.search('orchestration', [skill]);
    expect(result.matchDetails.matchedFields).toContain('tags');
  });

  it('filters out skills with zero score', () => {
    const matching = makeSkill({ name: 'orchestration-tool' });
    const nonMatching = makeSkill({
      name: 'database-connector',
      description: 'connects databases',
    });
    const results = strategy.search('orchestration', [matching, nonMatching]);
    expect(results.every((r) => r.score > 0)).toBe(true);
    expect(results.map((r) => r.skill.name)).toContain('orchestration-tool');
    expect(results.map((r) => r.skill.name)).not.toContain(
      'database-connector',
    );
  });

  it('returns results sorted by score descending', () => {
    const skills = [
      makeSkill({ name: 'unrelated', description: 'nothing here' }),
      makeSkill({ name: 'perfect-skill', description: 'perfect match here' }),
      makeSkill({ name: 'partial', description: 'match only' }),
    ];
    const results = strategy.search('perfect match', skills);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it('handles multi-word query matching across fields', () => {
    const skill = makeSkill({
      name: 'advisor-tool',
      description: 'discovery helper',
    });
    const results = strategy.search('advisor discovery', [skill]);
    expect(results).toHaveLength(1);
    expect(results[0].matchDetails.matchedFields).toContain('name');
    expect(results[0].matchDetails.matchedFields).toContain('description');
  });
});
