# Agent Skill Search Enhancement — W1–W5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the linear substring filter in `AgentSkillsService.searchSkills()` with a pluggable multi-strategy retrieval pipeline (token-match, fuzzy, TF-IDF) that returns relevance-ranked results with an in-memory inverted index — while keeping the existing `searchSkills()` API contract intact.

**Architecture:** A `SkillSearchPipelineService` orchestrates an ordered list of `ISkillSearchStrategy` implementations, merges scored candidates by max-score per skill, sorts descending, and applies optional `minScore`/`limit` post-filters. `SkillIndexService` provides a read-through in-memory inverted index that is populated lazily on first search and fully invalidated on every skill write/rename/delete. Scores appear in results only when `includeScores=true`.

**Tech Stack:** NestJS (`@Injectable()`), TypeScript strict, **vitest** (existing test framework — `import { describe, it, expect, vi, beforeEach } from 'vitest'`). No external search libraries — Levenshtein distance and TF-IDF implemented in-process.

> **Note:** W6 (DB-stored pipeline configuration for live strategy tuning without redeploy) is explicitly out of scope for this plan — it requires a separate DB migration and admin endpoint effort.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `apps/api/src/ai-config/services/skill-search/skill-search-strategy.interface.ts` | `ISkillSearchStrategy`, `ScoredSkillResult`, `SkillSearchParams`, field-weight constants, `tokenize()` util |
| **Create** | `apps/api/src/ai-config/services/skill-search/strategies/token-match.strategy.ts` | `TokenMatchStrategy` — tokenized word + substring scoring |
| **Create** | `apps/api/src/ai-config/services/skill-search/strategies/token-match.strategy.spec.ts` | Unit tests |
| **Create** | `apps/api/src/ai-config/services/skill-search/strategies/fuzzy-match.strategy.ts` | `FuzzyMatchStrategy` + `levenshteinDistance()` + `fuzzyThreshold()` |
| **Create** | `apps/api/src/ai-config/services/skill-search/strategies/fuzzy-match.strategy.spec.ts` | Unit tests |
| **Create** | `apps/api/src/ai-config/services/skill-search/strategies/tfidf-match.strategy.ts` | `TfIdfMatchStrategy` — corpus-aware TF-IDF scoring |
| **Create** | `apps/api/src/ai-config/services/skill-search/strategies/tfidf-match.strategy.spec.ts` | Unit tests |
| **Create** | `apps/api/src/ai-config/services/skill-search/skill-index.service.ts` | `SkillIndexService` — in-memory inverted index with invalidation |
| **Create** | `apps/api/src/ai-config/services/skill-search/skill-index.service.spec.ts` | Unit tests |
| **Create** | `apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.ts` | `SkillSearchPipelineService` — strategy orchestration + ranking |
| **Create** | `apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts` | Integration unit tests |
| **Modify** | `apps/api/src/ai-config/services/agent-skills.service.ts` | Inject pipeline; extend `searchSkills()` params; delegate search |
| **Modify** | `apps/api/src/ai-config/services/agent-skills.service.spec.ts` | Update constructor call; add extended-param tests |
| **Modify** | `apps/api/src/ai-config/services/agent-skill-library.service.ts` | Inject `SkillIndexService`; call `invalidateAll()` after write/rename/delete |
| **Modify** | `apps/api/src/ai-config/ai-config.module.ts` | Register new `@Injectable()` services |

---

## Task 1: Define Core Types, Interface, and tokenize() Utility

**Files:**
- Create: `apps/api/src/ai-config/services/skill-search/skill-search-strategy.interface.ts`

- [ ] **Step 1.1: Create the interface file**

```typescript
// apps/api/src/ai-config/services/skill-search/skill-search-strategy.interface.ts
import type { SkillLibraryRecord } from '../agent-skill-library.service.types';

export const FIELD_WEIGHTS = {
  name: 0.40,
  description: 0.25,
  tags: 0.20,
  category: 0.10,
  semantic: 0.05,
} as const;

export const MATCH_SCORES = {
  exact: 1.0,
  substring: 0.7,
} as const;

export interface ScoredSkillResult {
  skill: SkillLibraryRecord;
  score: number;
  matchDetails: {
    strategy: string;
    matchedFields: string[];
    highlights?: string[];
  };
}

export interface ISkillSearchStrategy {
  readonly name: string;
  search(query: string, skills: SkillLibraryRecord[]): ScoredSkillResult[];
}

export interface SkillSearchParams {
  query?: string;
  category?: string;
  tags?: string[];
  includeScores?: boolean;
  minScore?: number;
  limit?: number;
}

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[\s\-_,;:.!?/\\]+/)
    .filter((t) => t.length > 0);
}
```

- [ ] **Step 1.2: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit -p apps/api/tsconfig.app.json`
Expected: No errors.

- [ ] **Step 1.3: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/skill-search-strategy.interface.ts
git commit -m "feat(skill-search): add ISkillSearchStrategy interface, types, and tokenize util"
```

---

## Task 2: Implement TokenMatchStrategy (W1 + W2)

**Files:**
- Create: `apps/api/src/ai-config/services/skill-search/strategies/token-match.strategy.ts`
- Create: `apps/api/src/ai-config/services/skill-search/strategies/token-match.strategy.spec.ts`

- [ ] **Step 2.1: Write the failing tests**

```typescript
// apps/api/src/ai-config/services/skill-search/strategies/token-match.strategy.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TokenMatchStrategy } from './token-match.strategy';
import type { SkillLibraryRecord } from '../../agent-skill-library.service.types';

function makeSkill(overrides: Partial<SkillLibraryRecord> = {}): SkillLibraryRecord {
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
    const nameMatch = makeSkill({ name: 'orchestration-runner', description: 'executes things' });
    const descMatch = makeSkill({ name: 'workflow-engine', description: 'orchestration helper' });
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
    const skill = makeSkill({ name: 'other-skill', description: 'handles orchestration' });
    const [result] = strategy.search('orchestration', [skill]);
    expect(result.matchDetails.matchedFields).toContain('description');
  });

  it('includes "tags" in matchedFields when a tag matches', () => {
    const skill = makeSkill({ name: 'some-skill', description: 'does things', tags: ['orchestration'] });
    const [result] = strategy.search('orchestration', [skill]);
    expect(result.matchDetails.matchedFields).toContain('tags');
  });

  it('filters out skills with zero score', () => {
    const matching = makeSkill({ name: 'orchestration-tool' });
    const nonMatching = makeSkill({ name: 'database-connector', description: 'connects databases' });
    const results = strategy.search('orchestration', [matching, nonMatching]);
    expect(results.every((r) => r.score > 0)).toBe(true);
    expect(results.map((r) => r.skill.name)).toContain('orchestration-tool');
    expect(results.map((r) => r.skill.name)).not.toContain('database-connector');
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
    const skill = makeSkill({ name: 'advisor-tool', description: 'discovery helper' });
    const results = strategy.search('advisor discovery', [skill]);
    expect(results).toHaveLength(1);
    expect(results[0].matchDetails.matchedFields).toContain('name');
    expect(results[0].matchDetails.matchedFields).toContain('description');
  });
});
```

- [ ] **Step 2.2: Run tests to confirm they fail**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/strategies/token-match.strategy.spec.ts`
Expected: FAIL — `TokenMatchStrategy` module not found.

- [ ] **Step 2.3: Implement TokenMatchStrategy**

```typescript
// apps/api/src/ai-config/services/skill-search/strategies/token-match.strategy.ts
import { Injectable } from '@nestjs/common';
import type { SkillLibraryRecord } from '../../agent-skill-library.service.types';
import {
  FIELD_WEIGHTS,
  ISkillSearchStrategy,
  MATCH_SCORES,
  ScoredSkillResult,
  tokenize,
} from '../skill-search-strategy.interface';

@Injectable()
export class TokenMatchStrategy implements ISkillSearchStrategy {
  readonly name = 'token-match';

  search(query: string, skills: SkillLibraryRecord[]): ScoredSkillResult[] {
    const tokens = tokenize(query);
    if (!tokens.length || !skills.length) return [];

    return skills
      .map((skill) => this.scoreSkill(tokens, skill))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  private scoreSkill(tokens: string[], skill: SkillLibraryRecord): ScoredSkillResult {
    const matchedFields: string[] = [];

    const nameScore = this.scoreField(tokens, skill.name);
    const descScore = this.scoreField(tokens, skill.description);
    const tagScore = this.scoreField(tokens, (skill.tags ?? []).join(' '));
    const catScore = this.scoreField(tokens, skill.category ?? '');

    if (nameScore > 0) matchedFields.push('name');
    if (descScore > 0) matchedFields.push('description');
    if (tagScore > 0) matchedFields.push('tags');
    if (catScore > 0) matchedFields.push('category');

    const score =
      FIELD_WEIGHTS.name * nameScore +
      FIELD_WEIGHTS.description * descScore +
      FIELD_WEIGHTS.tags * tagScore +
      FIELD_WEIGHTS.category * catScore;

    return { skill, score, matchDetails: { strategy: this.name, matchedFields } };
  }

  private scoreField(tokens: string[], fieldValue: string): number {
    if (!fieldValue) return 0;
    const lowerField = fieldValue.toLowerCase();
    const fieldTokens = tokenize(fieldValue);

    const tokenScores = tokens.map((token) => {
      if (fieldTokens.includes(token)) return MATCH_SCORES.exact;
      if (lowerField.includes(token)) return MATCH_SCORES.substring;
      return 0;
    });

    return tokenScores.reduce((a, b) => a + b, 0) / tokens.length;
  }
}
```

- [ ] **Step 2.4: Run tests to confirm they pass**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/strategies/token-match.strategy.spec.ts`
Expected: PASS (all 9 tests green).

- [ ] **Step 2.5: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/strategies/
git commit -m "feat(skill-search): implement TokenMatchStrategy with field-weighted relevance scoring"
```

---

## Task 3: Implement FuzzyMatchStrategy (W3)

**Files:**
- Create: `apps/api/src/ai-config/services/skill-search/strategies/fuzzy-match.strategy.ts`
- Create: `apps/api/src/ai-config/services/skill-search/strategies/fuzzy-match.strategy.spec.ts`

- [ ] **Step 3.1: Write the failing tests**

```typescript
// apps/api/src/ai-config/services/skill-search/strategies/fuzzy-match.strategy.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { FuzzyMatchStrategy, levenshteinDistance, fuzzyThreshold } from './fuzzy-match.strategy';
import type { SkillLibraryRecord } from '../../agent-skill-library.service.types';

function makeSkill(overrides: Partial<SkillLibraryRecord> = {}): SkillLibraryRecord {
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

  it('returns 2 for two transpositions ("orchestration" vs "orchestartion")', () => {
    expect(levenshteinDistance('orchestration', 'orchestartion')).toBe(2);
  });

  it('handles empty strings', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('', '')).toBe(0);
  });
});

describe('fuzzyThreshold', () => {
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

  it('matches a typo variant of a skill name ("orchestartion" → "orchestration")', () => {
    const skill = makeSkill({ name: 'orchestration-runner' });
    const results = strategy.search('orchestartion', [skill]);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('does NOT match short words with typos (threshold=0 for ≤3 chars)', () => {
    // "ap" vs "api" — threshold is 0, so only exact match
    const skill = makeSkill({ name: 'api-client', description: 'connects to api' });
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
```

- [ ] **Step 3.2: Run tests to confirm they fail**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/strategies/fuzzy-match.strategy.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement FuzzyMatchStrategy**

```typescript
// apps/api/src/ai-config/services/skill-search/strategies/fuzzy-match.strategy.ts
import { Injectable } from '@nestjs/common';
import type { SkillLibraryRecord } from '../../agent-skill-library.service.types';
import {
  FIELD_WEIGHTS,
  ISkillSearchStrategy,
  MATCH_SCORES,
  ScoredSkillResult,
  tokenize,
} from '../skill-search-strategy.interface';

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

export function fuzzyThreshold(word: string): number {
  if (word.length <= 3) return 0;
  if (word.length === 4) return 1;
  return 2;
}

@Injectable()
export class FuzzyMatchStrategy implements ISkillSearchStrategy {
  readonly name = 'fuzzy-match';

  search(query: string, skills: SkillLibraryRecord[]): ScoredSkillResult[] {
    const tokens = tokenize(query);
    if (!tokens.length || !skills.length) return [];

    return skills
      .map((skill) => this.scoreSkill(tokens, skill))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  private scoreSkill(tokens: string[], skill: SkillLibraryRecord): ScoredSkillResult {
    const matchedFields: string[] = [];

    const nameScore = this.fuzzyScoreField(tokens, skill.name);
    const descScore = this.fuzzyScoreField(tokens, skill.description);
    const tagScore = this.fuzzyScoreField(tokens, (skill.tags ?? []).join(' '));
    const catScore = this.fuzzyScoreField(tokens, skill.category ?? '');

    if (nameScore > 0) matchedFields.push('name');
    if (descScore > 0) matchedFields.push('description');
    if (tagScore > 0) matchedFields.push('tags');
    if (catScore > 0) matchedFields.push('category');

    const score =
      FIELD_WEIGHTS.name * nameScore +
      FIELD_WEIGHTS.description * descScore +
      FIELD_WEIGHTS.tags * tagScore +
      FIELD_WEIGHTS.category * catScore;

    return { skill, score, matchDetails: { strategy: this.name, matchedFields } };
  }

  private fuzzyScoreField(tokens: string[], fieldValue: string): number {
    if (!fieldValue) return 0;
    const fieldTokens = tokenize(fieldValue);
    if (!fieldTokens.length) return 0;

    const tokenScores = tokens.map((token) => {
      const threshold = fuzzyThreshold(token);
      let best = 0;

      for (const ft of fieldTokens) {
        if (token === ft) {
          best = Math.max(best, MATCH_SCORES.exact);
          continue;
        }
        if (threshold === 0) continue;

        const dist = levenshteinDistance(token, ft);
        if (dist <= threshold) {
          const fuzzyScore = 1.0 - dist / Math.max(token.length, ft.length);
          best = Math.max(best, fuzzyScore);
        }
      }

      return best;
    });

    return tokenScores.reduce((a, b) => a + b, 0) / tokens.length;
  }
}
```

- [ ] **Step 3.4: Run tests to confirm they pass**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/strategies/fuzzy-match.strategy.spec.ts`
Expected: PASS (all 12 tests green).

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/strategies/fuzzy-match.strategy.ts \
        apps/api/src/ai-config/services/skill-search/strategies/fuzzy-match.strategy.spec.ts
git commit -m "feat(skill-search): implement FuzzyMatchStrategy with Levenshtein distance scoring"
```

---

## Task 4: Implement TfIdfMatchStrategy (W5)

**Files:**
- Create: `apps/api/src/ai-config/services/skill-search/strategies/tfidf-match.strategy.ts`
- Create: `apps/api/src/ai-config/services/skill-search/strategies/tfidf-match.strategy.spec.ts`

- [ ] **Step 4.1: Write the failing tests**

```typescript
// apps/api/src/ai-config/services/skill-search/strategies/tfidf-match.strategy.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TfIdfMatchStrategy } from './tfidf-match.strategy';
import type { SkillLibraryRecord } from '../../agent-skill-library.service.types';

function makeSkill(overrides: Partial<SkillLibraryRecord> = {}): SkillLibraryRecord {
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
      makeSkill({ name: 'orchestration-runner', description: 'orchestration tool' }),
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
    const matching = makeSkill({ name: 'orchestration-tool', description: 'handles orchestration' });
    const nonMatching = makeSkill({ name: 'database-tool', description: 'manages databases' });
    const results = strategy.search('orchestration', [matching, nonMatching]);
    expect(results.every((r) => r.score > 0)).toBe(true);
    expect(results.map((r) => r.skill.name)).not.toContain('database-tool');
  });

  it('returns results sorted by score descending', () => {
    const skills = [
      makeSkill({ name: 'orchestration-runner', description: 'runs orchestration' }),
      makeSkill({ name: 'workflow-engine', description: 'manages orchestration pipelines' }),
      makeSkill({ name: 'database-tool', description: 'manages databases' }),
    ];
    const results = strategy.search('orchestration', skills);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });
});
```

- [ ] **Step 4.2: Run tests to confirm they fail**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/strategies/tfidf-match.strategy.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement TfIdfMatchStrategy**

```typescript
// apps/api/src/ai-config/services/skill-search/strategies/tfidf-match.strategy.ts
import { Injectable } from '@nestjs/common';
import type { SkillLibraryRecord } from '../../agent-skill-library.service.types';
import { ISkillSearchStrategy, ScoredSkillResult, tokenize } from '../skill-search-strategy.interface';

interface SkillDoc {
  skill: SkillLibraryRecord;
  tf: Map<string, number>;
}

@Injectable()
export class TfIdfMatchStrategy implements ISkillSearchStrategy {
  readonly name = 'tfidf';

  search(query: string, skills: SkillLibraryRecord[]): ScoredSkillResult[] {
    const tokens = tokenize(query);
    if (!tokens.length || !skills.length) return [];

    const docs = skills.map((skill) => this.buildDoc(skill));

    // df(term) = number of documents containing the term
    const df = new Map<string, number>();
    for (const { tf } of docs) {
      for (const term of tf.keys()) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }

    const N = skills.length;

    return docs
      .map(({ skill, tf }) => {
        let rawScore = 0;
        for (const token of tokens) {
          const termTf = tf.get(token) ?? 0;
          const termDf = df.get(token) ?? 0;
          if (termTf > 0 && termDf > 0) {
            rawScore += termTf * Math.log(N / termDf);
          }
        }
        // Normalize to [0, 1]: divide by query length so single-token scores don't exceed 1
        const score = Math.min(rawScore / tokens.length, 1.0);
        return {
          skill,
          score,
          matchDetails: {
            strategy: this.name,
            matchedFields: score > 0 ? ['content'] : [],
          },
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  private buildDoc(skill: SkillLibraryRecord): SkillDoc {
    // Weight name tokens 4×, description 2×, tags and category 1×
    const terms = [
      ...tokenize(skill.name).flatMap((t) => [t, t, t, t]),
      ...tokenize(skill.description).flatMap((t) => [t, t]),
      ...(skill.tags ?? []).flatMap(tokenize),
      ...(skill.category ? tokenize(skill.category) : []),
    ];

    const tf = new Map<string, number>();
    for (const term of terms) {
      tf.set(term, (tf.get(term) ?? 0) + 1 / terms.length);
    }

    return { skill, tf };
  }
}
```

- [ ] **Step 4.4: Run tests to confirm they pass**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/strategies/tfidf-match.strategy.spec.ts`
Expected: PASS (all 6 tests green).

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/strategies/tfidf-match.strategy.ts \
        apps/api/src/ai-config/services/skill-search/strategies/tfidf-match.strategy.spec.ts
git commit -m "feat(skill-search): implement TfIdfMatchStrategy for corpus-aware relevance scoring"
```

---

## Task 5: Implement SkillIndexService (W4)

**Files:**
- Create: `apps/api/src/ai-config/services/skill-search/skill-index.service.ts`
- Create: `apps/api/src/ai-config/services/skill-search/skill-index.service.spec.ts`

- [ ] **Step 5.1: Write the failing tests**

```typescript
// apps/api/src/ai-config/services/skill-search/skill-index.service.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillIndexService } from './skill-index.service';
import type { SkillLibraryRecord } from '../agent-skill-library.service.types';

function makeSkill(overrides: Partial<SkillLibraryRecord> = {}): SkillLibraryRecord {
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
    const skills = [makeSkill({ name: 'skill-a' }), makeSkill({ name: 'skill-b' })];
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
    const skill = makeSkill({ name: 'orchestration-runner', description: 'runs pipelines' });
    service.build([skill]);
    const results = service.searchTokens(['orchestration']);
    expect(results.has('orchestration-runner')).toBe(true);
  });

  it('searchTokens() with empty words returns all skill names', () => {
    service.build([makeSkill({ name: 'skill-a' }), makeSkill({ name: 'skill-b' })]);
    expect(service.searchTokens([])).toEqual(new Set(['skill-a', 'skill-b']));
  });

  it('invalidate() removes the skill from index and inverted index', () => {
    const skill = makeSkill({ name: 'removable-skill', description: 'this will be removed' });
    service.build([skill]);
    service.invalidate('removable-skill');
    expect(service.get('removable-skill')).toBeUndefined();
    expect(service.searchTokens(['removable']).has('removable-skill')).toBe(false);
  });

  it('invalidate() on unknown name is a no-op', () => {
    service.build([makeSkill({ name: 'safe-skill' })]);
    expect(() => service.invalidate('ghost')).not.toThrow();
    expect(service.getAll()).toHaveLength(1);
  });

  it('invalidateAll() resets the index to unbuilt state', () => {
    service.build([makeSkill()]);
    service.invalidateAll();
    expect(service.isBuilt()).toBe(false);
    expect(service.getAll()).toHaveLength(0);
  });
});
```

- [ ] **Step 5.2: Run tests to confirm they fail**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/skill-index.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement SkillIndexService**

```typescript
// apps/api/src/ai-config/services/skill-search/skill-index.service.ts
import { Injectable } from '@nestjs/common';
import type { SkillLibraryRecord } from '../agent-skill-library.service.types';
import { tokenize } from './skill-search-strategy.interface';

@Injectable()
export class SkillIndexService {
  private readonly skillIndex = new Map<string, SkillLibraryRecord>();
  private readonly invertedIndex = new Map<string, Set<string>>();
  private built = false;

  build(skills: SkillLibraryRecord[]): void {
    this.skillIndex.clear();
    this.invertedIndex.clear();

    for (const skill of skills) {
      this.addSkill(skill);
    }

    this.built = true;
  }

  invalidate(skillName: string): void {
    const skill = this.skillIndex.get(skillName);
    if (!skill) return;

    for (const word of this.extractWords(skill)) {
      this.invertedIndex.get(word)?.delete(skillName);
    }

    this.skillIndex.delete(skillName);
  }

  invalidateAll(): void {
    this.skillIndex.clear();
    this.invertedIndex.clear();
    this.built = false;
  }

  isBuilt(): boolean {
    return this.built;
  }

  searchTokens(words: string[]): Set<string> {
    if (!words.length) return new Set(this.skillIndex.keys());

    const results = new Set<string>();
    for (const word of words) {
      const matches = this.invertedIndex.get(word);
      if (matches) {
        for (const name of matches) results.add(name);
      }
    }
    return results;
  }

  getAll(): SkillLibraryRecord[] {
    return Array.from(this.skillIndex.values());
  }

  get(skillName: string): SkillLibraryRecord | undefined {
    return this.skillIndex.get(skillName);
  }

  private addSkill(skill: SkillLibraryRecord): void {
    this.skillIndex.set(skill.name, skill);

    for (const word of this.extractWords(skill)) {
      if (!this.invertedIndex.has(word)) {
        this.invertedIndex.set(word, new Set());
      }
      this.invertedIndex.get(word)!.add(skill.name);
    }
  }

  private extractWords(skill: SkillLibraryRecord): string[] {
    return [
      ...tokenize(skill.name),
      ...tokenize(skill.description),
      ...(skill.tags ?? []).flatMap(tokenize),
      ...(skill.category ? tokenize(skill.category) : []),
    ];
  }
}
```

- [ ] **Step 5.4: Run tests to confirm they pass**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/skill-index.service.spec.ts`
Expected: PASS (all 10 tests green).

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/skill-index.service.ts \
        apps/api/src/ai-config/services/skill-search/skill-index.service.spec.ts
git commit -m "feat(skill-search): implement SkillIndexService with lazy build and full invalidation"
```

---

## Task 6: Implement SkillSearchPipelineService

**Files:**
- Create: `apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.ts`
- Create: `apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts`

- [ ] **Step 6.1: Write the failing tests**

```typescript
// apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillSearchPipelineService } from './skill-search-pipeline.service';
import { SkillIndexService } from './skill-index.service';
import { TokenMatchStrategy } from './strategies/token-match.strategy';
import { FuzzyMatchStrategy } from './strategies/fuzzy-match.strategy';
import { TfIdfMatchStrategy } from './strategies/tfidf-match.strategy';
import type { SkillLibraryRecord } from '../agent-skill-library.service.types';

function makeSkill(overrides: Partial<SkillLibraryRecord> = {}): SkillLibraryRecord {
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
      makeSkill({ name: 'orchestration-runner', description: 'runs orchestration', category: 'automation', tags: [] }),
      makeSkill({ name: 'database-connector', description: 'connects databases', category: 'data', tags: [] }),
      makeSkill({ name: 'debug-helper', description: 'helps debug issues', category: null, tags: ['debugging'] }),
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
    expect(results.every((r) => r.skill.tags.includes('alpha') && r.skill.tags.includes('beta'))).toBe(true);
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

  it('applies minScore filter', () => {
    const results = pipeline.search({ query: 'orchestration', minScore: 0.95 });
    expect(results.every((r) => r.score >= 0.95)).toBe(true);
  });

  it('applies limit', () => {
    const results = pipeline.search({ query: 'orchestration runner debug', limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
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
    expect(results.some((r) => r.skill.name === 'orchestration-runner')).toBe(true);
  });
});
```

- [ ] **Step 6.2: Run tests to confirm they fail**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement SkillSearchPipelineService**

```typescript
// apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.ts
import { Injectable } from '@nestjs/common';
import type { SkillLibraryRecord } from '../agent-skill-library.service.types';
import {
  ScoredSkillResult,
  SkillSearchParams,
} from './skill-search-strategy.interface';
import { SkillIndexService } from './skill-index.service';
import { TokenMatchStrategy } from './strategies/token-match.strategy';
import { FuzzyMatchStrategy } from './strategies/fuzzy-match.strategy';
import { TfIdfMatchStrategy } from './strategies/tfidf-match.strategy';

@Injectable()
export class SkillSearchPipelineService {
  constructor(
    private readonly index: SkillIndexService,
    private readonly tokenMatch: TokenMatchStrategy,
    private readonly fuzzyMatch: FuzzyMatchStrategy,
    private readonly tfIdf: TfIdfMatchStrategy,
  ) {}

  search(params: SkillSearchParams, fallbackSkills?: SkillLibraryRecord[]): ScoredSkillResult[] {
    if (!this.index.isBuilt() && fallbackSkills) {
      this.index.build(fallbackSkills);
    }

    let candidates = this.index.getAll();
    candidates = this.applyFilters(candidates, params);

    const query = params.query?.trim();
    if (!query) {
      return candidates.map((skill) => ({
        skill,
        score: 1.0,
        matchDetails: { strategy: 'filter', matchedFields: [] },
      }));
    }

    const resultMap = new Map<string, ScoredSkillResult>();
    for (const strategy of [this.tokenMatch, this.fuzzyMatch, this.tfIdf]) {
      for (const result of strategy.search(query, candidates)) {
        const existing = resultMap.get(result.skill.name);
        if (!existing || result.score > existing.score) {
          resultMap.set(result.skill.name, result);
        }
      }
    }

    let results = Array.from(resultMap.values()).sort((a, b) => b.score - a.score);

    if (params.minScore !== undefined) {
      results = results.filter((r) => r.score >= params.minScore!);
    }

    if (params.limit !== undefined) {
      results = results.slice(0, params.limit);
    }

    return results;
  }

  private applyFilters(skills: SkillLibraryRecord[], params: SkillSearchParams): SkillLibraryRecord[] {
    let filtered = skills;

    if (params.category) {
      const cat = params.category.trim().toLowerCase();
      filtered = filtered.filter((s) => s.category?.toLowerCase() === cat);
    }

    if (params.tags?.length) {
      const tags = params.tags.map((t) => t.trim().toLowerCase());
      filtered = filtered.filter((s) =>
        tags.every((tag) => (s.tags ?? []).map((t) => t.toLowerCase()).includes(tag)),
      );
    }

    return filtered;
  }
}
```

- [ ] **Step 6.4: Run tests to confirm they pass**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts`
Expected: PASS (all 9 tests green).

- [ ] **Step 6.5: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.ts \
        apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts
git commit -m "feat(skill-search): implement SkillSearchPipelineService with max-score merging and ranking"
```

---

## Task 7: Update AgentSkillsService to Delegate to Pipeline (W1 completion)

**Files:**
- Modify: `apps/api/src/ai-config/services/agent-skills.service.ts`
- Modify: `apps/api/src/ai-config/services/agent-skills.service.spec.ts`

The current `searchSkills()` (lines 33–63) implements category filter → tag filter → tokenized substring match inline. We replace the body with a pipeline delegation and extend the params.

- [ ] **Step 7.1: Write new failing tests — add at the end of the existing `describe('searchSkills')` block**

Open `apps/api/src/ai-config/services/agent-skills.service.spec.ts`. Find the `describe('searchSkills', ...)` block. Add these tests inside it:

```typescript
    it('returns results sorted by score descending when query is provided', () => {
      const skills = [
        {
          id: 'skill-1',
          name: 'review-plan',
          description: 'Review the plan',
          category: 'orchestration',
          tags: ['review', 'planning'],
          isActive: true,
          skillMarkdown: '',
          compatibility: null,
          metadata: null,
          source: 'imported' as const,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPath: '/skills/review-plan',
        },
        {
          id: 'skill-2',
          name: 'workflow-engine',
          description: 'manages review pipelines',
          category: 'automation',
          tags: [],
          isActive: true,
          skillMarkdown: '',
          compatibility: null,
          metadata: null,
          source: 'imported' as const,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPath: '/skills/workflow-engine',
        },
      ];
      (skillLibrary.listSkills as any).mockReturnValue(skills);

      const results = service.searchSkills({ query: 'review' });
      // "review-plan" has "review" in name (higher score) vs "workflow-engine" has "review" in description
      expect(results[0].name).toBe('review-plan');
    });

    it('surfaces _score on results when includeScores=true', () => {
      const skills = [
        {
          id: 'skill-1',
          name: 'orchestration-runner',
          description: 'executes orchestration workflows',
          category: null,
          tags: [],
          isActive: true,
          skillMarkdown: '',
          compatibility: null,
          metadata: null,
          source: 'imported' as const,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPath: '/skills/orchestration-runner',
        },
      ];
      (skillLibrary.listSkills as any).mockReturnValue(skills);

      const results = service.searchSkills({ query: 'orchestration', includeScores: true });
      expect((results[0] as any)._score).toBeGreaterThan(0);
      expect((results[0] as any)._matchDetails).toBeDefined();
    });

    it('does NOT surface _score when includeScores is not set', () => {
      const skills = [
        {
          id: 'skill-1',
          name: 'orchestration-runner',
          description: 'orchestration workflows',
          category: null,
          tags: [],
          isActive: true,
          skillMarkdown: '',
          compatibility: null,
          metadata: null,
          source: 'imported' as const,
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          rootPath: '/skills/orchestration-runner',
        },
      ];
      (skillLibrary.listSkills as any).mockReturnValue(skills);

      const results = service.searchSkills({ query: 'orchestration' });
      expect((results[0] as any)._score).toBeUndefined();
    });

    it('respects limit param', () => {
      const skills = [
        { id: 's1', name: 'skill-one', description: 'first skill match', category: null, tags: [], isActive: true, skillMarkdown: '', compatibility: null, metadata: null, source: 'imported' as const, version: 1, createdAt: new Date(), updatedAt: new Date(), rootPath: '/s1' },
        { id: 's2', name: 'skill-two', description: 'second skill match', category: null, tags: [], isActive: true, skillMarkdown: '', compatibility: null, metadata: null, source: 'imported' as const, version: 1, createdAt: new Date(), updatedAt: new Date(), rootPath: '/s2' },
      ];
      (skillLibrary.listSkills as any).mockReturnValue(skills);

      const results = service.searchSkills({ query: 'skill', limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });
```

- [ ] **Step 7.2: Run the full spec to verify new tests fail, existing tests still pass**

Run: `npx vitest run apps/api/src/ai-config/services/agent-skills.service.spec.ts`
Expected: The new tests FAIL (constructor still has 2 args); all prior tests PASS.

- [ ] **Step 7.3: Update agent-skills.service.ts — add import and extend params type**

At the top of `agent-skills.service.ts`, add imports after the existing import block:

```typescript
import { SkillSearchPipelineService } from './skill-search/skill-search-pipeline.service';
import type { SkillSearchParams } from './skill-search/skill-search-strategy.interface';
```

Replace the existing `searchSkills` param type inline definition with:

```typescript
// Replace (line ~33):
searchSkills(params: { query?: string; category?: string; tags?: string[] }) {
// With:
searchSkills(params: SkillSearchParams): SkillLibraryRecord[] {
```

- [ ] **Step 7.4: Add pipeline to the constructor**

Replace the existing constructor:

```typescript
// Before:
  constructor(
    private readonly skillLibrary: AgentSkillLibraryService,
    private readonly profiles: AgentProfileRepository,
  ) {}

// After:
  constructor(
    private readonly skillLibrary: AgentSkillLibraryService,
    private readonly pipeline: SkillSearchPipelineService,
    private readonly profiles: AgentProfileRepository,
  ) {}
```

- [ ] **Step 7.5: Replace searchSkills() body**

Replace the full `searchSkills()` method body (lines 33–64):

```typescript
  searchSkills(params: SkillSearchParams): SkillLibraryRecord[] {
    const allSkills = this.skillLibrary.listSkills({ includeInactive: false });
    const scored = this.pipeline.search(params, allSkills);

    if (params.includeScores) {
      return scored.map(({ skill, score, matchDetails }) =>
        Object.assign(skill, { _score: score, _matchDetails: matchDetails }),
      );
    }

    return scored.map(({ skill }) => skill);
  }
```

- [ ] **Step 7.6: Update the spec's beforeEach to inject a real pipeline**

In `agent-skills.service.spec.ts`, add the imports at the top of the file:

```typescript
import { SkillIndexService } from './skill-search/skill-index.service';
import { TokenMatchStrategy } from './skill-search/strategies/token-match.strategy';
import { FuzzyMatchStrategy } from './skill-search/strategies/fuzzy-match.strategy';
import { TfIdfMatchStrategy } from './skill-search/strategies/tfidf-match.strategy';
import { SkillSearchPipelineService } from './skill-search/skill-search-pipeline.service';
```

Then update the `beforeEach` service instantiation (currently line 90):

```typescript
// Before:
    service = new AgentSkillsService(skillLibrary, profileRepo);

// After:
    const searchPipeline = new SkillSearchPipelineService(
      new SkillIndexService(),
      new TokenMatchStrategy(),
      new FuzzyMatchStrategy(),
      new TfIdfMatchStrategy(),
    );
    service = new AgentSkillsService(skillLibrary, searchPipeline, profileRepo);
```

- [ ] **Step 7.7: Run the full spec — all tests must pass**

Run: `npx vitest run apps/api/src/ai-config/services/agent-skills.service.spec.ts`
Expected: PASS — all tests green (existing + new).

If the existing test `'matches multi-word queries by tokenizing...'` fails on ordering, it is because the pipeline now returns skills in score order. Verify: `review-plan` scores higher than `debug-code` for query `'plan review code'` (2 matching words vs 1), so the `toEqual([skills[0], skills[1]])` expectation is preserved.

- [ ] **Step 7.8: Commit**

```bash
git add apps/api/src/ai-config/services/agent-skills.service.ts \
        apps/api/src/ai-config/services/agent-skills.service.spec.ts
git commit -m "feat(skill-search): delegate AgentSkillsService.searchSkills() to SkillSearchPipelineService"
```

---

## Task 8: Hook Index Invalidation into AgentSkillLibraryService (W4)

**Files:**
- Modify: `apps/api/src/ai-config/services/agent-skill-library.service.ts`

The `AgentSkillLibraryService` currently has no constructor dependencies (line 33). We inject `SkillIndexService` and call `invalidateAll()` after any skill is written, renamed, or deleted so the next search rebuilds the index from fresh filesystem data.

> **Why `invalidateAll()` not `invalidate(name)`?** A write operation changes the skill's content — the old index entry is stale but we'd also need to re-add the updated skill. Calling `invalidateAll()` keeps the logic simple: the next `searchSkills()` call passes all active skills as `fallbackSkills`, the pipeline rebuilds the index from scratch.

- [ ] **Step 8.1: Add SkillIndexService import and constructor injection**

At the top of `agent-skill-library.service.ts`, add:

```typescript
import { SkillIndexService } from './skill-search/skill-index.service';
```

Replace the existing constructor (line 33):

```typescript
// Before:
  constructor() {
    this.libraryRoot =
      process.env.NEXUS_SKILLS_LIBRARY_PATH?.trim() ||
      path.join(process.cwd(), 'storage', 'skills');

    fs.mkdirSync(this.libraryRoot, { recursive: true });
  }

// After:
  constructor(private readonly skillIndex: SkillIndexService) {
    this.libraryRoot =
      process.env.NEXUS_SKILLS_LIBRARY_PATH?.trim() ||
      path.join(process.cwd(), 'storage', 'skills');

    fs.mkdirSync(this.libraryRoot, { recursive: true });
  }
```

- [ ] **Step 8.2: Locate writeSkillMarkdown, renameSkill, deleteSkill method boundaries**

Run: `grep -n "writeSkillMarkdown\|renameSkill\|deleteSkill" apps/api/src/ai-config/services/agent-skill-library.service.ts`

Note the line numbers for the closing `}` of each method. You will add `this.skillIndex.invalidateAll();` as the last statement before `return` in each of the three methods.

- [ ] **Step 8.3: Add invalidateAll() call inside writeSkillMarkdown**

Find the `writeSkillMarkdown` method. Before the final `return` statement (which returns the `SkillLibraryRecord`), add:

```typescript
this.skillIndex.invalidateAll();
```

- [ ] **Step 8.4: Add invalidateAll() call inside renameSkill**

Find the `renameSkill` method. Before the final statement that returns or ends the method, add:

```typescript
this.skillIndex.invalidateAll();
```

- [ ] **Step 8.5: Add invalidateAll() call inside deleteSkill**

Find the `deleteSkill` method. Before the final statement that returns or ends the method, add:

```typescript
this.skillIndex.invalidateAll();
```

- [ ] **Step 8.6: Run the agent-skill-library spec to verify no regressions**

Run: `npx vitest run apps/api/src/ai-config/services/agent-skill-library.service.spec.ts`

If the spec instantiates `AgentSkillLibraryService` directly (e.g., `new AgentSkillLibraryService()`), update it to pass a `SkillIndexService` mock. Check the spec's `beforeEach` and if it has:
```typescript
service = new AgentSkillLibraryService();
```
Change it to:
```typescript
import { vi } from 'vitest';
const mockIndex = { invalidateAll: vi.fn(), invalidate: vi.fn(), isBuilt: vi.fn(), build: vi.fn(), getAll: vi.fn(), get: vi.fn(), searchTokens: vi.fn() };
service = new AgentSkillLibraryService(mockIndex as any);
```

Expected: PASS — all existing tests green.

- [ ] **Step 8.7: Commit**

```bash
git add apps/api/src/ai-config/services/agent-skill-library.service.ts
git commit -m "feat(skill-search): invalidate SkillIndexService after every skill write, rename, or delete"
```

---

## Task 9: Register New Services in AiConfigModule

**Files:**
- Modify: `apps/api/src/ai-config/ai-config.module.ts`

The module currently has `providers: [AgentSkillLibraryService, AgentSkillsService, ...]`. NestJS cannot instantiate services with constructor dependencies unless they appear in `providers` and their own deps are also listed.

- [ ] **Step 9.1: Add imports to ai-config.module.ts**

Add after the existing service imports (line 34):

```typescript
import { SkillIndexService } from './services/skill-search/skill-index.service';
import { TokenMatchStrategy } from './services/skill-search/strategies/token-match.strategy';
import { FuzzyMatchStrategy } from './services/skill-search/strategies/fuzzy-match.strategy';
import { TfIdfMatchStrategy } from './services/skill-search/strategies/tfidf-match.strategy';
import { SkillSearchPipelineService } from './services/skill-search/skill-search-pipeline.service';
```

- [ ] **Step 9.2: Add to providers array**

In the `providers` array (line 54), add the five new services **before** `AgentSkillLibraryService` and `AgentSkillsService` so NestJS resolves deps in order:

```typescript
  providers: [
    // ... existing providers above ...
    SkillIndexService,
    TokenMatchStrategy,
    FuzzyMatchStrategy,
    TfIdfMatchStrategy,
    SkillSearchPipelineService,
    AgentSkillLibraryService,   // now receives SkillIndexService from DI
    AgentSkillsService,          // now receives SkillSearchPipelineService from DI
    // ... rest of existing providers ...
  ],
```

- [ ] **Step 9.3: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit -p apps/api/tsconfig.app.json`
Expected: No errors.

- [ ] **Step 9.4: Run the full ai-config test suite**

Run: `npx vitest run apps/api/src/ai-config/`
Expected: All tests green.

- [ ] **Step 9.5: Commit**

```bash
git add apps/api/src/ai-config/ai-config.module.ts
git commit -m "feat(skill-search): register search pipeline services in AiConfigModule"
```

---

## Task 10: Final Verification

- [ ] **Step 10.1: Run all strategy + service specs together**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/`
Expected: All tests green.

- [ ] **Step 10.2: Run the full api test suite**

Run: `npx vitest run apps/api/`
Expected: All tests pass; no regressions.

- [ ] **Step 10.3: TypeScript final check**

Run: `npx tsc --noEmit -p apps/api/tsconfig.app.json`
Expected: No errors.

- [ ] **Step 10.4: Push**

```bash
git push
```

---

## Self-Review Checklist

| Requirement (from EPIC-201) | Task |
|-----------------------------|------|
| Tokenized word matching extracted to `TokenMatchStrategy` | Task 2 |
| Fuzzy/typo-tolerant matching (`orchestartion` → `orchestration`) | Task 3 |
| `levenshteinDistance()` with configurable threshold (0 for ≤3 chars, 2 for ≥5) | Task 3 |
| Relevance scoring with field weights (name 0.40, desc 0.25, tags 0.20, category 0.10) | Task 2 |
| Results ranked by score descending | Task 6 |
| TF-IDF strategy with corpus-level IDF | Task 4 |
| In-memory inverted index, lazy build | Task 5 |
| Index invalidation on write/rename/delete | Task 8 |
| `includeScores`, `minScore`, `limit` optional params | Task 7 |
| `_score` and `_matchDetails` on results (only when `includeScores=true`) | Task 7 |
| Backward-compatible — existing callers unchanged | Task 7 (no breaking changes) |
| Strategy pipeline composable (union by max-score) | Task 6 |
| Module registration for NestJS DI | Task 9 |
| W6 (DB-stored config) | **Out of scope for this plan** |
| Embedding strategy | **Out of scope for this plan** |
