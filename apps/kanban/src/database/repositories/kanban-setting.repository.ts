import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanSettingEntity } from "../entities/kanban-setting.entity";

@Injectable()
export class KanbanSettingRepository {
  constructor(
    @InjectRepository(KanbanSettingEntity)
    private readonly repository: Repository<KanbanSettingEntity>,
  ) {}

  findAll(): Promise<KanbanSettingEntity[]> {
    return this.repository.find({ order: { key: "ASC" } });
  }

  findByKey(key: string): Promise<KanbanSettingEntity | null> {
    return this.repository.findOne({ where: { key } });
  }

  async upsert(
    key: string,
    value: unknown,
    description?: string | null,
  ): Promise<KanbanSettingEntity> {
    const existing = await this.findByKey(key);
    return this.repository.save(
      this.repository.create({
        key,
        value,
        description:
          description === undefined
            ? (existing?.description ?? null)
            : description,
        createdAt: existing?.createdAt,
        updatedAt: existing?.updatedAt,
      }),
    );
  }
}
