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

  private scoreSkill(
    tokens: string[],
    skill: SkillLibraryRecord,
  ): ScoredSkillResult {
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

    return {
      skill,
      score,
      matchDetails: { strategy: this.name, matchedFields },
    };
  }

  private scoreField(tokens: string[], fieldValue: string): number {
    if (fieldValue.length === 0) return 0;
    const lowerField = fieldValue.toLowerCase();
    const fieldTokens = tokenize(fieldValue);

    const tokenScores = tokens.map((token) => {
      if (fieldTokens.includes(token)) return MATCH_SCORES.exact;
      if (lowerField.includes(token)) return MATCH_SCORES.substring;
      return 0;
    });

    return tokenScores.reduce<number>((a, b) => a + b, 0) / tokens.length;
  }
}
