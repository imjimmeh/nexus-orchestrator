import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ChatSessionMemory } from '../entities/chat-session-memory.entity';

interface ListSessionMemoryParams {
  profileId?: string;
  chatSessionId?: string;
  memoryType?: 'preference' | 'fact' | 'history';
  query?: string;
  onlyUndistilled?: boolean;
  limit: number;
  offset: number;
}

@Injectable()
export class ChatSessionMemoryRepository {
  constructor(
    @InjectRepository(ChatSessionMemory)
    private readonly repository: Repository<ChatSessionMemory>,
  ) {}

  async create(data: Partial<ChatSessionMemory>): Promise<ChatSessionMemory> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<ChatSessionMemory>,
  ): Promise<ChatSessionMemory | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async findById(id: string): Promise<ChatSessionMemory | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findRecentBySession(
    chatSessionId: string,
    limit: number,
  ): Promise<ChatSessionMemory[]> {
    return this.repository.find({
      where: { chat_session_id: chatSessionId },
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  async findUndistilledBySession(
    chatSessionId: string,
    limit: number,
  ): Promise<ChatSessionMemory[]> {
    return this.repository.find({
      where: {
        chat_session_id: chatSessionId,
        distilled_at: IsNull(),
      },
      order: { created_at: 'ASC' },
      take: limit,
    });
  }

  async countBySession(chatSessionId: string): Promise<number> {
    return this.repository.count({ where: { chat_session_id: chatSessionId } });
  }

  async markDistilled(
    memoryIds: string[],
    promotedProfileMemoryId: string | null,
  ): Promise<void> {
    if (memoryIds.length === 0) {
      return;
    }

    await this.repository.update(
      { id: In(memoryIds) },
      {
        distilled_at: new Date(),
        promoted_profile_memory_id: promotedProfileMemoryId,
      },
    );
  }

  async pruneBySession(
    chatSessionId: string,
    keepLatest: number,
  ): Promise<number> {
    if (keepLatest < 1) {
      const deleted = await this.repository.delete({
        chat_session_id: chatSessionId,
      });
      return deleted.affected ?? 0;
    }

    const staleRows = await this.repository
      .createQueryBuilder('memory')
      .select('memory.id', 'id')
      .where('memory.chat_session_id = :chatSessionId', { chatSessionId })
      .orderBy('memory.created_at', 'DESC')
      .offset(keepLatest)
      .getRawMany<{ id: string }>();

    if (staleRows.length === 0) {
      return 0;
    }

    const staleIds = staleRows.map((row) => row.id);
    const deleted = await this.repository.delete({ id: In(staleIds) });
    return deleted.affected ?? 0;
  }

  async list(params: ListSessionMemoryParams): Promise<{
    items: ChatSessionMemory[];
    total: number;
  }> {
    const qb = this.repository
      .createQueryBuilder('memory')
      .orderBy('memory.created_at', 'DESC')
      .take(params.limit)
      .skip(params.offset);

    if (params.profileId) {
      qb.andWhere('memory.profile_id = :profileId', {
        profileId: params.profileId,
      });
    }

    if (params.chatSessionId) {
      qb.andWhere('memory.chat_session_id = :chatSessionId', {
        chatSessionId: params.chatSessionId,
      });
    }

    if (params.memoryType) {
      qb.andWhere('memory.memory_type = :memoryType', {
        memoryType: params.memoryType,
      });
    }

    if (params.onlyUndistilled) {
      qb.andWhere('memory.distilled_at IS NULL');
    }

    if (params.query && params.query.length > 0) {
      qb.andWhere(
        '(memory.content ILIKE :pattern OR memory.normalized_content ILIKE :pattern)',
        {
          pattern: `%${params.query}%`,
        },
      );
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
