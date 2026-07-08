import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ContainerTier, IJob } from '@nexus/core';
import { StepRequiredToolRetryService } from './step-required-tool-retry.service';
import { CHAT_SESSION_DOMAIN_PORT } from '../domain-ports';
import { StateManagerService } from '../state-manager.service';
import { WorkflowEventLogService } from '../workflow-event-log.service';
import { WorkflowOutputContractService } from '../workflow-output-contract.service';
import { WORKFLOW_ENGINE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../kernel/interfaces/workflow-kernel.ports';
import { RuntimeFeedbackIngestionService } from '../../runtime-feedback/runtime-feedback-ingestion.service';

describe('StepRequiredToolRetryService', () => {
  let service: StepRequiredToolRetryService;
  let stateManager: { getVariable: Mock; setVariable: Mock };
  let sessionHydration: { saveSessionFromExitedContainer: Mock };
  let eventLog: { appendBestEffort: Mock };
  let workflowEngine: { retryJobWithMessage: Mock };
  let runRepo: { findById: Mock };
  let runtimeFeedback: { ingest: Mock };
  let outputContractService: {
    validateOutputContract: Mock;
    buildDefaultRetryPrompt: Mock;
    buildRetryPrompt: Mock;
  };

  beforeEach(async () => {
    stateManager = {
      getVariable: vi.fn().mockResolvedValue(null),
      setVariable: vi.fn().mockResolvedValue(undefined),
    };
    sessionHydration = {
      saveSessionFromExitedContainer: vi.fn().mockResolvedValue('tree-1'),
    };
    eventLog = {
      appendBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    workflowEngine = {
      retryJobWithMessage: vi.fn().mockResolvedValue(undefined),
    };
    runRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'wf-1' }),
    };
    runtimeFeedback = {
      ingest: vi.fn().mockResolvedValue({
        groupId: 'group-1',
        candidateId: null,
        promoted: false,
        skippedReason: 'frequency_below_threshold',
      }),
    };
    outputContractService = {
      validateOutputContract: vi.fn().mockResolvedValue({
        valid: true,
        missing: [],
        invalid: [],
      }),
      buildDefaultRetryPrompt: vi.fn().mockReturnValue('retry'),
      buildRetryPrompt: vi.fn().mockReturnValue('retry with type fix'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StepRequiredToolRetryService,
        { provide: CHAT_SESSION_DOMAIN_PORT, useValue: sessionHydration },
        { provide: StateManagerService, useValue: stateManager },
        { provide: WorkflowEventLogService, useValue: eventLog },
        { provide: WORKFLOW_ENGINE_SERVICE, useValue: workflowEngine },
        { provide: WORKFLOW_RUN_REPOSITORY_PORT, useValue: runRepo },
        { provide: RuntimeFeedbackIngestionService, useValue: runtimeFeedback },
        {
          provide: WorkflowOutputContractService,
          useValue: outputContractService,
        },
      ],
    }).compile();

    service = module.get(StepRequiredToolRetryService);
  });

  it('returns proceed when no output_contract is configured', async () => {
    const result = await service.checkRequiredToolCallsAndRetryJob(
      'wf-1',
      'step-1',
      { id: 'step-1', type: 'execution', tier: ContainerTier.LIGHT, steps: [] },
      'container-1',
    );

    expect(result).toBe('proceed');
  });

  it('skips output-contract enforcement when the run is parked (durable suspend)', async () => {
    runRepo.findById.mockResolvedValueOnce({
      id: 'wf-1',
      wait_reason: 'dependency',
    });

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'wf-1',
      'step-1',
      {
        id: 'step-1',
        type: 'execution',
        tier: ContainerTier.LIGHT,
        steps: [],
        output_contract: { required: ['decision'] },
        max_retries: 2,
      },
      'container-1',
    );

    expect(result).toBe('proceed');
    expect(outputContractService.validateOutputContract).not.toHaveBeenCalled();
    expect(workflowEngine.retryJobWithMessage).not.toHaveBeenCalled();
    expect(eventLog.appendBestEffort).not.toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'job.output_contract.missing',
      }),
    );
  });

  it('returns retried when output_contract is not satisfied', async () => {
    outputContractService.validateOutputContract.mockResolvedValueOnce({
      valid: false,
      missing: ['decision'],
      invalid: [],
    });

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'wf-1',
      'step-1',
      {
        id: 'step-1',
        type: 'execution',
        tier: ContainerTier.LIGHT,
        steps: [],
        output_contract: {
          required: ['decision'],
        },
        max_retries: 2,
      },
      'container-1',
    );

    expect(result).toBe('retried');
    expect(workflowEngine.retryJobWithMessage).toHaveBeenCalled();
    expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'wf-1',
        jobId: 'step-1',
        eventType: 'job.output_contract.retry_enqueued',
        payload: expect.objectContaining({
          missingFields: ['decision'],
          resumeSession: true,
          retryCount: 1,
          maxRetries: 2,
        }),
      }),
    );
  });

  it('carries workflowYamlSkills into the retry so a retried step keeps its workflow-level skills', async () => {
    outputContractService.validateOutputContract.mockResolvedValueOnce({
      valid: false,
      missing: ['decision'],
      invalid: [],
    });

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'wf-1',
      'step-1',
      {
        id: 'step-1',
        type: 'execution',
        tier: ContainerTier.LIGHT,
        steps: [],
        output_contract: {
          required: ['decision'],
        },
        max_retries: 2,
      },
      'container-1',
      undefined,
      'workflow',
      ['git-commit-discipline'],
    );

    expect(result).toBe('retried');
    expect(workflowEngine.retryJobWithMessage).toHaveBeenCalledWith(
      'wf-1',
      'step-1',
      expect.objectContaining({ id: 'step-1' }),
      expect.any(String),
      expect.any(String),
      undefined,
      'workflow',
      ['git-commit-discipline'],
    );
  });

  it('emits satisfied audit event when output_contract is satisfied', async () => {
    outputContractService.validateOutputContract.mockResolvedValueOnce({
      valid: true,
      missing: [],
      invalid: [],
    });

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'wf-1',
      'step-1',
      {
        id: 'step-1',
        type: 'execution',
        tier: ContainerTier.LIGHT,
        steps: [],
        output_contract: {
          required: ['decision'],
        },
      },
      'container-1',
    );

    expect(result).toBe('proceed');
    expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'wf-1',
        jobId: 'step-1',
        eventType: 'job.output_contract.satisfied',
        payload: { requiredFields: ['decision'] },
      }),
    );
  });

  it('throws when retries are exhausted', async () => {
    outputContractService.validateOutputContract.mockResolvedValueOnce({
      valid: false,
      missing: ['decision'],
      invalid: [],
    });
    stateManager.getVariable.mockImplementation(
      (_runId: string, key: string) => {
        if (key === '_internal.retries.step-1') {
          return Promise.resolve(2);
        }
        return Promise.resolve(null);
      },
    );

    await expect(
      service.checkRequiredToolCallsAndRetryJob(
        'wf-1',
        'step-1',
        {
          id: 'step-1',
          type: 'execution',
          tier: ContainerTier.LIGHT,
          steps: [],
          output_contract: {
            required: ['decision'],
          },
          max_retries: 2,
        },
        'container-1',
      ),
    ).rejects.toThrow('Max retries (2) exhausted');

    expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'wf-1',
        jobId: 'step-1',
        eventType: 'job.output_contract.exhausted',
        payload: expect.objectContaining({
          missingFields: ['decision'],
          retryCount: 2,
          maxRetries: 2,
        }),
      }),
    );
    expect(runtimeFeedback.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        signal_type: 'workflow_anomaly',
        source_module: 'workflow-step-execution',
        scope: { scope_type: 'workflow_run', scope_id: 'wf-1' },
        affected: expect.objectContaining({
          workflow_run_id: 'wf-1',
          job_id: 'step-1',
          failure_class: 'output_contract_exhausted',
        }),
        evidence: [
          expect.objectContaining({
            kind: 'output_contract_exhausted',
            summary: expect.stringContaining('decision'),
          }),
        ],
        confidence: 0.85,
        severity: 'high',
        dedupe_fingerprint:
          'workflow_anomaly:output_contract_exhausted:wf-1:step-1:decision',
      }),
    );
  });

  it('falls back to stateless retry when session save fails', async () => {
    outputContractService.validateOutputContract.mockResolvedValueOnce({
      valid: false,
      missing: ['decision'],
      invalid: [],
    });
    sessionHydration.saveSessionFromExitedContainer.mockRejectedValueOnce(
      new Error('Invalid JSONL data: Line 9: Invalid JSON format'),
    );

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'wf-1',
      'step-1',
      {
        id: 'step-1',
        type: 'execution',
        tier: ContainerTier.LIGHT,
        steps: [],
        output_contract: {
          required: ['decision'],
        },
        max_retries: 2,
      },
      'container-1',
    );

    expect(result).toBe('retried');
    expect(workflowEngine.retryJobWithMessage).toHaveBeenCalledWith(
      'wf-1',
      'step-1',
      expect.objectContaining({ id: 'step-1' }),
      undefined,
      expect.any(String),
      undefined,
      undefined,
      undefined,
    );
    expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'wf-1',
        jobId: 'step-1',
        eventType: 'job.output_contract.retry_enqueued',
        payload: expect.objectContaining({
          missingFields: ['decision'],
          resumeSession: false,
        }),
      }),
    );
  });

  it('auto-satisfies exhausted orchestration decision output contract', async () => {
    outputContractService.validateOutputContract.mockResolvedValueOnce({
      valid: false,
      missing: ['decision'],
      invalid: [],
    });
    stateManager.getVariable.mockImplementation(
      (_runId: string, key: string) => {
        if (key === '_internal.retries.ceo_orchestration_decision') {
          return Promise.resolve(2);
        }

        if (key === 'jobs.ceo_orchestration_decision.output') {
          return Promise.resolve({});
        }

        return Promise.resolve(null);
      },
    );

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'wf-1',
      'ceo_orchestration_decision',
      {
        id: 'ceo_orchestration_decision',
        type: 'execution',
        tier: ContainerTier.HEAVY,
        steps: [],
        output_contract: {
          required: ['decision'],
        },
        max_retries: 2,
      },
      'container-1',
    );

    expect(result).toBe('proceed');
    expect(stateManager.setVariable).toHaveBeenCalledWith(
      'wf-1',
      'jobs.ceo_orchestration_decision.output',
      expect.objectContaining({
        decision: 'continue',
        auto_generated: true,
      }),
    );
    expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'wf-1',
        jobId: 'ceo_orchestration_decision',
        eventType: 'job.output_contract.auto_fallback',
      }),
    );
  });

  it('retries with type mismatch prompt when output has invalid types', async () => {
    outputContractService.validateOutputContract.mockResolvedValueOnce({
      valid: false,
      missing: ['summary'],
      invalid: [{ field: 'decision', expected: 'string', actual: 'number' }],
    });

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'wf-1',
      'step-1',
      {
        id: 'step-1',
        type: 'execution',
        tier: ContainerTier.LIGHT,
        steps: [],
        output_contract: {
          required: ['summary', 'decision'],
        },
        max_retries: 2,
      },
      'container-1',
    );

    expect(result).toBe('retried');
    expect(outputContractService.buildRetryPrompt).toHaveBeenCalledWith(
      ['summary'],
      [{ field: 'decision', expected: 'string', actual: 'number' }],
    );
    expect(workflowEngine.retryJobWithMessage).toHaveBeenCalledWith(
      'wf-1',
      'step-1',
      expect.any(Object),
      expect.any(String),
      'retry with type fix',
      undefined,
      undefined,
      undefined,
    );
    expect(eventLog.appendBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'job.output_contract.missing',
        payload: expect.objectContaining({
          problemFields: ['summary', 'decision'],
        }),
      }),
    );
  });

  it('concatenates yaml retry_prompt with auto-generated type mismatch details', async () => {
    outputContractService.validateOutputContract.mockResolvedValueOnce({
      valid: false,
      missing: ['architect_summary'],
      invalid: [
        {
          field: 'subtask_blueprint',
          expected:
            'array<object { subtask_id: string, title: string, order_index: integer, depends_on_subtask_ids: array<string> }>',
          actual: 'array<string>',
        },
      ],
    });
    // Mock returns the auto-generated portion
    outputContractService.buildRetryPrompt.mockReturnValue(
      'Auto: missing fields: architect_summary; fields with wrong type: subtask_blueprint (expected array<object>, got array<string>)',
    );

    const yamlRetryPrompt =
      'Your previous set_job_output was incomplete or malformed.';

    const result = await service.checkRequiredToolCallsAndRetryJob(
      'wf-1',
      'step-1',
      {
        id: 'step-1',
        type: 'execution',
        tier: ContainerTier.LIGHT,
        steps: [],
        output_contract: {
          required: ['architect_summary', 'subtask_blueprint'],
        },
        max_retries: 2,
        retry_prompt: yamlRetryPrompt,
      },
      'container-1',
    );

    expect(result).toBe('retried');
    expect(outputContractService.buildRetryPrompt).toHaveBeenCalledWith(
      ['architect_summary'],
      [
        {
          field: 'subtask_blueprint',
          expected:
            'array<object { subtask_id: string, title: string, order_index: integer, depends_on_subtask_ids: array<string> }>',
          actual: 'array<string>',
        },
      ],
    );
    // The prompt passed to retryJobWithMessage must contain BOTH the YAML prompt AND the auto-generated details
    expect(workflowEngine.retryJobWithMessage).toHaveBeenCalledWith(
      'wf-1',
      'step-1',
      expect.any(Object),
      expect.any(String),
      expect.stringContaining('Your previous set_job_output was incomplete'),
      undefined,
      undefined,
      undefined,
    );
    expect(workflowEngine.retryJobWithMessage).toHaveBeenCalledWith(
      'wf-1',
      'step-1',
      expect.any(Object),
      expect.any(String),
      expect.stringContaining('Auto: missing fields'),
      undefined,
      undefined,
      undefined,
    );
  });
});
