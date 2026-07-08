import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { KanbanCoreRunProjectionEntity } from "../entities/kanban-core-run-projection.entity";

@Injectable()
export class KanbanCoreRunProjectionRepository {
  constructor(
    @InjectRepository(KanbanCoreRunProjectionEntity)
    private readonly repository: Repository<KanbanCoreRunProjectionEntity>,
  ) {}

  save(
    projection: Partial<KanbanCoreRunProjectionEntity>,
  ): Promise<KanbanCoreRunProjectionEntity> {
    return this.repository.save(this.repository.create(projection));
  }

  findByRunId(runId: string): Promise<KanbanCoreRunProjectionEntity | null> {
    return this.repository.findOne({
      where: {
        run_id: runId,
      },
    });
  }

  findByproject_id(
    project_id: string,
  ): Promise<KanbanCoreRunProjectionEntity[]> {
    return this.repository.find({
      where: {
        project_id: project_id,
      },
      order: {
        occurred_at: "DESC",
      },
    });
  }

  async hasActiveProjectWorkflowRun(
    project_id: string,
    workflow_id: string,
  ): Promise<boolean> {
    const activeRunCount = await this.repository.count({
      where: {
        project_id: project_id,
        workflow_id: workflow_id,
        status: In(["PENDING", "RUNNING"]),
      },
    });

    return activeRunCount > 0;
  }

  async deleteByproject_id(project_id: string): Promise<void> {
    await this.repository.delete({ project_id: project_id });
  }
}
