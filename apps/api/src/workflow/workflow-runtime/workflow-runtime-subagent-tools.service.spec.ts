import { Test, TestingModule } from '@nestjs/testing';
import { ToolPolicyEffect, WorkflowStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRuntimeSubagentToolsService } from './workflow-runtime-subagent-tools.service';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../kernel/interfaces/workflow-kernel.ports';
import { SubagentOrchestratorService } from '../workflow-subagents/subagent-orchestrator.service';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { WorkflowStageSkillPolicyService } from '../workflow-stage-skill-policy.service';
import { ExecutionContextResolverService } from '../execution-context-resolver.service';
import { AgentProfileRepository } from '../../ai-config/database/repositories/agent-profile.repository';
import { ToolPolicyEvaluatorService } from '../../capability-governance/tool-policy-evaluator.service';
import { ToolMountingService } from '../../tool-runtime/tool-mounting.service';

describe('WorkflowRuntimeSubagentToolsService', () => {
  let service: WorkflowRuntimeSubagentToolsService;

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
    spawn: vi.fn().mockResolvedValue('execution-1'),
    waitForSubagents: vi.fn().mockResolvedValue({ results: [] }),
    checkStatus: vi.fn().mockResolvedValue(null),
  };

  const docker = {
    listContainers: vi.fn().mockResolvedValue([
      {
        Id: 'parent-container-1',
        Created: 12,
      },
    ]),
  };

  const stageSkillPolicy = {
    resolveLifecycleStage: vi.fn().mockReturnValue('implementation'),
  };

  const agentProfileRepo = {
    findByName: vi.fn().mockResolvedValue(null),
  };

  const toolPolicyEvaluator = {
    evaluate: vi.fn().mockReturnValue({
      effect: ToolPolicyEffect.ALLOW,
      explanation: 'No rules matched. Using default effect.',
    }),
  };

  const toolMounting = {
    canProfileUseTool: vi.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRuntimeSubagentToolsService,
        { provide: WORKFLOW_RUN_REPOSITORY_PORT, useValue: runRepository },
        {
          provide: SubagentOrchestratorService,
          useValue: subagentOrchestrator,
        },
        {
          provide: WorkflowStageSkillPolicyService,
          useValue: stageSkillPolicy,
        },
        { provide: DOCKER_CLIENT, useValue: docker },
        { provide: AgentProfileRepository, useValue: agentProfileRepo },
        {
          provide: ToolPolicyEvaluatorService,
          useValue: toolPolicyEvaluator,
        },
        { provide: ToolMountingService, useValue: toolMounting },
        ExecutionContextResolverService,
      ],
    }).compile();

    service = module.get(WorkflowRuntimeSubagentToolsService);
  });
  it('spawns async subagent with requested parent host mount inheritance', async () => {
    const result = await service.spawnSubagentAsync(
      { userId: 'agent:run-1:job-1' },
      {
        agent_profile: 'architect-agent',
        task_prompt: 'implement tests asynchronously',
        tools: ['read'],
        assigned_files: ['docs/epics/EPIC-101.md'],
        host_mounts: [
          { alias: 'skills_library', subpath: 'my-skill', mode: 'rw' } as never,
        ],
        inherit_host_mounts: false,
      },
    );

    expect(subagentOrchestrator.spawn).toHaveBeenCalledWith(
      'parent-container-1',
      expect.objectContaining({
        workflowRunId: 'run-1',
        parent_job_id: 'job-1',
        lifecycle_stage: 'implementation',
        tier: 'heavy',
        host_mounts: [
          { alias: 'skills_library', subpath: 'my-skill', mode: 'rw' },
        ],
        inherit_host_mounts: false,
      } as any),
    );
    expect(result).toEqual(
      expect.objectContaining({ ok: true, action: 'spawn_subagent_async' }),
    );
  });

  it('sets role to the authenticated stepId so the duplicate-spawn guard fires for step-originated spawns', async () => {
    await service.spawnSubagentAsync(
      { userId: 'agent:run-1:job-1', stepId: 'implement' },
      {
        agent_profile: 'architect-agent',
        task_prompt: 'implement feature',
        tools: ['read'],
      },
    );

    expect(subagentOrchestrator.spawn).toHaveBeenCalledWith(
      'parent-container-1',
      expect.objectContaining({ role: 'implement' } as any),
    );
  });

  it('sets role to undefined when no stepId is present on the token', async () => {
    await service.spawnSubagentAsync(
      { userId: 'agent:run-1:job-1' },
      {
        agent_profile: 'architect-agent',
        task_prompt: 'implement feature',
        tools: ['read'],
      },
    );

    expect(subagentOrchestrator.spawn).toHaveBeenCalledWith(
      'parent-container-1',
      expect.objectContaining({ role: undefined } as any),
    );
  });

  // FU-5 GATE: the spawning step's YAML id must reach `SubagentSpawnParams`
  // as `parent_step_id` so the skill resolver can select step-scoped
  // `workflow_skill_bindings`/YAML skills for the subagent — see
  // `subagent-orchestrator.skills.helpers.ts`.
  it('threads the authenticated stepId through as parent_step_id so step-scoped skills reach the subagent', async () => {
    await service.spawnSubagentAsync(
      { userId: 'agent:run-1:job-1', stepId: 'implement' },
      {
        agent_profile: 'architect-agent',
        task_prompt: 'implement feature',
        tools: ['read'],
      },
    );

    expect(subagentOrchestrator.spawn).toHaveBeenCalledWith(
      'parent-container-1',
      expect.objectContaining({ parent_step_id: 'implement' } as any),
    );
  });

  it('sets parent_step_id to undefined when no stepId is present on the token', async () => {
    await service.spawnSubagentAsync(
      { userId: 'agent:run-1:job-1' },
      {
        agent_profile: 'architect-agent',
        task_prompt: 'implement feature',
        tools: ['read'],
      },
    );

    expect(subagentOrchestrator.spawn).toHaveBeenCalledWith(
      'parent-container-1',
      expect.objectContaining({ parent_step_id: undefined } as any),
    );
  });

  it('rejects subagent spawn for cancelled workflow runs', async () => {
    runRepository.findById.mockResolvedValueOnce({
      id: 'run-1',
      status: WorkflowStatus.CANCELLED,
      state_variables: { trigger: {} },
    });

    await expect(
      service.spawnSubagentAsync(
        { userId: 'agent:run-1:job-1' },
        {
          agent_profile: 'architect-agent',
          task_prompt: 'implement tests asynchronously',
          tools: ['read'],
        },
      ),
    ).rejects.toThrow('terminal status CANCELLED');

    expect(subagentOrchestrator.spawn).not.toHaveBeenCalled();
  });

  it('throws when no agent execution context is present', async () => {
    await expect(
      service.spawnSubagentAsync(
        { userId: 'user-1' },
        {
          agent_profile: 'architect-agent',
          task_prompt: 'implement tests',
          tools: ['read'],
          assigned_files: ['docs/epics/EPIC-101.md'],
        },
      ),
    ).rejects.toThrow('Agent execution context is required');
  });

  it('uses authenticated jobId claim as parent job id for subagent callers', async () => {
    await service.spawnSubagentAsync(
      { userId: 'agent:run-1:subagent-execution-1', jobId: 'implement' },
      {
        agent_profile: 'architect-agent',
        task_prompt: 'spawn nested subagent',
        tools: ['read'],
      },
    );

    expect(subagentOrchestrator.spawn).toHaveBeenCalledWith(
      'parent-container-1',
      expect.objectContaining({
        workflowRunId: 'run-1',
        parent_job_id: 'implement',
        tier: 'heavy',
      } as any),
    );
  });

  it('uses the authenticated step id to resolve the current parent container', async () => {
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
          Labels: {
            'nexus.parent_container_id': 'parent-container-1',
          },
        },
        {
          Id: 'parent-container-1',
          Created: 12,
        },
      ];
    });

    await service.checkSubagentStatus(
      {
        userId: 'agent:run-1:implement_and_commit',
        jobId: 'implement_and_commit',
        stepId: 'implement',
      },
      'execution-1',
    );

    expect(subagentOrchestrator.checkStatus).toHaveBeenCalledWith(
      'parent-container-1',
      'execution-1',
      'run-1',
    );
  });

  it('rejects spawn when tool policy evaluates to DENY', async () => {
    agentProfileRepo.findByName.mockResolvedValue({
      id: 'profile-1',
      name: 'caller-profile',
      tool_policy: {
        rules: [],
        default: ToolPolicyEffect.ALLOW,
      },
    });
    toolPolicyEvaluator.evaluate.mockReturnValue({
      effect: ToolPolicyEffect.DENY,
      explanation: 'explicit deny',
    });

    await expect(
      service.spawnSubagentAsync(
        { jobId: 'job-1', agentProfileName: 'caller-profile' },
        {
          agent_profile: 'target-agent',
          task_prompt: 'do work',
        } as never,
      ),
    ).rejects.toThrow(
      "Agent profile 'caller-profile' is not permitted to spawn subagent with profile 'target-agent'",
    );

    expect(subagentOrchestrator.spawn).not.toHaveBeenCalled();
  });

  it('rejects spawn when tool policy evaluates to GUARDRAIL_DENY', async () => {
    agentProfileRepo.findByName.mockResolvedValue({
      id: 'profile-1',
      name: 'caller-profile',
      tool_policy: {
        rules: [],
        default: ToolPolicyEffect.ALLOW,
      },
    });
    toolPolicyEvaluator.evaluate.mockReturnValue({
      effect: ToolPolicyEffect.GUARDRAIL_DENY,
      explanation: 'guardrail block',
    });

    await expect(
      service.spawnSubagentAsync(
        { jobId: 'job-1', agentProfileName: 'caller-profile' },
        {
          agent_profile: 'target-agent',
          task_prompt: 'do work',
        } as never,
      ),
    ).rejects.toThrow(
      "Agent profile 'caller-profile' is not permitted to spawn subagent with profile 'target-agent'",
    );

    expect(subagentOrchestrator.spawn).not.toHaveBeenCalled();
  });

  it('skips gating when params.agent_profile is missing', async () => {
    await service.spawnSubagentAsync(
      { userId: 'agent:run-1:job-1', agentProfileName: 'caller-profile' },
      {
        task_prompt: 'do work',
      } as never,
    );

    expect(agentProfileRepo.findByName).not.toHaveBeenCalled();
    expect(subagentOrchestrator.spawn).toHaveBeenCalled();
  });

  it('skips gating when caller profile is not found in DB', async () => {
    agentProfileRepo.findByName.mockResolvedValue(null);

    await service.spawnSubagentAsync(
      { userId: 'agent:run-1:job-1', agentProfileName: 'unknown-profile' },
      {
        agent_profile: 'target-agent',
        task_prompt: 'do work',
      } as never,
    );

    expect(toolPolicyEvaluator.evaluate).not.toHaveBeenCalled();
    expect(subagentOrchestrator.spawn).toHaveBeenCalled();
  });

  it('skips gating when caller profile has no tool_policy', async () => {
    agentProfileRepo.findByName.mockResolvedValue({
      id: 'profile-1',
      name: 'caller-profile',
      tool_policy: null,
    });

    await service.spawnSubagentAsync(
      { userId: 'agent:run-1:job-1', agentProfileName: 'caller-profile' },
      {
        agent_profile: 'target-agent',
        task_prompt: 'do work',
      } as never,
    );

    expect(toolPolicyEvaluator.evaluate).not.toHaveBeenCalled();
    expect(subagentOrchestrator.spawn).toHaveBeenCalled();
  });

  describe('forceModelForSubagents cascade', () => {
    beforeEach(() => {
      docker.listContainers.mockResolvedValue([
        { Id: 'parent-container-1', Created: 12 },
      ]);
    });

    it('injects model_override and provider_override when forceModelForSubagents is true', async () => {
      runRepository.findById.mockResolvedValueOnce({
        id: 'run-1',
        status: WorkflowStatus.RUNNING,
        state_variables: {
          trigger: {
            resource: {
              executionConfig: {
                model: 'claude-opus-4-8',
                provider: 'anthropic',
                forceModelForSubagents: true,
              },
            },
          },
        },
      });

      await service.spawnSubagentAsync(
        { userId: 'agent:run-1:job-1' },
        {
          agent_profile: 'architect-agent',
          task_prompt: 'implement feature',
          tools: ['read'],
        },
      );

      expect(subagentOrchestrator.spawn).toHaveBeenCalledWith(
        'parent-container-1',
        expect.objectContaining({
          model_override: 'claude-opus-4-8',
          provider_override: 'anthropic',
        } as any),
      );
    });

    it('does not inject model_override when forceModelForSubagents is false', async () => {
      runRepository.findById.mockResolvedValueOnce({
        id: 'run-1',
        status: WorkflowStatus.RUNNING,
        state_variables: {
          trigger: {
            resource: {
              executionConfig: {
                model: 'claude-opus-4-8',
                forceModelForSubagents: false,
              },
            },
          },
        },
      });

      await service.spawnSubagentAsync(
        { userId: 'agent:run-1:job-1' },
        {
          agent_profile: 'architect-agent',
          task_prompt: 'implement feature',
          tools: ['read'],
        },
      );

      expect(subagentOrchestrator.spawn).toHaveBeenCalledWith(
        'parent-container-1',
        expect.not.objectContaining({
          model_override: expect.anything(),
        } as any),
      );
    });

    it('does not inject model_override when forceModelForSubagents is absent', async () => {
      await service.spawnSubagentAsync(
        { userId: 'agent:run-1:job-1' },
        {
          agent_profile: 'architect-agent',
          task_prompt: 'implement feature',
          tools: ['read'],
        },
      );

      expect(subagentOrchestrator.spawn).toHaveBeenCalledWith(
        'parent-container-1',
        expect.not.objectContaining({
          model_override: expect.anything(),
        } as any),
      );
    });
  });

  describe('profileAllowed ∩ requestedTools intersection', () => {
    beforeEach(() => {
      docker.listContainers.mockResolvedValue([
        { Id: 'parent-container-1', Created: 12 },
      ]);
    });

    it('strips profile-denied tools from the spawn params tools list', async () => {
      // profile denies spawn_subagent_async but allows everything else
      toolMounting.canProfileUseTool.mockImplementation(
        (_profile: string, tool: string) => tool !== 'spawn_subagent_async',
      );

      await service.spawnSubagentAsync(
        { userId: 'agent:run-1:job-1' },
        {
          agent_profile: 'limited-agent',
          task_prompt: 'implement feature',
          tools: ['read', 'spawn_subagent_async'],
        },
      );

      const spawnArgs = (subagentOrchestrator.spawn as ReturnType<typeof vi.fn>)
        .mock.calls[0][1] as { tools: string[] };
      expect(spawnArgs.tools).not.toContain('spawn_subagent_async');
      expect(spawnArgs.tools).toContain('read');
    });

    it('includes wait_for_subagents as a companion when spawn_subagent_async is granted', async () => {
      // profile allows spawn_subagent_async but does not explicitly list wait_for_subagents
      toolMounting.canProfileUseTool.mockImplementation(
        (_profile: string, tool: string) => tool !== 'wait_for_subagents',
      );

      await service.spawnSubagentAsync(
        { userId: 'agent:run-1:job-1' },
        {
          agent_profile: 'orchestrator-agent',
          task_prompt: 'orchestrate work',
          tools: ['read', 'spawn_subagent_async', 'wait_for_subagents'],
        },
      );

      const spawnArgs = (subagentOrchestrator.spawn as ReturnType<typeof vi.fn>)
        .mock.calls[0][1] as { tools: string[] };
      expect(spawnArgs.tools).toContain('spawn_subagent_async');
      expect(spawnArgs.tools).toContain('wait_for_subagents');
    });

    it('passes all tools through when no agent_profile is provided', async () => {
      await service.spawnSubagentAsync({ userId: 'agent:run-1:job-1' }, {
        task_prompt: 'anonymous task',
        tools: ['read', 'spawn_subagent_async'],
      } as never);

      expect(toolMounting.canProfileUseTool).not.toHaveBeenCalled();
      const spawnArgs = (subagentOrchestrator.spawn as ReturnType<typeof vi.fn>)
        .mock.calls[0][1] as { tools: string[] };
      expect(spawnArgs.tools).toContain('read');
      expect(spawnArgs.tools).toContain('spawn_subagent_async');
    });
  });
});
