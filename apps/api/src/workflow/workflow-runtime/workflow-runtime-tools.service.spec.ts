import { Test, TestingModule } from '@nestjs/testing';
import {
  ScheduledJobScope,
  ToolPolicyEffect,
  WorkflowStatus,
} from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRuntimeToolsService } from './workflow-runtime-tools.service';
import { WorkflowRepositoryAggregator } from '../workflow-repository-aggregator.service';
import { CapabilityPreflightService } from '../../tool/capability-preflight.service';
import { StepSupportService } from '../workflow-step-execution/step-support.service';
import { InternalToolRegistryService } from '../../tool/internal-tool-registry.service';
import { ExecutionContextResolverService } from '../execution-context-resolver.service';
import { WorkflowRunRepository } from '../database/repositories/workflow-run.repository';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../kernel/interfaces/workflow-kernel.ports';
import { CHAT_SESSION_REPOSITORY_PORT } from '../domain-ports';
import { ToolContractRepairAdapter } from '../../tool-runtime/tool-contract-repair.adapter';
import { StandingOrdersService } from '../../automation/standing-orders.service';
import {
  WORKFLOW_PARSER_SERVICE,
  WORKFLOW_RUNTIME_CAPABILITY_EXECUTOR_SERVICE,
} from '../kernel/interfaces/workflow-kernel.ports';

describe('WorkflowRuntimeToolsService', () => {
  let service: WorkflowRuntimeToolsService;
  const chatscope_id = '556d4517-b7c5-44b8-b36e-cb58ccd2dc90';

  const runRepository = {
    findById: vi.fn().mockResolvedValue({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.RUNNING,
      current_step_id: 'job-1',
      state_variables: { trigger: { scope_id: 'project-1' } },
    }),
  };

  const workflowRepository = {
    findById: vi.fn().mockResolvedValue({
      id: 'wf-1',
      yaml_definition:
        'workflow_id: wf-1\nname: test\njobs:\n  - id: job-1\n    type: execution\n    tier: light\n',
    }),
    findByIdentifier: vi.fn().mockResolvedValue({
      id: 'wf-1',
      yaml_definition:
        'workflow_id: wf-1\nname: test\njobs:\n  - id: job-1\n    type: execution\n    tier: light\n',
    }),
  };

  const parser = {
    parseWorkflow: vi.fn().mockReturnValue({
      workflow_id: 'wf-1',
      jobs: [
        {
          id: 'job-1',
          type: 'execution',
          tier: 'light',
          steps: [{ id: 'default', prompt: 'test' }],
        },
      ],
    }),
  };

  const preflight = {
    resolveCapabilitySnapshot: vi.fn().mockResolvedValue({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      scopeId: 'project-1',
      mode: 'supervised',
      callableToolNames: ['query_memory'],
      denied: [],
      approvalRequiredToolNames: [],
      agentToolPolicy: null,
    }),
    resolveChatCapabilitySnapshot: vi.fn().mockResolvedValue({
      workflowRunId: '',
      jobId: 'chat',
      scopeId: chatscope_id,
      mode: 'supervised',
      callableToolNames: ['query_memory'],
      denied: [],
      approvalRequiredToolNames: [],
      agentToolPolicy: null,
    }),
  };

  const support = {
    resolveJobInputs: vi.fn().mockReturnValue({}),
    resolveAllowedToolNames: vi
      .fn()
      .mockResolvedValue(new Set(['query_memory'])),
    resolveApprovalRequiredToolNames: vi.fn().mockResolvedValue(new Set()),
    resolveAgentToolPolicy: vi.fn().mockResolvedValue(null),
  };

  const registry = {
    executeTool: vi.fn(),
  };

  const capabilityExecutor = {
    execute: vi.fn().mockImplementation((params) => params.execute()),
  };

  const contractRepair = {
    repair: vi
      .fn()
      .mockImplementation(({ payload }) =>
        Promise.resolve({ payload, repairs: [] }),
      ),
  };

  const agentProfilesRepository = {
    findPaged: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    findByNameInsensitive: vi.fn(),
    findActiveNames: vi.fn().mockResolvedValue([]),
  };

  const standingOrders = {
    getRuntimeStandingOrders: vi.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    registry.executeTool.mockImplementation(
      (name: string, _context: unknown, payload: Record<string, unknown>) =>
        Promise.resolve({
          tool_name: name,
          payload,
        }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRuntimeToolsService,
        {
          provide: WorkflowRepositoryAggregator,
          useValue: {
            workflows: workflowRepository,
            runs: runRepository,
            agentProfiles: agentProfilesRepository,
          },
        },
        { provide: WORKFLOW_PARSER_SERVICE, useValue: parser },
        { provide: CapabilityPreflightService, useValue: preflight },
        { provide: StepSupportService, useValue: support },
        { provide: InternalToolRegistryService, useValue: registry },
        {
          provide: WORKFLOW_RUNTIME_CAPABILITY_EXECUTOR_SERVICE,
          useValue: capabilityExecutor,
        },
        { provide: ToolContractRepairAdapter, useValue: contractRepair },
        ExecutionContextResolverService,
        {
          provide: WorkflowRunRepository,
          useValue: runRepository,
        },
        {
          provide: WORKFLOW_RUN_REPOSITORY_PORT,
          useExisting: WorkflowRunRepository,
        },
        {
          provide: CHAT_SESSION_REPOSITORY_PORT,
          useValue: {
            findById: vi.fn().mockResolvedValue(null),
          },
        },
        { provide: StandingOrdersService, useValue: standingOrders },
      ],
    }).compile();

    service = module.get(WorkflowRuntimeToolsService);
  });

  it('returns capability snapshot and standing orders through registry dispatch', async () => {
    const agentToolPolicy = {
      default: ToolPolicyEffect.DENY,
      rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'query_memory' }],
    };
    preflight.resolveCapabilitySnapshot.mockResolvedValueOnce({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      scopeId: 'project-1',
      mode: 'supervised',
      callableToolNames: ['query_memory'],
      denied: [],
      approvalRequiredToolNames: [],
      agentToolPolicy,
    });

    const result = await service.getCapabilities({
      user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
    });

    expect(result).toEqual(
      expect.objectContaining({
        workflow_run_id: 'run-1',
        job_id: 'job-1',
        callable_tools: ['query_memory'],
        agent_tool_policy: agentToolPolicy,
        standing_orders: [],
      }),
    );
    expect(registry.executeTool).not.toHaveBeenCalled();
  });

  it('injects active standing orders for the resolved scope into workflow capabilities', async () => {
    const runtimeStandingOrders = [
      {
        id: 'so-1',
        title: 'Escalate blocked work',
        instruction: 'Flag any blocked task to the operator immediately.',
        profile_name: null,
        priority: 10,
        override_policy: 'advisory',
      },
    ];
    standingOrders.getRuntimeStandingOrders.mockResolvedValueOnce(
      runtimeStandingOrders,
    );

    const result = await service.getCapabilities({
      user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
    });

    expect(standingOrders.getRuntimeStandingOrders).toHaveBeenCalledWith(
      'project-1',
      undefined,
    );
    expect(result).toEqual(
      expect.objectContaining({ standing_orders: runtimeStandingOrders }),
    );
  });

  it('resolves standing orders for the subagent agent profile', async () => {
    support.resolveAllowedToolNames.mockResolvedValueOnce(new Set(['bash']));
    runRepository.findById.mockResolvedValueOnce({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.RUNNING,
      current_step_id: 'job-1',
      state_variables: {
        trigger: { scope_id: '6d6bf7b3-24a2-4c6d-b53b-e34aae574bda' },
      },
    });

    await service.getCapabilities({
      workflow_run_id: 'run-1',
      job_id: 'subagent-exec-1',
      user: {
        userId: 'agent:run-1:subagent-exec-1',
        roles: ['Agent'],
        agentProfileName: 'investigation-subagent',
        workflowRunId: 'run-1',
        jobId: 'subagent-exec-1',
        isSubagent: true,
        subagentExecutionId: 'subagent-exec-1',
        parentJobId: 'run_scope_probes',
        allowedTools: ['bash'],
      },
    });

    expect(standingOrders.getRuntimeStandingOrders).toHaveBeenCalledWith(
      '6d6bf7b3-24a2-4c6d-b53b-e34aae574bda',
      'investigation-subagent',
    );
  });

  it('returns empty standing orders when resolution fails', async () => {
    standingOrders.getRuntimeStandingOrders.mockRejectedValueOnce(
      new Error('db unavailable'),
    );

    const result = await service.getCapabilities({
      user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
    });

    expect(result).toEqual(expect.objectContaining({ standing_orders: [] }));
  });

  it('resolves subagent capabilities from subagent tool context instead of parent job policy', async () => {
    support.resolveAllowedToolNames.mockResolvedValueOnce(new Set(['bash']));
    const agentToolPolicy = {
      default: ToolPolicyEffect.ALLOW,
      rules: [{ effect: ToolPolicyEffect.DENY, tool: 'write' }],
    };
    support.resolveAgentToolPolicy.mockResolvedValueOnce(agentToolPolicy);

    const result = await service.getCapabilities({
      workflow_run_id: 'run-1',
      job_id: 'subagent-exec-1',
      user: {
        userId: 'agent:run-1:subagent-exec-1',
        roles: ['Agent'],
        agentProfileName: 'investigation-subagent',
        workflowRunId: 'run-1',
        jobId: 'subagent-exec-1',
        isSubagent: true,
        subagentExecutionId: 'subagent-exec-1',
        parentJobId: 'run_scope_probes',
        allowedTools: ['bash'],
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        workflow_run_id: 'run-1',
        job_id: 'subagent-exec-1',
        parent_job_id: 'run_scope_probes',
        agent_profile_name: 'investigation-subagent',
        callable_tools: ['bash'],
        approval_required_tools: [],
        agent_tool_policy: agentToolPolicy,
      }),
    );
    expect(support.resolveAllowedToolNames).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ name: 'bash' }],
        agentProfile: 'investigation-subagent',
        policyStrategy: 'profile_only',
      }),
    );
    expect(preflight.resolveCapabilitySnapshot).not.toHaveBeenCalled();

    parser.parseWorkflow.mockReturnValueOnce({
      workflow_id: 'wf-1',
      jobs: [
        {
          id: 'run_scope_probes',
          type: 'execution',
          tier: 'heavy',
          permissions: {
            tool_policy: {
              default: ToolPolicyEffect.ALLOW,
              rules: [{ effect: ToolPolicyEffect.DENY, tool: 'bash' }],
            },
          },
          steps: [{ id: 'probe', prompt: 'spawn probes' }],
        },
      ],
    });
    preflight.resolveCapabilitySnapshot.mockResolvedValueOnce({
      workflowRunId: 'run-1',
      jobId: 'run_scope_probes',
      scopeId: 'project-1',
      mode: 'supervised',
      callableToolNames: [],
      denied: [
        {
          toolName: 'bash',
          reasonCode: 'job_policy_denied',
          reason: 'Parent job denies bash',
          policyAuthority: 'job_policy',
        },
      ],
      approvalRequiredToolNames: [],
    });

    const parentResult = await service.getCapabilities({
      workflow_run_id: 'run-1',
      job_id: 'run_scope_probes',
      user: {
        userId: 'agent:run-1:run_scope_probes',
        roles: ['Agent'],
        agentProfileName: 'investigation-coordinator',
        workflowRunId: 'run-1',
        jobId: 'run_scope_probes',
      },
    });

    expect(parentResult).toEqual(
      expect.objectContaining({
        job_id: 'run_scope_probes',
        callable_tools: [],
        denied_tools: [
          expect.objectContaining({
            toolName: 'bash',
            reasonCode: 'job_policy_denied',
          }),
        ],
      }),
    );
  });

  it('rejects subagent capability requests for a different workflow run', async () => {
    await expect(
      service.getCapabilities({
        workflow_run_id: 'run-2',
        job_id: 'subagent-exec-1',
        user: {
          userId: 'agent:run-1:subagent-exec-1',
          roles: ['Agent'],
          agentProfileName: 'investigation-subagent',
          workflowRunId: 'run-1',
          jobId: 'subagent-exec-1',
          isSubagent: true,
          subagentExecutionId: 'subagent-exec-1',
          parentJobId: 'run_scope_probes',
          allowedTools: ['bash'],
        },
      }),
    ).rejects.toThrow(
      'workflow_run_id does not match authenticated agent context',
    );
  });

  it('rejects subagent capability requests for a different job context', async () => {
    await expect(
      service.getCapabilities({
        workflow_run_id: 'run-1',
        job_id: 'run_scope_probes',
        user: {
          userId: 'agent:run-1:subagent-exec-1',
          roles: ['Agent'],
          agentProfileName: 'investigation-subagent',
          workflowRunId: 'run-1',
          jobId: 'subagent-exec-1',
          isSubagent: true,
          subagentExecutionId: 'subagent-exec-1',
          parentJobId: 'run_scope_probes',
          allowedTools: ['bash'],
        },
      }),
    ).rejects.toThrow('job_id does not match authenticated subagent context');
  });

  it('uses workflow run scope from state over payload scope_id for internal tools', async () => {
    runRepository.findById.mockResolvedValueOnce({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.RUNNING,
      state_variables: {
        trigger: {
          scopeId: '6d6bf7b3-24a2-4c6d-b53b-e34aae574bda',
        },
      },
    });

    await service.executeInternalTool({
      name: 'query_memory',
      payload: { scope_id: 'd3ad0000-0000-4000-8000-000000000000' },
      workflow_run_id: 'run-1',
      user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
    });

    expect(registry.executeTool).toHaveBeenCalledWith(
      'query_memory',
      expect.objectContaining({
        scopeId: '6d6bf7b3-24a2-4c6d-b53b-e34aae574bda',
      }),
      { scope_id: 'd3ad0000-0000-4000-8000-000000000000' },
    );
  });

  it('rejects internal tool execution for cancelled workflow runs', async () => {
    runRepository.findById.mockResolvedValueOnce({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.CANCELLED,
      state_variables: { trigger: { scope_id: 'project-1' } },
    });

    await expect(
      service.executeInternalTool({
        name: 'query_memory',
        payload: { query: 'risk' },
        workflow_run_id: 'run-1',
        user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
      }),
    ).rejects.toThrow('terminal status CANCELLED');

    expect(registry.executeTool).not.toHaveBeenCalled();
  });

  it('rejects internal tool execution when workflow_run_id does not match agent token context', async () => {
    await expect(
      service.executeInternalTool({
        name: 'query_memory',
        payload: { query: 'risk' },
        workflow_run_id: 'run-active',
        user: { userId: 'agent:run-cancelled:job-1', roles: ['Agent'] },
      }),
    ).rejects.toThrow('does not match authenticated agent context');

    expect(registry.executeTool).not.toHaveBeenCalled();
    expect(runRepository.findById).not.toHaveBeenCalledWith('run-active');
  });

  it('resolves workflow definitions for legacy runs stored with definition ids', async () => {
    const legacyRun = {
      id: 'run-legacy-1',
      workflow_id: 'project_orchestration_cycle_ceo',
      status: WorkflowStatus.RUNNING,
      current_step_id: 'job-1',
      state_variables: {
        trigger: { scope_id: '5f699df3-e3be-4559-9df6-cf32c8089eed' },
      },
    };
    runRepository.findById
      .mockResolvedValueOnce(legacyRun)
      .mockResolvedValueOnce(legacyRun);
    workflowRepository.findById.mockRejectedValueOnce(
      new Error(
        'invalid input syntax for type uuid: "project_orchestration_cycle_ceo"',
      ),
    );
    workflowRepository.findByIdentifier.mockResolvedValueOnce({
      id: 'workflow-row-uuid',
      yaml_definition:
        'workflow_id: project_orchestration_cycle_ceo\nname: Project Orchestration Cycle (CEO)\njobs:\n  - id: job-1\n    type: execution\n    tier: light\n',
    });

    const result = await service.getCapabilities({
      workflow_run_id: 'run-legacy-1',
      job_id: 'job-1',
      user: { userId: 'agent:run-legacy-1:job-1', roles: ['Agent'] },
    });

    expect(workflowRepository.findById).not.toHaveBeenCalled();
    expect(workflowRepository.findByIdentifier).toHaveBeenCalledWith(
      'project_orchestration_cycle_ceo',
      { includeInactive: true },
    );
    expect(result).toEqual(
      expect.objectContaining({
        workflow_run_id: 'run-1',
        job_id: 'job-1',
        callable_tools: ['query_memory'],
      }),
    );
  });

  it('dispatches queryMemory to internal tool registry', async () => {
    const result = await service.executeInternalTool({
      name: 'query_memory',
      payload: {
        entity_type: 'Project',
        entity_id: 'project-1',
        query: 'risk',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        tool_name: 'query_memory',
      }),
    );
  });

  it('dispatches workflow and schedule tool calls by canonical internal tool names', async () => {
    await service.executeInternalTool({
      name: 'list_workflows',
      payload: { include_inactive: true },
    });
    await service.executeInternalTool({
      name: 'create_workflow_definition',
      payload: { yaml_definition: 'workflow_id: wf-2' },
    });
    await service.executeInternalTool({
      name: 'list_schedules',
      payload: {
        scope_id: 'project-1',
        scope: ScheduledJobScope.SCOPE,
      },
    });

    expect(registry.executeTool).toHaveBeenCalledWith(
      'list_workflows',
      expect.any(Object),
      { include_inactive: true },
    );
    expect(registry.executeTool).toHaveBeenCalledWith(
      'create_workflow_definition',
      expect.any(Object),
      { yaml_definition: 'workflow_id: wf-2' },
    );
    expect(registry.executeTool).toHaveBeenCalledWith(
      'list_schedules',
      expect.any(Object),
      {
        scope_id: 'project-1',
        scope: ScheduledJobScope.SCOPE,
      },
    );
  });

  it('routes generic executeInternalTool calls through capability executor', async () => {
    const result = await service.executeInternalTool({
      name: 'query_memory',
      payload: { query: 'agent notes' },
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
    });

    expect(capabilityExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityName: 'query_memory',
        payload: { query: 'agent notes' },
      }),
    );
    expect(contractRepair.repair).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'query_memory',
        payload: { query: 'agent notes' },
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        tool_name: 'query_memory',
      }),
    );
  });

  it('delegates allowed record_learning through the capability executor before internal tool dispatch', async () => {
    const payload = {
      scope_type: 'workflow_run',
      scope_id: 'run-1',
      lesson: 'Keep context governed.',
      evidence: [
        {
          kind: 'workflow_run',
          id: 'run-1',
          summary: 'Runtime capability governance allowed this learning input.',
        },
      ],
      confidence: 0.82,
      tags: ['runtime'],
    };

    await service.executeInternalTool({
      name: 'record_learning',
      payload,
      user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
    });

    expect(contractRepair.repair).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'job-1',
      }),
    );
    expect(capabilityExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityName: 'record_learning',
        payload,
        context: expect.objectContaining({
          workflow_run_id: 'run-1',
          job_id: 'job-1',
        }),
      }),
    );
    expect(registry.executeTool).toHaveBeenCalledWith(
      'record_learning',
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'job-1',
      }),
      payload,
    );
  });

  it('returns runtime governance denial for denied record_learning execution', async () => {
    capabilityExecutor.execute.mockResolvedValueOnce({
      ok: false,
      action: 'record_learning',
      execution_status: 'denied',
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      reason: "Capability 'record_learning' is denied",
      denied_reason_code: 'capability_not_allowed',
    });

    const result = await service.executeInternalTool({
      name: 'record_learning',
      payload: { lesson: 'Keep context governed.' },
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
    });

    expect(result).toEqual({
      ok: false,
      action: 'record_learning',
      execution_status: 'denied',
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      reason: "Capability 'record_learning' is denied",
      denied_reason_code: 'capability_not_allowed',
    });
    expect(capabilityExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityName: 'record_learning',
        payload: { lesson: 'Keep context governed.' },
      }),
    );
    expect(registry.executeTool).not.toHaveBeenCalled();
  });

  it('rejects internal tool execution when job_id does not match agent token context', async () => {
    await expect(
      service.executeInternalTool({
        name: 'record_learning',
        payload: { lesson: 'Keep context governed.' },
        workflow_run_id: 'run-1',
        job_id: 'job-other',
        user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
      }),
    ).rejects.toThrow('job_id does not match authenticated agent context');

    expect(contractRepair.repair).not.toHaveBeenCalled();
    expect(capabilityExecutor.execute).not.toHaveBeenCalled();
    expect(registry.executeTool).not.toHaveBeenCalled();
  });

  it('falls back to chat capability resolution for chat agent tokens', async () => {
    const result = await service.getCapabilities({
      user: {
        userId: 'agent:chat:abbe48cd-e650-4fb8-b826-8c8fb3ab3d2d',
        roles: ['Agent'],
        agentProfileName: 'ceo-agent',
      },
    });

    expect(preflight.resolveChatCapabilitySnapshot).toHaveBeenCalledWith({
      chatSessionId: 'abbe48cd-e650-4fb8-b826-8c8fb3ab3d2d',
      agentProfileName: 'ceo-agent',
      scopeId: null,
    });
    expect(result).toEqual(
      expect.objectContaining({
        chat_session_id: 'abbe48cd-e650-4fb8-b826-8c8fb3ab3d2d',
        agent_profile_name: 'ceo-agent',
      }),
    );
  });

  it('returns a single active profile summary by name', async () => {
    agentProfilesRepository.findByNameInsensitive.mockResolvedValueOnce({
      id: 'profile-1',
      name: 'architect-agent',
      is_active: true,
      tier_preference: 'heavy',
      model_name: 'gpt-5.3',
      provider_name: 'openai',
      tool_policy: {
        default: ToolPolicyEffect.DENY,
        rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'read' }],
      },
      system_prompt: 'Architect system prompt',
      source: 'seeded',
      created_at: new Date('2026-04-20T10:00:00.000Z'),
      updated_at: new Date('2026-04-24T10:00:00.000Z'),
    });

    const result = await service.getAgentProfile('architect-agent');

    expect(agentProfilesRepository.findByNameInsensitive).toHaveBeenCalledWith(
      'architect-agent',
    );
    expect(result).toEqual(
      expect.objectContaining({
        found: true,
        name: 'architect-agent',
        agent_profile: expect.objectContaining({
          name: 'architect-agent',
          tier_preference: 'heavy',
        }),
      }),
    );
  });

  it('lists only active agent profiles by default', async () => {
    agentProfilesRepository.findPaged.mockResolvedValueOnce({
      total: 1,
      data: [
        {
          id: 'profile-1',
          name: 'architect-agent',
          is_active: true,
          tier_preference: 'heavy',
          model_name: null,
          provider_name: null,
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'read' }],
          },
          system_prompt: 'Plan carefully',
          source: 'seed',
          created_at: new Date('2026-04-20T10:00:00.000Z'),
          updated_at: new Date('2026-04-24T10:00:00.000Z'),
        },
      ],
    });

    const result = await service.getAgentProfiles({ limit: 5, offset: 10 });

    expect(agentProfilesRepository.findPaged).toHaveBeenCalledWith(
      { limit: 5, offset: 10 },
      { includeInactive: false },
    );
    expect(result).toEqual(
      expect.objectContaining({
        total: 1,
        limit: 5,
        offset: 10,
        agent_profiles: [
          expect.objectContaining({
            name: 'architect-agent',
            is_active: true,
          }),
        ],
      }),
    );
  });

  it('includes inactive agent profiles only when requested', async () => {
    agentProfilesRepository.findPaged.mockResolvedValueOnce({
      total: 0,
      data: [],
    });

    await service.getAgentProfiles({ include_inactive: true });

    expect(agentProfilesRepository.findPaged).toHaveBeenCalledWith(
      { limit: 20, offset: 0 },
      { includeInactive: true },
    );
  });

  it('lists active agent profile names without full profile payloads', async () => {
    agentProfilesRepository.findActiveNames.mockResolvedValueOnce([
      'architect-agent',
      'product-manager',
    ]);

    const result = await service.listAgentProfileNames();

    expect(result).toEqual({
      total: 2,
      names: ['architect-agent', 'product-manager'],
    });
  });

  it('delegates checkPermission to capability executor', async () => {
    const mockCheckPermission = vi.fn().mockResolvedValue({ status: 'allow' });
    (service as any).runtimeCapabilityExecutor.checkPermission =
      mockCheckPermission;

    const result = await service.checkPermission({
      tool_name: 'bash',
      payload: { command: 'ls' },
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      user: { userId: 'u-1', roles: ['Admin'] },
    });

    expect(mockCheckPermission).toHaveBeenCalledWith({
      capabilityName: 'bash',
      context: expect.objectContaining({
        workflow_run_id: 'run-1',
        job_id: 'job-1',
      }),
      payload: { command: 'ls' },
    });
    expect(result).toEqual({
      status: 'allow',
      reason: undefined,
      denied_reason_code: undefined,
    });
  });

  it('maps step id context to owning job for capability resolution', async () => {
    const result = await service.getCapabilities({
      workflow_run_id: 'run-1',
      job_id: 'default',
      user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
    });

    expect(preflight.resolveCapabilitySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'job-1',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        workflow_run_id: 'run-1',
        job_id: 'job-1',
      }),
    );
  });

  it('enforces subagent allowedTools before chat capabilities when subagent provides chat_session_id', async () => {
    const chatSessionId = 'abbe48cd-e650-4fb8-b826-8c8fb3ab3d2d';
    support.resolveAllowedToolNames.mockResolvedValueOnce(new Set(['bash']));

    const result = await service.getCapabilities({
      workflow_run_id: 'run-1',
      job_id: 'subagent-exec-1',
      chat_session_id: chatSessionId,
      user: {
        userId: 'agent:run-1:subagent-exec-1',
        roles: ['Agent'],
        agentProfileName: 'investigation-subagent',
        workflowRunId: 'run-1',
        jobId: 'subagent-exec-1',
        isSubagent: true,
        subagentExecutionId: 'subagent-exec-1',
        parentJobId: 'run_scope_probes',
        allowedTools: ['bash'],
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        workflow_run_id: 'run-1',
        job_id: 'subagent-exec-1',
        parent_job_id: 'run_scope_probes',
        agent_profile_name: 'investigation-subagent',
        callable_tools: ['bash'],
      }),
    );

    expect(result).not.toHaveProperty('chat_session_id');
    expect(preflight.resolveChatCapabilitySnapshot).not.toHaveBeenCalled();
    expect(support.resolveAllowedToolNames).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ name: 'bash' }],
        agentProfile: 'investigation-subagent',
        policyStrategy: 'profile_only',
      }),
    );
  });

  it('applies workflow-level deny_tools to subagent capability resolution', async () => {
    workflowRepository.findByIdentifier.mockResolvedValueOnce({
      id: 'wf-1',
      yaml_definition:
        'workflow_id: wf-1\nname: test\npermissions:\n  tool_policy:\n    default: allow\n    rules:\n      - effect: deny\n        tool: unsafe_tool\njobs:\n  - id: run_scope_probes\n    type: execution\n    tier: heavy\n',
    });
    parser.parseWorkflow.mockReturnValueOnce({
      workflow_id: 'wf-1',
      permissions: {
        tool_policy: {
          default: ToolPolicyEffect.ALLOW,
          rules: [{ effect: ToolPolicyEffect.DENY, tool: 'unsafe_tool' }],
        },
      },
      jobs: [
        {
          id: 'run_scope_probes',
          type: 'execution',
          tier: 'heavy',
          steps: [{ id: 'probe', prompt: 'spawn probes' }],
        },
      ],
    });
    support.resolveAllowedToolNames.mockResolvedValueOnce(
      new Set(['bash', 'unsafe_tool']),
    );

    const result = await service.getCapabilities({
      workflow_run_id: 'run-1',
      job_id: 'subagent-exec-1',
      user: {
        userId: 'agent:run-1:subagent-exec-1',
        roles: ['Agent'],
        agentProfileName: 'investigation-subagent',
        workflowRunId: 'run-1',
        jobId: 'subagent-exec-1',
        isSubagent: true,
        subagentExecutionId: 'subagent-exec-1',
        parentJobId: 'run_scope_probes',
        allowedTools: ['bash', 'unsafe_tool'],
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        workflow_run_id: 'run-1',
        job_id: 'subagent-exec-1',
        callable_tools: ['bash'],
        denied_tools: expect.arrayContaining([
          expect.objectContaining({
            toolName: 'unsafe_tool',
            reasonCode: 'profile_denied',
          }),
        ]),
      }),
    );
  });

  it('rejects subagent chat capability requests without delegated tools', async () => {
    await expect(
      service.getCapabilities({
        workflow_run_id: 'run-1',
        job_id: 'subagent-exec-1',
        chat_session_id: 'abbe48cd-e650-4fb8-b826-8c8fb3ab3d2d',
        user: {
          userId: 'agent:run-1:subagent-exec-1',
          roles: ['Agent'],
          agentProfileName: 'investigation-subagent',
          workflowRunId: 'run-1',
          jobId: 'subagent-exec-1',
          isSubagent: true,
          subagentExecutionId: 'subagent-exec-1',
          parentJobId: 'run_scope_probes',
          allowedTools: [],
        },
      }),
    ).rejects.toThrow('subagent delegated tools are required');

    expect(preflight.resolveChatCapabilitySnapshot).not.toHaveBeenCalled();
  });
});
