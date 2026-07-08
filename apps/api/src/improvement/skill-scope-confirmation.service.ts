import { BadRequestException, Injectable } from '@nestjs/common';
import * as yaml from 'js-yaml';
import { AgentSkillsService } from '../ai-config/services/agent-skills.service';
import { AuthorizationService } from '../auth/authorization/authorization.service';
import { GLOBAL_SCOPE_NODE_ID } from '../scope/scope.constants';
import { ScopeService } from '../scope/scope.service';
import { ImprovementProposalRepository } from './database/repositories/improvement-proposal.repository';
import type { ImprovementProposal } from './database/entities/improvement-proposal.entity';

const SKILL_UPDATE_PERMISSION = 'skills:update';

interface PendingScopeConfirmation {
  recommendedScope: {
    projects: string[];
    agents: string[];
    workflows: string[];
  } | null;
}

/**
 * The confirm/reject action for a `skill_create` proposal's LLM-recommended
 * scope, parked at `provenance.materialization.scope_confirmation.pending`
 * by {@link import('./skill-create-completion.listener').SkillCreateCompletionListener}.
 * This is the action that has never existed before this feature — `'manual'`
 * mode (the default) has always parked proposals with no way to act on them.
 *
 * Permission is checked against the scope(s) the recommendation would
 * actually widen INTO (every `recommended_scope.projects` entry, or
 * {@link GLOBAL_SCOPE_NODE_ID} when that list is empty, meaning "no project
 * restriction"), via the existing {@link AuthorizationService.can}, which
 * already walks the `scope_node_closure` ancestor chain — a role assigned at
 * an ancestor scope (e.g. a platform admin) satisfies a narrower target
 * automatically, with no new authorization concept introduced here. If the
 * confirming user lacks the permission at even one target scope, the whole
 * confirmation is refused (all-or-nothing) — the already-applied origin
 * scope from {@link import('./skill-create-completion.listener').SkillCreateCompletionListener.applyOriginScope}
 * is untouched either way.
 *
 * Skill visibility is OR'd across `projects`/`agents`/`workflows` (see
 * `AgentSkillLibraryService.isVisible`), so a non-empty `agents` or
 * `workflows` array is its own independent widening axis — granting that
 * agent/workflow visibility into the skill in *every* project, not just the
 * ones already permission-checked above. A `skills:update` grant scoped to a
 * single project therefore does not cover it. Whenever the recommendation
 * names at least one agent or workflow, an additional check against
 * {@link GLOBAL_SCOPE_NODE_ID} is required — this is deliberately a *global*
 * grant rather than a per-project one, since the agent/workflow widening
 * itself has no project boundary to check against.
 */
@Injectable()
export class SkillScopeConfirmationService {
  constructor(
    private readonly proposals: ImprovementProposalRepository,
    private readonly authz: AuthorizationService,
    private readonly skillsService: AgentSkillsService,
    private readonly scopeService: ScopeService,
  ) {}

  async confirm(
    proposalId: string,
    userId: string,
  ): Promise<{ confirmed: boolean; reason?: string }> {
    const proposal = await this.loadProposal(proposalId);
    const pending = readPendingScopeConfirmation(proposal);

    const staleScopeId = await this.findFirstStaleProjectScope(
      pending.recommendedScope?.projects ?? [],
    );
    if (staleScopeId) {
      throw new BadRequestException(
        `Recommended scope names project ${staleScopeId}, which no longer resolves to a live scope node`,
      );
    }

    const targetScopeNodeIds = resolveTargetScopeNodeIds(
      pending.recommendedScope,
    );
    const deniedScope = await this.findFirstDeniedScope(
      userId,
      targetScopeNodeIds,
    );
    if (deniedScope) {
      return {
        confirmed: false,
        reason: `missing ${SKILL_UPDATE_PERMISSION} permission at scope ${deniedScope}`,
      };
    }

    const skillName = readSkillName(proposal.payload);
    const record = this.skillsService.getSkill(skillName);
    const updatedMarkdown = buildScopedMarkdown(
      record.skillMarkdown,
      pending.recommendedScope,
    );
    this.skillsService.updateSkill(skillName, {
      skill_markdown: updatedMarkdown,
    });

    await this.proposals.updateById(proposalId, {
      provenance: mergeScopeConfirmation(proposal.provenance, {
        pending: false,
        confirmed_scope: pending.recommendedScope,
        auto_applied: false,
        confirmed_by: userId,
      }),
    });

    return { confirmed: true };
  }

  async reject(proposalId: string): Promise<void> {
    const proposal = await this.loadProposal(proposalId);
    readPendingScopeConfirmation(proposal);

    await this.proposals.updateById(proposalId, {
      provenance: mergeScopeConfirmation(proposal.provenance, {
        pending: false,
        rejected: true,
      }),
    });
  }

  private async loadProposal(proposalId: string): Promise<ImprovementProposal> {
    const proposal = await this.proposals.findById(proposalId);
    if (!proposal) {
      throw new BadRequestException(`proposal ${proposalId} not found`);
    }
    return proposal;
  }

  private async findFirstDeniedScope(
    userId: string,
    scopeNodeIds: string[],
  ): Promise<string | null> {
    for (const scopeNodeId of scopeNodeIds) {
      const allowed = await this.authz.can(
        userId,
        SKILL_UPDATE_PERMISSION,
        scopeNodeId,
      );
      if (!allowed) {
        return scopeNodeId;
      }
    }
    return null;
  }

  private async findFirstStaleProjectScope(
    scopeIds: string[],
  ): Promise<string | null> {
    for (const scopeId of scopeIds) {
      if (!(await this.scopeService.isLiveScope(scopeId))) {
        return scopeId;
      }
    }
    return null;
  }
}

function resolveTargetScopeNodeIds(
  recommendedScope: PendingScopeConfirmation['recommendedScope'],
): string[] {
  const projects = recommendedScope?.projects ?? [];
  const projectScopeNodeIds =
    projects.length > 0 ? projects : [GLOBAL_SCOPE_NODE_ID];

  // `agents`/`workflows` widen visibility independently of `projects` (OR
  // semantics — see AgentSkillLibraryService.isVisible), so naming either
  // always requires an additional global-scope grant on top of whatever
  // per-project checks apply above.
  const namesAgentsOrWorkflows =
    (recommendedScope?.agents?.length ?? 0) > 0 ||
    (recommendedScope?.workflows?.length ?? 0) > 0;
  if (!namesAgentsOrWorkflows) {
    return projectScopeNodeIds;
  }

  return projectScopeNodeIds.includes(GLOBAL_SCOPE_NODE_ID)
    ? projectScopeNodeIds
    : [...projectScopeNodeIds, GLOBAL_SCOPE_NODE_ID];
}

function readPendingScopeConfirmation(
  proposal: ImprovementProposal,
): PendingScopeConfirmation {
  const materialization = readRecord(proposal.provenance?.materialization);
  const scopeConfirmation = readRecord(materialization?.scope_confirmation);
  if (!scopeConfirmation?.pending) {
    throw new BadRequestException(
      `proposal ${proposal.id} has no pending scope confirmation`,
    );
  }
  return {
    recommendedScope: readScope(scopeConfirmation.recommended_scope),
  };
}

function readScope(
  value: unknown,
): { projects: string[]; agents: string[]; workflows: string[] } | null {
  const record = readRecord(value);
  if (!record) return null;
  return {
    projects: readStringArray(record.projects),
    agents: readStringArray(record.agents),
    workflows: readStringArray(record.workflows),
  };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readSkillName(payload: Record<string, unknown>): string {
  const name = payload?.target_skill_name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new BadRequestException('proposal payload has no target_skill_name');
  }
  return name;
}

function mergeScopeConfirmation(
  provenance: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const materialization = readRecord(provenance?.materialization) ?? {};
  const scopeConfirmation =
    readRecord(materialization.scope_confirmation) ?? {};
  return {
    ...provenance,
    materialization: {
      ...materialization,
      scope_confirmation: { ...scopeConfirmation, ...update },
    },
  };
}

/**
 * Rewrite the target skill's frontmatter `scope` from a confirmed scope.
 * Mirrors `SkillCreateCompletionListener`'s private `buildScopedMarkdown` —
 * deliberately duplicated rather than shared across modules for the same
 * reason `readScopeId` is duplicated elsewhere in this codebase (small, pure,
 * module-local helper; not worth an extraction that adds an import edge
 * between two otherwise-independent services for four lines of logic).
 */
function buildScopedMarkdown(
  currentMarkdown: string,
  scope: { projects: string[]; agents: string[]; workflows: string[] } | null,
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
    if (scope.projects.length) scopeObj.projects = scope.projects;
    if (scope.agents.length) scopeObj.agents = scope.agents;
    if (scope.workflows.length) scopeObj.workflows = scope.workflows;
    if (Object.keys(scopeObj).length > 0) {
      frontmatter.scope = scopeObj;
    } else {
      delete frontmatter.scope;
    }
  }
  const serialized = yaml.dump(frontmatter).trimEnd();
  return `---\n${serialized}\n---${match[4]}`;
}
