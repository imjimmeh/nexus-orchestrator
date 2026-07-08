import { describe, expect, it } from 'vitest';
import { resolveStalledJobIds } from './stalled-job-resolution.helpers';

describe('resolveStalledJobIds', () => {
  it('returns started-but-incomplete jobs (the incident shape)', () => {
    const run = {
      current_step_id: 'capture_charter',
      state_variables: {
        jobs: {
          refine_charter: { steps: { refine: { status: 'running' } } },
          capture_charter: { result: 'skipped' },
          capture_charter_brownfield: { result: 'skipped' },
        },
        _internal: {
          current_job_id: 'refine_charter',
          completed_jobs: {
            capture_charter: true,
            capture_charter_brownfield: true,
          },
        },
      },
    };

    expect(resolveStalledJobIds(run as never)).toEqual(['refine_charter']);
  });

  it('falls back to _internal.current_job_id when the jobs map is empty', () => {
    const run = {
      current_step_id: 'first_job',
      state_variables: { _internal: { current_job_id: 'second_job' } },
    };

    expect(resolveStalledJobIds(run as never)).toEqual(['second_job']);
  });

  it('falls back to current_step_id when state is bare', () => {
    const run = { current_step_id: 'first_job', state_variables: {} };

    expect(resolveStalledJobIds(run as never)).toEqual(['first_job']);
  });

  it('returns empty when nothing is resolvable', () => {
    const run = { current_step_id: undefined, state_variables: undefined };

    expect(resolveStalledJobIds(run as never)).toEqual([]);
  });
});
