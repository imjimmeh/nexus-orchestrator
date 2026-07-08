export const FIELD_WEIGHTS = {
  name: 0.4,
  description: 0.25,
  tags: 0.2,
  category: 0.1,
  semantic: 0.05,
} as const;

export const MATCH_SCORES = {
  exact: 1.0,
  substring: 0.7,
} as const;

export type {
  ScoredSkillResult,
  ISkillSearchStrategy,
  SkillSearchParams,
} from './skill-search-strategy.types';

export function tokenize(text: string): string[] {
  if (text.length === 0) return [];
  return text
    .toLowerCase()
    .split(/[\s\-_,;:.!?/\\]+/)
    .filter((t) => t.length > 0);
}
