import { describe, expect, it } from 'vitest';
import type { IWorkflowStep } from '@nexus/core';
import { resolveTemplatedInputs } from './workflow-step-execution/step-support-inputs.helpers';
import { createStepSpecialStepExecutorTestFixture } from './workflow-special-steps/step-special-step-executor.test-fixture';

describe('Workflow YAML Enhancements', () => {
  it('resolves mapping transforms', () => {
    const resolved = resolveTemplatedInputs(
      {
        status: {
          source: '{{ jobs.review.output.decision }}',
          mapping: {
            approved: 'done',
            rejected: 'in-progress',
          },
          default: 'todo',
        },
      },
      {
        jobs: {
          review: {
            output: {
              decision: 'approved',
            },
          },
        },
      },
      (value) => value,
    );

    expect(resolved).toEqual({ status: 'done' });
  });

  it('supports nested mapping transforms', () => {
    const resolved = resolveTemplatedInputs(
      {
        payload: {
          phase: {
            source: '{{ trigger.stage }}',
            mapping: {
              planning: {
                state: 'todo',
              },
            },
            default: {
              state: 'in-progress',
            },
          },
        },
      },
      {
        trigger: {
          stage: 'planning',
        },
      },
      (value) => value,
    );

    expect(resolved).toEqual({
      payload: {
        phase: {
          state: 'todo',
        },
      },
    });
  });

  it('evaluates switch cases and picks matching case inputs', async () => {
    const fixture = await createStepSpecialStepExecutorTestFixture();

    fixture.manageToolCandidateExecuteMock.mockResolvedValue({
      result: {
        status: 'completed',
        mode: 'manage_tool_candidate',
        action: 'validate',
        artifactId: 'case-match',
      },
      output: { ok: true, artifact_id: 'case-match' },
    });

    await fixture.service.executeSpecialStep(
      'run-1',
      'step-1',
      {
        id: 'step-1',
        type: 'manage_tool_candidate',
        tier: 'light',
        inputs: {
          action: 'validate',
          artifact_id: 'base-id',
        },
        switch: [
          {
            case: '{{ trigger.route_to_default }}',
            inputs: { artifact_id: 'default-id' },
          },
          {
            case: '{{ trigger.route_to_case }}',
            inputs: { artifact_id: 'case-match' },
          },
        ],
      },
      {},
      {
        trigger: {
          route_to_default: false,
          route_to_case: true,
        },
      },
    );

    expect(fixture.manageToolCandidateExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedStepInputs: expect.objectContaining({
          artifact_id: 'case-match',
        }),
      }),
    );
  });

  it('falls back to switch default inputs', async () => {
    const fixture = await createStepSpecialStepExecutorTestFixture();

    fixture.manageToolCandidateExecuteMock.mockResolvedValue({
      result: {
        status: 'completed',
        mode: 'manage_tool_candidate',
        action: 'validate',
        artifactId: 'fallback-id',
      },
      output: { ok: true, artifact_id: 'fallback-id' },
    });

    await fixture.service.executeSpecialStep(
      'run-1',
      'step-1',
      {
        id: 'step-1',
        type: 'manage_tool_candidate',
        tier: 'light',
        inputs: {
          action: 'validate',
          artifact_id: 'base-id',
        },
        switch: [
          {
            case: '{{ trigger.no_match }}',
            inputs: { artifact_id: 'nope' },
          },
        ],
        default: {
          inputs: { artifact_id: 'fallback-id' },
        },
      },
      {},
      { trigger: { no_match: false } },
    );

    expect(fixture.manageToolCandidateExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedStepInputs: expect.objectContaining({
          artifact_id: 'fallback-id',
        }),
      }),
    );
  });

  it('runs for_each sequentially and aggregates outputs', async () => {
    const fixture = await createStepSpecialStepExecutorTestFixture();

    fixture.manageToolCandidateExecuteMock.mockImplementation(async (ctx) => {
      const artifactId = String(ctx.resolvedStepInputs.artifact_id);
      return {
        result: {
          status: 'completed',
          mode: 'manage_tool_candidate',
          action: 'validate',
          artifactId,
        },
        output: {
          ok: true,
          artifact_id: artifactId,
        },
      };
    });

    const result = await fixture.service.executeSpecialStep(
      'run-2',
      'step-2',
      {
        id: 'step-2',
        type: 'manage_tool_candidate',
        tier: 'light',
        inputs: {
          action: 'validate',
          artifact_id: '{{ item.id }}',
        },
        for_each: '{{ jobs.source.output.items }}',
      },
      {},
      {
        jobs: {
          source: {
            output: {
              items: [{ id: 'a-1' }, { id: 'a-2' }],
            },
          },
        },
      },
    );

    expect(fixture.manageToolCandidateExecuteMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      status: 'completed',
      mode: 'for_each',
      iterations: 2,
      errorCount: 0,
    });
  });

  it('continues for_each when continue_on_error is enabled', async () => {
    const fixture = await createStepSpecialStepExecutorTestFixture();

    fixture.manageToolCandidateExecuteMock
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce({
        result: {
          status: 'completed',
          mode: 'manage_tool_candidate',
          action: 'validate',
          artifactId: 'ok-2',
        },
        output: { ok: true, artifact_id: 'ok-2' },
      });

    const result = await fixture.service.executeSpecialStep(
      'run-3',
      'step-3',
      {
        id: 'step-3',
        type: 'manage_tool_candidate',
        tier: 'light',
        inputs: {
          action: 'validate',
          artifact_id: '{{ item.id }}',
        },
        for_each: '{{ jobs.source.output.items }}',
        continue_on_error: true,
      },
      {},
      {
        jobs: {
          source: {
            output: {
              items: [{ id: 'bad-1' }, { id: 'ok-2' }],
            },
          },
        },
      },
    );

    expect(fixture.manageToolCandidateExecuteMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      status: 'completed',
      mode: 'for_each',
      iterations: 2,
      errorCount: 1,
    });
  });

  it('fails for_each when expression does not resolve to array', async () => {
    const fixture = await createStepSpecialStepExecutorTestFixture();

    await expect(
      fixture.service.executeSpecialStep(
        'run-4',
        'step-4',
        {
          id: 'step-4',
          type: 'manage_tool_candidate',
          tier: 'light',
          inputs: {
            action: 'validate',
            artifact_id: '{{ item.id }}',
          },
          for_each: '{{ jobs.source.output.not_array }}',
        },
        {},
        {
          jobs: {
            source: {
              output: {
                not_array: 'oops',
              },
            },
          },
        },
      ),
    ).rejects.toThrow('for_each expression must resolve to array');
  });

  it('throws when mapping has no matching key and no default', () => {
    expect(() =>
      resolveTemplatedInputs(
        {
          status: {
            source: '{{ trigger.phase }}',
            mapping: {
              planning: 'todo',
            },
          },
        },
        {
          trigger: {
            phase: 'unknown',
          },
        },
        (value) => value,
      ),
    ).toThrow(
      "Mapping error: value 'unknown' not found in mapping and no default provided",
    );
  });
});
