import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('workflow internal tools external cutover', () => {
  it('does not retain core-owned external project/resource internal tool handlers', () => {
    const root = resolve(__dirname);
    const removedPaths = [
      'handlers/project-tools.handler.ts',
      'handlers/resource-tools.handler.ts',
      'tools/project/get-project-brief.tool.ts',
      'tools/project/get-project-state.tool.ts',
      'tools/project/get-run-diagnostics.tool.ts',
      'tools/resources/get-orchestration-timeline.tool.ts',
      'tools/resources/get-todo-list.tool.ts',
      'tools/resources/get-resource-history.tool.ts',
      'tools/resources/get-resource.tool.ts',
      'tools/resources/get-resources.tool.ts',
      'tools/resources/manage-todo-list.tool.ts',
      'tools/charter/update-charter.tool.ts',
      'tools/memory/record-project-memory.tool.ts',
      '../../tool/handlers/propose-resources.tool.ts',
    ];

    for (const removedPath of removedPaths) {
      expect(existsSync(resolve(root, removedPath))).toBe(false);
    }
  });
});
