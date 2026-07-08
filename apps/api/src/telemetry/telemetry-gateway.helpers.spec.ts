import { describe, expect, it, vi } from 'vitest';
import {
  resolveScopeIdFromContext,
  resolveScopeIdFromRun,
} from './telemetry-gateway.helpers';

describe('resolveScopeIdFromRun', () => {
  it('extracts scopeId from a valid run', () => {
    const run = { state_variables: { trigger: { scopeId: 'p-1' } } };
    expect(resolveScopeIdFromRun(run)).toBe('p-1');
  });

  it('returns null for null input', () => {
    expect(resolveScopeIdFromRun(null)).toBeNull();
  });

  it('returns null when state_variables is missing', () => {
    expect(resolveScopeIdFromRun({})).toBeNull();
  });
});

describe('resolveScopeIdFromContext', () => {
  it('returns scopeId directly when provided', async () => {
    const result = await resolveScopeIdFromContext({
      scopeId: 'direct-project',
    });
    expect(result).toBe('direct-project');
  });

  it('skips workflow run lookup when scopeId is provided', async () => {
    const findById = vi.fn();
    const result = await resolveScopeIdFromContext({
      scopeId: 'direct-project',
      workflowRunId: 'run-1',
      workflowRunRepo: { findById },
    });
    expect(result).toBe('direct-project');
    expect(findById).not.toHaveBeenCalled();
  });

  it('falls back to workflow run lookup when scopeId is not provided', async () => {
    const findById = vi.fn().mockResolvedValue({
      state_variables: { trigger: { scopeId: 'from-run' } },
    });
    const result = await resolveScopeIdFromContext({
      workflowRunId: 'run-1',
      workflowRunRepo: { findById },
    });
    expect(result).toBe('from-run');
    expect(findById).toHaveBeenCalledWith('run-1');
  });

  it('returns null when no scopeId and no workflow run repo', async () => {
    const result = await resolveScopeIdFromContext({
      workflowRunId: 'run-1',
    });
    expect(result).toBeNull();
  });

  it('returns null when no scopeId and workflow run not found', async () => {
    const findById = vi.fn().mockResolvedValue(null);
    const result = await resolveScopeIdFromContext({
      workflowRunId: 'run-1',
      workflowRunRepo: { findById },
    });
    expect(result).toBeNull();
  });

  it('returns null when neither scopeId nor workflowRunId provided', async () => {
    const result = await resolveScopeIdFromContext({});
    expect(result).toBeNull();
  });
});
