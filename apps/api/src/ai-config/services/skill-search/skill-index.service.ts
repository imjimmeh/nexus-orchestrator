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
      let bucket = this.invertedIndex.get(word);
      if (!bucket) {
        bucket = new Set();
        this.invertedIndex.set(word, bucket);
      }
      bucket.add(skill.name);
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
