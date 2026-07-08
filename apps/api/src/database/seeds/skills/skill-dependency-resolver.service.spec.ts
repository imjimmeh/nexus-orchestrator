import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SkillDependencyResolverService } from './skill-dependency-resolver.service';

function writeSkill(params: {
  root: string;
  name: string;
  prerequisites?: string[];
}): void {
  const skillDir = path.join(params.root, params.name);
  fs.mkdirSync(skillDir, { recursive: true });

  const prerequisites = params.prerequisites ?? [];
  const prerequisitesBlock =
    prerequisites.length > 0
      ? prerequisites.map((value) => `    - ${value}`).join('\n')
      : '    []';

  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    [
      '---',
      `name: ${params.name}`,
      'description: test skill',
      'metadata:',
      '  version: 1.0.0',
      '  prerequisites:',
      prerequisitesBlock,
      '  tier: light',
      '  estimated_duration: 5m',
      '---',
      '',
      '# Skill',
      '',
      '## Overview',
      'overview',
      '',
      '## Prerequisites',
      'prerequisites',
      '',
      '## Instructions',
      '1. run',
      '',
      '## Output Format',
      'output',
    ].join('\n'),
    'utf8',
  );
}

describe('SkillDependencyResolverService', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-deps-'));
    process.env.NEXUS_SKILLS_LIBRARY_PATH = tempRoot;
    delete process.env.STRICT_SKILL_VALIDATION;
  });

  afterEach(() => {
    delete process.env.NEXUS_SKILLS_LIBRARY_PATH;
    delete process.env.STRICT_SKILL_VALIDATION;

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('includes prerequisites before assigned skills', () => {
    writeSkill({ root: tempRoot, name: 'base-skill' });
    writeSkill({
      root: tempRoot,
      name: 'advanced-skill',
      prerequisites: ['base-skill'],
    });

    const resolver = new SkillDependencyResolverService();
    const resolved = resolver.resolve(['advanced-skill']);

    expect(resolved).toEqual(['base-skill', 'advanced-skill']);
  });

  it('detects circular skill dependencies', () => {
    writeSkill({
      root: tempRoot,
      name: 'skill-a',
      prerequisites: ['skill-b'],
    });
    writeSkill({
      root: tempRoot,
      name: 'skill-b',
      prerequisites: ['skill-a'],
    });

    const resolver = new SkillDependencyResolverService();

    expect(() => resolver.resolve(['skill-a'])).toThrow(
      'Circular skill dependency detected',
    );
  });

  it('fails when an assigned skill is unknown', () => {
    writeSkill({ root: tempRoot, name: 'known-skill' });
    const resolver = new SkillDependencyResolverService();

    expect(() => resolver.resolve(['missing-skill'])).toThrow(
      'Unknown skill referenced in dependency resolver: missing-skill',
    );
  });

  it('caches the skills directory listing so it is only read once', () => {
    writeSkill({ root: tempRoot, name: 'skill-a' });
    writeSkill({ root: tempRoot, name: 'skill-b' });

    const resolver = new SkillDependencyResolverService();

    // Warm the cache via the first call
    const firstResult = resolver.listKnownSkills();
    expect(firstResult.has('skill-a')).toBe(true);
    expect(firstResult.has('skill-b')).toBe(true);

    // Remove one skill from disk — a second readdirSync would see only skill-a
    fs.rmSync(path.join(tempRoot, 'skill-b'), { recursive: true });

    // Cached result must still include skill-b (directory not re-read)
    const secondResult = resolver.listKnownSkills();
    expect(secondResult.has('skill-b')).toBe(true);
  });
});
