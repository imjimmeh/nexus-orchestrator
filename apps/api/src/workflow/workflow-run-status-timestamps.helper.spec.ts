import { describe, it, expect } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import { buildRunStatusTimestampPatch } from './workflow-run-status-timestamps.helper';
import type { RunStatusTimestampSnapshot } from './workflow-run-status-timestamps.types';

const NOW = new Date('2026-06-19T10:00:00.000Z');

describe('buildRunStatusTimestampPatch', () => {
  it('stamps started_at when first entering RUNNING', () => {
    const patch = buildRunStatusTimestampPatch(
      { started_at: null, completed_at: null },
      WorkflowStatus.RUNNING,
      NOW,
    );
    expect(patch).toEqual({ started_at: NOW });
  });

  it('does not re-stamp started_at when already started', () => {
    const existing = new Date('2026-06-19T09:00:00.000Z');
    const patch = buildRunStatusTimestampPatch(
      { started_at: existing, completed_at: null },
      WorkflowStatus.RUNNING,
      NOW,
    );
    expect(patch).toEqual({});
  });

  it('stamps completed_at for each terminal status', () => {
    for (const status of [
      WorkflowStatus.COMPLETED,
      WorkflowStatus.FAILED,
      WorkflowStatus.CANCELLED,
    ]) {
      const patch = buildRunStatusTimestampPatch(
        { started_at: NOW, completed_at: null },
        status,
        NOW,
      );
      expect(patch).toEqual({ completed_at: NOW });
    }
  });

  it('does not re-stamp completed_at when already completed', () => {
    const existing = new Date('2026-06-19T09:30:00.000Z');
    const patch = buildRunStatusTimestampPatch(
      { started_at: NOW, completed_at: existing },
      WorkflowStatus.COMPLETED,
      NOW,
    );
    expect(patch).toEqual({});
  });

  it('returns nothing for non-stamping transitions (e.g. PENDING)', () => {
    const patch = buildRunStatusTimestampPatch(
      { started_at: null, completed_at: null },
      WorkflowStatus.PENDING,
      NOW,
    );
    expect(patch).toEqual({});
  });
});
