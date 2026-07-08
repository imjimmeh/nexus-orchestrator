import { describe, it, expect } from 'vitest';
import {
  jobOutputStatePath,
  hasPersistedJobOutput,
} from './workflow-job-output.helpers';

describe('workflow-job-output.helpers', () => {
  it('builds the canonical job output state path', () => {
    expect(jobOutputStatePath('implement_and_commit')).toBe(
      'jobs.implement_and_commit.output',
    );
  });

  it('hasPersistedJobOutput is true when a non-empty object is present', async () => {
    const getVariable = async (path: string) =>
      path === 'jobs.j1.output' ? { summary: 'done' } : null;
    expect(await hasPersistedJobOutput(getVariable, 'j1')).toBe(true);
  });

  it('is false for null / undefined / empty object', async () => {
    expect(await hasPersistedJobOutput(async () => null, 'j1')).toBe(false);
    expect(await hasPersistedJobOutput(async () => undefined, 'j1')).toBe(
      false,
    );
    expect(await hasPersistedJobOutput(async () => ({}), 'j1')).toBe(false);
  });
});
