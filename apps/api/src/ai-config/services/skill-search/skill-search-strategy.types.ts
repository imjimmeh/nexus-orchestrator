import type { SkillLibraryRecord } from '../agent-skill-library.service.types';

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
