import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { KanbanOrchestrationFactEntity } from "../entities/kanban-orchestration-fact.entity";
import type { PublishOrchestrationFactInput } from "../../orchestration/control-plane/control-plane.types";

@Injectable()
export class KanbanOrchestrationFactRepository {
  constructor(
    @InjectRepository(KanbanOrchestrationFactEntity)
    private readonly repository: Repository<KanbanOrchestrationFactEntity>,
  ) {}

  publishFact(
    input: PublishOrchestrationFactInput,
  ): Promise<KanbanOrchestrationFactEntity> {
    const now = new Date();
    return this.repository.save(
      this.repository.create({
        project_id: input.projectId,
        fact_type: input.factType,
        subject_kind: input.subjectKind,
        subject_id: input.subjectId,
        source_type: input.sourceType,
        source_id: input.sourceId,
        confidence: input.confidence,
        freshness_status: "fresh",
        observed_at: input.observedAt ?? now,
        expires_at: input.expiresAt ?? null,
        invalidated_at: null,
        invalidated_by_event_id: null,
        payload_json: input.payload,
        evidence: input.evidence ?? [],
        metadata: input.metadata ?? null,
      }),
    );
  }

  listFreshByTypes(
    projectId: string,
    factTypes: string[],
    now: Date,
  ): Promise<KanbanOrchestrationFactEntity[]> {
    if (factTypes.length === 0) return Promise.resolve([]);

    return this.repository
      .createQueryBuilder("fact")
      .where("fact.project_id = :projectId", { projectId })
      .andWhere("fact.fact_type IN (:...factTypes)", { factTypes })
      .andWhere("fact.invalidated_at IS NULL")
      .andWhere("fact.freshness_status = :fresh", { fresh: "fresh" })
      .andWhere("(fact.expires_at IS NULL OR fact.expires_at > :now)", { now })
      .orderBy("fact.observed_at", "DESC")
      .getMany();
  }

  listFreshByTypesAndSubjects(
    projectId: string,
    requirements: Array<{
      readonly factType: string;
      readonly subjectKind: string;
      readonly subjectIds: string[];
    }>,
    now: Date,
  ): Promise<KanbanOrchestrationFactEntity[]> {
    if (requirements.length === 0) return Promise.resolve([]);

    const qb = this.repository
      .createQueryBuilder("fact")
      .where("fact.project_id = :projectId", { projectId })
      .andWhere("fact.invalidated_at IS NULL")
      .andWhere("fact.freshness_status = :fresh", { fresh: "fresh" })
      .andWhere("(fact.expires_at IS NULL OR fact.expires_at > :now)", { now });

    const orConditions: string[] = [];
    const params: Record<string, unknown> = { projectId, now, fresh: "fresh" };

    for (const [i, req] of requirements.entries()) {
      if (req.subjectIds.length === 0) {
        // Project-level: match fact_type only
        orConditions.push(`fact.fact_type = :ft${i}`);
        params[`ft${i}`] = req.factType;
      } else {
        // Subject-level: match fact_type + subject_kind + subject_id IN (...)
        orConditions.push(
          `(fact.fact_type = :ft${i} AND fact.subject_kind = :sk${i} AND fact.subject_id IN (:...sids${i}))`,
        );
        params[`ft${i}`] = req.factType;
        params[`sk${i}`] = req.subjectKind;
        params[`sids${i}`] = req.subjectIds;
      }
    }

    qb.andWhere(`(${orConditions.join(" OR ")})`, params);
    return qb.orderBy("fact.observed_at", "DESC").getMany();
  }

  listByProject(projectId: string): Promise<KanbanOrchestrationFactEntity[]> {
    return this.repository.find({
      where: { project_id: projectId },
      order: { observed_at: "DESC" },
    });
  }

  async invalidateBySubject(
    projectId: string,
    subjectKind: string,
    subjectId: string,
    eventId: string,
    invalidatedAt: Date,
  ): Promise<void> {
    await this.repository.update(
      {
        project_id: projectId,
        subject_kind: subjectKind,
        subject_id: subjectId,
        freshness_status: In(["fresh", "stale"]),
      },
      {
        freshness_status: "invalidated",
        invalidated_at: invalidatedAt,
        invalidated_by_event_id: eventId,
      },
    );
  }
}
