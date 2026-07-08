import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('seed workflow special-step sanitization', () => {
  it('does not seed amend_entity jobs', () => {
    const root = join(__dirname, '../../../../..');
    const workflowDir = join(root, 'seed/workflows');
    const workflowFiles = readdirSync(workflowDir)
      .filter((file) => file.endsWith('.workflow.yaml'))
      .map((file) => join(workflowDir, file));

    const offenders = workflowFiles.filter((file) =>
      /type:\s*amend_entity\b/.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
