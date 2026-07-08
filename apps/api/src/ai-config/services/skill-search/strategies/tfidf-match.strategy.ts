import { Injectable } from '@nestjs/common';
import type { SkillLibraryRecord } from '../../agent-skill-library.service.types';
import type {
  ISkillSearchStrategy,
  ScoredSkillResult,
} from '../skill-search-strategy.types';
import { tokenize } from '../skill-search-strategy.interface';

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
          if (termTf > 0) {
            rawScore += termTf * Math.log(N / termDf);
          }
        }
        // Normalize to [0, 1]: divide by query token count
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
