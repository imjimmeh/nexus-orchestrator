import { vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowStatus } from '@nexus/core';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../kernel/interfaces/workflow-kernel.ports';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { MeshDelegationService } from '../workflow-subagents/mesh-delegation.service';
import { SubagentOrchestratorService } from '../workflow-subagents/subagent-orchestrator.service';
import { WorkflowRuntimeMeshDelegationToolsService } from './workflow-runtime-mesh-delegation-tools.service';
import { WorkflowStageSkillPolicyService } from '../workflow-stage-skill-policy.service';
import { ExecutionContextResolverService } from '../execution-context-resolver.service';

describe('WorkflowRuntimeMeshDelegationToolsService', () => {
  let service: WorkflowRuntimeMeshDelegationToolsService;

  const runRepository = {
    findById: vi.fn().mockResolvedValue({
      id: 'run-1',
      status: WorkflowStatus.RUNNING,
      state_variables: {
        trigger: {
          orchestrationStatus: 'orchestrating',
        },
      },
    }),
  };

  const subagentOrchestrator = {
    spawn: vi.fn().mockResolvedValue('exec-1'),
    cancelExecution: vi.fn().mockResolvedValue(true),
  };

  const meshDelegation = {
    createDelegation: vi.fn(),
    getContractById: vi.fn(),
    cancelDelegation: vi.fn(),
    dispatchQueuedDelegations: vi.fn(),
    getReplay: vi.fn(),
    sweepTimedOutDelegations: vi.fn(),
  };

  const stageSkillPolicy = {
    resolveLifecycleStage: vi.fn().mockReturnValue('implementation'),
  };

  const docker = {
    listContainers: vi.fn().mockResolvedValue([
      {
        Id: 'parent-container-1',
        Created: 12,
      },
    ]),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRuntimeMeshDelegationToolsService,
        { provide: WORKFLOW_RUN_REPOSITORY_PORT, useValue: runRepository },
        {
          provide: SubagentOrchestratorService,
          useValue: subagentOrchestrator,
        },
        { provide: MeshDelegationService, useValue: meshDelegation },
        {
          provide: WorkflowStageSkillPolicyService,
          useValue: stageSkillPolicy,
        },
        { provide: DOCKER_CLIENT, useValue: docker },
        ExecutionContextResolverService,
      ],
    }).compile();

    service = module.get(WorkflowRuntimeMeshDelegationToolsService);
  });
  it('creates delegation contracts from agent execution context', async () => {
    meshDelegation.createDelegation.mockResolvedValue({
      contract: { id: 'contract-1', workflow_run_id: 'run-1' },
      governanceDecision: {
        allowed: true,
        effectiveTools: ['read'],
        privilegedTools: [],
        rationale: [],
      },
      dispatchResult: {
        workflowRunId: 'run-1',
        parentContainerId: 'parent-container-1',
        dispatchedContractIds: ['contract-1'],
        failedContractIds: [],
        backpressure: false,
      },
    });

    const result = await service.createDelegationContract(
      {
        userId: 'agent:run-1:job-1',
        agentProfileName: 'architect-agent',
      },
      {
        objective: 'Implement feature',
        agent_profile: 'architect-agent',
        tools: ['read'],
        tier: 'heavy',
      },
    );

    expect(meshDelegation.createDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        parentContainerId: 'parent-container-1',
        parentExecutionId: 'job-1',
        requesterAgentProfile: 'architect-agent',
        objective: 'Implement feature',
      }),
      expect.objectContaining({
        workflowRunId: 'run-1',
        parentContainerId: 'parent-container-1',
        lifecycleStage: 'implementation',
        spawnHandler: expect.any(Function),
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'create_delegation_contract',
      }),
    );
  });

  it('rejects delegation creation for cancelled workflow runs', async () => {
    runRepository.findById.mockResolvedValueOnce({
      id: 'run-1',
      status: WorkflowStatus.CANCELLED,
      state_variables: { trigger: {} },
    });

    await expect(
      service.createDelegationContract(
        {
          userId: 'agent:run-1:job-1',
          agentProfileName: 'architect-agent',
        },
        {
          objective: 'Implement feature',
          agent_profile: 'architect-agent',
          tools: ['read'],
          tier: 'heavy',
        },
      ),
    ).rejects.toThrow('terminal status CANCELLED');

    expect(meshDelegation.createDelegation).not.toHaveBeenCalled();
  });

  it('uses the authenticated step id to resolve the parent container for delegation contracts', async () => {
    docker.listContainers.mockImplementation(async (options) => {
      const labels = new Set(options?.filters?.label ?? []);
      if (labels.has('nexus.step_id=implement')) {
        return [
          {
            Id: 'parent-container-1',
            Created: 12,
          },
        ];
      }

      return [
        {
          Id: 'child-subagent-container',
          Created: 20,
        },
        {
          Id: 'parent-container-1',
          Created: 12,
        },
      ];
    });
    meshDelegation.createDelegation.mockResolvedValue({
      contract: { id: 'contract-1', workflow_run_id: 'run-1' },
      governanceDecision: {
        allowed: true,
        effectiveTools: ['read'],
        privilegedTools: [],
        rationale: [],
      },
      dispatchResult: {
        workflowRunId: 'run-1',
        parentContainerId: 'parent-container-1',
        dispatchedContractIds: ['contract-1'],
        failedContractIds: [],
        backpressure: false,
      },
    });

    await service.createDelegationContract(
      {
        userId: 'agent:run-1:implement_and_commit',
        stepId: 'implement',
      },
      {
        objective: 'Implement feature',
        agent_profile: 'architect-agent',
        tools: ['read'],
        tier: 'heavy',
      },
    );

    expect(meshDelegation.createDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        parentContainerId: 'parent-container-1',
      }),
      expect.objectContaining({
        parentContainerId: 'parent-container-1',
      }),
    );
  });

  it('rejects delegation contract lookup from a different workflow run', async () => {
    meshDelegation.getContractById.mockResolvedValue({
      id: 'contract-1',
      workflow_run_id: 'run-2',
    });

    await expect(
      service.getDelegationContract(
        {
          userId: 'agent:run-1:job-1',
        },
        { contract_id: 'contract-1' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('wires cancellation handler through to subagent orchestrator', async () => {
    meshDelegation.cancelDelegation.mockResolvedValue({
      cancelled: true,
      contract: { id: 'contract-1' },
    });

    await service.cancelDelegationContract(
      {
        userId: 'agent:run-1:job-1',
      },
      { contract_id: 'contract-1' },
    );

    const cancelCall = meshDelegation.cancelDelegation.mock.calls[0]?.[0];
    if (!cancelCall) {
      throw new Error('Expected cancelDelegation call');
    }

    await cancelCall.cancelHandler({
      workflowRunId: 'run-1',
      parentContainerId: 'parent-container-1',
      subagentExecutionId: 'exec-1',
      reason: 'manual_cancel',
    });

    expect(subagentOrchestrator.cancelExecution).toHaveBeenCalledWith(
      'parent-container-1',
      'exec-1',
      {
        workflowRunId: 'run-1',
        reason: 'manual_cancel',
      },
    );
  });

  it('rejects calls without agent execution context', async () => {
    await expect(
      service.createDelegationContract(
        {
          userId: 'user-1',
        },
        {
          objective: 'Implement feature',
          agent_profile: 'architect-agent',
          tools: ['read'],
          tier: 'heavy',
        },
      ),
    ).rejects.toThrow('Agent execution context is required');
  });
});
