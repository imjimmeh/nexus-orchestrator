import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMemoryPromotionAudit } from '../entities/chat-memory-promotion-audit.entity';

@Injectable()
export class ChatMemoryPromotionAuditRepository {
  constructor(
    @InjectRepository(ChatMemoryPromotionAudit)
    private readonly repository: Repository<ChatMemoryPromotionAudit>,
  ) {}

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<ChatMemoryPromotionAudit | null> {
    return this.repository.findOne({
      where: { idempotency_key: idempotencyKey },
    });
  }

  async create(
    data: Partial<ChatMemoryPromotionAudit>,
  ): Promise<ChatMemoryPromotionAudit> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async countByAction(
    action: 'promoted' | 'updated' | 'archived',
  ): Promise<number> {
    return this.repository.count({ where: { action } });
  }
}
