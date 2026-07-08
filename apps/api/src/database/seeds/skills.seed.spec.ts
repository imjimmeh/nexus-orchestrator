import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SkillSeedService } from './skills.seed';

describe('SkillSeedService', () => {
  let tempRoot: string;
  let seedRoot: string;
  let libraryRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-seed-spec-'));
    seedRoot = path.join(tempRoot, 'seed', 'skills');
    libraryRoot = path.join(tempRoot, 'library');

    process.env.NEXUS_SKILLS_SEED_PATH = seedRoot;
    process.env.NEXUS_SKILLS_LIBRARY_PATH = libraryRoot;
  });

  afterEach(() => {
    delete process.env.NEXUS_SKILLS_SEED_PATH;
    delete process.env.NEXUS_SKILLS_LIBRARY_PATH;
    delete process.env.STRICT_SKILL_VALIDATION;

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }

    vi.restoreAllMocks();
  });

  it('copies valid seeded skills into the runtime library', () => {
    const sourceSkillDir = path.join(seedRoot, 'architecture-review');
    fs.mkdirSync(path.join(sourceSkillDir, 'references'), { recursive: true });
    fs.writeFileSync(
      path.join(sourceSkillDir, 'SKILL.md'),
      [
        '---',
        'name: architecture-review',
        'description: Seeded architecture review skill.',
        '---',
        '',
        '# Architecture Review',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(sourceSkillDir, 'references', 'notes.md'),
      'seeded note',
      'utf8',
    );

    const service = new SkillSeedService();
    service.seed();

    expect(
      fs.existsSync(path.join(libraryRoot, 'architecture-review', 'SKILL.md')),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(libraryRoot, 'architecture-review', 'references', 'notes.md'),
      ),
    ).toBe(true);
  });

  it('copies nested skill directories without relying on fs.cpSync', () => {
    const sourceSkillDir = path.join(seedRoot, 'orchestration-playbooks');
    fs.mkdirSync(path.join(sourceSkillDir, 'existing-project-investigation'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(sourceSkillDir, 'SKILL.md'),
      [
        '---',
        'name: orchestration-playbooks',
        'description: Seeded orchestration playbooks.',
        '---',
        '',
        '# Orchestration Playbooks',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(sourceSkillDir, 'existing-project-investigation', 'SKILL.md'),
      'nested playbook',
      'utf8',
    );
    const implementation = fs.readFileSync(
      path.join(__dirname, 'skills.seed.ts'),
      'utf8',
    );

    const service = new SkillSeedService();
    service.seed();

    expect(implementation).not.toContain('fs.cpSync');
    expect(
      fs.readFileSync(
        path.join(
          libraryRoot,
          'orchestration-playbooks',
          'existing-project-investigation',
          'SKILL.md',
        ),
        'utf8',
      ),
    ).toBe('nested playbook');
  });

  it('skips malformed skill directories', () => {
    const invalidSkillDir = path.join(seedRoot, 'broken-skill');
    fs.mkdirSync(invalidSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(invalidSkillDir, 'SKILL.md'),
      '# missing frontmatter',
      'utf8',
    );

    const service = new SkillSeedService();
    service.seed();

    expect(fs.existsSync(path.join(libraryRoot, 'broken-skill'))).toBe(false);
  });

  it('fails fast in strict mode when required sections are missing', () => {
    process.env.STRICT_SKILL_VALIDATION = 'true';

    const sourceSkillDir = path.join(seedRoot, 'strict-skill');
    fs.mkdirSync(sourceSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceSkillDir, 'SKILL.md'),
      [
        '---',
        'name: strict-skill',
        'description: Strict test.',
        'metadata:',
        '  version: 1.0.0',
        '  prerequisites: []',
        '  tier: light',
        '  estimated_duration: 10m',
        '---',
        '',
        '# Strict Skill',
        '## Overview',
        'overview only',
      ].join('\n'),
      'utf8',
    );

    const service = new SkillSeedService();

    expect(() => {
      service.seed();
    }).toThrow(
      'Skill seeding failed strict validation with 1 invalid skill(s)',
    );
  });
});
