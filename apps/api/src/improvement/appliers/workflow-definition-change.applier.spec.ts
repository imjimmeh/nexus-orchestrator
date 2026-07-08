import { describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { WorkflowDefinitionChangeApplier } from './workflow-definition-change.applier';
import type { IWorkflowPersistenceService } from '../../workflow/kernel/interfaces/workflow-kernel.ports';
import type { WorkflowRepositoryAggregator } from '../../workflow/workflow-repository-aggregator.service';
import type { WorkflowParserService } from '../../workflow/workflow-parser.service';
import type { WorkflowValidationService } from '../../workflow/workflow-validation.service';
import type { ConfigResolutionCache } from '../../config-resolution/config-resolution-cache.service';
import type { Workflow } from '../../workflow/database/entities/workflow.entity';
import type { ImprovementProposal } from '../database/entities/improvement-proposal.entity';

// The payload schema trims `proposedYaml`, so this fixture must already be
// trim-stable (no leading/trailing whitespace) for exact-value assertions
// against what the applier passes through to `updateWorkflow`.
const VALID_YAML =
  'workflow_id: sample_workflow\nname: Sample Workflow\njobs: []';

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 'workflow-uuid-1',
    name: 'Sample Workflow',
    yaml_definition: VALID_YAML,
    overrides: null,
    ...overrides,
  } as Workflow;
}

function makeProposal(
  overrides: Partial<ImprovementProposal> = {},
): ImprovementProposal {
  return {
    id: 'proposal-uuid-1',
    kind: 'workflow_definition_change',
    status: 'approved',
    payload: {
      workflowName: 'Sample Workflow',
      proposedYaml: VALID_YAML,
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
    ...overrides,
  } as ImprovementProposal;
}

function buildApplier(workflow: Workflow | null = makeWorkflow()) {
  const parsedDefinition = {
    workflow_id: 'sample_workflow',
    name: 'Sample Workflow',
    jobs: [],
  };
  const mocks = {
    workflowPersistence: {
      updateWorkflow: vi.fn().mockResolvedValue(workflow),
    },
    repos: {
      workflows: {
        findByIdentifier: vi.fn().mockResolvedValue(workflow),
        update: vi.fn().mockResolvedValue(workflow),
      },
    },
    parser: { parseWorkflow: vi.fn().mockReturnValue(parsedDefinition) },
    validator: {
      validateWorkflow: vi
        .fn()
        .mockResolvedValue({ valid: true, errors: [], warnings: [] }),
    },
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
  return { applier, mocks };
}

describe('WorkflowDefinitionChangeApplier.apply', () => {
  it('returns ok:false without any mutation when proposedYaml fails to parse', async () => {
    const { applier, mocks } = buildApplier();
    mocks.parser.parseWorkflow.mockImplementation(() => {
      throw new Error('Invalid workflow YAML: Missing name');
    });

    const result = await applier.apply(makeProposal());

    expect(result.ok).toBe(false);
    expect(mocks.proposalRepository.update).not.toHaveBeenCalled();
    expect(mocks.repos.workflows.update).not.toHaveBeenCalled();
    expect(mocks.workflowPersistence.updateWorkflow).not.toHaveBeenCalled();
  });

  it('returns ok:false carrying the error text when semantic validation fails', async () => {
    const { applier, mocks } = buildApplier();
    mocks.validator.validateWorkflow.mockResolvedValue({
      valid: false,
      errors: ['job implement: unknown tool x'],
      warnings: [],
    });

    const result = await applier.apply(makeProposal());

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('unknown tool x');
    expect(mocks.proposalRepository.update).not.toHaveBeenCalled();
    expect(mocks.repos.workflows.update).not.toHaveBeenCalled();
  });

  it('returns ok:false without mutating when the proposed YAML name does not match the target workflow', async () => {
    const { applier, mocks } = buildApplier();
    mocks.parser.parseWorkflow.mockReturnValue({
      workflow_id: 'sample_workflow',
      name: 'Renamed Workflow',
      jobs: [],
    });

    const result = await applier.apply(makeProposal());

    expect(result.ok).toBe(false);
    expect(mocks.proposalRepository.update).not.toHaveBeenCalled();
    expect(mocks.repos.workflows.update).not.toHaveBeenCalled();
  });

  it('returns ok:false + unrouted:true without mutating when the workflow does not exist', async () => {
    const { applier, mocks } = buildApplier(null);

    const result = await applier.apply(makeProposal());

    expect(result.ok).toBe(false);
    expect(result.unrouted).toBe(true);
    expect(mocks.parser.parseWorkflow).not.toHaveBeenCalled();
    expect(mocks.proposalRepository.update).not.toHaveBeenCalled();
    expect(mocks.repos.workflows.update).not.toHaveBeenCalled();
  });

  it('writes rollback_data BEFORE mutating the workflow yaml', async () => {
    const { applier, mocks } = buildApplier();

    await applier.apply(makeProposal());

    const snapshotOrder =
      mocks.proposalRepository.update.mock.invocationCallOrder[0];
    const mutateOrder =
      mocks.workflowPersistence.updateWorkflow.mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeLessThan(mutateOrder);
    expect(mocks.proposalRepository.update).toHaveBeenCalledWith(
      'proposal-uuid-1',
      {
        rollback_data: expect.objectContaining({
          workflowId: 'workflow-uuid-1',
          name: 'Sample Workflow',
          yaml_definition: VALID_YAML,
        }),
      },
    );
  });

  it('pins overrides with proposal provenance, updates the yaml, and invalidates the cache', async () => {
    const { applier, mocks } = buildApplier();

    const result = await applier.apply(makeProposal());

    expect(result.ok).toBe(true);
    expect(mocks.repos.workflows.update).toHaveBeenCalledWith(
      'workflow-uuid-1',
      {
        overrides: expect.objectContaining({
          improvement_proposal: expect.objectContaining({
            proposal_id: 'proposal-uuid-1',
          }),
        }),
      },
    );
    expect(mocks.workflowPersistence.updateWorkflow).toHaveBeenCalledWith(
      'workflow-uuid-1',
      VALID_YAML,
    );
    expect(mocks.configResolutionCache.invalidate).toHaveBeenCalledWith(
      'workflow',
      'Sample Workflow',
    );
  });

  it('rollback_data survives a mutation failure (failure injection)', async () => {
    const { applier, mocks } = buildApplier();
    mocks.workflowPersistence.updateWorkflow.mockRejectedValue(
      new Error('gitops edit denied'),
    );

    const result = await applier.apply(makeProposal());

    expect(result.ok).toBe(false);
    expect(mocks.proposalRepository.update).toHaveBeenCalledWith(
      'proposal-uuid-1',
      expect.objectContaining({ rollback_data: expect.anything() }),
    );
  });

  it('does not re-snapshot on retry (idempotency)', async () => {
    const { applier, mocks } = buildApplier();
    const proposal = makeProposal({
      rollback_data: {
        workflowId: 'workflow-uuid-1',
        name: 'Sample Workflow',
        yaml_definition: 'ORIGINAL YAML',
        overrides: null,
      },
    });

    const result = await applier.apply(proposal);

    expect(result.ok).toBe(true);
    expect(mocks.proposalRepository.update).not.toHaveBeenCalled();
  });
});

describe('WorkflowDefinitionChangeApplier.rollback', () => {
  it('restores yaml_definition + overrides via a raw update and invalidates the cache', async () => {
    const { applier, mocks } = buildApplier();

    await applier.rollback(
      makeProposal({
        rollback_data: {
          workflowId: 'workflow-uuid-1',
          name: 'Sample Workflow',
          yaml_definition: 'ORIGINAL YAML',
          overrides: null,
        },
      }),
    );

    expect(mocks.repos.workflows.update).toHaveBeenCalledWith(
      'workflow-uuid-1',
      { yaml_definition: 'ORIGINAL YAML', overrides: null },
    );
    expect(mocks.configResolutionCache.invalidate).toHaveBeenCalledWith(
      'workflow',
      'Sample Workflow',
    );
  });

  it('throws when rollback_data is absent', async () => {
    const { applier } = buildApplier();

    await expect(
      applier.rollback(makeProposal({ rollback_data: null })),
    ).rejects.toThrow();
  });
});
