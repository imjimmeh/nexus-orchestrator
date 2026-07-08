import { Injectable } from '@nestjs/common';
import type { SkillLibraryRecord } from '../../agent-skill-library.service.types';
import type {
  ISkillSearchStrategy,
  ScoredSkillResult,
} from '../skill-search-strategy.types';
import {
  FIELD_WEIGHTS,
  MATCH_SCORES,
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

  private scoreSkill(
    tokens: string[],
    skill: SkillLibraryRecord,
  ): ScoredSkillResult {
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

    return {
      skill,
      score,
      matchDetails: { strategy: this.name, matchedFields },
    };
  }

  private fuzzyScoreField(tokens: string[], fieldValue: string): number {
    if (fieldValue.length === 0) return 0;
    const fieldTokens = tokenize(fieldValue);
    if (fieldTokens.length === 0) return 0;

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

    return tokenScores.reduce<number>((a, b) => a + b, 0) / tokens.length;
  }
}
