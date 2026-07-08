import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactLibraryService } from '../../ai-config/services/artifact-library.service';
import { AgentSkillsService } from '../../ai-config/services/agent-skills.service';
import { ImprovementProposalService } from '../../improvement/improvement-proposal.service';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { ToolApprovalRuleService } from '../../capability-governance/tool-approval-rule.service';
import { ToolCallApprovalRequestService } from '../../capability-governance/tool-call-approval-request.service';
import { ToolCandidateService } from '../../tool-runtime/tool-candidate.service';
import { ToolRegistryService } from '../../tool-registry/tool-registry.service';
import { PolicyEngineService } from '../../capability-governance/policy-engine.service';
import { ToolPolicyEvaluatorService } from '../../capability-governance/tool-policy-evaluator.service';
import { WorkflowRuntimeCapabilityExecutorService } from './workflow-runtime-capability-executor.service';
import { WorkflowRuntimeCapabilityLifecycleService } from './workflow-runtime-capability-lifecycle.service';
import { WorkflowRuntimeToolsService } from './workflow-runtime-tools.service';

describe('WorkflowRuntimeCapabilityLifecycleService', () => {
  let service: WorkflowRuntimeCapabilityLifecycleService;

  const runtimeTools = {
    getCapabilities: vi.fn(),
  };

  const toolCandidates = {
    createDraft: vi.fn(),
    validateCandidate: vi.fn(),
    publishCandidate: vi.fn(),
  };

  const toolRegistry = {
    upsertTool: vi.fn(),
  };

  const agentSkills = {
    createSkill: vi.fn(),
    updateSkill: vi.fn(),
    getSkill: vi.fn(),
    listSkillFiles: vi.fn(),
    upsertSkillFile: vi.fn(),
    deleteSkillFile: vi.fn(),
    replaceProfileSkills: vi.fn(),
    addProfileSkills: vi.fn(),
    addProfileSkillsByProfileName: vi.fn(),
    removeProfileSkills: vi.fn(),
  };

  const eventLedger = {
    emitBestEffort: vi.fn().mockResolvedValue(undefined),
  };

  const improvementProposals = {
    submitProposal: vi.fn(),
  };

  const artifacts = {
    createArtifact: vi.fn(),
    upsertArtifact: vi.fn(),
    listArtifacts: vi.fn(),
    listArtifactFiles: vi.fn(),
    upsertArtifactFile: vi.fn(),
    deleteArtifactFile: vi.fn(),
  };

  const toolApprovalRuleService = {
    evaluate: vi.fn().mockResolvedValue({ allowed: true, matchedRules: [] }),
    resolveAlwaysAllowedTools: vi.fn().mockResolvedValue(new Set()),
    createRule: vi.fn().mockResolvedValue({ id: 'rule-1' }),
    resolveToolEffectExecution: vi.fn().mockResolvedValue(null),
  };

  const toolCallApprovalRequestService = {
    checkApproval: vi.fn().mockResolvedValue({
      requiresApproval: false,
      existingRequest: null,
    }),
    createRequest: vi.fn().mockResolvedValue({ id: 'req-1' }),
    resolvePendingRequest: vi.fn().mockResolvedValue(null),
    requestAndWaitForApproval: vi.fn().mockResolvedValue({
      status: 'approved',
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    runtimeTools.getCapabilities.mockResolvedValue({
      callable_tools: ['create_tool_candidate'],
      denied_tools: [],
      approval_required_tools: [],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRuntimeCapabilityExecutorService,
        WorkflowRuntimeCapabilityLifecycleService,
        { provide: WorkflowRuntimeToolsService, useValue: runtimeTools },
        { provide: ToolCandidateService, useValue: toolCandidates },
        { provide: ToolRegistryService, useValue: toolRegistry },
        { provide: AgentSkillsService, useValue: agentSkills },
        { provide: ArtifactLibraryService, useValue: artifacts },
        { provide: EventLedgerService, useValue: eventLedger },
        {
          provide: ImprovementProposalService,
          useValue: improvementProposals,
        },
        { provide: ToolApprovalRuleService, useValue: toolApprovalRuleService },
        {
          provide: ToolCallApprovalRequestService,
          useValue: toolCallApprovalRequestService,
        },
        PolicyEngineService,
        ToolPolicyEvaluatorService,
      ],
    }).compile();

    service = module.get(WorkflowRuntimeCapabilityLifecycleService);
  });

  it('executes create_tool_candidate when capability is callable', async () => {
    toolCandidates.createDraft.mockResolvedValue({ id: 'artifact-1' });

    const result = await service.createToolCandidate({
      tool_name: 'new_tool',
      language: 'node',
      source_code: 'export const tool = {};',
      schema: { type: 'object' },
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
    });

    expect(runtimeTools.getCapabilities).toHaveBeenCalledWith({
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
    });
    expect(toolCandidates.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_name: 'new_tool',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'create_tool_candidate',
        execution_status: 'executed',
        workflow_run_id: 'run-1',
        job_id: 'job-1',
      }),
    );
  });

  it('returns denied when capability is not callable', async () => {
    runtimeTools.getCapabilities.mockResolvedValueOnce({
      callable_tools: [],
      denied_tools: [
        {
          toolName: 'create_tool_candidate',
          reasonCode: 'policy_denied',
          reason: 'Blocked by workflow allow list.',
        },
      ],
      approval_required_tools: [],
    });

    const result = await service.createToolCandidate({
      tool_name: 'blocked_tool',
      language: 'node',
      source_code: 'export const tool = {};',
      schema: { type: 'object' },
      user: { userId: 'agent:run-2:job-2', roles: ['Agent'] },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        execution_status: 'denied',
        denied_reason_code: 'policy_denied',
      }),
    );
    expect(toolCandidates.createDraft).not.toHaveBeenCalled();
  });

  it('denies and skips mutation when approval request is rejected', async () => {
    runtimeTools.getCapabilities.mockResolvedValueOnce({
      callable_tools: [],
      denied_tools: [],
      approval_required_tools: ['replace_profile_skills'],
    });
    toolApprovalRuleService.resolveToolEffectExecution.mockResolvedValueOnce(
      'require_approval',
    );
    toolCallApprovalRequestService.requestAndWaitForApproval.mockResolvedValueOnce(
      { status: 'rejected' },
    );

    const result = await service.replaceProfileSkills({
      profile_id: 'profile-1',
      skill_ids: ['debugging'],
      workflow_run_id: 'run-3',
      job_id: 'job-3',
      user: { userId: 'agent:run-3:job-3', roles: ['Agent'] },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        execution_status: 'denied',
      }),
    );
    expect(agentSkills.replaceProfileSkills).not.toHaveBeenCalled();
  });

  it('executes add_profile_skills when callable', async () => {
    runtimeTools.getCapabilities.mockResolvedValueOnce({
      callable_tools: ['add_profile_skills'],
      denied_tools: [],
      approval_required_tools: [],
    });
    agentSkills.addProfileSkills.mockResolvedValueOnce([{ id: 'debugging' }]);

    const result = await service.addProfileSkills({
      profile_id: 'profile-1',
      skill_ids: ['debugging'],
      workflow_run_id: 'run-5',
      job_id: 'job-5',
      user: { userId: 'agent:run-5:job-5', roles: ['Agent'] },
    });

    expect(agentSkills.addProfileSkills).toHaveBeenCalledWith('profile-1', [
      'debugging',
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'add_profile_skills',
        execution_status: 'executed',
      }),
    );
  });

  it('executes save_script_as_skill and assigns skill to profile', async () => {
    runtimeTools.getCapabilities.mockResolvedValueOnce({
      callable_tools: ['save_script_as_skill'],
      denied_tools: [],
      approval_required_tools: [],
    });
    agentSkills.createSkill.mockReturnValueOnce({ name: 'script-saver' });
    agentSkills.upsertSkillFile.mockReturnValueOnce({
      path: 'scripts/reusable-script.md',
    });
    agentSkills.addProfileSkills.mockResolvedValueOnce([
      { id: 'script-saver' },
    ]);

    const result = await service.saveScriptAsSkill({
      name: 'script-saver',
      description: 'Reusable script utility',
      script_content: 'echo "hello"',
      profile_id: 'profile-1',
      workflow_run_id: 'run-6',
      job_id: 'job-6',
      user: { userId: 'agent:run-6:job-6', roles: ['Agent'] },
    });

    expect(agentSkills.createSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'script-saver',
      }),
    );
    expect(agentSkills.upsertSkillFile).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: 'script-saver',
      }),
    );
    expect(agentSkills.addProfileSkills).toHaveBeenCalledWith('profile-1', [
      'script-saver',
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'save_script_as_skill',
        execution_status: 'executed',
      }),
    );
  });

  it('files a governed skill_assignment proposal for the caller profile instead of assigning directly', async () => {
    runtimeTools.getCapabilities.mockResolvedValueOnce({
      callable_tools: ['create_skill'],
      denied_tools: [],
      approval_required_tools: [],
    });
    agentSkills.createSkill.mockReturnValueOnce({ name: 'custom-skill' });
    improvementProposals.submitProposal.mockResolvedValueOnce({
      outcome: 'auto_applied',
      proposal: { id: 'proposal-1' },
    });

    const result = await service.createSkill({
      name: 'custom-skill',
      description: 'Test skill',
      skill_markdown:
        '---\nname: custom-skill\ndescription: Test skill\n---\n\n# Custom Skill',
      workflow_run_id: 'run-8',
      job_id: 'job-8',
      user: {
        userId: 'agent:run-8:job-8',
        roles: ['Agent'],
        agentProfileName: 'architect-agent',
      },
    });

    expect(improvementProposals.submitProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'skill_assignment',
        payload: expect.objectContaining({
          skillName: 'custom-skill',
          assignment_targets: [
            { type: 'agent_profile', profileName: 'architect-agent' },
          ],
        }),
      }),
    );
    expect(agentSkills.addProfileSkillsByProfileName).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'create_skill',
        execution_status: 'executed',
        result: expect.objectContaining({
          skill: { name: 'custom-skill' },
          assignment_proposal: {
            profile_name: 'architect-agent',
            outcome: 'auto_applied',
            proposal_id: 'proposal-1',
          },
        }),
      }),
    );
  });

  it('auto-assigns save_script_as_skill to caller profile when profile_id is omitted', async () => {
    runtimeTools.getCapabilities.mockResolvedValueOnce({
      callable_tools: ['save_script_as_skill'],
      denied_tools: [],
      approval_required_tools: [],
    });
    agentSkills.createSkill.mockReturnValueOnce({ name: 'script-saver' });
    agentSkills.upsertSkillFile.mockReturnValueOnce({
      path: 'scripts/reusable-script.md',
    });
    agentSkills.addProfileSkillsByProfileName.mockResolvedValueOnce([
      { id: 'script-saver' },
    ]);

    const result = await service.saveScriptAsSkill({
      name: 'script-saver',
      description: 'Reusable script utility',
      script_content: 'echo "hello"',
      workflow_run_id: 'run-9',
      job_id: 'job-9',
      user: {
        userId: 'agent:run-9:job-9',
        roles: ['Agent'],
        agentProfileName: 'qa-agent',
      },
    });

    expect(agentSkills.addProfileSkillsByProfileName).toHaveBeenCalledWith(
      'qa-agent',
      ['script-saver'],
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'save_script_as_skill',
        execution_status: 'executed',
      }),
    );
  });

  it('allows admin/developer calls without agent execution context', async () => {
    agentSkills.createSkill.mockReturnValue({ id: 'skill-1' });

    const result = await service.createSkill({
      name: 'custom-skill',
      description: 'Test skill',
      skill_markdown:
        '---\nname: custom-skill\ndescription: Test skill\n---\n\n# Custom Skill',
      user: { userId: 'user-1', roles: ['Admin'] },
    });

    expect(runtimeTools.getCapabilities).not.toHaveBeenCalled();
    expect(agentSkills.createSkill).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        execution_status: 'executed',
      }),
    );
  });

  it('denies agent call when execution context is missing', async () => {
    const result = await service.createSkill({
      name: 'blocked-skill',
      description: 'Blocked skill',
      skill_markdown:
        '---\nname: blocked-skill\ndescription: Blocked skill\n---\n\n# Skill',
      user: { roles: ['Agent'] },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        execution_status: 'denied',
        denied_reason_code: 'missing_agent_execution_context',
      }),
    );
    expect(agentSkills.createSkill).not.toHaveBeenCalled();
  });

  it('returns failed result and emits failure event when execution throws', async () => {
    runtimeTools.getCapabilities.mockResolvedValueOnce({
      callable_tools: ['upsert_tool'],
      denied_tools: [],
      approval_required_tools: [],
    });
    toolRegistry.upsertTool.mockRejectedValueOnce(new Error('upsert failed'));

    const result = await service.upsertTool({
      name: 'failing-tool',
      schema: { type: 'object' },
      typescript_code: 'export const tool = {};',
      tier_restriction: 2,
      workflow_run_id: 'run-4',
      job_id: 'job-4',
      user: { userId: 'agent:run-4:job-4', roles: ['Agent'] },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        execution_status: 'failed',
        error: 'upsert failed',
      }),
    );

    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.runtime.capability.failed',
        outcome: 'failure',
        toolName: 'upsert_tool',
      }),
    );
  });

  it('executes save_script_as_artifact and writes artifact file', async () => {
    runtimeTools.getCapabilities.mockResolvedValueOnce({
      callable_tools: ['save_script_as_artifact'],
      denied_tools: [],
      approval_required_tools: [],
    });
    artifacts.upsertArtifact.mockReturnValueOnce({ id: 'shared-scripts' });
    artifacts.upsertArtifactFile.mockReturnValueOnce([
      { path: 'scripts/reusable-script.md' },
    ]);

    const result = await service.saveScriptAsArtifact({
      artifact_id: 'shared-scripts',
      name: 'Shared Scripts',
      description: 'Reusable command snippets',
      script_content: 'echo run',
      workflow_run_id: 'run-7',
      job_id: 'job-7',
      user: { userId: 'agent:run-7:job-7', roles: ['Agent'] },
    });

    expect(artifacts.upsertArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        artifact_id: 'shared-scripts',
      }),
    );
    expect(artifacts.upsertArtifactFile).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: 'shared-scripts',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'save_script_as_artifact',
        execution_status: 'executed',
      }),
    );
  });
});
