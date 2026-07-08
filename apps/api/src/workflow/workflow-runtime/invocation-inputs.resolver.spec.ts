import { describe, expect, it } from 'vitest';
import { resolveInvocationInputs } from './invocation-inputs.resolver';

describe('resolveInvocationInputs', () => {
  it('defaults workflowId when absent', () => {
    expect(resolveInvocationInputs({}).workflowId).toBe(
      'orchestration_invoke_agent_default',
    );
  });

  it('falls back reasoning -> reason', () => {
    expect(resolveInvocationInputs({ reason: 'r' }).reasoning).toBe('r');
  });

  it('prefers params.task_prompt over trigger_data.task_prompt', () => {
    const out = resolveInvocationInputs({
      task_prompt: 'a',
      trigger_data: { task_prompt: 'b' },
    });
    expect(out.taskPrompt).toBe('a');
  });

  it('prefers trigger_data.message and trigger_data.objective over params', () => {
    const out = resolveInvocationInputs({
      message: 'pm',
      objective: 'po',
      trigger_data: { message: 'tm', objective: 'to' },
    });
    expect(out.message).toBe('tm');
    expect(out.objective).toBe('to');
  });
});
