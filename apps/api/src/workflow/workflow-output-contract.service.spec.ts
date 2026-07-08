import { describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { OutputContract } from '@nexus/core';
import { WorkflowOutputContractService } from './workflow-output-contract.service';
import { StateManagerService } from './state-manager.service';
import { TOOL_EXECUTION_COUNTER } from './tool-execution-counter.tokens';
import type { IToolExecutionCounter } from './tool-execution-counter.types';

function makeStateManager(output: unknown) {
  return { getVariable: vi.fn().mockResolvedValue(output) };
}

function makeCounter(count = 0): IToolExecutionCounter {
  return { countSuccessfulToolExecutions: vi.fn().mockResolvedValue(count) };
}

async function makeService(
  output: unknown,
  counter: IToolExecutionCounter = makeCounter(),
): Promise<WorkflowOutputContractService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      WorkflowOutputContractService,
      { provide: StateManagerService, useValue: makeStateManager(output) },
      { provide: TOOL_EXECUTION_COUNTER, useValue: counter },
    ],
  }).compile();
  return module.get(WorkflowOutputContractService);
}

describe('WorkflowOutputContractService', () => {
  it('flags a required array field emitted as an empty string', async () => {
    const service = await makeService({
      result_items: '',
      planning_summary: 'summary',
    });

    const result = await service.validateOutputContract(
      'run-1',
      'research_goal_backlog',
      {
        required: ['result_items', 'planning_summary'],
        types: {
          result_items: 'array',
          planning_summary: 'string',
        },
      },
    );

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.invalid).toEqual([
      { field: 'result_items', expected: 'array', actual: 'string' },
    ]);
  });

  it('returns valid when all types match', async () => {
    const service = await makeService({
      result_items: [{ title: 'x' }],
      planning_summary: 'summary',
    });

    const result = await service.validateOutputContract(
      'run-1',
      'research_goal_backlog',
      {
        required: ['result_items', 'planning_summary'],
        types: {
          result_items: 'array',
          planning_summary: 'string',
        },
      },
    );

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.invalid).toEqual([]);
  });

  it('flags a required string field present as an empty string as missing', async () => {
    const service = await makeService({
      implementation_plan: '',
    });

    const result = await service.validateOutputContract(
      'run-1',
      'refine_scope',
      {
        required: ['implementation_plan'],
        types: {
          implementation_plan: 'string',
        },
      },
    );

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['implementation_plan']);
    expect(result.invalid).toEqual([]);
  });

  it('flags a required field present as an empty array/object as missing', async () => {
    const service = await makeService({
      result_items: [],
      metadata: {},
    });

    const result = await service.validateOutputContract('run-1', 'job-1', {
      required: ['result_items', 'metadata'],
      types: {
        result_items: 'array',
        metadata: 'object',
      },
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['result_items', 'metadata']);
    expect(result.invalid).toEqual([]);
  });

  it('does not flag a required field with no declared type as missing when non-empty', async () => {
    const service = await makeService({
      status: 'ok',
    });

    const result = await service.validateOutputContract('run-1', 'job-1', {
      required: ['status'],
    });

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('does not flag an optional (non-required) empty field as unsatisfied', async () => {
    const service = await makeService({
      required_field: 'present',
      optional_field: '',
    });

    const result = await service.validateOutputContract('run-1', 'job-1', {
      required: ['required_field'],
      types: {
        required_field: 'string',
        optional_field: 'string',
      },
    });

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.invalid).toEqual([]);
  });

  it('returns missing for fields not in output', async () => {
    const service = await makeService({});

    const result = await service.validateOutputContract('run-1', 'job-1', {
      required: ['field_a', 'field_b'],
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['field_a', 'field_b']);
    expect(result.invalid).toEqual([]);
  });

  it('returns invalid for null output', async () => {
    const service = await makeService(null);

    const result = await service.validateOutputContract('run-1', 'job-1', {
      required: ['field_a'],
    });

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(['field_a']);
    expect(result.invalid).toEqual([]);
  });

  it('flags nested object and array type mismatches', async () => {
    const service = await makeService({
      result_items: [{ title: 'x' }, { title: 1 }],
      planning_summary: 'summary',
    });

    const result = await service.validateOutputContract(
      'run-1',
      'research_goal_backlog',
      {
        required: ['result_items', 'planning_summary'],
        types: {
          result_items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: 'string' },
            },
          },
          planning_summary: 'string',
        },
      },
    );

    expect(result.valid).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.invalid).toEqual([
      {
        field: 'result_items[1].title',
        expected: 'string',
        actual: 'number',
      },
    ]);
  });

  describe('reconcile', () => {
    const contract: OutputContract = {
      required: ['items_created'],
      types: { items_created: 'integer' },
      reconcile: [{ field: 'items_created', tool: 'widget_create' }],
    };

    it('fails when the reported count exceeds the successful tool-call count', async () => {
      const counter = makeCounter(0);
      const service = await makeService({ items_created: 53 }, counter);

      const result = await service.validateOutputContract(
        'run-1',
        'dedup_and_create',
        contract,
      );

      expect(result.valid).toBe(false);
      expect(result.missing).toEqual([]);
      expect(result.invalid).toEqual([]);
      expect(result.reconciliation).toEqual([
        {
          field: 'items_created',
          tool: 'widget_create',
          reported: 53,
          actual: 0,
        },
      ]);
      expect(counter.countSuccessfulToolExecutions).toHaveBeenCalledWith({
        workflowRunId: 'run-1',
        jobId: 'dedup_and_create',
        toolName: 'widget_create',
      });
    });

    it('passes when the reported count matches the successful tool-call count', async () => {
      const service = await makeService({ items_created: 7 }, makeCounter(7));

      const result = await service.validateOutputContract(
        'run-1',
        'dedup_and_create',
        contract,
      );

      expect(result.valid).toBe(true);
      expect(result.reconciliation).toEqual([]);
    });

    it('does not consult the counter when the contract has no reconcile rules', async () => {
      const counter = makeCounter(0);
      const service = await makeService({ items_created: 9 }, counter);

      await service.validateOutputContract('run-1', 'dedup_and_create', {
        required: ['items_created'],
        types: { items_created: 'integer' },
      });

      expect(counter.countSuccessfulToolExecutions).not.toHaveBeenCalled();
    });
  });

  describe('retry prompts', () => {
    it('describes the set_job_output data argument shape for missing fields', async () => {
      const service = await makeService({});

      const prompt = service.buildDefaultRetryPrompt([
        'promotedCandidates',
        'createdSkillProposals',
      ]);

      expect(prompt).toContain(
        'tool argument data set to a plain object containing all required fields',
      );
      expect(prompt).toContain('Never nest another data key inside data');
    });

    it('describes the set_job_output data argument shape for malformed output', async () => {
      const service = await makeService({});

      const prompt = service.buildRetryPrompt(
        ['promotedCandidates'],
        [
          {
            field: 'createdSkillProposals',
            expected: 'integer',
            actual: 'string',
          },
        ],
      );

      expect(prompt).toContain(
        'tool argument data set to a plain object containing all required fields',
      );
      expect(prompt).toContain('Never nest another data key inside data');
    });
  });
});
