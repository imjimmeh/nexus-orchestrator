import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('workflow core lifecycle boundary', () => {
  it('does not contain hard-coded external lifecycle fanout targets', () => {
    const workflowRoot = __dirname;
    const files = listTypescriptFiles(workflowRoot).filter(
      (file) => !file.endsWith('.spec.ts'),
    );
    const forbidden = [
      'EXTERNAL_SERVICE_BASE_URL',
      'EXTERNAL_SERVICE_BEARER_TOKEN',
      'EXTERNAL_SERVICE_JWT_AUDIENCE',
      'EXTERNAL_SERVICE_JWT_ISSUER',
      'EXTERNAL_SERVICE_JWT_TTL',
      'publishToExternal',
      'CoreHttpClient',
      '/internal/core/events',
    ];

    const violations = files.flatMap((file) => {
      const content = readFileSync(file, 'utf8');
      return forbidden
        .filter((needle) => content.includes(needle))
        .map((needle) => `${file}: ${needle}`);
    });

    expect(violations).toEqual([]);
  });
});

function listTypescriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      return listTypescriptFiles(path);
    }

    return path.endsWith('.ts') ? [path] : [];
  });
}
