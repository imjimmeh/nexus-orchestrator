import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const roots = ['src/workflow', 'src/project'];
const WORKFLOW_ROOT = 'src/workflow';
const DOMAIN_PORTS_DIR = `${WORKFLOW_ROOT}/domain-ports`;

describe('workflow/project domain port boundary', () => {
  it('does not use forwardRef to couple workflow and project modules', () => {
    const offenders = roots.flatMap((root) =>
      listTsFiles(root).filter((file) => {
        const content = readFileSync(file, 'utf8');
        return (
          /forwardRef\s*\(/.test(content) &&
          /ProjectModule|WorkflowModule/.test(content)
        );
      }),
    );

    expect(offenders).toEqual([]);
  });

  it('does not import chat-domain code outside the domain-ports adapter layer', () => {
    const chatPathPattern = /\/chat\//u;
    const hydrationServicePattern = /session-hydration\.service/;

    const offenders: Array<{ file: string; reasons: string[] }> = [];

    for (const file of listTsFiles(WORKFLOW_ROOT)) {
      // The domain-ports/ adapters are the only sanctioned place that talks
      // to the chat domain directly: they wrap concrete chat types behind
      // workflow-neutral ports. Everywhere else must reach those types
      // through a port or through @nexus/core / shared interfaces.
      // `file` comes from `join()`, which yields OS-native separators
      // (backslashes on Windows); normalize before comparing against the
      // forward-slash `DOMAIN_PORTS_DIR` prefix so this exclusion applies
      // cross-platform.
      if (file.replace(/\\/g, '/').startsWith(`${DOMAIN_PORTS_DIR}/`)) {
        continue;
      }

      const content = readFileSync(file, 'utf8');
      const reasons: string[] = [];
      const seenReasons = new Set<string>();

      const addReason = (reason: string): void => {
        if (!seenReasons.has(reason)) {
          seenReasons.add(reason);
          reasons.push(reason);
        }
      };

      // Match every import path string in the file (handles both static
      // `import ... from '...'` and dynamic `import('...')` / `export ... from`
      // forms). Anything in a quoted position is a candidate path.
      const importPathMatches = content.matchAll(
        /(?:^|[^\w$])(?:import|export)\s+(?:[^'"`\n;]+?\s+from\s+)?['"]([^'"`\n]+?)['"]/g,
      );

      for (const match of importPathMatches) {
        const importPath = match[1];
        if (chatPathPattern.test(importPath)) {
          addReason(
            `imports chat-domain code via path containing "/chat/": ${importPath}`,
          );
        }
        if (hydrationServicePattern.test(importPath)) {
          addReason(
            `imports concrete session-hydration.service (use the ISessionHydrationService interface): ${importPath}`,
          );
        }
      }

      if (reasons.length > 0) {
        offenders.push({ file, reasons });
      }
    }

    if (offenders.length > 0) {
      const lines: string[] = [
        'Found workflow files importing chat-domain code outside the domain-ports adapter layer.',
        'Route these imports through the ports in `apps/api/src/workflow/domain-ports/` instead.',
        '',
      ];
      for (const offender of offenders) {
        lines.push(`  ${offender.file}`);
        for (const reason of offender.reasons) {
          lines.push(`    - ${reason}`);
        }
      }
      throw new Error(lines.join('\n'));
    }

    expect(offenders).toEqual([]);
  });
});

function listTsFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listTsFiles(path));
    } else if (path.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}
