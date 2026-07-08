import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import type {
  ImprovementProposalKind,
  ImprovementProposalStatus,
} from '@nexus/core';
import { ImprovementProposal } from '../entities/improvement-proposal.entity';
import type { ListImprovementProposalsFilter } from './improvement-proposal.repository.types';

@Injectable()
export class ImprovementProposalRepository {
  constructor(
    @InjectRepository(ImprovementProposal)
    private readonly repo: Repository<ImprovementProposal>,
  ) {}

  async create(
    input: Partial<ImprovementProposal>,
  ): Promise<ImprovementProposal> {
    const entity = this.repo.create({
      status: 'pending',
      occurrence_count: 1,
      provenance: {},
      rollback_data: null,
      applied_at: null,
      rolled_back_at: null,
      ...input,
    });
    return this.repo.save(entity);
  }

  async findById(id: string): Promise<ImprovementProposal | null> {
    return this.repo.findOne({ where: { id } });
  }

  async list(
    filter: ListImprovementProposalsFilter,
  ): Promise<{ data: ImprovementProposal[]; total: number }> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 50;
    const qb = this.repo
      .createQueryBuilder('p')
      .orderBy('p.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    if (filter.kinds?.length) {
      qb.andWhere('p.kind IN (:...kinds)', { kinds: filter.kinds });
    }
    if (filter.statuses?.length) {
      qb.andWhere('p.status IN (:...statuses)', { statuses: filter.statuses });
    }
    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async updateById(
    id: string,
    patch: Partial<ImprovementProposal>,
  ): Promise<ImprovementProposal | null> {
    await this.repo.update(
      { id },
      patch as Parameters<typeof this.repo.update>[1],
    );
    return this.findById(id);
  }

  async updatePendingById(
    id: string,
    patch: Partial<ImprovementProposal>,
  ): Promise<ImprovementProposal | null> {
    const result = await this.repo.update(
      { id, status: 'pending' },
      patch as Parameters<typeof this.repo.update>[1],
    );
    if (!result.affected) {
      return null;
    }
    return this.findById(id);
  }

  async bumpOccurrence(id: string): Promise<ImprovementProposal | null> {
    await this.repo.increment({ id }, 'occurrence_count', 1);
    return this.findById(id);
  }

  /**
   * Find the most recent `pending` `skill_create` proposal targeting the
   * given skill name, if one exists. Backs `create_skill_proposal` tool
   * idempotency: agents retry tool calls across turns, so a repeated
   * request for the same target skill must resolve to the existing
   * pending proposal rather than creating a duplicate.
   */
  async findPendingSkillCreateByTargetName(
    targetSkillName: string,
  ): Promise<ImprovementProposal | null> {
    return this.repo
      .createQueryBuilder('p')
      .where('p.kind = :kind', {
        kind: 'skill_create' as ImprovementProposalKind,
      })
      .andWhere('p.status = :status', {
        status: 'pending' as ImprovementProposalStatus,
      })
      .andWhere("p.payload ->> 'target_skill_name' = :targetSkillName", {
        targetSkillName,
      })
      .orderBy('p.created_at', 'DESC')
      .limit(1)
      .getOne();
  }

  /**
   * Count proposals matching the given statuses, optionally narrowed to one
   * or more kinds (e.g. `skill_create`-only counts for the learning
   * dashboard, which historically only ever saw skill proposals).
   */
  async countByStatuses(
    statuses: ImprovementProposalStatus[],
    kinds?: ImprovementProposalKind[],
  ): Promise<number> {
    if (statuses.length === 0) {
      return 0;
    }

    return this.repo.count({
      where: {
        status: In(statuses),
        ...(kinds && kinds.length > 0 ? { kind: In(kinds) } : {}),
      },
    });
  }

  /**
   * Recent proposals of a given kind restricted to the given statuses,
   * within the last `sinceDays` days. Backs intake-time dedup (e.g.
   * `CodeChangeDedupService`), which needs a bounded candidate window rather
   * than scanning the full proposal history.
   */
  async findRecentByKindAndStatuses(
    kind: ImprovementProposalKind,
    statuses: ImprovementProposalStatus[],
    sinceDays: number,
  ): Promise<ImprovementProposal[]> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    return this.repo.find({
      where: { kind, status: In(statuses), created_at: MoreThan(since) },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * Count `skill_assignment` proposals in the given window whose payload
   * targets the given skill on the given `(workflowName, stepId)` pair.
   * Backs the self-improvement control plane `SkillBindingUsageCard`
   * `reuseCount7d` figure — i.e. how many operator- or pipeline-directed
   * `skill_assignment` proposals in the window would land this binding.
   *
   * The containment filter matches the `payload.assignment_targets`
   * (snake_case) shape written by `ImprovementProposalsController.create`
   * and the retrospective router; passing any other shape would silently
   * under-count reuse and surface a falsely-zero `reuseCount7d` on the
   * card. `stepId` is optional — pass `null` for a workflow-scoped
   * binding (the JSONB array entry then omits the key).
   */
  async countSkillAssignmentReuseSince(opts: {
    since: Date;
    skillName: string;
    workflowName: string;
    stepId: string | null;
  }): Promise<number> {
    const containment: Array<Record<string, unknown>> = [
      { type: 'workflow_step', workflowName: opts.workflowName },
    ];
    if (opts.stepId !== null) {
      containment[0].stepId = opts.stepId;
    }
    return this.repo
      .createQueryBuilder('p')
      .where('p.kind = :kind', { kind: 'skill_assignment' })
      .andWhere('p.created_at >= :since', { since: opts.since })
      .andWhere("p.payload ->> 'skillName' = :skillName", {
        skillName: opts.skillName,
      })
      .andWhere("p.payload -> 'assignment_targets' @> :assignmentTargets", {
        assignmentTargets: containment,
      })
      .getCount();
  }
}
