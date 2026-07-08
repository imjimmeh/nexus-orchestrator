import { Injectable } from '@nestjs/common';
import type { AssignmentTarget } from '@nexus/core';
import type { ImprovementProposal } from '../database/entities/improvement-proposal.entity';
import type { ImprovementProposalRepository } from '../database/repositories/improvement-proposal.repository';
import {
  type IImprovementApplier,
  type ImprovementApplyResult,
} from './improvement-applier.types';
import { applySkillAssignments } from './skill-create.applier';
import {
  buildAssignmentRollbackData,
  parseAssignmentTargets,
} from './assignment-target.helpers';
import type {
  SkillAssignmentApplierBindingsGateway,
  SkillAssignmentApplierSkillsGateway,
} from './skill-assignment.types';

/**
 * `skill_assignment` applier — binds an ALREADY-EXISTING skill to
 * agent-profile / workflow-step targets. Unlike {@link import('./skill-create.applier').SkillCreateApplier},
 * there is no materialization step: the skill is assumed to exist already,
 * so `apply()` verifies that up front and applies every target
 * synchronously via {@link applySkillAssignments} (Task 6, reused as-is —
 * routing a resolved target to its destination is identical whether the
 * skill was just materialized or already existed). Mirroring
 * {@link import('./skill-create.applier').SkillCreateApplier}, `apply()`
 * only patches `rollback_data` — it never sets `status` itself.
 * `ImprovementProposalService.applyProposal` owns the `applied` status
 * transition on a successful (`ok: true`) result; there is no completion
 * listener to hand off to.
 */
@Injectable()
export class SkillAssignmentApplier implements IImprovementApplier {
  readonly kind = 'skill_assignment' as const;

  constructor(
    private readonly skills: SkillAssignmentApplierSkillsGateway,
    private readonly bindings: SkillAssignmentApplierBindingsGateway,
    private readonly proposals: ImprovementProposalRepository,
  ) {}

  async apply(proposal: ImprovementProposal): Promise<ImprovementApplyResult> {
    const payload = proposal.payload as {
      skillName?: unknown;
      assignment_targets?: unknown;
    };
    const skillName = readSkillName(payload.skillName);
    if (!skillName) {
      return {
        ok: false,
        detail: 'skill_assignment proposal payload has no skillName',
      };
    }
    if (!this.skills.skillExists(skillName)) {
      return { ok: false, detail: `skill not found: ${skillName}` };
    }

    const targets = parseAssignmentTargets(payload.assignment_targets);
    const outcomes = await applySkillAssignments(
      {
        skillName,
        targets,
        proposalId: proposal.id,
        scopeId: readScopeId(proposal.provenance),
      },
      { skills: this.skills, bindings: this.bindings },
    );

    await this.proposals.updateById(proposal.id, {
      rollback_data: buildAssignmentRollbackData(
        proposal.rollback_data,
        outcomes,
      ),
    });

    return {
      ok: true,
      detail: `applied ${outcomes.length} target(s)`,
      unrouted: outcomes.some((outcome) => outcome.status === 'unrouted'),
    };
  }

  async rollback(proposal: ImprovementProposal): Promise<void> {
    const skillName = readSkillName(
      (proposal.payload as { skillName?: unknown } | undefined)?.skillName,
    );
    if (!skillName) {
      return;
    }

    const appliedTargets = readAppliedTargets(proposal.rollback_data);
    for (const target of appliedTargets) {
      if (target.type === 'agent_profile') {
        await this.skills.removeProfileSkills(target.profileName, [skillName]);
      } else {
        await this.bindings.removeBinding({
          workflowName: target.workflowName,
          stepId: target.stepId ?? null,
          skillName,
        });
      }
    }
  }
}

function readSkillName(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Mirrors `skill-create.applier.ts`'s own `readScopeId` — deliberately
 * duplicated per this codebase's existing discipline for small module-local
 * scope helpers rather than sharing a cross-module utility for a two-line
 * accessor.
 */
function readScopeId(provenance: Record<string, unknown>): string | null {
  const scope = provenance?.scope_id;
  return typeof scope === 'string' && scope.length > 0 ? scope : null;
}

function readAppliedTargets(
  rollbackData: Record<string, unknown> | null,
): AssignmentTarget[] {
  return parseAssignmentTargets(
    (rollbackData as { applied_targets?: unknown } | null)?.applied_targets,
  );
}
