import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SkillSeedService } from './skills.seed';

/**
 * Minimal SKILL.md that passes SkillValidationService in non-strict mode.
 * The `name` field must match the directory name (`test-skill`).
 */
const SEED_SKILL_CONTENT = `---
name: test-skill
description: A seeded test skill.
---

## Overview

Seeded content.
`;

/**
 * Runtime-authored SKILL.md with a confirmed scope and nexus_origin.source=agent_factory.
 * The unique marker string is used to prove byte-for-byte survival.
 */
const RUNTIME_SKILL_CONTENT = `---
name: test-skill
description: A seeded test skill.
nexus_origin:
  source: agent_factory
  stamped_at: '2026-01-01T00:00:00.000Z'
scope:
  confirmed_at: '2026-01-02T00:00:00.000Z'
---

## Overview

RUNTIME_AUTHORED_UNIQUE_MARKER content here.
`;

function writeSeedSkill(
  seedRoot: string,
  skillName: string,
  content: string,
): void {
  const dir = path.join(seedRoot, skillName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
}

function writeLibrarySkill(
  libraryRoot: string,
  skillName: string,
  content: string,
): void {
  const dir = path.join(libraryRoot, skillName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
}

function readLibrarySkill(libraryRoot: string, skillName: string): string {
  return fs.readFileSync(path.join(libraryRoot, skillName, 'SKILL.md'), 'utf8');
}

describe('SkillSeedService — override-safe re-seeding (EPIC-212 Phase 4 Task 5)', () => {
  let seedRoot: string;
  let libraryRoot: string;
  const savedEnv: Record<string, string | undefined> = {};

  function captureEnv(...keys: string[]): void {
    for (const key of keys) {
      savedEnv[key] = process.env[key];
    }
  }

  function restoreEnv(): void {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  }

  beforeEach(() => {
    seedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-seed-'));
    libraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-library-'));

    captureEnv(
      'NEXUS_SKILLS_SEED_PATH',
      'NEXUS_SKILLS_LIBRARY_PATH',
      'NEXUS_SKILLS_SEED_FORCE_OVERWRITE',
      'STRICT_SKILL_VALIDATION',
    );

    process.env.NEXUS_SKILLS_SEED_PATH = seedRoot;
    process.env.NEXUS_SKILLS_LIBRARY_PATH = libraryRoot;
    delete process.env.NEXUS_SKILLS_SEED_FORCE_OVERWRITE;
    delete process.env.STRICT_SKILL_VALIDATION;
  });

  afterEach(() => {
    restoreEnv();
    fs.rmSync(seedRoot, { recursive: true, force: true });
    fs.rmSync(libraryRoot, { recursive: true, force: true });
  });

  describe('new skill (no existing target)', () => {
    it('copies the seed content to the library (created)', () => {
      writeSeedSkill(seedRoot, 'test-skill', SEED_SKILL_CONTENT);

      new SkillSeedService().seed();

      expect(readLibrarySkill(libraryRoot, 'test-skill')).toBe(
        SEED_SKILL_CONTENT,
      );
    });
  });

  describe('runtime-authored target (nexus_origin.source: agent_factory)', () => {
    it('is NOT overwritten — content survives byte-for-byte (preserved)', () => {
      writeSeedSkill(seedRoot, 'test-skill', SEED_SKILL_CONTENT);
      writeLibrarySkill(libraryRoot, 'test-skill', RUNTIME_SKILL_CONTENT);

      new SkillSeedService().seed();

      expect(readLibrarySkill(libraryRoot, 'test-skill')).toBe(
        RUNTIME_SKILL_CONTENT,
      );
    });

    it('retains the runtime unique marker, proving the file was not replaced', () => {
      writeSeedSkill(seedRoot, 'test-skill', SEED_SKILL_CONTENT);
      writeLibrarySkill(libraryRoot, 'test-skill', RUNTIME_SKILL_CONTENT);

      new SkillSeedService().seed();

      expect(readLibrarySkill(libraryRoot, 'test-skill')).toContain(
        'RUNTIME_AUTHORED_UNIQUE_MARKER',
      );
    });
  });

  describe('seed-origin target (no nexus_origin block)', () => {
    it('IS replaced with the incoming seed content (updated)', () => {
      const updatedSeedContent = SEED_SKILL_CONTENT.replace(
        'Seeded content.',
        'Updated seed content.',
      );
      writeSeedSkill(seedRoot, 'test-skill', updatedSeedContent);
      writeLibrarySkill(libraryRoot, 'test-skill', SEED_SKILL_CONTENT);

      new SkillSeedService().seed();

      expect(readLibrarySkill(libraryRoot, 'test-skill')).toContain(
        'Updated seed content.',
      );
    });
  });

  describe('force overwrite escape hatch (NEXUS_SKILLS_SEED_FORCE_OVERWRITE=true)', () => {
    it('overwrites a runtime-authored skill when the flag is set', () => {
      writeSeedSkill(seedRoot, 'test-skill', SEED_SKILL_CONTENT);
      writeLibrarySkill(libraryRoot, 'test-skill', RUNTIME_SKILL_CONTENT);
      process.env.NEXUS_SKILLS_SEED_FORCE_OVERWRITE = 'true';

      new SkillSeedService().seed();

      const result = readLibrarySkill(libraryRoot, 'test-skill');
      expect(result).not.toContain('RUNTIME_AUTHORED_UNIQUE_MARKER');
      expect(result).toBe(SEED_SKILL_CONTENT);
    });
  });
});
