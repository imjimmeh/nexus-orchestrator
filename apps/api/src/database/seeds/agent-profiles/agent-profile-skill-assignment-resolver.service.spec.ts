import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AgentProfileSkillAssignmentResolverService } from './agent-profile-skill-assignment-resolver.service';

describe('AgentProfileSkillAssignmentResolverService', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-resolver-seed-'));
    process.env.NEXUS_SKILLS_LIBRARY_PATH = tempRoot;
  });

  afterEach(() => {
    delete process.env.NEXUS_SKILLS_LIBRARY_PATH;

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps only skills that exist in the seeded skills library', () => {
    const existingSkillDir = path.join(tempRoot, 'software-architect');
    fs.mkdirSync(existingSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(existingSkillDir, 'SKILL.md'),
      '---\nname: software-architect\ndescription: Skill\n---\n',
      'utf8',
    );

    const resolver = new AgentProfileSkillAssignmentResolverService();

    const resolved = resolver.resolveAssignedSkills(
      'architect-agent',
      ['software-architect'],
      null,
    );

    expect(resolved).toEqual(['software-architect']);
  });

  it('fails fast when configured skills are unavailable, even when existing skills are present', () => {
    const resolver = new AgentProfileSkillAssignmentResolverService();

    expect(() =>
      resolver.resolveAssignedSkills(
        'architect-agent',
        ['missing-skill'],
        ['software-architect'],
      ),
    ).toThrowError(
      'Profile architect-agent references missing skills: missing-skill',
    );
  });

  it('fails fast when configured skills are unavailable and no fallback exists', () => {
    const resolver = new AgentProfileSkillAssignmentResolverService();

    expect(() =>
      resolver.resolveAssignedSkills(
        'architect-agent',
        ['missing-skill'],
        null,
      ),
    ).toThrowError(
      'Profile architect-agent references missing skills: missing-skill',
    );
  });

  it('treats normalized skill sets as equal', () => {
    const resolver = new AgentProfileSkillAssignmentResolverService();

    const equal = resolver.areSkillAssignmentsEqual(
      ['Software-Architect', 'software-architect'],
      ['software-architect'],
    );

    expect(equal).toBe(true);
  });

  it('includes prerequisite skills in resolved assignment order', () => {
    fs.mkdirSync(path.join(tempRoot, 'coding-standards'), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, 'coding-standards', 'SKILL.md'),
      [
        '---',
        'name: coding-standards',
        'description: Base skill',
        'metadata:',
        '  version: 1.0.0',
        '  prerequisites: []',
        '  tier: light',
        '  estimated_duration: 10m',
        '---',
        '',
        '## Overview',
        'overview',
        '## Prerequisites',
        'none',
        '## Instructions',
        '1. run',
        '## Output Format',
        'summary',
      ].join('\n'),
      'utf8',
    );

    fs.mkdirSync(path.join(tempRoot, 'test-driven-development'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(tempRoot, 'test-driven-development', 'SKILL.md'),
      [
        '---',
        'name: test-driven-development',
        'description: Depends on coding standards',
        'metadata:',
        '  version: 1.0.0',
        '  prerequisites:',
        '    - coding-standards',
        '  tier: heavy',
        '  estimated_duration: 20m',
        '---',
        '',
        '## Overview',
        'overview',
        '## Prerequisites',
        'none',
        '## Instructions',
        '1. run',
        '## Output Format',
        'summary',
      ].join('\n'),
      'utf8',
    );

    const resolver = new AgentProfileSkillAssignmentResolverService();

    const resolved = resolver.resolveAssignedSkills(
      'senior-dev',
      ['test-driven-development'],
      null,
    );

    expect(resolved).toEqual(['coding-standards', 'test-driven-development']);
  });
});
