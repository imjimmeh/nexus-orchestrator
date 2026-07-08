import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanProjectEntity } from "../entities/kanban-project.entity";

@Injectable()
export class KanbanProjectRepository {
  constructor(
    @InjectRepository(KanbanProjectEntity)
    private readonly repository: Repository<KanbanProjectEntity>,
  ) {}

  save(project: Partial<KanbanProjectEntity>): Promise<KanbanProjectEntity> {
    return this.repository.save(this.repository.create(project));
  }

  findAll(): Promise<KanbanProjectEntity[]> {
    return this.repository.find({
      order: {
        created_at: "ASC",
      },
    });
  }

  findById(id: string): Promise<KanbanProjectEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async removeById(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  async removeByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.repository
      .createQueryBuilder()
      .delete()
      .from(KanbanProjectEntity)
      .where("id IN (:...ids)", { ids })
      .execute();
  }
}
