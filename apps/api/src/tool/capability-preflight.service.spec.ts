import { ToolPolicyEffect, resolveSkillDiscoveryMode } from '@nexus/core';
import type { SkillDiscoveryMode } from '@nexus/core';
import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { CapabilityPreflightService } from './capability-preflight.service';
import { CapabilityRegistryService } from '../capability-infra/capability-registry.service';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { StepSupportService } from '../workflow/workflow-step-execution/step-support.service';
import { ToolApprovalRuleService } from '../capability-governance/tool-approval-rule.service';
import { PolicyEngineService } from '../capability-governance/policy-engine.service';

describe('CapabilityPreflightService', () => {
  let service: CapabilityPreflightService;
  let toolRegistry: { getToolsForTier: ReturnType<typeof vi.fn> };
  let support: {
    getJobTier: ReturnType<typeof vi.fn>;
    selectToolsForJob: ReturnType<typeof vi.fn>;
    resolveAgentProfileFromJobInputs: ReturnType<typeof vi.fn>;
    resolveAllowedToolNames: ReturnType<typeof vi.fn>;
    resolveApprovalRequiredToolNames: ReturnType<typeof vi.fn>;
    resolveAgentToolPolicy: ReturnType<typeof vi.fn>;
    resolveSkillDiscoveryModeForJob: ReturnType<typeof vi.fn>;
  };
  let ruleService: {
    resolveToolEffectPreflight: ReturnType<typeof vi.fn>;
  };
  let capabilityRegistry: {
    getDiscoveredEntries: ReturnType<typeof vi.fn>;
    getDiscoveredBridgeActions: ReturnType<typeof vi.fn>;
    getDiscoveredEntryByName: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    toolRegistry = {
      getToolsForTier: vi
        .fn()
        .mockResolvedValue([
          { name: 'query_memory' },
          { name: 'set_job_output' },
        ]),
    };

    support = {
      getJobTier: vi.fn().mockReturnValue(1),
      selectToolsForJob: vi
        .fn()
        .mockReturnValue([
          { name: 'query_memory' },
          { name: 'set_job_output' },
        ]),
      resolveAgentProfileFromJobInputs: vi.fn().mockReturnValue('ceo'),
      resolveAllowedToolNames: vi
        .fn()
        .mockResolvedValue(new Set(['query_memory', 'set_job_output'])),
      resolveApprovalRequiredToolNames: vi.fn().mockResolvedValue(new Set()),
      resolveAgentToolPolicy: vi.fn().mockResolvedValue(null),
      // Mirror the real service: drive the cascade off the first step's mode
      // and the workflow-level mode so step-level control is deterministic
      // without a real DB-backed agent profile.
      resolveSkillDiscoveryModeForJob: vi.fn().mockImplementation(
        (params: {
          job: {
            steps?: Array<{ skill_discovery_mode?: SkillDiscoveryMode }>;
          };
          workflowMode?: SkillDiscoveryMode | null;
        }): Promise<SkillDiscoveryMode> =>
          Promise.resolve(
            resolveSkillDiscoveryMode({
              step: params.job.steps?.[0]?.skill_discovery_mode ?? null,
              workflow: params.workflowMode ?? null,
              agentProfile: null,
            }),
          ),
      ),
    };

    ruleService = {
      resolveToolEffectPreflight: vi.fn().mockResolvedValue(null),
    };

    capabilityRegistry = {
      getDiscoveredEntries: vi.fn().mockReturnValue([
        {
          name: 'create_agent_profile',
          mutatingAction: true,
          runtimeOwner: 'runner',
        },
        {
          name: 'query_memory',
          mutatingAction: false,
          runtimeOwner: undefined,
        },
        {
          name: 'open_war_room',
          mutatingAction: true,
          runtimeOwner: 'api',
        },
      ]),
      getDiscoveredBridgeActions: vi.fn().mockReturnValue(new Set()),
      getDiscoveredEntryByName: vi.fn().mockImplementation((name: string) => {
        const entries: Record<
          string,
          { mutatingAction?: boolean; runtimeOwner?: string }
        > = {
          create_agent_profile: {
            mutatingAction: true,
            runtimeOwner: 'runner',
          },
          query_memory: { mutatingAction: false, runtimeOwner: undefined },
          open_war_room: { mutatingAction: true, runtimeOwner: 'api' },
        };
        return entries[name] ?? null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapabilityPreflightService,
        { provide: ToolRegistryService, useValue: toolRegistry },
        { provide: StepSupportService, useValue: support },
        { provide: ToolApprovalRuleService, useValue: ruleService },
        PolicyEngineService,
        { provide: CapabilityRegistryService, useValue: capabilityRegistry },
      ],
    }).compile();

    service = module.get(CapabilityPreflightService);
  });

  it('returns ok when selected tools are callable', async () => {
    const result = await service.preflightJobExecution({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: {
        id: 'job-1',
        type: 'execution',
        tier: 'light',
        tools: ['query_memory'],
      },
      stateVariables: { trigger: { scope_id: 'project-1' } },
      resolvedJobInputs: {},
      workflowPermissions: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.callableToolNames).toContain('query_memory');
  });

  it('includes sdk-native ls as callable when requested and allowed', async () => {
    support.selectToolsForJob.mockReturnValueOnce([]);
    support.resolveAllowedToolNames.mockResolvedValueOnce(new Set(['ls']));

    const result = await service.preflightJobExecution({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: {
        id: 'job-1',
        type: 'execution',
        tier: 'light',
        tools: ['ls'],
      },
      stateVariables: { trigger: { scope_id: 'project-1' } },
      resolvedJobInputs: {},
      workflowPermissions: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.callableToolNames).toContain('ls');
    expect(result.denied).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ toolName: 'ls' })]),
    );
  });

  it('validates raw API callback tools independently', async () => {
    support.selectToolsForJob.mockReturnValueOnce([{ name: 'open_war_room' }]);
    support.resolveAllowedToolNames.mockResolvedValueOnce(
      new Set(['open_war_room']),
    );

    const result = await service.preflightJobExecution({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: {
        id: 'job-1',
        type: 'execution',
        tier: 'light',
        tools: ['open_war_room'],
      },
      stateVariables: { trigger: { scope_id: 'project-1' } },
      resolvedJobInputs: {},
      workflowPermissions: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.callableToolNames).toContain('open_war_room');
  });

  it('includes explicitly allowed discovered API callback tools even when registry projection is missing', async () => {
    support.selectToolsForJob.mockReturnValueOnce([
      { name: 'spawn_subagent_async' },
    ]);
    support.resolveAllowedToolNames.mockResolvedValueOnce(
      new Set(['spawn_subagent_async', 'wait_for_subagents']),
    );
    capabilityRegistry.getDiscoveredEntries.mockReturnValue([
      {
        name: 'spawn_subagent_async',
        mutatingAction: true,
        runtimeOwner: 'api',
      },
      {
        name: 'wait_for_subagents',
        mutatingAction: false,
        runtimeOwner: 'api',
      },
    ]);
    capabilityRegistry.getDiscoveredEntryByName.mockImplementation(
      (name: string) => {
        const entries: Record<
          string,
          { mutatingAction?: boolean; runtimeOwner?: string }
        > = {
          spawn_subagent_async: { mutatingAction: true, runtimeOwner: 'api' },
          wait_for_subagents: { mutatingAction: false, runtimeOwner: 'api' },
        };
        return entries[name] ?? null;
      },
    );

    const result = await service.preflightJobExecution({
      workflowRunId: 'run-1',
      jobId: 'implement_and_commit',
      job: {
        id: 'implement_and_commit',
        type: 'execution',
        tier: 'heavy',
        permissions: {
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [
              { effect: ToolPolicyEffect.ALLOW, tool: 'search_skills' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'step_complete' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'yield_session' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'war_room.consensus' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'war_room.read_session' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'war_room.open_session' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'war_room.send_message' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'spawn_subagent_async' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'wait_for_subagents' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'set_job_output' },
              { effect: ToolPolicyEffect.DENY, tool: 'write' },
              { effect: ToolPolicyEffect.DENY, tool: 'edit' },
              { effect: ToolPolicyEffect.DENY, tool: 'bash' },
              { effect: ToolPolicyEffect.DENY, tool: 'query_memory' },
            ],
          },
        },
      },
      stateVariables: { trigger: { scope_id: 'project-1' } },
      resolvedJobInputs: { agent_profile: 'orchestrator' },
      workflowPermissions: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.callableToolNames).toContain('wait_for_subagents');
  });

  it('fails when output_contract.required is empty', async () => {
    const result = await service.preflightJobExecution({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: {
        id: 'job-1',
        type: 'execution',
        tier: 'light',
        output_contract: {
          required: [],
        },
      },
      stateVariables: { trigger: { scope_id: 'project-1' } },
      resolvedJobInputs: {},
      workflowPermissions: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe('output_contract_invalid');
  });

  it('resolves scope_id from workflow trigger before resolved job inputs', async () => {
    const result = await service.resolveCapabilitySnapshot({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: {
        id: 'job-1',
        type: 'execution',
        tier: 'light',
        tools: ['query_memory'],
      },
      stateVariables: { trigger: { scopeId: 'trigger-scope' } },
      resolvedJobInputs: { scope_id: 'stale-scope' },
      workflowPermissions: undefined,
    });

    expect(result.scopeId).toBe('trigger-scope');
  });

  it('marks tool denied when publication_status is not published', async () => {
    support.selectToolsForJob.mockReturnValueOnce([
      { name: 'query_memory', publication_status: 'validated' },
    ]);
    support.resolveAllowedToolNames.mockResolvedValueOnce(
      new Set(['query_memory']),
    );
    const result = await service.resolveCapabilitySnapshot({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: {
        id: 'job-1',
        type: 'execution',
        tier: 'light',
        tools: ['query_memory'],
      },
      stateVariables: { trigger: { scope_id: 'project-1' } },
      resolvedJobInputs: {},
      workflowPermissions: undefined,
    });

    expect(result.denied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'query_memory',
          reasonCode: 'tool_not_published',
        }),
      ]),
    );
  });

  it('ignores workflow allowlist when policyStrategy is profile_only', async () => {
    support.resolveAllowedToolNames.mockResolvedValueOnce(
      new Set(['query_memory']),
    );

    const result = await service.preflightJobExecution({
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: {
        id: 'job-1',
        type: 'execution',
        tier: 'light',
        tools: ['query_memory'],
      },
      stateVariables: { trigger: { scope_id: 'project-1' } },
      resolvedJobInputs: {},
      workflowPermissions: {
        allow_tools: ['set_job_output'],
        policy_strategy: 'profile_only',
      } as never,
      policyStrategy: 'profile_only',
    });

    expect(result.ok).toBe(true);
    expect(result.callableToolNames).toContain('query_memory');
    expect(support.resolveAllowedToolNames).toHaveBeenCalledWith(
      expect.objectContaining({ policyStrategy: 'profile_only' }),
    );
  });

  it('resolves chat capability snapshot from profile_only policy', async () => {
    support.resolveAllowedToolNames.mockResolvedValueOnce(
      new Set(['query_memory']),
    );
    const result = await service.resolveChatCapabilitySnapshot({
      chatSessionId: 'chat-1',
      agentProfileName: 'ceo-agent',
      scopeId: 'project-1',
    });

    expect(result.workflowRunId).toBe('');
    expect(result.jobId).toBe('chat');
    expect(result.callableToolNames).toContain('query_memory');
    expect(support.resolveAllowedToolNames).toHaveBeenCalledWith(
      expect.objectContaining({ policyStrategy: 'profile_only' }),
    );
  });

  it('normalizes invalid scope_id format in chat capabilities', async () => {
    support.resolveAllowedToolNames.mockResolvedValueOnce(
      new Set(['query_memory']),
    );

    const result = await service.resolveChatCapabilitySnapshot({
      chatSessionId: 'chat-1',
      agentProfileName: 'ceo-agent',
      scopeId: 'not-a-uuid',
    });

    expect(result.scopeId).toBeNull();
  });

  describe('wait_for_subagents companion tool exposure regression', () => {
    /**
     * REGRESSION TEST: cf330f84-47d8-457b-9928-6dafc24ab260
     *
     * This test verifies that `wait_for_subagents` appears in the callable tool list
     * when it is allowed via workflowPermissions (implement_and_commit pattern) but
     * NOT explicitly listed in job.permissions.allow_tools.
     *
     * The bug: resolveRequestedApiCapabilityNames() only checks job.tools and
     * job.permissions.allow_tools for discovered API capabilities. It doesn't check
     * workflowPermissions where companion tools like wait_for_subagents are often
     * defined in the workflow-level permissions.
     *
     * Expected behavior: When spawn_subagent_async is in job.permissions.allow_tools
     * and wait_for_subagents is in workflowPermissions.allow_tools, the companion
     * tool wait_for_subagents should be discovered as a candidate and appear in
     * the callable tool list.
     */
    it(
      'should expose wait_for_subagents in callable tools when allowed via ' +
        'workflowPermissions but NOT in job.permissions.allow_tools',
      async () => {
        // Setup: Only spawn_subagent_async in job permissions, wait_for_subagents only at workflow level
        support.selectToolsForJob.mockReturnValueOnce([]);
        support.resolveAllowedToolNames.mockResolvedValueOnce(
          new Set(['spawn_subagent_async', 'wait_for_subagents']),
        );
        capabilityRegistry.getDiscoveredEntries.mockReturnValue([
          {
            name: 'spawn_subagent_async',
            mutatingAction: true,
            runtimeOwner: 'api',
          },
          {
            name: 'wait_for_subagents',
            mutatingAction: false,
            runtimeOwner: 'api',
          },
        ]);
        capabilityRegistry.getDiscoveredEntryByName.mockImplementation(
          (name: string) => {
            const entries: Record<
              string,
              { mutatingAction?: boolean; runtimeOwner?: string }
            > = {
              spawn_subagent_async: {
                mutatingAction: true,
                runtimeOwner: 'api',
              },
              wait_for_subagents: {
                mutatingAction: false,
                runtimeOwner: 'api',
              },
            };
            return entries[name] ?? null;
          },
        );

        // Execute: Test implement_and_commit pattern where wait_for_subagents
        // is in workflowPermissions but NOT in job.permissions.allow_tools
        const result = await service.preflightJobExecution({
          workflowRunId: 'run-1',
          jobId: 'implement_and_commit',
          job: {
            id: 'implement_and_commit',
            type: 'execution',
            tier: 'heavy',
            // Note: job.tools is empty (simulating real workflow behavior)
            // Note: wait_for_subagents is NOT in job.permissions.tool_policy
            permissions: {
              tool_policy: {
                default: ToolPolicyEffect.DENY,
                rules: [
                  { effect: ToolPolicyEffect.ALLOW, tool: 'search_skills' },
                  { effect: ToolPolicyEffect.ALLOW, tool: 'step_complete' },
                  { effect: ToolPolicyEffect.ALLOW, tool: 'yield_session' },
                  { effect: ToolPolicyEffect.ALLOW, tool: 'open_war_room' },
                  {
                    effect: ToolPolicyEffect.ALLOW,
                    tool: 'invite_war_room_participant',
                  },
                  {
                    effect: ToolPolicyEffect.ALLOW,
                    tool: 'post_war_room_message',
                  },
                  { effect: ToolPolicyEffect.ALLOW, tool: 'close_war_room' },
                  {
                    effect: ToolPolicyEffect.ALLOW,
                    tool: 'spawn_subagent_async',
                  },
                  // wait_for_subagents intentionally OMITTED here
                  { effect: ToolPolicyEffect.ALLOW, tool: 'set_job_output' },
                  { effect: ToolPolicyEffect.DENY, tool: 'write' },
                  { effect: ToolPolicyEffect.DENY, tool: 'edit' },
                  { effect: ToolPolicyEffect.DENY, tool: 'bash' },
                  { effect: ToolPolicyEffect.DENY, tool: 'query_memory' },
                ],
              },
            },
          },
          stateVariables: { trigger: { scope_id: 'project-1' } },
          resolvedJobInputs: { agent_profile: 'orchestrator' },
          // wait_for_subagents is ONLY in workflowPermissions (mimicking implement_and_commit job pattern)
          workflowPermissions: {
            tool_policy: {
              default: ToolPolicyEffect.DENY,
              rules: [
                { effect: ToolPolicyEffect.ALLOW, tool: 'search_skills' },
                { effect: ToolPolicyEffect.ALLOW, tool: 'step_complete' },
                { effect: ToolPolicyEffect.ALLOW, tool: 'yield_session' },
                { effect: ToolPolicyEffect.ALLOW, tool: 'open_war_room' },
                {
                  effect: ToolPolicyEffect.ALLOW,
                  tool: 'invite_war_room_participant',
                },
                {
                  effect: ToolPolicyEffect.ALLOW,
                  tool: 'post_war_room_message',
                },
                { effect: ToolPolicyEffect.ALLOW, tool: 'close_war_room' },
                {
                  effect: ToolPolicyEffect.ALLOW,
                  tool: 'spawn_subagent_async',
                },
                { effect: ToolPolicyEffect.ALLOW, tool: 'wait_for_subagents' }, // Companion tool only at workflow level!
                { effect: ToolPolicyEffect.ALLOW, tool: 'set_job_output' },
              ],
            },
          },
        });

        // Assert: wait_for_subagents should be callable even though it's only in workflowPermissions
        expect(result.ok).toBe(true);
        expect(result.callableToolNames).toContain('wait_for_subagents');
        expect(result.callableToolNames).toContain('spawn_subagent_async');
      },
    );

    it('discovers API capabilities requested through workflow tool_policy rules', async () => {
      support.selectToolsForJob.mockReturnValueOnce([]);
      support.resolveAllowedToolNames.mockResolvedValueOnce(
        new Set(['spawn_subagent_async', 'wait_for_subagents']),
      );
      capabilityRegistry.getDiscoveredEntries.mockReturnValue([
        {
          name: 'spawn_subagent_async',
          mutatingAction: true,
          runtimeOwner: 'api',
        },
        {
          name: 'wait_for_subagents',
          mutatingAction: false,
          runtimeOwner: 'api',
        },
      ]);
      capabilityRegistry.getDiscoveredEntryByName.mockImplementation(
        (name: string) => {
          const entries: Record<
            string,
            { mutatingAction?: boolean; runtimeOwner?: string }
          > = {
            spawn_subagent_async: {
              mutatingAction: true,
              runtimeOwner: 'api',
            },
            wait_for_subagents: {
              mutatingAction: false,
              runtimeOwner: 'api',
            },
          };
          return entries[name] ?? null;
        },
      );

      const result = await service.preflightJobExecution({
        workflowRunId: 'run-1',
        jobId: 'implement_and_commit',
        job: {
          id: 'implement_and_commit',
          type: 'execution',
          tier: 'heavy',
        },
        stateVariables: { trigger: { scope_id: 'project-1' } },
        resolvedJobInputs: { agent_profile: 'orchestrator' },
        workflowPermissions: {
          tool_policy: {
            default: ToolPolicyEffect.DENY,
            rules: [
              { effect: ToolPolicyEffect.ALLOW, tool: 'spawn_subagent_async' },
              { effect: ToolPolicyEffect.ALLOW, tool: 'wait_for_subagents' },
            ],
          },
        },
      });

      expect(result.ok).toBe(true);
      expect(result.callableToolNames).toEqual(
        expect.arrayContaining(['spawn_subagent_async', 'wait_for_subagents']),
      );
    });

    /**
     * Additional regression test: verify the companion tool is NOT exposed
     * when explicitly denied at workflow level.
     */
    it('should NOT expose wait_for_subagents when explicitly denied in workflowPermissions', async () => {
      support.selectToolsForJob.mockReturnValueOnce([]);
      support.resolveAllowedToolNames.mockResolvedValueOnce(
        new Set(['spawn_subagent_async']),
      );
      capabilityRegistry.getDiscoveredEntries.mockReturnValue([
        {
          name: 'spawn_subagent_async',
          mutatingAction: true,
          runtimeOwner: 'api',
        },
        {
          name: 'wait_for_subagents',
          mutatingAction: false,
          runtimeOwner: 'api',
        },
      ]);
      capabilityRegistry.getDiscoveredEntryByName.mockImplementation(
        (name: string) => {
          const entries: Record<
            string,
            { mutatingAction?: boolean; runtimeOwner?: string }
          > = {
            spawn_subagent_async: {
              mutatingAction: true,
              runtimeOwner: 'api',
            },
            wait_for_subagents: {
              mutatingAction: false,
              runtimeOwner: 'api',
            },
          };
          return entries[name] ?? null;
        },
      );

      const result = await service.preflightJobExecution({
        workflowRunId: 'run-1',
        jobId: 'implement_and_commit',
        job: {
          id: 'implement_and_commit',
          type: 'execution',
          tier: 'heavy',
          permissions: {
            allow_tools: ['spawn_subagent_async'],
            deny_tools: [],
          } as never,
        },
        stateVariables: { trigger: { scope_id: 'project-1' } },
        resolvedJobInputs: { agent_profile: 'orchestrator' },
        workflowPermissions: {
          allow_tools: ['spawn_subagent_async'],
          deny_tools: ['wait_for_subagents'], // Explicitly denied
        } as never,
      });

      // wait_for_subagents should NOT be callable when explicitly denied
      expect(result.callableToolNames).not.toContain('wait_for_subagents');
    });
  });

  describe('native skill discovery mode suppresses search_skills', () => {
    const setupSkillDiscoveryCapabilities = (): void => {
      support.selectToolsForJob.mockReturnValueOnce([]);
      support.resolveAllowedToolNames.mockResolvedValueOnce(
        new Set(['search_skills', 'read_skill_manifest']),
      );
      capabilityRegistry.getDiscoveredEntries.mockReturnValue([
        {
          name: 'search_skills',
          mutatingAction: false,
          runtimeOwner: 'api',
        },
        {
          name: 'read_skill_manifest',
          mutatingAction: false,
          runtimeOwner: 'api',
        },
      ]);
      capabilityRegistry.getDiscoveredEntryByName.mockImplementation(
        (name: string) => {
          const entries: Record<
            string,
            { mutatingAction?: boolean; runtimeOwner?: string }
          > = {
            search_skills: { mutatingAction: false, runtimeOwner: 'api' },
            read_skill_manifest: { mutatingAction: false, runtimeOwner: 'api' },
          };
          return entries[name] ?? null;
        },
      );
    };

    it('drops search_skills but keeps read_skill_manifest when step mode is native', async () => {
      setupSkillDiscoveryCapabilities();

      const result = await service.preflightJobExecution({
        workflowRunId: 'run-1',
        jobId: 'job-1',
        job: {
          id: 'job-1',
          type: 'execution',
          tier: 'light',
          tools: ['search_skills', 'read_skill_manifest'],
          steps: [{ id: 's1', skill_discovery_mode: 'native' }],
        } as never,
        stateVariables: { trigger: { scope_id: 'project-1' } },
        resolvedJobInputs: {},
        workflowPermissions: undefined,
      });

      expect(result.ok).toBe(true);
      expect(result.callableToolNames).not.toContain('search_skills');
      expect(result.callableToolNames).toContain('read_skill_manifest');
    });

    it('keeps search_skills callable when step mode is search', async () => {
      setupSkillDiscoveryCapabilities();

      const result = await service.preflightJobExecution({
        workflowRunId: 'run-1',
        jobId: 'job-1',
        job: {
          id: 'job-1',
          type: 'execution',
          tier: 'light',
          tools: ['search_skills', 'read_skill_manifest'],
          steps: [{ id: 's1', skill_discovery_mode: 'search' }],
        } as never,
        stateVariables: { trigger: { scope_id: 'project-1' } },
        resolvedJobInputs: {},
        workflowPermissions: undefined,
      });

      expect(result.ok).toBe(true);
      expect(result.callableToolNames).toContain('search_skills');
      expect(result.callableToolNames).toContain('read_skill_manifest');
    });
  });
});
