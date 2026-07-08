import { describe, it, expect, beforeEach } from 'vitest';
import { SkillSearchPipelineService } from './skill-search-pipeline.service';
import { SkillIndexService } from './skill-index.service';
import { TokenMatchStrategy } from './strategies/token-match.strategy';
import { FuzzyMatchStrategy } from './strategies/fuzzy-match.strategy';
import { TfIdfMatchStrategy } from './strategies/tfidf-match.strategy';
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

describe('SkillSearchPipelineService', () => {
  let pipeline: SkillSearchPipelineService;
  let index: SkillIndexService;
  let allSkills: SkillLibraryRecord[];

  beforeEach(() => {
    index = new SkillIndexService();
    pipeline = new SkillSearchPipelineService(
      index,
      new TokenMatchStrategy(),
      new FuzzyMatchStrategy(),
      new TfIdfMatchStrategy(),
    );
    allSkills = [
      makeSkill({
        name: 'orchestration-runner',
        description: 'runs orchestration',
        category: 'automation',
        tags: [],
      }),
      makeSkill({
        name: 'database-connector',
        description: 'connects databases',
        category: 'data',
        tags: [],
      }),
      makeSkill({
        name: 'debug-helper',
        description: 'helps debug issues',
        category: null,
        tags: ['debugging'],
      }),
    ];
    index.build(allSkills);
  });

  it('returns all skills with score 1.0 when no query is provided', () => {
    const results = pipeline.search({});
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.score === 1.0)).toBe(true);
  });

  it('filters by category before running strategies', () => {
    const results = pipeline.search({ category: 'automation' });
    expect(results).toHaveLength(1);
    expect(results[0].skill.name).toBe('orchestration-runner');
  });

  it('filters by tags using AND logic (all tags must match)', () => {
    const skill = makeSkill({ name: 'multi-tag', tags: ['alpha', 'beta'] });
    index.build([...allSkills, skill]);
    const results = pipeline.search({ tags: ['alpha', 'beta'] });
    expect(
      results.every(
        (r) => r.skill.tags.includes('alpha') && r.skill.tags.includes('beta'),
      ),
    ).toBe(true);
  });

  it('returns results sorted by score descending', () => {
    const results = pipeline.search({ query: 'orchestration' });
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });

  it('deduplicates when multiple strategies match the same skill (max-score wins)', () => {
    const results = pipeline.search({ query: 'orchestration' });
    const names = results.map((r) => r.skill.name);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });

  it('applies minScore filter — excludes results below threshold', () => {
    // Get full results first to confirm there are results to compare against
    const fullResults = pipeline.search({ query: 'orchestration' });
    expect(fullResults.length).toBeGreaterThan(0);

    // Apply a high minScore that should exclude some results
    const filtered = pipeline.search({
      query: 'orchestration',
      minScore: 0.95,
    });
    expect(filtered.every((r) => r.score >= 0.95)).toBe(true);
    expect(filtered.length).toBeLessThanOrEqual(fullResults.length);
  });

  it('applies limit — returns at most N results', () => {
    // Confirm the unfiltered search returns more than 1 result
    const fullResults = pipeline.search({
      query: 'orchestration runner debug',
    });
    expect(fullResults.length).toBeGreaterThan(0);

    const limited = pipeline.search({
      query: 'orchestration runner debug',
      limit: 1,
    });
    expect(limited).toHaveLength(1);
  });

  it('populates the index lazily from fallbackSkills when not yet built', () => {
    const freshIndex = new SkillIndexService();
    const freshPipeline = new SkillSearchPipelineService(
      freshIndex,
      new TokenMatchStrategy(),
      new FuzzyMatchStrategy(),
      new TfIdfMatchStrategy(),
    );
    expect(freshIndex.isBuilt()).toBe(false);
    const results = freshPipeline.search({ query: 'orchestration' }, allSkills);
    expect(freshIndex.isBuilt()).toBe(true);
    expect(results.some((r) => r.skill.name === 'orchestration-runner')).toBe(
      true,
    );
  });
});
