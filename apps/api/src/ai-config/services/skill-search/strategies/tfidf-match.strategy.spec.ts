import { describe, it, expect, beforeEach } from 'vitest';
import { TfIdfMatchStrategy } from './tfidf-match.strategy';
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

describe('TfIdfMatchStrategy', () => {
  let strategy: TfIdfMatchStrategy;

  beforeEach(() => {
    strategy = new TfIdfMatchStrategy();
  });

  it('has name "tfidf"', () => {
    expect(strategy.name).toBe('tfidf');
  });

  it('returns empty array for empty skills list', () => {
    expect(strategy.search('orchestration', [])).toEqual([]);
  });

  it('returns empty array for empty query', () => {
    expect(strategy.search('', [makeSkill()])).toEqual([]);
  });

  it('ranks the skill with the rare query term higher in the corpus', () => {
    // 'orchestration' appears only in skill-a; 'tool' is in all three
    const skills = [
      makeSkill({
        name: 'orchestration-runner',
        description: 'orchestration tool',
      }),
      makeSkill({ name: 'basic-tool', description: 'a simple tool' }),
      makeSkill({ name: 'another-tool', description: 'another helpful tool' }),
    ];
    const results = strategy.search('orchestration', skills);
    expect(results[0].skill.name).toBe('orchestration-runner');
  });

  it('returns scores between 0 and 1 (inclusive)', () => {
    const skills = [
      makeSkill({ name: 'skill-a', description: 'orchestration workflows' }),
      makeSkill({ name: 'skill-b', description: 'unrelated content' }),
    ];
    const results = strategy.search('orchestration', skills);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('filters out skills with zero score', () => {
    const matching = makeSkill({
      name: 'orchestration-tool',
      description: 'handles orchestration',
    });
    const nonMatching = makeSkill({
      name: 'database-tool',
      description: 'manages databases',
    });
    const results = strategy.search('orchestration', [matching, nonMatching]);
    expect(results.every((r) => r.score > 0)).toBe(true);
    expect(results.map((r) => r.skill.name)).not.toContain('database-tool');
  });

  it('returns empty array for whitespace-only query', () => {
    expect(strategy.search('   ', [makeSkill()])).toEqual([]);
  });

  it('excludes skills where all query terms appear in every document (IDF = 0)', () => {
    const skills = [
      makeSkill({
        name: 'orchestration-runner',
        description: 'orchestration tool',
      }),
      makeSkill({ name: 'basic-tool', description: 'a simple tool' }),
      makeSkill({ name: 'another-tool', description: 'another helpful tool' }),
    ];
    // 'tool' appears in all 3 docs → IDF = log(3/3) = 0 → zero score for 'tool'-only query
    const results = strategy.search('orchestration', skills);
    expect(results).toHaveLength(1);
    expect(results[0].skill.name).toBe('orchestration-runner');
  });

  it('returns results sorted by score descending', () => {
    const skills = [
      makeSkill({
        name: 'orchestration-runner',
        description: 'runs orchestration',
      }),
      makeSkill({
        name: 'workflow-engine',
        description: 'manages orchestration pipelines',
      }),
      makeSkill({ name: 'database-tool', description: 'manages databases' }),
    ];
    const results = strategy.search('orchestration', skills);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });
});
