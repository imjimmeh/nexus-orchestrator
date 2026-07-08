import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Skill } from '../database/entities/skill.entity';
import { ScopedConfigResolver } from '../../config-resolution/scoped-config-resolver.service';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';
import type { EffectiveConfig } from '../../config-resolution/effective-config.types';
import { GitOpsEditPolicyService } from '../../gitops/gitops-edit-policy.service';
import { GitOpsPendingChangeService } from '../../gitops/gitops-pending-change.service';

@Injectable()
export class SkillService {
  constructor(
    private readonly resolver: ScopedConfigResolver,
    @InjectRepository(Skill) private readonly repo: Repository<Skill>,
    @Optional()
    private readonly gitOpsEditPolicy?: GitOpsEditPolicyService,
    @Optional()
    private readonly gitOpsPendingChanges?: GitOpsPendingChangeService,
  ) {}

  resolve(
    name: string,
    scopeNodeId: string | null,
  ): Promise<EffectiveConfig<Skill>> {
    return this.resolver.resolve<Skill>(
      'skill',
      name,
      scopeNodeId ?? GLOBAL_SCOPE_NODE_ID,
    );
  }

  async createScopedOverride(
    baseName: string,
    scopeNodeId: string,
    skillMarkdown: string,
    actorId?: string,
  ): Promise<Skill> {
    const base = await this.repo.findOne({
      where: { name: baseName, scope_node_id: IsNull() },
    });
    if (!base) throw new NotFoundException(`Skill '${baseName}' not found`);
    const decision = await this.gitOpsEditPolicy?.evaluateCreate({
      objectType: 'skill',
      scopeNodeId,
    });
    if (decision) {
      this.gitOpsEditPolicy?.assertAllowed(decision);
    }
    const {
      id: _id,
      created_at: _created_at,
      updated_at: _updated_at,
      ...cloneable
    } = base;
    const created = await this.repo.save(
      this.repo.create({
        ...cloneable,
        skill_markdown: skillMarkdown,
        scope_node_id: scopeNodeId,
        base_ref: base.id,
        source: 'admin' as const,
        locked: false,
      }),
    );
    if (decision?.action === 'allow_with_pending_change' && decision.binding) {
      await this.gitOpsPendingChanges?.recordConfigObjectChange({
        binding: decision.binding,
        objectType: 'skill',
        scopeNodeId,
        name: base.name,
        changeType: 'create',
        payload: { skill_markdown: skillMarkdown },
        actorId,
      });
    }

    return created;
  }

  async list(scopeNodeId?: string): Promise<Skill[]> {
    if (scopeNodeId) {
      return this.repo.find({ where: { scope_node_id: scopeNodeId } });
    }
    return this.repo.find({ where: { scope_node_id: IsNull() } });
  }

  async findByName(name: string): Promise<Skill | null> {
    return this.repo.findOne({ where: { name, scope_node_id: IsNull() } });
  }

  /**
   * Upserts a GLOBAL-scope (`scope_node_id IS NULL`) `skills` row for
   * `name`. The unique index on `(name, scope_node_id)` does not dedupe
   * `NULL` scope values (standard btree semantics), so — mirroring
   * {@link findByName} — this looks the row up explicitly rather than
   * relying on an `ON CONFLICT` upsert.
   *
   * Used by {@link import('./agent-skills.service').AgentSkillsService.upsertSkill}
   * to keep the `skills` DB corpus (read by
   * `LearningRouterService.loadSkillCorpus` / `skillExists`) in sync with
   * every materialized file-based skill, so the router never proposes a
   * duplicate `skill_new` for a skill that already exists on disk.
   */
  async upsert(params: {
    name: string;
    description: string;
    skillMarkdown: string;
    source: Skill['source'];
  }): Promise<Skill> {
    const existing = await this.repo.findOne({
      where: { name: params.name, scope_node_id: IsNull() },
    });

    if (existing) {
      existing.description = params.description;
      existing.skill_markdown = params.skillMarkdown;
      existing.source = params.source;
      return this.repo.save(existing);
    }

    return this.repo.save(
      this.repo.create({
        name: params.name,
        description: params.description,
        skill_markdown: params.skillMarkdown,
        scope_node_id: null,
        source: params.source,
      }),
    );
  }
}
