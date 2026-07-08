import { describe, it, expect } from 'vitest';
import { DriftDetectionService } from './drift-detection.service';
import type { ReconciliationPlan } from './reconciliation.types';

const svc = new DriftDetectionService();

describe('DriftDetectionService.classify', () => {
  const plan: ReconciliationPlan = {
    changes: [
      { type: 'role', key: 'viewer', op: 'noop' },
      { type: 'scope_node', key: '/acme', op: 'create' },
      { type: 'scope_node', key: '/stale', op: 'delete' },
      {
        type: 'role',
        key: 'member',
        op: 'update',
        diff: { description: { from: 'v1', to: 'v2' } },
      },
    ],
    summary: { create: 1, update: 1, delete: 1, noop: 1 },
  };

  it('maps create→git_only, delete→db_only, update→field_divergence', () => {
    const report = svc.classify(plan);
    const byKey = Object.fromEntries(
      report.drifted.map((d) => [d.key, d.category]),
    );
    expect(byKey['/acme']).toBe('git_only');
    expect(byKey['/stale']).toBe('db_only');
    expect(byKey['member']).toBe('field_divergence');
    expect(report.inSync).toBe(1);
  });

  it('reports field-level diff for divergent objects', () => {
    const report = svc.classify(plan);
    expect(report.drifted.find((d) => d.key === 'member')?.diff).toEqual({
      description: { from: 'v1', to: 'v2' },
    });
  });

  it('noop-skipped changes (skippedReason) do not count as in-sync', () => {
    const planWithSkipped: ReconciliationPlan = {
      changes: [
        {
          type: 'scope_node',
          key: '/locked',
          op: 'noop',
          skippedReason: 'object is locked',
        },
      ],
      summary: { create: 0, update: 0, delete: 0, noop: 1 },
    };
    const report = svc.classify(planWithSkipped);
    // A noop that was only a noop due to a guard (skippedReason) should be reported as field_divergence,
    // not counted as inSync — it represents a desired change that could not be applied.
    expect(report.drifted.some((d) => d.key === '/locked')).toBe(true);
    expect(report.inSync).toBe(0);
  });
});
