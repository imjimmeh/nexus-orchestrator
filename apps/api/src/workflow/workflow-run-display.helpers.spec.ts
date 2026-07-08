import { describe, expect, it } from 'vitest';
import { resolveWorkflowRunDisplayName } from './workflow-run-display.helpers';

const base = { id: 'abcdef123456', state_variables: {} } as never;

describe('resolveWorkflowRunDisplayName', () => {
  it('prefers the trigger display name', () => {
    const run = {
      ...base,
      state_variables: { trigger: { displayName: 'Nightly' } },
    };
    expect(resolveWorkflowRunDisplayName(run as never, 'wf')).toBe('Nightly');
  });
  it('falls back to workflow name, then run id prefix', () => {
    expect(resolveWorkflowRunDisplayName(base, 'wf')).toBe('wf');
    expect(resolveWorkflowRunDisplayName(base, null)).toBe(
      'Workflow run abcdef12',
    );
  });
});
