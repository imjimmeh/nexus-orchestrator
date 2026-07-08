import { Injectable, Logger } from '@nestjs/common';
import type { AssignmentTarget } from '@nexus/core';
import { WorkflowEngineService } from '../../workflow/workflow-engine.service';
import type { ImprovementProposal } from '../database/entities/improvement-proposal.entity';
import {
  type IImprovementApplier,
  type ImprovementApplyResult,
} from './improvement-applier.types';
import {
  parseAssignmentTargets,
  partitionAssignmentTargets,
} from './assignment-target.helpers';
import type {
  AssignmentApplicationOutcome,
  SkillAssignmentDeps,
} from './skill-assignment.types';

/**
 * `skill_create` applier — dispatches the `create_skill` workflow that
 * materializes a proposed skill. Materialization completes asynchronously; the
 * {@link import('../skill-create-completion.listener').SkillCreateCompletionListener}
 * flips the proposal to its terminal outcome once the run reports back and
 * applies any `assignment_targets` via {@link applySkillAssignments} — a skill
 * can only be bound to a profile/workflow once it exists on disk, so
 * `apply()` here only validates that the targets parse.
 */
@Injectable()
export class SkillCreateApplier implements IImprovementApplier {
  readonly kind = 'skill_create' as const;

  private readonly logger = new Logger(SkillCreateApplier.name);

  constructor(private readonly workflowEngine: WorkflowEngineService) {}

  async apply(proposal: ImprovementProposal): Promise<ImprovementApplyResult> {
    const payload = proposal.payload as {
      target_skill_name?: string;
      patch_markdown?: string;
      proposal_summary?: string;
      assignment_targets?: unknown;
    };
    const targets = parseAssignmentTargets(payload.assignment_targets);
    if (targets.length > 0) {
      this.logger.log(
        `Proposal ${proposal.id} carries ${targets.length} valid assignment target(s); applied post-materialization`,
      );
    }
    const runId = await this.workflowEngine.startWorkflow('create_skill', {
      target_skill_name: payload.target_skill_name ?? '',
      patch_markdown: payload.patch_markdown ?? '',
      proposal_summary: payload.proposal_summary ?? '',
      source_proposal_id: proposal.id,
      scope_id: readScopeId(proposal.provenance) ?? '',
    });
    if (!runId) {
      return { ok: false, detail: 'failed to start create_skill workflow' };
    }
    return { ok: true, detail: `materialization dispatched (run ${runId})` };
  }
}

function readScopeId(provenance: Record<string, unknown>): string | undefined {
  const scope = provenance?.scope_id;
  return typeof scope === 'string' && scope.length > 0 ? scope : undefined;
}

export type { AssignmentApplicationOutcome, SkillAssignmentDeps };

/**
 * Applies each parsed `assignment_target` for a materialized skill: agent
 * profile targets add the skill to the profile's assigned-skill list;
 * workflow targets bind the skill at the workflow level (no `stepId`) or a
 * specific step. Called by the completion listener once
 * `materialized:true` is observed — never from `apply()`, since the skill
 * must exist before either destination can meaningfully reference it.
 */
export async function applySkillAssignments(
  input: {
    skillName: string;
    targets: AssignmentTarget[];
    proposalId: string;
    scopeId?: string | null;
  },
  deps: SkillAssignmentDeps,
): Promise<AssignmentApplicationOutcome[]> {
  const { profileTargets, workflowTargets } = partitionAssignmentTargets(
    input.targets,
  );
  const outcomes: AssignmentApplicationOutcome[] = [];

  for (const target of profileTargets) {
    try {
      if (input.scopeId) {
        await deps.skills.addScopedProfileSkill({
          profileName: target.profileName,
          skillName: input.skillName,
          scopeNodeId: input.scopeId,
        });
      } else {
        await deps.skills.addProfileSkills(target.profileName, [
          input.skillName,
        ]);
      }
      outcomes.push({ status: 'applied', target });
    } catch (err: unknown) {
      outcomes.push({ status: 'unrouted', target, reason: describeError(err) });
    }
  }

  for (const target of workflowTargets) {
    try {
      await deps.bindings.addBinding({
        workflowName: target.workflowName,
        stepId: target.stepId ?? null,
        skillName: input.skillName,
        provenance: { proposalId: input.proposalId },
      });
      outcomes.push({ status: 'applied', target });
    } catch (err: unknown) {
      outcomes.push({ status: 'unrouted', target, reason: describeError(err) });
    }
  }

  return outcomes;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
