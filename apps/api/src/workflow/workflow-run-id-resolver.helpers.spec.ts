import { describe, expect, it, vi } from 'vitest';
import {
  resolveStepYamlSkillsById,
  resolveWorkflowNameById,
  resolveWorkflowYamlSkillsById,
} from './workflow-run-id-resolver.helpers';

describe('resolveWorkflowNameById', () => {
  it('returns undefined without querying when workflowId is absent', async () => {
    const findById = vi.fn();
    const onError = vi.fn();

    const result = await resolveWorkflowNameById(
      { findById },
      undefined,
      onError,
    );

    expect(result).toBeUndefined();
    expect(findById).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('resolves the workflow name for a known workflow id', async () => {
    const findById = vi.fn().mockResolvedValue({ name: 'my-workflow' });
    const onError = vi.fn();

    const result = await resolveWorkflowNameById(
      { findById },
      'workflow-1',
      onError,
    );

    expect(findById).toHaveBeenCalledWith('workflow-1');
    expect(result).toBe('my-workflow');
    expect(onError).not.toHaveBeenCalled();
  });

  it('fails soft to undefined when the workflow is not found', async () => {
    const findById = vi.fn().mockResolvedValue(null);
    const onError = vi.fn();

    const result = await resolveWorkflowNameById(
      { findById },
      'missing-workflow',
      onError,
    );

    expect(result).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

  it('fails soft to undefined and reports the error when the lookup throws', async () => {
    const findById = vi.fn().mockRejectedValue(new Error('DB error'));
    const onError = vi.fn();

    const result = await resolveWorkflowNameById(
      { findById },
      'workflow-1',
      onError,
    );

    expect(result).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('workflow-1'));
  });
});

describe('resolveWorkflowYamlSkillsById', () => {
  const VALID_YAML = `
workflow_id: my_workflow
name: my-workflow
skills: [workflow-yaml-skill]
steps:
  - id: build
    type: execution
    tier: light
    inputs:
      system_prompt: test prompt
`;

  it('returns an empty array without querying when workflowId is absent', async () => {
    const findById = vi.fn();
    const onError = vi.fn();

    const result = await resolveWorkflowYamlSkillsById(
      { findById },
      undefined,
      onError,
    );

    expect(result).toEqual([]);
    expect(findById).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('resolves the workflow-level YAML skills for a known workflow id', async () => {
    const findById = vi
      .fn()
      .mockResolvedValue({ name: 'my-workflow', yaml_definition: VALID_YAML });
    const onError = vi.fn();

    const result = await resolveWorkflowYamlSkillsById(
      { findById },
      'workflow-1',
      onError,
    );

    expect(findById).toHaveBeenCalledWith('workflow-1');
    expect(result).toEqual(['workflow-yaml-skill']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('fails soft to an empty array when the workflow is not found', async () => {
    const findById = vi.fn().mockResolvedValue(null);
    const onError = vi.fn();

    const result = await resolveWorkflowYamlSkillsById(
      { findById },
      'missing-workflow',
      onError,
    );

    expect(result).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('fails soft to an empty array and reports the error when parsing throws', async () => {
    const findById = vi.fn().mockResolvedValue({
      name: 'bad-workflow',
      yaml_definition: 'not: [valid',
    });
    const onError = vi.fn();

    const result = await resolveWorkflowYamlSkillsById(
      { findById },
      'workflow-1',
      onError,
    );

    expect(result).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('workflow-1'));
  });
});

describe('resolveStepYamlSkillsById', () => {
  const VALID_YAML = `
workflow_id: my_workflow
name: my-workflow
skills: [workflow-yaml-skill]
steps:
  - id: build
    type: execution
    tier: light
    inputs:
      system_prompt: test prompt
      skills: [step-yaml-skill]
  - id: deploy
    type: execution
    tier: light
    inputs:
      system_prompt: test prompt
`;

  it('returns an empty array without querying when workflowId is absent', async () => {
    const findById = vi.fn();
    const onError = vi.fn();

    const result = await resolveStepYamlSkillsById(
      { findById },
      undefined,
      'build',
      onError,
    );

    expect(result).toEqual([]);
    expect(findById).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('returns an empty array without querying when stepId is absent', async () => {
    const findById = vi.fn();
    const onError = vi.fn();

    const result = await resolveStepYamlSkillsById(
      { findById },
      'workflow-1',
      undefined,
      onError,
    );

    expect(result).toEqual([]);
    expect(findById).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('resolves the step-level YAML skills for the matching step id', async () => {
    const findById = vi
      .fn()
      .mockResolvedValue({ name: 'my-workflow', yaml_definition: VALID_YAML });
    const onError = vi.fn();

    const result = await resolveStepYamlSkillsById(
      { findById },
      'workflow-1',
      'build',
      onError,
    );

    expect(findById).toHaveBeenCalledWith('workflow-1');
    expect(result).toEqual(['step-yaml-skill']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('returns an empty array for a step with no declared skills', async () => {
    const findById = vi
      .fn()
      .mockResolvedValue({ name: 'my-workflow', yaml_definition: VALID_YAML });
    const onError = vi.fn();

    const result = await resolveStepYamlSkillsById(
      { findById },
      'workflow-1',
      'deploy',
      onError,
    );

    expect(result).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('fails soft to an empty array when the step id does not match any job', async () => {
    const findById = vi
      .fn()
      .mockResolvedValue({ name: 'my-workflow', yaml_definition: VALID_YAML });
    const onError = vi.fn();

    const result = await resolveStepYamlSkillsById(
      { findById },
      'workflow-1',
      'nonexistent-step',
      onError,
    );

    expect(result).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('fails soft to an empty array when the workflow is not found', async () => {
    const findById = vi.fn().mockResolvedValue(null);
    const onError = vi.fn();

    const result = await resolveStepYamlSkillsById(
      { findById },
      'missing-workflow',
      'build',
      onError,
    );

    expect(result).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('fails soft to an empty array and reports the error when parsing throws', async () => {
    const findById = vi.fn().mockResolvedValue({
      name: 'bad-workflow',
      yaml_definition: 'not: [valid',
    });
    const onError = vi.fn();

    const result = await resolveStepYamlSkillsById(
      { findById },
      'workflow-1',
      'build',
      onError,
    );

    expect(result).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('workflow-1'));
  });
});
