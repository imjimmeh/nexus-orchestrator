import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ChatProfileMemory } from '../entities/chat-profile-memory.entity';

interface ListProfileMemoryParams {
  profileId?: string;
  chatSessionId?: string;
  memoryType?: 'preference' | 'fact' | 'history';
  query?: string;
  includeArchived?: boolean;
  limit: number;
  offset: number;
}

@Injectable()
export class ChatProfileMemoryRepository {
  constructor(
    @InjectRepository(ChatProfileMemory)
    private readonly repository: Repository<ChatProfileMemory>,
  ) {}

  async create(data: Partial<ChatProfileMemory>): Promise<ChatProfileMemory> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(
    id: string,
    data: Partial<ChatProfileMemory>,
  ): Promise<ChatProfileMemory | null> {
    await this.repository.update(
      id,
      data as QueryDeepPartialEntity<ChatProfileMemory>,
    );
    return this.findById(id);
  }

  async findById(id: string): Promise<ChatProfileMemory | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findActiveByProfile(
    profileId: string,
    limit: number,
  ): Promise<ChatProfileMemory[]> {
    return this.repository.find({
      where: {
        profile_id: profileId,
        archived_at: IsNull(),
      },
      order: { updated_at: 'DESC' },
      take: limit,
    });
  }

  async findAllActiveByProfile(
    profileId: string,
  ): Promise<ChatProfileMemory[]> {
    return this.repository.find({
      where: {
        profile_id: profileId,
        archived_at: IsNull(),
      },
      order: { updated_at: 'DESC' },
    });
  }

  async findByNormalized(params: {
    profileId: string;
    normalizedContent: string;
    memoryType: 'preference' | 'fact' | 'history';
  }): Promise<ChatProfileMemory | null> {
    return this.repository.findOne({
      where: {
        profile_id: params.profileId,
        normalized_content: params.normalizedContent,
        memory_type: params.memoryType,
        archived_at: IsNull(),
      },
    });
  }

  async touchAccessed(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) {
      return;
    }

    await this.repository.update(
      { id: In(memoryIds) },
      {
        last_accessed_at: new Date(),
      },
    );
  }

  async archive(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) {
      return;
    }

    await this.repository.update(
      { id: In(memoryIds) },
      {
        archived_at: new Date(),
      },
    );
  }

  async list(params: ListProfileMemoryParams): Promise<{
    items: ChatProfileMemory[];
    total: number;
  }> {
    const qb = this.repository
      .createQueryBuilder('memory')
      .orderBy('memory.updated_at', 'DESC')
      .take(params.limit)
      .skip(params.offset);

    if (params.profileId) {
      qb.andWhere('memory.profile_id = :profileId', {
        profileId: params.profileId,
      });
    }

    if (params.chatSessionId) {
      qb.andWhere('memory.last_chat_session_id = :chatSessionId', {
        chatSessionId: params.chatSessionId,
      });
    }

    if (params.memoryType) {
      qb.andWhere('memory.memory_type = :memoryType', {
        memoryType: params.memoryType,
      });
    }

    if (!params.includeArchived) {
      qb.andWhere('memory.archived_at IS NULL');
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
