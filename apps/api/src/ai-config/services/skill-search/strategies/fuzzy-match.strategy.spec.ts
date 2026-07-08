import { describe, it, expect, beforeEach } from 'vitest';
import {
  FuzzyMatchStrategy,
  levenshteinDistance,
  fuzzyThreshold,
} from './fuzzy-match.strategy';
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

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('test', 'test')).toBe(0);
  });

  it('returns 1 for single substitution', () => {
    expect(levenshteinDistance('test', 'best')).toBe(1);
  });

  it('returns 1 for single insertion', () => {
    expect(levenshteinDistance('cat', 'cats')).toBe(1);
  });

  it('returns 1 for single deletion', () => {
    expect(levenshteinDistance('cats', 'cat')).toBe(1);
  });

  it('counts adjacent transposition as distance 2 (one delete + one insert)', () => {
    expect(levenshteinDistance('orchestration', 'orchestartion')).toBe(2);
  });

  it('handles empty strings', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('', '')).toBe(0);
  });
});

describe('fuzzyThreshold', () => {
  it('returns 0 for single-char words', () => {
    expect(fuzzyThreshold('a')).toBe(0);
  });

  it('returns 0 for words with 3 or fewer chars', () => {
    expect(fuzzyThreshold('ab')).toBe(0);
    expect(fuzzyThreshold('abc')).toBe(0);
  });

  it('returns 1 for 4-char words', () => {
    expect(fuzzyThreshold('test')).toBe(1);
  });

  it('returns 2 for words with 5 or more chars', () => {
    expect(fuzzyThreshold('debug')).toBe(2);
    expect(fuzzyThreshold('orchestration')).toBe(2);
  });
});

describe('FuzzyMatchStrategy', () => {
  let strategy: FuzzyMatchStrategy;

  beforeEach(() => {
    strategy = new FuzzyMatchStrategy();
  });

  it('has name "fuzzy-match"', () => {
    expect(strategy.name).toBe('fuzzy-match');
  });

  it('returns empty array for empty query', () => {
    expect(strategy.search('', [makeSkill()])).toEqual([]);
  });

  it('returns empty array for empty skills list', () => {
    expect(strategy.search('orchestration', [])).toEqual([]);
  });

  it('matches a typo variant of a skill name ("orchestartion" → "orchestration")', () => {
    const skill = makeSkill({ name: 'orchestration-runner' });
    const results = strategy.search('orchestartion', [skill]);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('does NOT match short words with typos (threshold=0 for ≤3 chars)', () => {
    const skill = makeSkill({
      name: 'api-client',
      description: 'connects to api',
    });
    const results = strategy.search('bp', [skill]);
    expect(results).toHaveLength(0);
  });

  it('scores an exact name match higher than a fuzzy match', () => {
    const exact = makeSkill({ name: 'orchestration-runner' });
    const typo = makeSkill({ name: 'orchestartion-runner' });
    const exactResults = strategy.search('orchestration', [exact]);
    const typoResults = strategy.search('orchestration', [typo]);
    expect(exactResults[0].score).toBeGreaterThan(typoResults[0].score);
  });

  it('returns results sorted by score descending', () => {
    const skills = [
      makeSkill({ name: 'orchestartion-runner', description: 'bad spelling' }),
      makeSkill({ name: 'orchestration-runner', description: 'exact match' }),
    ];
    const results = strategy.search('orchestration', skills);
    expect(results[0].skill.name).toBe('orchestration-runner');
  });
});
