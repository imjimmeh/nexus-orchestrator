import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { WorkflowDefinitionChangePayloadSchema } from '@nexus/core';
import type {
  IWorkflowDefinition,
  WorkflowChangeSummaryEntry,
} from '@nexus/core';
import { WORKFLOW_PERSISTENCE_SERVICE } from '../../workflow/kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowPersistenceService } from '../../workflow/kernel/interfaces/workflow-kernel.ports';
import { WorkflowRepositoryAggregator } from '../../workflow/workflow-repository-aggregator.service';
import { WorkflowParserService } from '../../workflow/workflow-parser.service';
import { WorkflowValidationService } from '../../workflow/workflow-validation.service';
import { ConfigResolutionCache } from '../../config-resolution/config-resolution-cache.service';
import type { Workflow } from '../../workflow/database/entities/workflow.entity';
import { ImprovementProposal } from '../database/entities/improvement-proposal.entity';
import {
  type IImprovementApplier,
  type ImprovementApplyResult,
} from './improvement-applier.types';
import {
  buildImprovementOverridesMarker,
  persistRollbackSnapshotOnce,
} from './definition-change.helpers';
import type { WorkflowRollbackSnapshot } from './workflow-definition-change.applier.types';

/**
 * `workflow_definition_change` applier — replaces an existing workflow's
 * `yaml_definition` with a proposed one (EPIC-D). Reuses
 * `WorkflowParserService`/`WorkflowValidationService` to pre-validate the
 * proposed YAML BEFORE any snapshot or mutation happens (a bad proposal must
 * fail cleanly, never partially persist), and `IWorkflowPersistenceService.updateWorkflow`
 * (the same path the admin UI's human edits take, including its security
 * scan and GitOps edit-policy check) to actually persist it — rather than
 * re-implementing workflow parsing/persistence here.
 *
 * Apply order is load-bearing (see `apply()`): pre-validation happens first
 * (parse -> semantic validate -> name-match guard), then the pre-mutation
 * snapshot is persisted, then the reseed-protection `overrides` marker is
 * set, BOTH before the YAML is actually replaced — so a crash mid-apply
 * always leaves either an untouched-and-unpinned workflow (proposal invalid
 * / workflow missing) or a pinned-but-not-yet-updated workflow that
 * `rollback()` can safely unwind, never an applied-but-unpinned change a
 * reseed could silently clobber.
 */
@Injectable()
export class WorkflowDefinitionChangeApplier implements IImprovementApplier {
  readonly kind = 'workflow_definition_change' as const;

  constructor(
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    private readonly repos: WorkflowRepositoryAggregator,
    private readonly parser: WorkflowParserService,
    private readonly validator: WorkflowValidationService,
    @InjectRepository(ImprovementProposal)
    private readonly proposals: Repository<ImprovementProposal>,
    @Optional()
    private readonly configResolutionCache?: ConfigResolutionCache,
  ) {}

  async apply(proposal: ImprovementProposal): Promise<ImprovementApplyResult> {
    const parsedPayload = WorkflowDefinitionChangePayloadSchema.safeParse(
      proposal.payload,
    );
    if (!parsedPayload.success) {
      return {
        ok: false,
        detail: `invalid workflow_definition_change payload: ${parsedPayload.error.message}`,
      };
    }
    const payload = parsedPayload.data;
    const identifier = payload.workflowId ?? payload.workflowName;
    if (identifier === undefined) {
      return {
        ok: false,
        detail:
          'workflow_definition_change payload has neither workflowId nor workflowName',
      };
    }

    const workflow = await this.repos.workflows.findByIdentifier(identifier, {
      includeInactive: true,
    });
    if (!workflow) {
      return {
        ok: false,
        detail: `workflow not found: ${identifier}`,
        unrouted: true,
      };
    }

    let definition: IWorkflowDefinition;
    try {
      definition = this.parser.parseWorkflow(payload.proposedYaml);
    } catch (err: unknown) {
      return { ok: false, detail: describeError(err) };
    }

    const validation = await this.validator.validateWorkflow(definition);
    if (!validation.valid) {
      return { ok: false, detail: validation.errors.join(', ') };
    }

    if (definition.name !== workflow.name) {
      return {
        ok: false,
        detail: `proposed YAML name "${definition.name}" does not match target workflow name "${workflow.name}"`,
      };
    }

    try {
      await persistRollbackSnapshotOnce(
        this.proposals,
        proposal,
        buildWorkflowRollbackSnapshot(workflow) as unknown as Record<
          string,
          unknown
        >,
      );

      await this.repos.workflows.update(workflow.id, {
        overrides: buildImprovementOverridesMarker(
          workflow.overrides ?? null,
          proposal.id,
          new Date().toISOString(),
        ),
      });

      await this.workflowPersistence.updateWorkflow(
        workflow.id,
        payload.proposedYaml,
      );

      this.configResolutionCache?.invalidate('workflow', workflow.name);

      return { ok: true, detail: describeChangeSummary(payload.changeSummary) };
    } catch (err: unknown) {
      return { ok: false, detail: describeError(err) };
    }
  }

  async rollback(proposal: ImprovementProposal): Promise<void> {
    const snapshot = parseWorkflowRollbackSnapshot(proposal.rollback_data);

    await this.repos.workflows.update(snapshot.workflowId, {
      yaml_definition: snapshot.yaml_definition,
      overrides: snapshot.overrides,
    });
    this.configResolutionCache?.invalidate('workflow', snapshot.name);
  }
}

function buildWorkflowRollbackSnapshot(
  workflow: Workflow,
): WorkflowRollbackSnapshot {
  return {
    workflowId: workflow.id,
    name: workflow.name,
    yaml_definition: workflow.yaml_definition,
    overrides: workflow.overrides ?? null,
  };
}

/**
 * Parses a proposal's `rollback_data` back into a
 * {@link WorkflowRollbackSnapshot}. Rolling back without a snapshot is a hard
 * error — there is nothing safe to restore to — so this throws rather than
 * silently no-op-ing on absent or malformed data.
 */
function parseWorkflowRollbackSnapshot(
  rollbackData: unknown,
): WorkflowRollbackSnapshot {
  if (!rollbackData || typeof rollbackData !== 'object') {
    throw new Error(
      'workflow_definition_change rollback requires a snapshot, but rollback_data is absent',
    );
  }
  const data = rollbackData as Record<string, unknown>;
  if (typeof data.workflowId !== 'string' || data.workflowId.length === 0) {
    throw new Error(
      'workflow_definition_change rollback_data is missing a workflowId',
    );
  }
  if (typeof data.yaml_definition !== 'string') {
    throw new Error(
      'workflow_definition_change rollback_data is missing yaml_definition',
    );
  }

  return {
    workflowId: data.workflowId,
    name: typeof data.name === 'string' ? data.name : '',
    yaml_definition: data.yaml_definition,
    overrides:
      (data.overrides as Record<string, unknown> | null | undefined) ?? null,
  };
}

function describeChangeSummary(
  changeSummary: readonly WorkflowChangeSummaryEntry[],
): string {
  return changeSummary
    .map((entry) => `${entry.field}: ${entry.from} -> ${entry.to}`)
    .join('; ');
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
