import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  AgentProfileChangePayloadSchema,
  UpdateAgentProfileSchema,
  type AgentProfilePatch,
} from '@nexus/core';
import { AiConfigAdminService } from '../../ai-config/ai-config-admin.service';
import { AgentSkillsService } from '../../ai-config/services/agent-skills.service';
import { AgentProfileRepository } from '../../ai-config/database/repositories/agent-profile.repository';
import type { AgentProfile } from '../../ai-config/database/entities/agent-profile.entity';
import { ImprovementProposal } from '../database/entities/improvement-proposal.entity';
import {
  type IImprovementApplier,
  type ImprovementApplyResult,
} from './improvement-applier.types';
import {
  buildImprovementOverridesMarker,
  persistRollbackSnapshotOnce,
} from './definition-change.helpers';
import {
  buildProfileRollbackSnapshot,
  buildProfileUpdateRequest,
  parseProfileRollbackSnapshot,
  splitRollbackRestore,
} from './agent-profile-change.applier.helpers';

/**
 * `agent_profile_change` applier — mutates an existing agent profile's
 * prompt/model/thinking-level/tool-policy/assigned-skills per a proposal's
 * `AgentProfilePatch` (EPIC-D). Reuses `AiConfigAdminService.updateAgentProfile`
 * (the same path the admin UI's human edits take, including its IAM-policy
 * refresh) and `AgentSkillsService` for skill (un)assignment rather than
 * re-implementing profile persistence.
 *
 * Apply order is load-bearing (see `apply()`): the pre-mutation snapshot is
 * persisted, then the reseed-protection `overrides` marker is set, BOTH
 * before any field is actually changed — so a crash mid-apply always leaves
 * either an untouched-and-unpinned profile (proposal payload was invalid /
 * profile missing) or a pinned-but-not-yet-fully-changed profile that
 * `rollback()` can safely unwind, never an applied-but-unpinned change that a
 * reseed could silently clobber.
 */
@Injectable()
export class AgentProfileChangeApplier implements IImprovementApplier {
  readonly kind = 'agent_profile_change' as const;

  constructor(
    private readonly aiConfigAdmin: AiConfigAdminService,
    private readonly agentSkills: AgentSkillsService,
    private readonly profileRepository: AgentProfileRepository,
    @InjectRepository(ImprovementProposal)
    private readonly proposals: Repository<ImprovementProposal>,
  ) {}

  async apply(proposal: ImprovementProposal): Promise<ImprovementApplyResult> {
    const parsedPayload = AgentProfileChangePayloadSchema.safeParse(
      proposal.payload,
    );
    if (!parsedPayload.success) {
      return {
        ok: false,
        detail: `invalid agent_profile_change payload: ${parsedPayload.error.message}`,
      };
    }
    const payload = parsedPayload.data;

    const profile = await this.profileRepository.findByName(
      payload.profileName,
    );
    if (!profile) {
      return {
        ok: false,
        detail: `agent profile not found: ${payload.profileName}`,
        unrouted: true,
      };
    }

    try {
      await persistRollbackSnapshotOnce(
        this.proposals,
        proposal,
        buildProfileRollbackSnapshot(profile) as unknown as Record<
          string,
          unknown
        >,
      );

      await this.profileRepository.update(profile.id, {
        overrides: buildImprovementOverridesMarker(
          profile.overrides ?? null,
          proposal.id,
          new Date().toISOString(),
        ),
      } as QueryDeepPartialEntity<AgentProfile>);

      const updateRequest = UpdateAgentProfileSchema.parse(
        buildProfileUpdateRequest(profile, payload.patch),
      );
      if (Object.keys(updateRequest).length > 0) {
        await this.aiConfigAdmin.updateAgentProfile(profile.id, updateRequest);
      }

      await this.applyAssignedSkillsChange(profile.id, payload.patch);

      return { ok: true, detail: payload.changeSummary };
    } catch (err: unknown) {
      return { ok: false, detail: describeError(err) };
    }
  }

  async rollback(proposal: ImprovementProposal): Promise<void> {
    const snapshot = parseProfileRollbackSnapshot(proposal.rollback_data);
    const { serviceFields, rawFields } = splitRollbackRestore(snapshot);

    if (Object.keys(serviceFields).length > 0) {
      await this.aiConfigAdmin.updateAgentProfile(
        snapshot.profileId,
        serviceFields,
      );
    }
    await this.profileRepository.update(
      snapshot.profileId,
      rawFields as QueryDeepPartialEntity<AgentProfile>,
    );
  }

  private async applyAssignedSkillsChange(
    profileId: string,
    patch: AgentProfilePatch,
  ): Promise<void> {
    const change = patch.assigned_skills;
    if (!change) {
      return;
    }
    if (change.add && change.add.length > 0) {
      await this.agentSkills.addProfileSkills(profileId, change.add);
    }
    if (change.remove && change.remove.length > 0) {
      await this.agentSkills.removeProfileSkills(profileId, change.remove);
    }
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
