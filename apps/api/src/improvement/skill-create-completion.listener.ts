import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as yaml from 'js-yaml';
import type { SkillScopeInput } from '@nexus/core';
import { WORKFLOW_RUN_COMPLETED_EVENT } from '../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';
import { WorkflowSkillBindingService } from '../workflow/workflow-skill-bindings/workflow-skill-binding.service';
import { ImprovementProposalRepository } from './database/repositories/improvement-proposal.repository';
import type { ImprovementProposal } from './database/entities/improvement-proposal.entity';
import { AgentSkillsService } from '../ai-config/services/agent-skills.service';
import { AgentProfileSkillBindingService } from '../ai-config/services/agent-profile-skill-binding.service';
import { ScopeService } from '../scope/scope.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { decideScopeApplication } from '../memory/learning/skill-scope-auto-apply.decide';
import {
  SKILL_SCOPE_CONFIRMATION_MODE_KEY,
  SKILL_SCOPE_CONFIRMATION_MODE_DEFAULT,
  coerceSkillScopeConfirmationMode,
} from '../settings/skill-scope-confirmation.settings.constants';
import { applySkillAssignments } from './appliers/skill-create.applier';
import {
  buildAssignmentRollbackData,
  parseAssignmentTargets,
} from './appliers/assignment-target.helpers';

/**
 * Finalizes a `skill_create` improvement proposal once its `create_skill`
 * workflow run completes. Ported from the retired legacy skill proposal
 * completion listener, repointed onto the new
 * {@link ImprovementProposalRepository}:
 *
 *  - keys off `trigger.source_proposal_id` (the applier stamps it on dispatch);
 *  - reads `jobs.author_skill.output.materialized`;
 *  - downgrades the proposal to `status:'failed'` when `materialized:false`
 *    (the applier already flipped it to `applied` optimistically at dispatch);
 *  - carries the recommended-scope auto-apply against {@link AgentSkillsService}
 *    when `skill_scope_confirmation_mode` is `auto` and the scope has content;
 *  - records the materialization outcome under `provenance.materialization`
 *    (the new entity has no `diagnostics_json` column);
 *  - applies the payload's `assignment_targets` (Epic B) via
 *    {@link applySkillAssignments} now that the skill file exists, recording
 *    what was applied/unrouted under `rollback_data`.
 */
@Injectable()
export class SkillCreateCompletionListener {
  private readonly logger = new Logger(SkillCreateCompletionListener.name);

  constructor(
    private readonly proposals: ImprovementProposalRepository,
    private readonly settingsService: SystemSettingsService,
    private readonly skillsService: AgentSkillsService,
    private readonly bindings: WorkflowSkillBindingService,
    private readonly profileSkillBindings: AgentProfileSkillBindingService,
    private readonly scopeService: ScopeService,
  ) {}

  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  async handleWorkflowCompleted(event: WorkflowRunEvent): Promise<void> {
    const trigger = readRecord(event.stateVariables.trigger);
    const proposalId = readNonEmptyString(trigger?.source_proposal_id);
    if (!proposalId) {
      return;
    }

    const proposal = await this.proposals.findById(proposalId);
    if (!proposal) {
      this.logger.warn(
        `Proposal ${proposalId} not found for completed workflow run ${event.workflowRunId}`,
      );
      return;
    }

    const jobs = readRecord(event.stateVariables.jobs);
    const authorJob = readRecord(jobs?.['author_skill']);
    const output = readRecord(authorJob?.output);
    const materialized = output?.materialized === true;

    if (materialized) {
      await this.proposals.updateById(
        proposalId,
        buildAppliedUpdate(proposal, output),
      );
      await this.applyAssignmentTargets(proposalId, proposal);
      await this.applyOriginScope(proposal);
      await this.tryAutoApplyScope(proposalId, proposal, output);
    } else {
      await this.proposals.updateById(
        proposalId,
        buildFailedUpdate(proposal, output),
      );
    }
  }

  /**
   * Applies the proposal payload's `assignment_targets` (Epic B) now that
   * the skill has materialized on disk. A no-op when the payload has none
   * (Epic A behavior). Routing failures (e.g. an unknown agent profile) are
   * recorded as `unrouted` rather than thrown, so one bad target cannot
   * abort the rest of the batch or the materialization outcome above.
   */
  private async applyAssignmentTargets(
    proposalId: string,
    proposal: ImprovementProposal,
  ): Promise<void> {
    const targets = parseAssignmentTargets(
      (proposal.payload as Record<string, unknown> | undefined)
        ?.assignment_targets,
    );
    if (targets.length === 0) {
      return;
    }

    const skillName = readSkillName(proposal.payload);
    if (!skillName) {
      this.logger.warn(
        `Proposal ${proposalId} has assignment targets but no target_skill_name; skipping assignment application`,
      );
      return;
    }

    const outcomes = await applySkillAssignments(
      {
        skillName,
        targets,
        proposalId,
        scopeId: readScopeId(proposal.provenance),
      },
      {
        skills: {
          addProfileSkills: async (profileName, skillNames) => {
            await this.skillsService.addProfileSkillsByProfileName(
              profileName,
              skillNames,
            );
          },
          addScopedProfileSkill: async (scopedInput) => {
            await this.profileSkillBindings.addProfileScopedBinding({
              skillName: scopedInput.skillName,
              scopeNodeId: scopedInput.scopeNodeId,
              profileName: scopedInput.profileName,
            });
          },
        },
        bindings: {
          addBinding: (input) => this.bindings.addBinding(input),
        },
      },
    );

    await this.proposals.updateById(proposalId, {
      rollback_data: buildAssignmentRollbackData(
        proposal.rollback_data,
        outcomes,
      ),
    });
  }

  /**
   * Apply the recommended scope directly to the skill markdown via
   * {@link AgentSkillsService} when `skill_scope_confirmation_mode` is `auto`
   * and the scope has content. Fail-soft: any error is logged and swallowed —
   * the proposal keeps `provenance.materialization.scope_confirmation.pending:true`
   * (written in the preceding `updateById`) and the human-confirmation path is
   * unaffected.
   */
  private async tryAutoApplyScope(
    proposalId: string,
    proposal: ImprovementProposal,
    output: Record<string, unknown> | null,
  ): Promise<void> {
    const rawMode = await this.settingsService.get(
      SKILL_SCOPE_CONFIRMATION_MODE_KEY,
      SKILL_SCOPE_CONFIRMATION_MODE_DEFAULT,
    );
    const mode = coerceSkillScopeConfirmationMode(rawMode);
    const recommendedScope = readRecord(output?.recommended_scope) ?? null;
    const scopeRationale = readNonEmptyString(output?.scope_rationale) ?? null;

    const decision = decideScopeApplication({
      recommendedScope,
      rationale: scopeRationale ?? undefined,
      mode,
      originScopeId: await this.resolveLiveScopeId(proposal.provenance),
    });

    if (decision.action !== 'auto_apply') {
      return;
    }

    try {
      this.applyScopeToSkill(
        readSkillName(proposal.payload),
        decision.confirmedScope as SkillScopeInput,
      );

      await this.proposals.updateById(proposalId, {
        provenance: mergeMaterialization(proposal.provenance, {
          materialized: true,
          scope_confirmation: {
            pending: false,
            recommended_scope: recommendedScope,
            scope_rationale: scopeRationale,
            confirmed_scope: decision.confirmedScope ?? null,
            auto_applied: true,
          },
        }),
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Auto-apply scope failed for proposal ${proposalId}, will require manual confirmation: ${String(err)}`,
      );
    }
  }

  /**
   * Applies the proposal's factual origin scope (`provenance.scope_id` — the
   * scope_node_id the run that produced this proposal actually executed
   * under) to the newly-materialized skill's frontmatter immediately,
   * unconditionally, regardless of `skill_scope_confirmation_mode`. This is
   * not a "recommendation" requiring confirmation — it is a record of where
   * the learning came from. A missing/empty scope_id (e.g. a manually
   * triggered proposal with no run context) leaves the skill unscoped, same
   * as before this change — there is no narrower scope to default to when
   * none is known. Fail-soft: any error is logged and swallowed, exactly
   * like {@link tryAutoApplyScope}'s existing discipline, since a partial
   * failure here must not affect the materialization outcome already
   * recorded above.
   */
  private async applyOriginScope(proposal: ImprovementProposal): Promise<void> {
    const scopeId = readScopeId(proposal.provenance);
    if (!scopeId) {
      return;
    }
    if (!(await this.scopeService.isLiveScope(scopeId))) {
      this.logger.warn(
        `Origin scope ${scopeId} for proposal ${proposal.id} no longer resolves to a live scope node; skipping origin-scope application`,
      );
      return;
    }
    try {
      this.applyScopeToSkill(readSkillName(proposal.payload), {
        projects: [scopeId],
        agents: [],
        workflows: [],
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to apply origin scope ${scopeId} to proposal ${proposal.id}: ${String(err)}`,
      );
    }
  }

  /**
   * Resolves `provenance.scope_id` to a validated live scope id, or `null`
   * when the scope_id is absent or no longer resolves to a live (existing,
   * non-archived) scope node. Shared by {@link applyOriginScope} and
   * {@link tryAutoApplyScope} so a stale scope_id is treated as absent by
   * both the unconditional origin-scope write and the auto-apply clamp in
   * {@link decideScopeApplication}.
   */
  private async resolveLiveScopeId(
    provenance: Record<string, unknown>,
  ): Promise<string | null> {
    const scopeId = readScopeId(provenance);
    if (!scopeId) {
      return null;
    }
    return (await this.scopeService.isLiveScope(scopeId)) ? scopeId : null;
  }

  /**
   * Rewrite the target skill's frontmatter `scope` from the confirmed scope.
   * Best-effort at the call site: a missing skill throws and is caught by
   * {@link tryAutoApplyScope}'s fail-soft guard.
   */
  private applyScopeToSkill(
    skillName: string | null,
    scope: SkillScopeInput,
  ): void {
    if (!skillName) {
      throw new Error('proposal payload has no target_skill_name');
    }
    const record = this.skillsService.getSkill(skillName);
    const updatedMarkdown = buildScopedMarkdown(record.skillMarkdown, scope);
    this.skillsService.updateSkill(skillName, {
      skill_markdown: updatedMarkdown,
    });
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readSkillName(payload: Record<string, unknown>): string | null {
  return readNonEmptyString(payload?.target_skill_name);
}

/**
 * Mirrors `skill-create.applier.ts`'s own `readScopeId` — deliberately
 * duplicated per this codebase's existing discipline for small module-local
 * scope helpers rather than sharing a cross-module utility for a two-line
 * accessor.
 */
function readScopeId(provenance: Record<string, unknown>): string | undefined {
  const scope = provenance?.scope_id;
  return typeof scope === 'string' && scope.length > 0 ? scope : undefined;
}

/**
 * Merge a `materialization` block into a proposal's existing provenance without
 * dropping unrelated provenance keys (e.g. the applier's `apply_detail`).
 */
function mergeMaterialization(
  provenance: Record<string, unknown>,
  materialization: Record<string, unknown>,
): Record<string, unknown> {
  const existing = readRecord(provenance?.materialization) ?? {};
  return {
    ...provenance,
    materialization: { ...existing, ...materialization },
  };
}

function buildAppliedUpdate(
  proposal: ImprovementProposal,
  output: Record<string, unknown> | null,
): Partial<ImprovementProposal> {
  const recommendedScope = readRecord(output?.recommended_scope) ?? null;
  const scopeRationale = readNonEmptyString(output?.scope_rationale) ?? null;
  return {
    status: 'applied',
    applied_at: new Date(),
    provenance: mergeMaterialization(proposal.provenance, {
      materialized: true,
      scope_confirmation: {
        pending: true,
        recommended_scope: recommendedScope,
        scope_rationale: scopeRationale,
      },
    }),
  };
}

function buildFailedUpdate(
  proposal: ImprovementProposal,
  output: Record<string, unknown> | null,
): Partial<ImprovementProposal> {
  return {
    status: 'failed',
    provenance: mergeMaterialization(proposal.provenance, {
      materialized: false,
      error_message:
        readNonEmptyString(output?.rejection_reason) ??
        'Skill materialization was not completed by the authoring agent',
    }),
  };
}

/**
 * Rewrite a skill markdown's frontmatter `scope` key from a confirmed scope.
 * A markdown without frontmatter is returned unchanged. An empty scope removes
 * the key entirely (i.e. "no restriction").
 */
function buildScopedMarkdown(
  currentMarkdown: string,
  scope: SkillScopeInput | null,
): string {
  const match = currentMarkdown.match(/^(---\n)([\s\S]*?)(\n---)([\s\S]*)$/);
  if (!match) {
    return currentMarkdown;
  }
  const frontmatter = (yaml.load(match[2]) ?? {}) as Record<string, unknown>;
  if (scope === null) {
    delete frontmatter.scope;
  } else {
    const scopeObj: Record<string, string[]> = {};
    if (scope.projects?.length) scopeObj.projects = scope.projects;
    if (scope.agents?.length) scopeObj.agents = scope.agents;
    if (scope.workflows?.length) scopeObj.workflows = scope.workflows;
    if (Object.keys(scopeObj).length > 0) {
      frontmatter.scope = scopeObj;
    } else {
      delete frontmatter.scope;
    }
  }
  const serialized = yaml.dump(frontmatter).trimEnd();
  return `---\n${serialized}\n---${match[4]}`;
}
