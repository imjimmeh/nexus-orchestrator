import { Injectable } from '@nestjs/common';
import type { SkillLibraryRecord } from '../agent-skill-library.service.types';
import type {
  ScoredSkillResult,
  SkillSearchParams,
} from './skill-search-strategy.types';
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

  search(
    params: SkillSearchParams,
    fallbackSkills?: SkillLibraryRecord[],
  ): ScoredSkillResult[] {
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

    let results = Array.from(resultMap.values()).sort(
      (a, b) => b.score - a.score,
    );

    if (params.minScore !== undefined) {
      const minScore = params.minScore;
      results = results.filter((r) => r.score >= minScore);
    }

    if (params.limit !== undefined) {
      results = results.slice(0, params.limit);
    }

    return results;
  }

  private applyFilters(
    skills: SkillLibraryRecord[],
    params: SkillSearchParams,
  ): SkillLibraryRecord[] {
    let filtered = skills;

    if (params.category) {
      const cat = params.category.trim().toLowerCase();
      filtered = filtered.filter((s) => s.category?.toLowerCase() === cat);
    }

    if (params.tags?.length) {
      const tags = params.tags.map((t) => t.trim().toLowerCase());
      filtered = filtered.filter((s) =>
        tags.every((tag) =>
          (s.tags ?? []).map((t) => t.toLowerCase()).includes(tag),
        ),
      );
    }

    return filtered;
  }
}
