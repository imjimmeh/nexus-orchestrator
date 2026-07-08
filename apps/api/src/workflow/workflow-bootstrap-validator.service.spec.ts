import { describe, expect, it, vi } from 'vitest';
import type { WorkflowParserService } from './workflow-parser.service';
import { WorkflowBootstrapValidatorService } from './workflow-bootstrap-validator.service';

describe('WorkflowBootstrapValidatorService', () => {
  const parseWorkflowMock = vi.fn();

  const parser = {
    parseWorkflow: parseWorkflowMock,
  } as unknown as WorkflowParserService;

  const service = new WorkflowBootstrapValidatorService(parser);

  it('returns ok with no contracts when no critical workflow contracts are defined', () => {
    const result = service.validateCriticalWorkflows([] as never);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('preserves generic validation contract shape for future contracts', () => {
    const result = service.validateCriticalWorkflows([
      {
        id: 'wf-1',
        yaml_definition: 'workflow_id: some_workflow',
        is_active: true,
      },
    ] as never);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
