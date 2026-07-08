import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanCoreLifecycleCursorEntity } from "../entities/kanban-core-lifecycle-cursor.entity";

@Injectable()
export class KanbanCoreLifecycleCursorRepository {
  constructor(
    @InjectRepository(KanbanCoreLifecycleCursorEntity)
    private readonly repository: Repository<KanbanCoreLifecycleCursorEntity>,
  ) {}

  getCursor(
    consumerName: string,
  ): Promise<KanbanCoreLifecycleCursorEntity | null> {
    return this.repository.findOne({ where: { consumer_name: consumerName } });
  }

  saveCursor(
    consumerName: string,
    streamId: string,
    streamKey = "stream:core:lifecycle",
  ): Promise<KanbanCoreLifecycleCursorEntity> {
    return this.repository.save(
      this.repository.create({
        consumer_name: consumerName,
        stream_key: streamKey,
        stream_id: streamId,
      }),
    );
  }
}
