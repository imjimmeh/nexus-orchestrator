import { Injectable, NotFoundException } from '@nestjs/common';
import { AgentProfileRepository } from '../database/repositories/agent-profile.repository';
import { AgentProfileSkillBindingRepository } from '../database/repositories/agent-profile-skill-binding.repository';
import { ScopeService } from '../../scope/scope.service';

/**
 * Runtime binding lifecycle for the "project" and "project+agent" skill
 * scope tiers. Bindings live in `agent_profile_skill_bindings` rather than
 * `agent_profiles.assigned_skills` so a profile reseed never clobbers
 * assignments applied outside of source control (e.g. by the
 * self-improvement pipeline's appliers) — same discipline as
 * `WorkflowSkillBindingService` for workflow-level bindings.
 *
 * A binding with a null `agent_profile_id` applies to any agent profile
 * operating under its `scope_node_id` (project tier); a binding with a
 * resolved `agent_profile_id` applies only to that profile within that scope
 * (project+agent tier). Ancestor scopes reach their descendants via
 * `ScopeService.getAncestorIds`, the same closure-table lookup
 * `AuthorizationService` already uses for permission inheritance — an
 * org-level binding is visible to every project under that org.
 */
@Injectable()
export class AgentProfileSkillBindingService {
  constructor(
    private readonly repo: AgentProfileSkillBindingRepository,
    private readonly profiles: AgentProfileRepository,
    private readonly scopeService: ScopeService,
  ) {}

  async addProjectScopedBinding(input: {
    skillName: string;
    scopeNodeId: string;
    provenance?: Record<string, unknown>;
  }): Promise<void> {
    await this.assertLiveScope(input.scopeNodeId);
    await this.repo.upsert({
      agent_profile_id: null,
      scope_node_id: input.scopeNodeId,
      skill_name: input.skillName,
      provenance: input.provenance ?? null,
    });
  }

  async addProfileScopedBinding(input: {
    skillName: string;
    scopeNodeId: string;
    profileName: string;
    provenance?: Record<string, unknown>;
  }): Promise<void> {
    const profile = await this.profiles.findByName(input.profileName);
    if (!profile) {
      throw new NotFoundException(
        `Agent profile with name ${input.profileName} not found`,
      );
    }
    await this.assertLiveScope(input.scopeNodeId);
    await this.repo.upsert({
      agent_profile_id: profile.id,
      scope_node_id: input.scopeNodeId,
      skill_name: input.skillName,
      provenance: input.provenance ?? null,
    });
  }

  /** Throws NotFoundException if scopeNodeId does not resolve to a live scope node. */
  private async assertLiveScope(scopeNodeId: string): Promise<void> {
    const isLive = await this.scopeService.isLiveScope(scopeNodeId);
    if (!isLive) {
      throw new NotFoundException(
        `Scope node ${scopeNodeId} not found or archived`,
      );
    }
  }

  async listApplicableSkillNames(params: {
    scopeNodeId?: string;
    agentProfileName?: string;
  }): Promise<string[]> {
    if (!params.scopeNodeId) {
      return [];
    }

    const ancestorIds = await this.scopeService.getAncestorIds(
      params.scopeNodeId,
    );

    let profileId: string | null = null;
    if (params.agentProfileName) {
      const profile = await this.profiles.findByName(params.agentProfileName);
      profileId = profile?.id ?? null;
    }

    const rows = await this.repo.listForScopeNodeIds(ancestorIds);
    return rows
      .filter(
        (row) =>
          row.agent_profile_id === null || row.agent_profile_id === profileId,
      )
      .map((row) => row.skill_name);
  }
}
