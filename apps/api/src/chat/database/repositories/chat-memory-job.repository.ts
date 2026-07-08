import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ChatMemoryJob } from '../entities/chat-memory-job.entity';

@Injectable()
export class ChatMemoryJobRepository {
  constructor(
    @InjectRepository(ChatMemoryJob)
    private readonly repository: Repository<ChatMemoryJob>,
  ) {}

  async findById(id: string): Promise<ChatMemoryJob | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ChatMemoryJob | null> {
    return this.repository.findOne({
      where: { idempotency_key: idempotencyKey },
    });
  }

  async enqueue(data: Partial<ChatMemoryJob>): Promise<ChatMemoryJob> {
    const existing = data.idempotency_key
      ? await this.findByIdempotencyKey(data.idempotency_key)
      : null;

    if (existing) {
      return existing;
    }

    const entity = this.repository.create({
      status: 'pending',
      ...data,
    });
    return this.repository.save(entity);
  }

  async claimNextPending(now: Date): Promise<ChatMemoryJob | null> {
    const pending = await this.repository.findOne({
      where: {
        status: 'pending',
        scheduled_at: LessThanOrEqual(now),
      },
      order: {
        scheduled_at: 'ASC',
        created_at: 'ASC',
      },
    });

    if (!pending) {
      return null;
    }

    await this.repository.update(pending.id, {
      status: 'running',
      started_at: now,
      attempts: pending.attempts + 1,
      last_error: null,
    });

    return this.findById(pending.id);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<ChatMemoryJob>,
  ): Promise<ChatMemoryJob | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async countByStatus(
    status: 'pending' | 'running' | 'completed' | 'failed',
  ): Promise<number> {
    return this.repository.count({ where: { status } });
  }

  async listRecent(limit: number): Promise<ChatMemoryJob[]> {
    return this.repository.find({
      order: { created_at: 'DESC' },
      take: limit,
    });
  }
}
