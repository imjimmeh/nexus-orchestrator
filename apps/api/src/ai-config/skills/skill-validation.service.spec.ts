import { afterEach, describe, expect, it } from 'vitest';
import { SkillValidationService } from './skill-validation.service';

describe('SkillValidationService', () => {
  const service = new SkillValidationService();

  afterEach(() => {
    delete process.env.STRICT_SKILL_VALIDATION;
  });

  it('validates a fully compliant skill in strict mode', () => {
    process.env.STRICT_SKILL_VALIDATION = 'true';

    const result = service.validateSkillMarkdown({
      skillName: 'example-skill',
      markdown: [
        '---',
        'name: example-skill',
        'description: Example skill.',
        'metadata:',
        '  version: 1.2.3',
        '  prerequisites: []',
        '  tier: light',
        '  estimated_duration: 10m',
        '  category: testing',
        '  tags:',
        '    - validation',
        '---',
        '',
        '# Example Skill',
        '',
        '## Overview',
        'overview',
        '',
        '## Prerequisites',
        'none',
        '',
        '## Instructions',
        '1. do thing',
        '',
        '## Output Format',
        'summary',
      ].join('\n'),
      knownSkillNames: new Set(['example-skill']),
      strict: true,
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails strict validation when required sections are missing', () => {
    const result = service.validateSkillMarkdown({
      skillName: 'missing-sections',
      markdown: [
        '---',
        'name: missing-sections',
        'description: Example skill.',
        'metadata:',
        '  version: 1.0.0',
        '  prerequisites: []',
        '  tier: heavy',
        '  estimated_duration: 20m',
        '  category: testing',
        '  tags:',
        '    - validation',
        '---',
        '',
        '# Missing Sections',
        '',
        '## Overview',
        'overview',
      ].join('\n'),
      strict: true,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'missing required section: Prerequisites (checked aliases: Required context, Context and inputs)',
    );
    expect(result.errors).toContain(
      'missing required section: Instructions (checked aliases: Execution guidance, Steps, Guidelines)',
    );
    expect(result.errors).toContain(
      'missing required section: Output Format (checked aliases: Output expectations, Expected output)',
    );
  });

  it('warns instead of failing when strict mode is disabled', () => {
    const result = service.validateSkillMarkdown({
      skillName: 'legacy-skill',
      markdown: [
        '---',
        'name: legacy-skill',
        'description: Legacy skill.',
        '---',
        '',
        '# Legacy Skill',
      ].join('\n'),
      strict: false,
    });

    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('flags unknown prerequisite skills in strict mode', () => {
    const result = service.validateSkillMarkdown({
      skillName: 'dependent-skill',
      markdown: [
        '---',
        'name: dependent-skill',
        'description: Depends on unknown.',
        'metadata:',
        '  version: 1.0.0',
        '  prerequisites:',
        '    - unknown-skill',
        '  tier: light',
        '  estimated_duration: 15m',
        '---',
        '',
        '# Dependent Skill',
        '',
        '## Overview',
        'overview',
        '',
        '## Prerequisites',
        'none',
        '',
        '## Instructions',
        '1. do thing',
        '',
        '## Output Format',
        'summary',
      ].join('\n'),
      knownSkillNames: new Set(['dependent-skill']),
      strict: true,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'metadata.prerequisites references unknown skill (unknown-skill)',
    );
  });
});
