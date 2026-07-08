import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanCoreLifecycleDeadLetterEntity } from "../entities/kanban-core-lifecycle-dead-letter.entity";
import type { CoreLifecycleDeadLetterInput } from "./kanban-core-lifecycle-dead-letter.types";

const DEFAULT_LIST_LIMIT = 100;

@Injectable()
export class KanbanCoreLifecycleDeadLetterRepository {
  constructor(
    @InjectRepository(KanbanCoreLifecycleDeadLetterEntity)
    private readonly repository: Repository<KanbanCoreLifecycleDeadLetterEntity>,
  ) {}

  saveDeadLetter(
    deadLetter: CoreLifecycleDeadLetterInput,
  ): Promise<KanbanCoreLifecycleDeadLetterEntity> {
    return this.repository.save(this.repository.create(deadLetter));
  }

  countRecent(): Promise<number> {
    return this.repository.count();
  }

  /** Lists dead-lettered rows, oldest first, optionally scoped to a stream key. */
  listDeadLetters(
    opts: { streamKey?: string; limit?: number } = {},
  ): Promise<KanbanCoreLifecycleDeadLetterEntity[]> {
    const { streamKey, limit = DEFAULT_LIST_LIMIT } = opts;
    return this.repository.find({
      ...(streamKey ? { where: { stream_key: streamKey } } : {}),
      order: { created_at: "ASC" },
      take: limit,
    });
  }

  async deleteDeadLetter(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
