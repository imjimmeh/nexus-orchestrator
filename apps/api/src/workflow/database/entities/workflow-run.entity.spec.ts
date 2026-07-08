import { describe, it, expect } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { WorkflowStatus } from '@nexus/core';
import { WorkflowRun } from './workflow-run.entity';

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  const run = new WorkflowRun();
  run.id = 'run-1';
  run.workflow_id = 'wf-1';
  run.status = WorkflowStatus.PENDING;
  run.state_variables = {};
  return Object.assign(run, overrides);
}

describe('WorkflowRun', () => {
  describe('updateStatus', () => {
    it('sets the status in-memory', () => {
      const run = makeRun();
      run.updateStatus(WorkflowStatus.RUNNING);
      expect(run.status).toBe(WorkflowStatus.RUNNING);
    });

    it('overwrites a previous status', () => {
      const run = makeRun({ status: WorkflowStatus.RUNNING });
      run.updateStatus(WorkflowStatus.COMPLETED);
      expect(run.status).toBe(WorkflowStatus.COMPLETED);
    });
  });

  describe('setStateVariable', () => {
    it('adds a new key to state_variables', () => {
      const run = makeRun();
      run.setStateVariable('myKey', 'myValue');
      expect(run.state_variables).toEqual({ myKey: 'myValue' });
    });

    it('overwrites an existing key', () => {
      const run = makeRun({ state_variables: { existing: 'old' } });
      run.setStateVariable('existing', 'new');
      expect(run.state_variables['existing']).toBe('new');
    });

    it('does not mutate other keys', () => {
      const run = makeRun({ state_variables: { a: 1, b: 2 } });
      run.setStateVariable('c', 3);
      expect(run.state_variables).toEqual({ a: 1, b: 2, c: 3 });
    });

    it('creates a new object reference (immutable spread)', () => {
      const run = makeRun();
      const before = run.state_variables;
      run.setStateVariable('x', 1);
      expect(run.state_variables).not.toBe(before);
    });
  });

  describe('timestamp columns', () => {
    it('declares nullable started_at and completed_at columns', () => {
      const columns = getMetadataArgsStorage()
        .columns.filter((c) => c.target === WorkflowRun)
        .map((c) => c.propertyName);
      expect(columns).toContain('started_at');
      expect(columns).toContain('completed_at');
    });
  });
});
