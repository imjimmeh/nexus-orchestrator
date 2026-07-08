import { describe, it, expect } from 'vitest';
import {
  RECONCILE_ORDER,
  GITOPS_MANAGED_BY,
  isReconcileObjectType,
} from './gitops.constants';

describe('reconciliation constants', () => {
  it('orders apply by dependency: nodes → roles → assignments → config objects', () => {
    expect(RECONCILE_ORDER).toEqual([
      'scope_node',
      'role',
      'role_assignment',
      'workflow',
      'agent_profile',
      'skill',
      'config_override',
    ]);
  });

  it('exposes the gitops managed-by tag value', () => {
    expect(GITOPS_MANAGED_BY).toBe('gitops');
  });

  it('validates object types', () => {
    expect(isReconcileObjectType('role')).toBe(true);
    expect(isReconcileObjectType('planet')).toBe(false);
  });
});
