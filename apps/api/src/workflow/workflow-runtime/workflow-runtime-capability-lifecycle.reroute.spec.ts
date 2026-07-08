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

/**
 * Epic B, Task 10(b) — `create_skill`'s self-assignment used to call
 * `AgentSkillsService.addProfileSkillsByProfileName` directly, bypassing
 * governance entirely. This spec locks in the reroute: self-assignment must
 * flow through `ImprovementProposalService.submitProposal({ kind:
 * 'skill_assignment', ... })`, exactly like the agent-initiated
 * `suggest_skill_assignment` tool, so `ImprovementGovernancePolicy` decides
 * auto-apply vs propose.
 */
describe('WorkflowRuntimeCapabilityLifecycleService createSkill reroute', () => {
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
    addProfileSkillsByProfileName: vi.fn(),
  };

  const eventLedger = {
    emitBestEffort: vi.fn().mockResolvedValue(undefined),
  };

  const artifacts = {};

  const improvementProposals = {
    submitProposal: vi.fn(),
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
      callable_tools: ['create_skill'],
      denied_tools: [],
      approval_required_tools: [],
    });
    improvementProposals.submitProposal.mockResolvedValue({
      outcome: 'proposed',
      proposal: { id: 'proposal-1' },
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

  it('files a skill_assignment proposal for the caller profile instead of assigning directly', async () => {
    agentSkills.createSkill.mockReturnValueOnce({ name: 'new-skill' });

    const result = await service.createSkill({
      name: 'new-skill',
      description: 'A new skill',
      skill_markdown:
        '---\nname: new-skill\ndescription: A new skill\n---\n\n# New Skill',
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      user: {
        userId: 'agent:run-1:job-1',
        roles: ['Agent'],
        agentProfileName: 'requesting-agent',
      },
    });

    expect(improvementProposals.submitProposal).toHaveBeenCalledTimes(1);
    expect(improvementProposals.submitProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'skill_assignment',
        payload: {
          skillName: 'new-skill',
          assignment_targets: [
            { type: 'agent_profile', profileName: 'requesting-agent' },
          ],
        },
      }),
    );
    expect(agentSkills.addProfileSkillsByProfileName).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          skill: { name: 'new-skill' },
          assignment_proposal: expect.objectContaining({
            profile_name: 'requesting-agent',
            outcome: 'proposed',
            proposal_id: 'proposal-1',
          }),
        }),
      }),
    );
  });

  it('does not file a proposal and returns a null assignment when the caller has no agent profile', async () => {
    agentSkills.createSkill.mockReturnValueOnce({ name: 'admin-skill' });

    const result = await service.createSkill({
      name: 'admin-skill',
      description: 'Admin-created skill',
      skill_markdown:
        '---\nname: admin-skill\ndescription: Admin-created skill\n---\n',
      user: { userId: 'user-1', roles: ['Admin'] },
    });

    expect(improvementProposals.submitProposal).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        result: { skill: { name: 'admin-skill' }, assignment_proposal: null },
      }),
    );
  });

  it('reflects a dropped governance outcome without a proposal id', async () => {
    agentSkills.createSkill.mockReturnValueOnce({ name: 'dropped-skill' });
    improvementProposals.submitProposal.mockResolvedValueOnce({
      outcome: 'dropped',
      proposal: null,
    });

    const result = await service.createSkill({
      name: 'dropped-skill',
      description: 'Dropped skill',
      skill_markdown:
        '---\nname: dropped-skill\ndescription: Dropped skill\n---\n',
      workflow_run_id: 'run-2',
      job_id: 'job-2',
      user: {
        userId: 'agent:run-2:job-2',
        roles: ['Agent'],
        agentProfileName: 'low-confidence-agent',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        result: expect.objectContaining({
          assignment_proposal: {
            profile_name: 'low-confidence-agent',
            outcome: 'dropped',
            proposal_id: null,
          },
        }),
      }),
    );
  });
});
