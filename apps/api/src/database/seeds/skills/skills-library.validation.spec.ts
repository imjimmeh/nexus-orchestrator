import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SkillValidationService } from '../../../ai-config/skills/skill-validation.service';
import { SkillDependencyResolverService } from './skill-dependency-resolver.service';

function resolveSeedSkillsRoot(): string {
  return path.resolve(__dirname, '../../../../../../seed/skills');
}

describe('Seed skills library validation', () => {
  it('validates all seed skills against base contract', () => {
    const root = resolveSeedSkillsRoot();
    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    const known = new Set(entries);
    const validator = new SkillValidationService();

    for (const skillName of entries) {
      const markdown = fs.readFileSync(
        path.join(root, skillName, 'SKILL.md'),
        'utf8',
      );

      const result = validator.validateSkillMarkdown({
        skillName,
        markdown,
        knownSkillNames: known,
        strict: false,
      });

      expect(result.errors).toEqual([]);
    }
  });

  it('resolves prerequisite chains for all skills without circular references', () => {
    const root = resolveSeedSkillsRoot();
    process.env.NEXUS_SKILLS_LIBRARY_PATH = root;

    const entries = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    const resolver = new SkillDependencyResolverService();
    const resolved = resolver.resolve(entries);

    expect(resolved.length).toBeGreaterThan(0);

    delete process.env.NEXUS_SKILLS_LIBRARY_PATH;
  });
});
