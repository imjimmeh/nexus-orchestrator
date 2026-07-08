import { describe, expect, it } from 'vitest';
import { GitOpsObjectRegistryService } from './gitops-object-registry.service';
import type { GitOpsObjectHandler } from './gitops-object-handler.types';

function createHandler(
  objectType: GitOpsObjectHandler['objectType'],
): GitOpsObjectHandler {
  return {
    objectType,
    readActual: async () => [],
    normalizeDesired: (input: any) => ({
      objectType,
      key: input.key,
      fields: input.fields,
    }),
    plan: (change: any) => ({
      objectType,
      key: change.desired.key,
      op: 'create',
      desired: {
        objectType,
        key: change.desired.key,
        fields: change.desired.fields,
      },
      actual: null,
    }),
    apply: async () => undefined,
    serialize: (actual: { key: string; fields: Record<string, unknown> }) => ({
      objectType,
      key: actual.key,
      fields: actual.fields,
      managedBy: 'gitops',
      locked: false,
    }),
    canEdit: () => ({ allowed: true }),
  };
}

describe('GitOpsObjectRegistryService', () => {
  it('returns handler for each registered object type', () => {
    const scopeNode = createHandler('scope_node');
    const role = createHandler('role');
    const roleAssignment = createHandler('role_assignment');
    const registry = new GitOpsObjectRegistryService([
      scopeNode,
      role,
      roleAssignment,
    ]);

    expect(registry.getHandler('scope_node')).toBe(scopeNode);
    expect(registry.getHandler('role')).toBe(role);
    expect(registry.getHandler('role_assignment')).toBe(roleAssignment);
  });

  it('throws a clear error for unsupported types', () => {
    const registry = new GitOpsObjectRegistryService([]);

    expect(() => registry.getHandler('workflow')).toThrow(/unsupported/i);
  });

  it('filters handlers by binding includedObjectTypes', () => {
    const scopeNode = createHandler('scope_node');
    const role = createHandler('role');
    const roleAssignment = createHandler('role_assignment');
    const registry = new GitOpsObjectRegistryService([
      scopeNode,
      role,
      roleAssignment,
    ]);

    const filtered = registry.getHandlersForBinding({
      includedObjectTypes: ['scope_node', 'role_assignment'],
    });

    expect(filtered.map((handler) => handler.objectType)).toEqual([
      'scope_node',
      'role_assignment',
    ]);
  });
});
