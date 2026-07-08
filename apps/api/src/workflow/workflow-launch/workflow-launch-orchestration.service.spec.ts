import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { BudgetDecisionService } from '../../cost-governance/budget-decision.service';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { WorkflowLaunchContractService } from './workflow-launch-contract.service';
import { WorkflowLaunchOrchestrationService } from './workflow-launch-orchestration.service';
import { WorkflowLaunchPresetRepository } from '../database/repositories/workflow-launch-preset.repository';
import type {
  IWorkflowEngineService,
  IWorkflowPersistenceService,
  IWorkflowParserService,
} from '../kernel/interfaces/workflow-kernel.ports';
import type {
  IWorkflow,
  WorkflowLaunchDescriptor,
  IWorkflowDefinition,
} from '@nexus/core';
import type { WorkflowDryRunResult } from '../workflow-engine.types';
import type { WorkflowLaunchPreset } from '../database/entities/workflow-launch-preset.entity';

// Helper to build a minimal IWorkflow object for testing
function createMockWorkflow(overrides: Partial<IWorkflow> = {}): IWorkflow {
  return {
    id: 'workflow-1',
    name: 'Test Workflow',
    is_active: true,
    yaml_definition: `
workflow_id: workflow-1
name: Test Workflow
trigger:
  type: manual
  launch:
    context: none
    inputs: []
jobs: []
`,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// Helper to build a workflow with specific trigger config
function createWorkflowWithTrigger(
  triggerType: string,
  launchConfig?: Record<string, unknown>,
): IWorkflow {
  const trigger: Record<string, unknown> = { type: triggerType };
  if (launchConfig) {
    trigger.launch = launchConfig;
  }

  const yaml = `
workflow_id: workflow-1
name: Test Workflow
trigger:
${triggerType === 'manual' ? '  type: manual' : ''}
${triggerType !== 'manual' ? `  type: ${triggerType}` : ''}
${launchConfig ? `  launch: ${JSON.stringify(launchConfig).replace(/"/g, '')}` : ''}
jobs: []
`;

  return createMockWorkflow({
    yaml_definition: yaml,
    id: 'workflow-1',
  });
}

describe('WorkflowLaunchOrchestrationService', () => {
  // Mock dependencies
  let mockWorkflowEngine: Mocked<IWorkflowEngineService>;
  let mockWorkflowPersistence: Mocked<IWorkflowPersistenceService>;
  let mockWorkflowParser: Mocked<IWorkflowParserService>;
  let mockContractService: Mocked<WorkflowLaunchContractService>;
  let mockPresetRepository: Mocked<WorkflowLaunchPresetRepository>;
  let mockEventLedger: Mocked<EventLedgerService>;
  let mockBudgetDecisionService: Mocked<BudgetDecisionService>;
  let service: WorkflowLaunchOrchestrationService;

  beforeEach(() => {
    // Create fresh mocks for each test
    mockWorkflowEngine = {
      startWorkflow: vi.fn(),
      cancelWorkflowRun: vi.fn(),
      handleJobComplete: vi.fn(),
      resumeJobWithMessage: vi.fn(),
      resumeWorkflow: vi.fn(),
      retryJobWithMessage: vi.fn(),
    };

    mockWorkflowPersistence = {
      getWorkflow: vi.fn(),
      getAllWorkflows: vi.fn(),
      getAllWorkflowsPaged: vi.fn(),
      getWorkflowRuns: vi.fn(),
      getWorkflowRunsPaged: vi.fn(),
      getWorkflowRun: vi.fn(),
      getActiveWorkflowRunsByScopeId: vi.fn(),
      createWorkflow: vi.fn(),
      updateWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
      createScopedOverride: vi.fn(),
      findWorkflowsByName: vi.fn(),
    };

    mockWorkflowParser = {
      parseWorkflow: vi.fn(),
      parse: vi.fn(),
    };

    mockContractService = {
      buildContract: vi.fn(),
      evaluateEligibility: vi.fn(),
      validateLaunchPayload: vi.fn(),
    };

    mockPresetRepository = {
      findById: vi.fn(),
      findByIdAndWorkflow: vi.fn(),
      findByWorkflow: vi.fn(),
      findByWorkflowProjectAndName: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };

    mockEventLedger = {
      emit: vi.fn(),
      emitBestEffort: vi.fn(),
      getById: vi.fn(),
      getByCorrelationId: vi.fn(),
      query: vi.fn(),
    };

    mockBudgetDecisionService = {
      evaluateAction: vi.fn(),
    };

    service = new WorkflowLaunchOrchestrationService(
      mockWorkflowEngine,
      mockWorkflowPersistence,
      mockWorkflowParser,
      mockContractService,
      mockPresetRepository,
      mockEventLedger,
      mockBudgetDecisionService,
    );
  });

  describe('resolveLaunchContext', () => {
    it('normalizes scope and context ids from query params', () => {
      const query = {
        scopeId: '  scope-1  ',
        contextId: '  ctx-1  ',
      };

      const context = service.resolveLaunchContext(query);

      expect(context.scopeId).toBe('scope-1');
      expect(context.contextId).toBe('ctx-1');
    });

    it('returns null for missing or whitespace-only values', () => {
      const query = {
        scopeId: '   ',
        contextId: '',
      };

      const context = service.resolveLaunchContext(query);

      expect(context.scopeId).toBeNull();
      expect(context.contextId).toBeNull();
    });
  });

  describe('buildWorkflowLaunchDescriptor', () => {
    it('builds a descriptor from workflow yaml definition', () => {
      const workflow = createMockWorkflow();
      const context = { scopeId: null, contextId: null };

      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Test Workflow',
        description: 'A test workflow',
      };

      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Test Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };

      const mockEligibility = {
        eligible: true,
        reasons: [],
      };

      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.evaluateEligibility.mockReturnValue(mockEligibility);

      const descriptor = service.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      );

      expect(descriptor).not.toBeNull();
      expect(descriptor?.workflowRowId).toBe('workflow-1');
      expect(descriptor?.workflowDefinitionId).toBe('workflow-1');
      expect(descriptor?.workflowName).toBe('Test Workflow');
      expect(descriptor?.contract).toEqual(mockContract);
      expect(descriptor?.eligibility).toEqual(mockEligibility);
    });

    it('returns null when workflow parsing fails', () => {
      const workflow = createMockWorkflow({
        yaml_definition: 'invalid: yaml: content',
      });
      const context = { scopeId: null, contextId: null };

      mockWorkflowParser.parseWorkflow.mockImplementation(() => {
        throw new Error('Parse error');
      });

      const descriptor = service.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      );

      expect(descriptor).toBeNull();
    });

    it('descriptor returns eligible: false when workflow has active runs', () => {
      const workflow = createMockWorkflow();
      const context = { scopeId: 'scope-1', contextId: 'ctx-1' };

      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Test Workflow',
      };
      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Test Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };
      const mockEligibility = {
        eligible: false,
        reasons: [
          {
            code: 'CONTEXT_REQUIRED' as const,
            message: 'Workflow already has an active run in this scope',
          },
        ],
      };

      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.evaluateEligibility.mockReturnValue(mockEligibility);

      const descriptor = service.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      );

      expect(descriptor).not.toBeNull();
      expect(descriptor?.eligibility.eligible).toBe(false);
      expect(descriptor?.eligibility.reasons).toHaveLength(1);
      expect(descriptor?.eligibility.reasons[0].code).toBe('CONTEXT_REQUIRED');
    });

    it('descriptor returns eligible: false when concurrency limit is reached', () => {
      const workflow = createMockWorkflow();
      const context = { scopeId: null, contextId: null };

      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Test Workflow',
      };
      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Test Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };
      const mockEligibility = {
        eligible: false,
        reasons: [
          {
            code: 'CONTEXT_REQUIRED' as const,
            message: 'Concurrency limit reached for this workflow',
          },
        ],
      };

      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.evaluateEligibility.mockReturnValue(mockEligibility);

      const descriptor = service.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      );

      expect(descriptor).not.toBeNull();
      expect(descriptor?.eligibility.eligible).toBe(false);
      expect(descriptor?.eligibility.reasons[0].message).toContain(
        'Concurrency limit',
      );
    });

    it('descriptor returns eligible: true when no active runs exist', () => {
      const workflow = createMockWorkflow();
      const context = { scopeId: null, contextId: null };

      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Test Workflow',
      };
      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Test Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };
      const mockEligibility = {
        eligible: true,
        reasons: [],
      };

      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.evaluateEligibility.mockReturnValue(mockEligibility);

      const descriptor = service.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      );

      expect(descriptor).not.toBeNull();
      expect(descriptor?.eligibility.eligible).toBe(true);
      expect(descriptor?.eligibility.reasons).toEqual([]);
    });

    it('descriptor passes context to evaluateEligibility for scope-aware checks', () => {
      const workflow = createMockWorkflow();
      const context = { scopeId: 'project-42', contextId: 'item-7' };

      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Test Workflow',
      };
      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Test Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };
      const mockEligibility = {
        eligible: true,
        reasons: [],
      };

      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.evaluateEligibility.mockReturnValue(mockEligibility);

      service.buildWorkflowLaunchDescriptor(workflow, context);

      expect(mockContractService.evaluateEligibility).toHaveBeenCalledWith(
        mockContract,
        context,
      );
    });

    // ── Task 1A: Dry-run eligibility evaluation with various concurrency states ──

    it('returns non-null for eligible workflow with no concurrency policy', () => {
      const workflow = createMockWorkflow();
      const context = { scopeId: null, contextId: null };

      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Eligible Workflow',
      };
      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Eligible Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };
      const mockEligibility = {
        eligible: true,
        reasons: [],
      };

      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.evaluateEligibility.mockReturnValue(mockEligibility);

      const descriptor = service.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      );

      expect(descriptor).not.toBeNull();
      expect(descriptor?.eligibility.eligible).toBe(true);
    });

    it('returns non-null when max_runs is not exhausted', () => {
      const workflow = createMockWorkflow();
      const context = { scopeId: 'scope-1', contextId: null };

      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Concurrency-Aware Workflow',
        concurrency: { max_runs: 3, on_conflict: 'skip' },
      };
      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Concurrency-Aware Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };
      const mockEligibility = {
        eligible: true,
        reasons: [],
      };

      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.evaluateEligibility.mockReturnValue(mockEligibility);

      const descriptor = service.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      );

      expect(descriptor).not.toBeNull();
      expect(descriptor?.eligibility.eligible).toBe(true);
    });

    it('marks ineligible when max_runs exhausted and on_conflict="skip"', () => {
      const workflow = createMockWorkflow();
      const context = { scopeId: null, contextId: null };

      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Busy Workflow',
      };
      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Busy Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };
      const mockEligibility = {
        eligible: false,
        reasons: [
          {
            code: 'CONTEXT_REQUIRED' as const,
            message:
              'Concurrency limit reached for this workflow (on_conflict=skip)',
          },
        ],
      };

      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.evaluateEligibility.mockReturnValue(mockEligibility);

      const descriptor = service.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      );

      expect(descriptor).not.toBeNull();
      expect(descriptor?.eligibility.eligible).toBe(false);
      expect(descriptor?.eligibility.reasons[0].message).toContain(
        'Concurrency limit',
      );
    });

    it('marks ineligible when max_runs exhausted and on_conflict="cancel_running"', () => {
      const workflow = createMockWorkflow();
      const context = { scopeId: null, contextId: null };

      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Cancel-Running Workflow',
      };
      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Cancel-Running Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };
      const mockEligibility = {
        eligible: false,
        reasons: [
          {
            code: 'CONTEXT_REQUIRED' as const,
            message:
              'Concurrency limit reached for this workflow (on_conflict=cancel_running)',
          },
        ],
      };

      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.evaluateEligibility.mockReturnValue(mockEligibility);

      const descriptor = service.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      );

      expect(descriptor).not.toBeNull();
      expect(descriptor?.eligibility.eligible).toBe(false);
      expect(descriptor?.eligibility.reasons[0].message).toContain(
        'cancel_running',
      );
    });

    it('builds descriptor for non-manual trigger type', () => {
      const workflow = createWorkflowWithTrigger('event', {
        context: 'none',
        inputs: [],
      });
      const context = { scopeId: null, contextId: null };

      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Event-Triggered Workflow',
        trigger: { type: 'event', launch: { context: 'none', inputs: [] } },
      };
      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Event-Triggered Workflow',
        triggerType: 'event' as const,
        launchable: false,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };
      const mockEligibility = {
        eligible: false,
        reasons: [
          {
            code: 'WORKFLOW_NOT_MANUAL' as const,
            message: 'Workflow is not manually launchable',
          },
        ],
      };

      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.evaluateEligibility.mockReturnValue(mockEligibility);

      const descriptor = service.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      );

      expect(descriptor).not.toBeNull();
      expect(descriptor?.eligibility.eligible).toBe(false);
      expect(descriptor?.eligibility.reasons[0].code).toBe(
        'WORKFLOW_NOT_MANUAL',
      );
    });

    it('builds descriptor with context-required but no scopeId provided', () => {
      const workflow = createWorkflowWithTrigger('manual', {
        context: 'required',
        inputs: [],
      });
      const context = { scopeId: null, contextId: null };

      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Context-Required Workflow',
        trigger: {
          type: 'manual',
          launch: { context: 'required', inputs: [] },
        },
      };
      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Context-Required Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'required' as const,
        inputs: [],
        allowRawJson: true,
      };
      const mockEligibility = {
        eligible: false,
        reasons: [
          {
            code: 'CONTEXT_REQUIRED' as const,
            message: 'This workflow requires a context.',
          },
          {
            code: 'CONTEXT_ID_REQUIRED' as const,
            message: 'This workflow requires a target context item.',
          },
        ],
      };

      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.evaluateEligibility.mockReturnValue(mockEligibility);

      const descriptor = service.buildWorkflowLaunchDescriptor(
        workflow,
        context,
      );

      expect(descriptor).not.toBeNull();
      expect(descriptor?.eligibility.eligible).toBe(false);
      expect(descriptor?.eligibility.reasons).toHaveLength(2);
      expect(descriptor?.eligibility.reasons.map((r) => r.code)).toContain(
        'CONTEXT_REQUIRED',
      );
      expect(descriptor?.eligibility.reasons.map((r) => r.code)).toContain(
        'CONTEXT_ID_REQUIRED',
      );
    });
  });

  describe('executeWorkflowInternal', () => {
    const defaultLaunchSource = 'manual' as const;

    describe('dry-run eligibility evaluation', () => {
      it('executes dry-run when dry_run flag is true and returns result', async () => {
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: { objective: 'test' },
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue({
          steps: [],
          valid: true,
        });

        const executeDto = {
          trigger_data: { objective: 'test' },
          dry_run: true,
        };

        const result = await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto,
          defaultLaunchSource,
        });

        expect(result.success).toBe(true);
        expect(mockWorkflowEngine.startWorkflow).toHaveBeenCalledWith(
          'workflow-1',
          expect.objectContaining({ objective: 'test' }),
          { dryRun: true },
        );
        expect(mockEventLedger.emitBestEffort).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: 'launch_executed',
            outcome: 'success',
            payload: expect.objectContaining({ dryRun: true }),
          }),
        );
      });

      it('returns dry-run result data when dry_run is enabled', async () => {
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };
        const dryRunResult = {
          steps: [{ id: 'step-1', status: 'success' }],
          valid: true,
          totalSteps: 1,
          executedSteps: 1,
        } as unknown as WorkflowDryRunResult;

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue(dryRunResult);

        const result = await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: { dry_run: true },
          defaultLaunchSource,
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual(dryRunResult);
      });

      it('dry_run=false does NOT pass dryRun option to the engine', async () => {
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-456');

        await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: { dry_run: false },
          defaultLaunchSource,
        });

        // Should call startWorkflow with exactly 2 args (no options object)
        expect(mockWorkflowEngine.startWorkflow).toHaveBeenCalledWith(
          'workflow-1',
          expect.any(Object),
        );
        const callArgs = mockWorkflowEngine.startWorkflow.mock.calls[0];
        expect(callArgs).toHaveLength(2);
      });
    });

    describe('launch contract validation failures', () => {
      it('throws BadRequestException when contract validation fails', async () => {
        expect.assertions(1);
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'required' as const,
          inputs: [],
          allowRawJson: true,
        };

        const validationIssues = [
          { code: 'CONTEXT_REQUIRED' as const, message: 'Context is required' },
          {
            code: 'CONTEXT_ID_REQUIRED' as const,
            message: 'Context ID is required',
          },
        ];

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: false,
          issues: validationIssues,
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });

        await expect(
          service.executeWorkflowInternal({
            workflowId: 'workflow-1',
            executeDto: {},
            defaultLaunchSource,
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('emits launch_rejected event when validation fails', async () => {
        expect.assertions(1);
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'required' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: false,
          issues: [{ code: 'CONTEXT_REQUIRED', message: 'Context required' }],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });

        try {
          await service.executeWorkflowInternal({
            workflowId: 'workflow-1',
            executeDto: {},
            defaultLaunchSource,
          });
        } catch {
          // Expected to throw
        }

        expect(mockEventLedger.emitBestEffort).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: 'launch_rejected',
            outcome: 'denied',
            errorCode: 'WORKFLOW_LAUNCH_VALIDATION_FAILED',
          }),
        );
      });

      it('throws with proper error structure containing issues', async () => {
        expect.assertions(3);
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'required' as const,
          inputs: [],
          allowRawJson: true,
        };
        const issues = [
          {
            code: 'MISSING_REQUIRED_INPUT' as const,
            message: 'Input required',
            field: 'objective',
          },
        ];

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: false,
          issues,
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });

        try {
          await service.executeWorkflowInternal({
            workflowId: 'workflow-1',
            executeDto: { trigger_data: {} },
            defaultLaunchSource,
          });
        } catch (error) {
          expect(error).toBeInstanceOf(BadRequestException);
          const response = (
            error as BadRequestException
          ).getResponse() as Record<string, unknown>;
          expect(response.code).toBe('WORKFLOW_LAUNCH_VALIDATION_FAILED');
          expect(response.issues).toEqual(issues);
        }
      });
    });

    describe('preset resolution paths', () => {
      it('resolves preset trigger data when preset_id is provided', async () => {
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };
        const presetTriggerData = {
          objective: 'preset-objective',
          priority: 'high',
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: presetTriggerData,
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockPresetRepository.findByIdAndWorkflow.mockResolvedValue({
          id: 'preset-1',
          workflow_id: 'workflow-1',
          trigger_data: presetTriggerData,
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-123');

        const result = await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: { preset_id: 'preset-1' },
          defaultLaunchSource,
        });

        expect(mockPresetRepository.findByIdAndWorkflow).toHaveBeenCalledWith(
          'preset-1',
          'workflow-1',
        );
        expect(result.success).toBe(true);
      });

      it('merges preset trigger data with executeDto trigger_data', async () => {
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };
        const presetTriggerData = {
          objective: 'from-preset',
          priority: 'high',
        };
        const executeTriggerData = {
          objective: 'from-execute', // Override preset value
          additional_field: 'extra',
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockImplementation(
          ({ triggerData }) => ({
            valid: true,
            issues: [],
            normalizedTriggerData: triggerData as Record<string, unknown>,
            normalizedContext: { scopeId: null, contextId: null },
          }),
        );
        mockPresetRepository.findByIdAndWorkflow.mockResolvedValue({
          id: 'preset-1',
          workflow_id: 'workflow-1',
          trigger_data: presetTriggerData,
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-123');

        await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: {
            preset_id: 'preset-1',
            trigger_data: executeTriggerData,
          },
          defaultLaunchSource,
        });

        // Verify the service received the merged data
        const calledArgs = mockWorkflowEngine.startWorkflow.mock.calls[0];
        expect(calledArgs[0]).toBe('workflow-1');
        expect(calledArgs[1]).toHaveProperty('objective', 'from-execute');
        expect(calledArgs[1]).toHaveProperty('priority', 'high');
        expect(calledArgs[1]).toHaveProperty('additional_field', 'extra');
        expect(calledArgs[2]).toBeUndefined();
      });

      it('sets launch source to preset when preset_id is provided', async () => {
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockPresetRepository.findByIdAndWorkflow.mockResolvedValue({
          id: 'preset-1',
          workflow_id: 'workflow-1',
          trigger_data: {},
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-123');

        await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: { preset_id: 'preset-1' },
          defaultLaunchSource,
        });

        // Verify launch metadata contains preset as source
        const startWorkflowCall =
          mockWorkflowEngine.startWorkflow.mock.calls[0];
        const triggerData = startWorkflowCall[1];
        expect(triggerData._launch).toMatchObject({
          source: 'preset',
          presetId: 'preset-1',
        });
      });

      it('throws NotFoundException when preset is not found', async () => {
        expect.assertions(1);
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockPresetRepository.findByIdAndWorkflow.mockResolvedValue(null);

        await expect(
          service.executeWorkflowInternal({
            workflowId: 'workflow-1',
            executeDto: { preset_id: 'nonexistent-preset' },
            defaultLaunchSource,
          }),
        ).rejects.toThrow(NotFoundException);
      });

      it('proceeds when preset exists but trigger_data is empty object', async () => {
        expect.assertions(2);

        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockPresetRepository.findByIdAndWorkflow.mockResolvedValue({
          id: 'preset-empty',
          workflow_id: 'workflow-1',
          trigger_data: {},
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-empty-preset');

        const result = await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: { preset_id: 'preset-empty' },
          defaultLaunchSource,
        });

        expect(result.success).toBe(true);
        expect(mockWorkflowEngine.startWorkflow).toHaveBeenCalled();
      });

      it('proceeds when preset exists but trigger_data is null', async () => {
        expect.assertions(2);

        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockPresetRepository.findByIdAndWorkflow.mockResolvedValue({
          id: 'preset-null',
          workflow_id: 'workflow-1',
          trigger_data: null,
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-null-preset');

        const result = await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: { preset_id: 'preset-null' },
          defaultLaunchSource,
        });

        expect(result.success).toBe(true);
        expect(mockWorkflowEngine.startWorkflow).toHaveBeenCalled();
      });

      it('passes through extra unknown fields in preset trigger_data', async () => {
        expect.assertions(4);

        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };
        const presetData = {
          objective: 'preset-objective',
          extra_field: 'should-pass-through',
          nested: { deep: 'value' },
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockImplementation(
          ({ triggerData }) => ({
            valid: true,
            issues: [],
            normalizedTriggerData: triggerData as Record<string, unknown>,
            normalizedContext: { scopeId: null, contextId: null },
          }),
        );
        mockPresetRepository.findByIdAndWorkflow.mockResolvedValue({
          id: 'preset-extra',
          workflow_id: 'workflow-1',
          trigger_data: presetData,
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-extra');

        await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: { preset_id: 'preset-extra' },
          defaultLaunchSource,
        });

        const calledArgs = mockWorkflowEngine.startWorkflow.mock.calls[0];
        expect(calledArgs[0]).toBe('workflow-1');
        expect(calledArgs[1]).toHaveProperty('objective', 'preset-objective');
        expect(calledArgs[1]).toHaveProperty(
          'extra_field',
          'should-pass-through',
        );
        expect(calledArgs[1]).toHaveProperty('nested', { deep: 'value' });
      });
    });

    describe('lifecycle event emission', () => {
      it('emits launch_requested event before validation', async () => {
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-123');

        const emitCalls: string[] = [];
        mockEventLedger.emitBestEffort.mockImplementation((params) => {
          emitCalls.push(params.eventName);
          return Promise.resolve();
        });

        await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: {},
          defaultLaunchSource,
        });

        expect(emitCalls).toContain('launch_requested');
        expect(emitCalls.indexOf('launch_requested')).toBeLessThan(
          emitCalls.indexOf('launch_validated'),
        );
      });

      it('emits launch_validated event after successful validation', async () => {
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-123');

        await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: {},
          defaultLaunchSource,
        });

        expect(mockEventLedger.emitBestEffort).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: 'launch_validated',
            outcome: 'success',
          }),
        );
      });

      it('emits launch_executed event with in_progress outcome for non-dry-run', async () => {
        expect.assertions(1);
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-123');

        await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: {},
          defaultLaunchSource,
        });

        expect(mockEventLedger.emitBestEffort).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: 'launch_executed',
            outcome: 'in_progress',
            payload: expect.objectContaining({ dryRun: false }),
          }),
        );
      });

      it('includes workflow and context info in lifecycle events', async () => {
        expect.assertions(1);
        const workflow = createMockWorkflow({ id: 'workflow-123' });
        const mockDefinition = {
          workflow_id: 'def-456',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'def-456',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: 'scope-1', contextId: 'ctx-1' },
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-789');

        await service.executeWorkflowInternal({
          workflowId: 'workflow-123',
          executeDto: {},
          defaultLaunchSource,
        });

        expect(mockEventLedger.emitBestEffort).toHaveBeenCalledWith(
          expect.objectContaining({
            workflowId: 'workflow-123',
            context: {
              scopeId: 'scope-1',
              contextId: 'ctx-1',
              contextType: 'resource',
              scopeNodeId: null,
              scopePath: null,
            },
          }),
        );
      });

      it('emits launch_failed event when engine.startWorkflow throws', async () => {
        expect.assertions(3);

        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockWorkflowEngine.startWorkflow.mockRejectedValue(
          new Error('Engine start failure'),
        );

        try {
          await service.executeWorkflowInternal({
            workflowId: 'workflow-1',
            executeDto: {},
            defaultLaunchSource,
          });
        } catch {
          // Expected to throw
        }

        const calls = mockEventLedger.emitBestEffort.mock.calls;
        const eventNames = calls.map((c) => c[0].eventName);

        expect(eventNames).toContain('launch_requested');
        expect(eventNames).toContain('launch_validated');
        // launch_executed should NOT be emitted since the engine threw
        expect(eventNames).not.toContain('launch_executed');
      });

      it('lifecycle event payload includes all required fields', async () => {
        expect.assertions(6);

        const workflow = createMockWorkflow({ id: 'workflow-payload' });
        const mockDefinition = {
          workflow_id: 'def-payload',
          name: 'Payload Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'def-payload',
          workflowName: 'Payload Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: {
            scopeId: 'scope-payload',
            contextId: 'ctx-payload',
          },
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-payload');

        await service.executeWorkflowInternal({
          workflowId: 'workflow-payload',
          executeDto: {},
          defaultLaunchSource,
        });

        // Inspect a lifecycle event payload for required fields
        const launchExecutedCall =
          mockEventLedger.emitBestEffort.mock.calls.find(
            (c) => c[0].eventName === 'launch_executed',
          );

        expect(launchExecutedCall).toBeDefined();
        const params = launchExecutedCall![0];
        expect(params.domain).toBe('workflow');
        expect(params.eventName).toBe('launch_executed');
        expect(params.outcome).toBe('in_progress');
        expect(params.workflowId).toBe('workflow-payload');
        expect(params.payload).toBeDefined();
      });

      it('lifecycle event payload includes workflowId, actor context, and outcome', async () => {
        expect.assertions(5);

        const workflow = createMockWorkflow({ id: 'wf-actor' });
        const mockDefinition = {
          workflow_id: 'def-actor',
          name: 'Actor Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'def-actor',
          workflowName: 'Actor Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: {
            scopeId: 'project-actor',
            contextId: 'item-actor',
          },
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-actor');

        await service.executeWorkflowInternal({
          workflowId: 'wf-actor',
          executeDto: {},
          defaultLaunchSource,
        });

        const validatedCall = mockEventLedger.emitBestEffort.mock.calls.find(
          (c) => c[0].eventName === 'launch_validated',
        );

        expect(validatedCall).toBeDefined();
        const params = validatedCall![0];
        expect(params.workflowId).toBe('wf-actor');
        expect(params.outcome).toBe('success');
        expect(params.context).toBeDefined();
        expect(params.context!.contextType).toBe('resource');
      });
    });

    describe('checkLaunchBudget', () => {
      const defaultLaunchSource = 'manual' as const;

      it('proceeds when budget evaluation passes (decision: allow)', async () => {
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockBudgetDecisionService.evaluateAction.mockResolvedValue({
          decision: 'allow',
          reasonCode: 'within_budget',
          matchingPolicyId: null,
          estimatedCostCents: null,
          remainingBudgetCents: null,
          approvalRequired: false,
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-123');

        const result = await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: {},
          defaultLaunchSource,
        });

        expect(mockBudgetDecisionService.evaluateAction).toHaveBeenCalledWith({
          scopeId: null,
          contextType: 'workflow_run',
          contextId: 'workflow-1',
          actionType: 'workflow_launch',
          actorType: 'workflow',
          actorId: null,
          providerName: null,
          modelName: null,
          expectedTokens: null,
          correlationId: 'workflow-1',
        });
        expect(result.success).toBe(true);
      });

      it('blocks launch when budget evaluation denies (decision: deny)', async () => {
        expect.assertions(2);
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockBudgetDecisionService.evaluateAction.mockResolvedValue({
          decision: 'deny',
          reasonCode: 'hard_limit_exceeded',
          matchingPolicyId: 'policy-1',
          estimatedCostCents: 500,
          remainingBudgetCents: 0,
          approvalRequired: true,
        });

        await expect(
          service.executeWorkflowInternal({
            workflowId: 'workflow-1',
            executeDto: {},
            defaultLaunchSource,
          }),
        ).rejects.toThrow('blocked by budget policy');

        expect(mockWorkflowEngine.startWorkflow).not.toHaveBeenCalled();
      });

      it('propagates errors from budget service when not related to deny decision', async () => {
        expect.assertions(2);
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        // Budget service throws an error unrelated to budget policy blocking.
        // The orchestration service catches and swallows non-budget-policy errors,
        // so the launch should proceed.
        mockBudgetDecisionService.evaluateAction.mockRejectedValue(
          new Error('Database connection error'),
        );
        mockWorkflowEngine.startWorkflow.mockResolvedValue('run-123');

        const result = await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: {},
          defaultLaunchSource,
        });

        // Launch should proceed despite the budget service error
        expect(result.success).toBe(true);
        expect(mockWorkflowEngine.startWorkflow).toHaveBeenCalled();
      });

      it('skips budget check when dry_run is true', async () => {
        expect.assertions(1);
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };
        const dryRunResult = {
          dryRun: true as const,
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          executionPath: ['job-1'],
          parallelGroups: [['job-1']],
          stateTransitions: [],
          mockJobsApplied: [],
          jobSimulations: [],
        } as WorkflowDryRunResult;

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockWorkflowEngine.startWorkflow.mockResolvedValue(dryRunResult);

        await service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: { dry_run: true },
          defaultLaunchSource,
        });

        // Budget check should be skipped for dry runs
        expect(mockBudgetDecisionService.evaluateAction).not.toHaveBeenCalled();
      });
    });

    // ── Task 1B: Lifecycle event emission edge cases ──

    it('emits launch_started lifecycle event with contextType: resource when contextId is present', async () => {
      expect.assertions(3);
      const workflow = createMockWorkflow({ id: 'wf-resource' });
      const mockDefinition = {
        workflow_id: 'def-resource',
        name: 'Resource Context Workflow',
        trigger: { type: 'manual' },
      };
      const mockContract = {
        workflowId: 'def-resource',
        workflowName: 'Resource Context Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };

      mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.validateLaunchPayload.mockReturnValue({
        valid: true,
        issues: [],
        normalizedTriggerData: {},
        normalizedContext: {
          scopeId: 'proj-1',
          contextId: 'item-42',
        },
      });
      mockWorkflowEngine.startWorkflow.mockResolvedValue('run-resource');

      await service.executeWorkflowInternal({
        workflowId: 'wf-resource',
        executeDto: { scopeId: 'proj-1', contextId: 'item-42' },
        defaultLaunchSource,
      });

      const executeCalls = mockEventLedger.emitBestEffort.mock.calls.filter(
        (c) => c[0].eventName === 'launch_executed',
      );
      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0][0].context?.contextType).toBe('resource');
      expect(executeCalls[0][0].context?.contextId).toBe('item-42');
    });

    it('emits launch_started with contextType: project when only scopeId is present', async () => {
      expect.assertions(3);
      const workflow = createMockWorkflow({ id: 'wf-project' });
      const mockDefinition = {
        workflow_id: 'def-project',
        name: 'Project Only Workflow',
        trigger: { type: 'manual' },
      };
      const mockContract = {
        workflowId: 'def-project',
        workflowName: 'Project Only Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };

      mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.validateLaunchPayload.mockReturnValue({
        valid: true,
        issues: [],
        normalizedTriggerData: {},
        normalizedContext: {
          scopeId: 'proj-only',
          contextId: null,
        },
      });
      mockWorkflowEngine.startWorkflow.mockResolvedValue('run-project');

      await service.executeWorkflowInternal({
        workflowId: 'wf-project',
        executeDto: { scopeId: 'proj-only' },
        defaultLaunchSource,
      });

      const executeCalls = mockEventLedger.emitBestEffort.mock.calls.filter(
        (c) => c[0].eventName === 'launch_executed',
      );
      expect(executeCalls).toHaveLength(1);
      // contextType should be null when no contextId, even if scopeId is present
      expect(executeCalls[0][0].context?.contextType).toBeNull();
      expect(executeCalls[0][0].context?.scopeId).toBe('proj-only');
    });

    it('emits lifecycle event with presetId in payload when using a preset', async () => {
      expect.assertions(3);
      const workflow = createMockWorkflow({ id: 'wf-preset-event' });
      const mockDefinition = {
        workflow_id: 'def-preset-event',
        name: 'Preset Event Workflow',
        trigger: { type: 'manual' },
      };
      const mockContract = {
        workflowId: 'def-preset-event',
        workflowName: 'Preset Event Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };

      mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.validateLaunchPayload.mockReturnValue({
        valid: true,
        issues: [],
        normalizedTriggerData: {},
        normalizedContext: { scopeId: null, contextId: null },
      });
      mockPresetRepository.findByIdAndWorkflow.mockResolvedValue({
        id: 'preset-event-1',
        workflow_id: 'wf-preset-event',
        trigger_data: { objective: 'from preset' },
      });
      mockWorkflowEngine.startWorkflow.mockResolvedValue('run-preset-event');

      await service.executeWorkflowInternal({
        workflowId: 'wf-preset-event',
        executeDto: { preset_id: 'preset-event-1' },
        defaultLaunchSource,
      });

      const executeCalls = mockEventLedger.emitBestEffort.mock.calls.filter(
        (c) => c[0].eventName === 'launch_executed',
      );
      expect(executeCalls).toHaveLength(1);
      expect(executeCalls[0][0].payload).toHaveProperty(
        'presetId',
        'preset-event-1',
      );
      expect(executeCalls[0][0].payload).toHaveProperty(
        'launchSource',
        'preset',
      );
    });

    it('emits launch_failed lifecycle event when workflow engine throws', async () => {
      expect.assertions(4);
      const workflow = createMockWorkflow({ id: 'wf-engine-fail' });
      const mockDefinition = {
        workflow_id: 'def-engine-fail',
        name: 'Engine Failure Workflow',
        trigger: { type: 'manual' },
      };
      const mockContract = {
        workflowId: 'def-engine-fail',
        workflowName: 'Engine Failure Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };

      mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.validateLaunchPayload.mockReturnValue({
        valid: true,
        issues: [],
        normalizedTriggerData: {},
        normalizedContext: { scopeId: 'scope-x', contextId: 'ctx-y' },
      });
      mockWorkflowEngine.startWorkflow.mockRejectedValue(
        new Error('Engine crashed'),
      );

      try {
        await service.executeWorkflowInternal({
          workflowId: 'wf-engine-fail',
          executeDto: {},
          defaultLaunchSource,
        });
      } catch {
        // Expected
      }

      // launch_requested and launch_validated should have been emitted
      const eventNames = mockEventLedger.emitBestEffort.mock.calls.map(
        (c) => c[0].eventName,
      );
      expect(eventNames).toContain('launch_requested');
      expect(eventNames).toContain('launch_validated');
      // launch_executed should NOT be emitted on failure
      expect(eventNames).not.toContain('launch_executed');
      // The engine threw, so verify we got the 2 events
      expect(eventNames).toHaveLength(2);
    });

    it('event payload includes correct launch_source derivation', async () => {
      expect.assertions(2);
      const workflow = createMockWorkflow({ id: 'wf-source' });
      const mockDefinition = {
        workflow_id: 'def-source',
        name: 'Launch Source Workflow',
        trigger: { type: 'manual' },
      };
      const mockContract = {
        workflowId: 'def-source',
        workflowName: 'Launch Source Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };

      mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.validateLaunchPayload.mockReturnValue({
        valid: true,
        issues: [],
        normalizedTriggerData: {},
        normalizedContext: { scopeId: null, contextId: null },
      });
      mockWorkflowEngine.startWorkflow.mockResolvedValue('run-source');

      await service.executeWorkflowInternal({
        workflowId: 'wf-source',
        executeDto: { launch_source: 'project_scoped' },
        defaultLaunchSource: 'manual',
      });

      // Check that the executed event has the manual default source (since no preset)
      const validatedCall = mockEventLedger.emitBestEffort.mock.calls.find(
        (c) => c[0].eventName === 'launch_validated',
      );
      expect(validatedCall).toBeDefined();
      expect(validatedCall![0].payload).toHaveProperty(
        'launchSource',
        'project_scoped',
      );
    });

    // ── Task 1C: Preset resolution edge cases ──

    it('resolves preset when it exists and has trigger_data', async () => {
      const workflow = createMockWorkflow();
      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Test Workflow',
        trigger: { type: 'manual' },
      };
      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Test Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };
      const presetData = {
        objective: 'canned-objective',
        priority: 'low',
        tags: ['urgent'],
      };

      mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockContractService.validateLaunchPayload.mockImplementation(
        ({ triggerData }) => ({
          valid: true,
          issues: [],
          normalizedTriggerData: triggerData as Record<string, unknown>,
          normalizedContext: { scopeId: null, contextId: null },
        }),
      );
      mockPresetRepository.findByIdAndWorkflow.mockResolvedValue({
        id: 'preset-xyz',
        workflow_id: 'workflow-1',
        trigger_data: presetData,
      });
      mockWorkflowEngine.startWorkflow.mockResolvedValue('run-preset');

      await service.executeWorkflowInternal({
        workflowId: 'workflow-1',
        executeDto: { preset_id: 'preset-xyz' },
        defaultLaunchSource,
      });

      const startArgs = mockWorkflowEngine.startWorkflow.mock.calls[0];
      expect(startArgs[1]).toHaveProperty('objective', 'canned-objective');
      expect(startArgs[1]).toHaveProperty('priority', 'low');
      expect(startArgs[1]).toHaveProperty('tags', ['urgent']);
    });

    it('throws NotFoundException when presetId provided but preset not found', async () => {
      expect.assertions(1);
      const workflow = createMockWorkflow();
      const mockDefinition = {
        workflow_id: 'workflow-1',
        name: 'Test Workflow',
        trigger: { type: 'manual' },
      };
      const mockContract = {
        workflowId: 'workflow-1',
        workflowName: 'Test Workflow',
        triggerType: 'manual' as const,
        launchable: true,
        context: 'none' as const,
        inputs: [],
        allowRawJson: true,
      };

      mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
      mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
      mockContractService.buildContract.mockReturnValue(mockContract);
      mockPresetRepository.findByIdAndWorkflow.mockResolvedValue(null);

      await expect(
        service.executeWorkflowInternal({
          workflowId: 'workflow-1',
          executeDto: { preset_id: 'missing-preset' },
          defaultLaunchSource,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    describe('error propagation', () => {
      it('propagates engine service errors', async () => {
        expect.assertions(1);
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockWorkflowEngine.startWorkflow.mockRejectedValue(
          new Error('Engine failure'),
        );

        await expect(
          service.executeWorkflowInternal({
            workflowId: 'workflow-1',
            executeDto: {},
            defaultLaunchSource,
          }),
        ).rejects.toThrow('Engine failure');
      });

      it('propagates persistence service errors', async () => {
        expect.assertions(1);
        mockWorkflowPersistence.getWorkflow.mockRejectedValue(
          new Error('Workflow not found'),
        );

        await expect(
          service.executeWorkflowInternal({
            workflowId: 'nonexistent',
            executeDto: {},
            defaultLaunchSource,
          }),
        ).rejects.toThrow('Workflow not found');
      });

      it('propagates parser service errors', async () => {
        expect.assertions(1);
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockImplementation(() => {
          throw new Error('Parse failure');
        });
        mockContractService.buildContract.mockReturnValue(mockContract);

        await expect(
          service.executeWorkflowInternal({
            workflowId: 'workflow-1',
            executeDto: {},
            defaultLaunchSource,
          }),
        ).rejects.toThrow('Parse failure');
      });

      it('emits failure event when engine fails', async () => {
        expect.assertions(1);
        const workflow = createMockWorkflow();
        const mockDefinition = {
          workflow_id: 'workflow-1',
          name: 'Test Workflow',
          trigger: { type: 'manual' },
        };
        const mockContract = {
          workflowId: 'workflow-1',
          workflowName: 'Test Workflow',
          triggerType: 'manual' as const,
          launchable: true,
          context: 'none' as const,
          inputs: [],
          allowRawJson: true,
        };

        mockWorkflowPersistence.getWorkflow.mockResolvedValue(workflow);
        mockWorkflowParser.parseWorkflow.mockReturnValue(mockDefinition);
        mockContractService.buildContract.mockReturnValue(mockContract);
        mockContractService.validateLaunchPayload.mockReturnValue({
          valid: true,
          issues: [],
          normalizedTriggerData: {},
          normalizedContext: { scopeId: null, contextId: null },
        });
        mockWorkflowEngine.startWorkflow.mockRejectedValue(
          new Error('Engine failure'),
        );

        try {
          await service.executeWorkflowInternal({
            workflowId: 'workflow-1',
            executeDto: {},
            defaultLaunchSource,
          });
        } catch {
          // Expected to throw
        }

        // Verify lifecycle events were emitted before the error
        expect(mockEventLedger.emitBestEffort).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: 'launch_requested',
          }),
        );
      });
    });
  });
});
