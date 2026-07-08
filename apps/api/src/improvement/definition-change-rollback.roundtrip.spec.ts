import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { ImprovementProposalService } from './improvement-proposal.service';
import { ImprovementApplierRegistry } from './appliers/improvement-applier.registry';
import { AgentProfileChangeApplier } from './appliers/agent-profile-change.applier';
import { WorkflowDefinitionChangeApplier } from './appliers/workflow-definition-change.applier';
import type { ImprovementProposalRepository } from './database/repositories/improvement-proposal.repository';
import type { ImprovementGovernancePolicyService } from './governance/improvement-governance-policy.service';
import type { EventLedgerService } from '../observability/event-ledger.service';
import type { ImprovementProposal } from './database/entities/improvement-proposal.entity';
import type { AiConfigAdminService } from '../ai-config/ai-config-admin.service';
import type { AgentSkillsService } from '../ai-config/services/agent-skills.service';
import type { AgentProfileRepository } from '../ai-config/database/repositories/agent-profile.repository';
import type { IWorkflowPersistenceService } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { WorkflowRepositoryAggregator } from '../workflow/workflow-repository-aggregator.service';
import type { WorkflowParserService } from '../workflow/workflow-parser.service';
import type { WorkflowValidationService } from '../workflow/workflow-validation.service';
import type { ConfigResolutionCache } from '../config-resolution/config-resolution-cache.service';

/**
 * Round-trip regression coverage for EPIC-D rollback: exercises
 * `ImprovementProposalService.rollback` (Epic A) end-to-end against REAL
 * `AgentProfileChangeApplier` / `WorkflowDefinitionChangeApplier` instances
 * (Task 3 / Task 4), wired through the real `ImprovementApplierRegistry`
 * rather than a hand-rolled test double. This is the seam that actually
 * proves rollback restores state, not just that a mocked applier's
 * `rollback` was invoked (see `improvement-proposal.service.spec.ts`, which
 * only asserts the dispatch contract).
 */

function makeGovernance(): ImprovementGovernancePolicyService {
  return {
    resolveAction: vi.fn(),
  } as unknown as ImprovementGovernancePolicyService;
}

function makeLedger(): EventLedgerService {
  return {
    emitBestEffort: vi.fn(async () => undefined),
  } as unknown as EventLedgerService;
}

/**
 * Proposal-repository test double backing `ImprovementProposalService`.
 * Seeded directly with an `applied` row (rollback is only reachable from
 * that status) so the round-trip starts from the applier's Task 3/4 fixture
 * snapshot rather than re-deriving it through `apply()`.
 */
/**
 * In-memory `ImprovementProposalRepository` double backing
 * `ImprovementProposalService`. Seeded with a single row and wired with the
 * three methods the service touches on the rollback / approve paths:
 * `findById`, `updateById`, and `updatePendingById` (the last needed by the
 * auto-rollback-on-apply-failure fixtures that drive the real appliers through
 * `approve()` — a `pending` -> `applied`/`failed` transition — rather than
 * seeding an already-`applied` row). `updatePendingById` no-ops on a
 * non-pending row, matching the real repository's optimistic guard.
 */
function makeProposalsRepo(seed: ImprovementProposal): {
  repo: ImprovementProposalRepository;
  updateById: ReturnType<typeof vi.fn>;
} {
  const rows = new Map<string, ImprovementProposal>([[seed.id, seed]]);
  const updateById = vi.fn(
    async (id: string, patch: Partial<ImprovementProposal>) => {
      const existing = rows.get(id);
      if (!existing) return null;
      const next = { ...existing, ...patch };
      rows.set(id, next);
      return next;
    },
  );
  const updatePendingById = vi.fn(
    async (id: string, patch: Partial<ImprovementProposal>) => {
      const existing = rows.get(id);
      if (!existing || existing.status !== 'pending') return null;
      const next = { ...existing, ...patch };
      rows.set(id, next);
      return next;
    },
  );
  const repo = {
    findById: vi.fn(async (id: string) => rows.get(id) ?? null),
    updateById,
    updatePendingById,
  } as unknown as ImprovementProposalRepository;
  return { repo, updateById };
}

describe('rollback round-trip through ImprovementProposalService', () => {
  describe('agent_profile_change', () => {
    function buildRealApplier() {
      const profileRollbackSnapshot = {
        profileId: 'profile-uuid-1',
        profileName: 'implementation-agent',
        system_prompt: 'Base prompt.',
        model_name: null,
        provider_name: null,
        thinking_level: null,
        tool_policy: { default: 'deny', rules: [] },
        assigned_skills: ['testing-unit-patterns'],
        overrides: null,
      };
      const mocks = {
        aiConfigAdmin: {
          updateAgentProfile: vi.fn().mockResolvedValue(undefined),
        },
        agentSkills: {
          addProfileSkills: vi.fn().mockResolvedValue([]),
          removeProfileSkills: vi.fn().mockResolvedValue([]),
        },
        profileRepository: {
          findByName: vi.fn().mockResolvedValue(null),
          update: vi.fn().mockResolvedValue(undefined),
        },
        proposalRepository: { update: vi.fn().mockResolvedValue(undefined) },
      };
      const applier = new AgentProfileChangeApplier(
        mocks.aiConfigAdmin as unknown as AiConfigAdminService,
        mocks.agentSkills as unknown as AgentSkillsService,
        mocks.profileRepository as unknown as AgentProfileRepository,
        mocks.proposalRepository as unknown as Repository<ImprovementProposal>,
      );
      return { applier, mocks, profileRollbackSnapshot };
    }

    it('restores the profile snapshot and transitions the proposal to rolled_back', async () => {
      const { applier, mocks, profileRollbackSnapshot } = buildRealApplier();
      const seed = {
        id: 'proposal-uuid-1',
        kind: 'agent_profile_change',
        status: 'applied',
        payload: {
          profileName: 'implementation-agent',
          patch: {
            system_prompt: { mode: 'append', value: 'Always run the linter.' },
          },
          changeSummary: 'Append lint reminder',
        },
        rollback_data: profileRollbackSnapshot,
        provenance: {},
        applied_at: new Date('2026-06-01T00:00:00Z'),
        rolled_back_at: null,
      } as unknown as ImprovementProposal;
      const { repo, updateById } = makeProposalsRepo(seed);
      const registry = new ImprovementApplierRegistry([applier]);
      const service = new ImprovementProposalService(
        repo,
        makeGovernance(),
        registry,
        makeLedger(),
      );

      const rolledBack = await service.rollback('proposal-uuid-1');

      expect(mocks.aiConfigAdmin.updateAgentProfile).toHaveBeenCalledWith(
        'profile-uuid-1',
        expect.objectContaining({ system_prompt: 'Base prompt.' }),
      );
      expect(mocks.profileRepository.update).toHaveBeenCalledWith(
        'profile-uuid-1',
        expect.objectContaining({
          overrides: null,
          assigned_skills: ['testing-unit-patterns'],
        }),
      );
      expect(updateById).toHaveBeenCalledWith(
        'proposal-uuid-1',
        expect.objectContaining({
          status: 'rolled_back',
          rolled_back_at: expect.any(Date),
        }),
      );
      expect(rolledBack.status).toBe('rolled_back');
      expect(rolledBack.rolled_back_at).toBeInstanceOf(Date);
    });

    it('auto-rolls-back the profile when apply() fails mid-mutation, and still marks the proposal failed', async () => {
      const { applier, mocks } = buildRealApplier();
      mocks.profileRepository.findByName.mockResolvedValue({
        id: 'profile-uuid-3',
        name: 'implementation-agent',
        system_prompt: 'Base prompt.',
        model_name: null,
        provider_name: null,
        thinking_level: null,
        tool_policy: { default: 'deny', rules: [] },
        assigned_skills: ['testing-unit-patterns'],
        overrides: null,
      });
      mocks.aiConfigAdmin.updateAgentProfile
        .mockRejectedValueOnce(new Error('db write failed'))
        .mockResolvedValue(undefined);
      const seed = {
        id: 'proposal-uuid-3',
        kind: 'agent_profile_change',
        status: 'pending',
        payload: {
          profileName: 'implementation-agent',
          patch: {
            system_prompt: { mode: 'append', value: 'Always run the linter.' },
          },
          changeSummary: 'Append lint reminder',
        },
        rollback_data: null,
        provenance: {},
        applied_at: null,
        rolled_back_at: null,
      } as unknown as ImprovementProposal;
      const { repo } = makeProposalsRepo(seed);
      const registry = new ImprovementApplierRegistry([applier]);
      const service = new ImprovementProposalService(
        repo,
        makeGovernance(),
        registry,
        makeLedger(),
      );

      const result = await service.approve('proposal-uuid-3');

      expect(result.status).toBe('failed');
      // Call 1: the override marker set before mutation. Call 2: rollback
      // restoring the pre-mutation snapshot (overrides back to null).
      expect(mocks.profileRepository.update).toHaveBeenCalledTimes(2);
      expect(mocks.profileRepository.update).toHaveBeenNthCalledWith(
        2,
        'profile-uuid-3',
        expect.objectContaining({
          overrides: null,
          assigned_skills: ['testing-unit-patterns'],
        }),
      );
      // Call 1: the failed apply attempt. Call 2: rollback restoring
      // system_prompt via the service path.
      expect(mocks.aiConfigAdmin.updateAgentProfile).toHaveBeenCalledTimes(2);
      expect(mocks.aiConfigAdmin.updateAgentProfile).toHaveBeenNthCalledWith(
        2,
        'profile-uuid-3',
        expect.objectContaining({ system_prompt: 'Base prompt.' }),
      );
    });
  });

  describe('workflow_definition_change', () => {
    const ORIGINAL_YAML =
      'workflow_id: sample_workflow\nname: Sample Workflow\njobs: []';

    function buildRealApplier() {
      const workflowRollbackSnapshot = {
        workflowId: 'workflow-uuid-1',
        name: 'Sample Workflow',
        yaml_definition: ORIGINAL_YAML,
        overrides: null,
      };
      const mocks = {
        workflowPersistence: {
          updateWorkflow: vi.fn().mockResolvedValue(undefined),
        },
        repos: {
          workflows: {
            findByIdentifier: vi.fn().mockResolvedValue(null),
            update: vi.fn().mockResolvedValue(undefined),
          },
        },
        parser: { parseWorkflow: vi.fn() },
        validator: { validateWorkflow: vi.fn() },
        proposalRepository: { update: vi.fn().mockResolvedValue(undefined) },
        configResolutionCache: { invalidate: vi.fn() },
      };
      const applier = new WorkflowDefinitionChangeApplier(
        mocks.workflowPersistence as unknown as IWorkflowPersistenceService,
        mocks.repos as unknown as WorkflowRepositoryAggregator,
        mocks.parser as unknown as WorkflowParserService,
        mocks.validator as unknown as WorkflowValidationService,
        mocks.proposalRepository as unknown as Repository<ImprovementProposal>,
        mocks.configResolutionCache as unknown as ConfigResolutionCache,
      );
      return { applier, mocks, workflowRollbackSnapshot };
    }

    it('restores the yaml_definition snapshot and transitions the proposal to rolled_back', async () => {
      const { applier, mocks, workflowRollbackSnapshot } = buildRealApplier();
      const seed = {
        id: 'proposal-uuid-2',
        kind: 'workflow_definition_change',
        status: 'applied',
        payload: {
          workflowName: 'Sample Workflow',
          proposedYaml:
            'workflow_id: sample_workflow\nname: Sample Workflow\njobs: [retry]',
          changeSummary: [
            {
              field: 'jobs',
              from: '1 job',
              to: '2 jobs',
              rationale: 'add a retry job',
            },
          ],
        },
        rollback_data: workflowRollbackSnapshot,
        provenance: {},
        applied_at: new Date('2026-06-01T00:00:00Z'),
        rolled_back_at: null,
      } as unknown as ImprovementProposal;
      const { repo, updateById } = makeProposalsRepo(seed);
      const registry = new ImprovementApplierRegistry([applier]);
      const service = new ImprovementProposalService(
        repo,
        makeGovernance(),
        registry,
        makeLedger(),
      );

      const rolledBack = await service.rollback('proposal-uuid-2');

      expect(mocks.repos.workflows.update).toHaveBeenCalledWith(
        'workflow-uuid-1',
        { yaml_definition: ORIGINAL_YAML, overrides: null },
      );
      expect(mocks.configResolutionCache.invalidate).toHaveBeenCalledWith(
        'workflow',
        'Sample Workflow',
      );
      expect(updateById).toHaveBeenCalledWith(
        'proposal-uuid-2',
        expect.objectContaining({
          status: 'rolled_back',
          rolled_back_at: expect.any(Date),
        }),
      );
      expect(rolledBack.status).toBe('rolled_back');
      expect(rolledBack.rolled_back_at).toBeInstanceOf(Date);
    });

    it('auto-rolls-back the workflow when apply() fails mid-mutation, and still marks the proposal failed', async () => {
      const { applier, mocks } = buildRealApplier();
      mocks.repos.workflows.findByIdentifier.mockResolvedValue({
        id: 'workflow-uuid-2',
        name: 'Sample Workflow',
        yaml_definition: ORIGINAL_YAML,
        overrides: null,
      });
      mocks.parser.parseWorkflow.mockReturnValue({ name: 'Sample Workflow' });
      mocks.validator.validateWorkflow.mockResolvedValue({
        valid: true,
        errors: [],
      });
      mocks.workflowPersistence.updateWorkflow.mockRejectedValueOnce(
        new Error('persist failed'),
      );
      const seed = {
        id: 'proposal-uuid-4',
        kind: 'workflow_definition_change',
        status: 'pending',
        payload: {
          workflowName: 'Sample Workflow',
          proposedYaml:
            'workflow_id: sample_workflow\nname: Sample Workflow\njobs: [retry]',
          changeSummary: [
            {
              field: 'jobs',
              from: '1 job',
              to: '2 jobs',
              rationale: 'add a retry job',
            },
          ],
        },
        rollback_data: null,
        provenance: {},
        applied_at: null,
        rolled_back_at: null,
      } as unknown as ImprovementProposal;
      const { repo } = makeProposalsRepo(seed);
      const registry = new ImprovementApplierRegistry([applier]);
      const service = new ImprovementProposalService(
        repo,
        makeGovernance(),
        registry,
        makeLedger(),
      );

      const result = await service.approve('proposal-uuid-4');

      expect(result.status).toBe('failed');
      // Call 1: the override marker set before mutation. Call 2: rollback
      // restoring the pre-mutation snapshot (yaml_definition + overrides).
      expect(mocks.repos.workflows.update).toHaveBeenCalledTimes(2);
      expect(mocks.repos.workflows.update).toHaveBeenNthCalledWith(
        2,
        'workflow-uuid-2',
        { yaml_definition: ORIGINAL_YAML, overrides: null },
      );
      expect(mocks.configResolutionCache.invalidate).toHaveBeenCalledWith(
        'workflow',
        'Sample Workflow',
      );
    });
  });
});
