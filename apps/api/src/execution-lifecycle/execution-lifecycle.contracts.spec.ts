import { describe, expect, it } from 'vitest';
import {
  EXECUTION_STATES,
  EXECUTION_FAILURE_REASONS,
  EXECUTION_EVENT_TYPES,
} from './execution-lifecycle.contracts';

describe('execution-lifecycle.contracts', () => {
  it('exposes the full state set', () => {
    expect(EXECUTION_STATES).toEqual([
      'pending',
      'provisioning',
      'running',
      'awaiting_input',
      'completing',
      'completed',
      'failed',
      'reaped',
      'cancelled',
      'retry_scheduled',
    ]);
  });

  it('exposes the closed failure taxonomy including never_dispatched', () => {
    expect(EXECUTION_FAILURE_REASONS).toContain('idle_timeout');
    expect(EXECUTION_FAILURE_REASONS).toContain('max_runtime_exceeded');
    expect(EXECUTION_FAILURE_REASONS).toContain('container_lost');
    expect(EXECUTION_FAILURE_REASONS).toContain('never_dispatched');
  });

  it('includes superseded for executions replaced by a newer attempt', () => {
    expect(EXECUTION_FAILURE_REASONS).toContain('superseded');
  });

  it('namespaces every event type under execution.', () => {
    for (const type of Object.values(EXECUTION_EVENT_TYPES)) {
      expect(type.startsWith('execution.')).toBe(true);
    }
  });
});
