import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { DeleteResult } from "typeorm";
import { Repository } from "typeorm";
import { KanbanProjectCharterItemEntity } from "../entities/kanban-project-charter-item.entity";

@Injectable()
export class KanbanProjectCharterItemRepository {
  constructor(
    @InjectRepository(KanbanProjectCharterItemEntity)
    private readonly repository: Repository<KanbanProjectCharterItemEntity>,
  ) {}

  listByProject(projectId: string): Promise<KanbanProjectCharterItemEntity[]> {
    return this.repository.find({
      where: { project_id: projectId },
      order: { created_at: "ASC" },
    });
  }

  create(input: {
    project_id: string;
    category: string;
    content: string;
    memory_type: string;
    source: string;
  }): Promise<KanbanProjectCharterItemEntity> {
    return this.repository.save(
      this.repository.create({ ...input, version: 1 }),
    );
  }

  async updateContent(
    id: string,
    projectId: string,
    content: string,
  ): Promise<KanbanProjectCharterItemEntity | null> {
    const existing = await this.repository.findOne({
      where: { id, project_id: projectId },
    });
    if (!existing) return null;
    existing.content = content;
    return this.repository.save(existing);
  }

  async deleteById(id: string, projectId: string): Promise<boolean> {
    const result: DeleteResult = await this.repository.delete({
      id,
      project_id: projectId,
    });
    return (result.affected ?? 0) > 0;
  }
}
