import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_DOMAIN_IMPORTS = [
  '../../project',
  '../project',
  'project/',
  'resources/',
  'goals/',
  'external',
];

describe('workflow special-step import boundary', () => {
  it('keeps built-in special-step handlers domain-agnostic', () => {
    const dir = __dirname;
    const handlerFiles = readdirSync(dir).filter(
      (file) =>
        file.startsWith('step-') &&
        (file.endsWith('-special-step.handler.ts') ||
          file.endsWith('-special-step.helpers.ts')) &&
        !file.endsWith('.spec.ts'),
    );

    const violations = handlerFiles.flatMap((file) => {
      const source = readFileSync(join(dir, file), 'utf8');
      return FORBIDDEN_DOMAIN_IMPORTS.flatMap((forbidden) => {
        const pattern = new RegExp(
          `from ['"][^'"]*${forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^'"]*['"]`,
        );
        return pattern.test(source)
          ? [`${basename(file)} imports ${forbidden}`]
          : [];
      });
    });

    expect(violations).toEqual([]);
  });
});
