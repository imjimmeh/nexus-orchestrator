import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMemoryEvent } from '../entities/chat-memory-event.entity';

@Injectable()
export class ChatMemoryEventRepository {
  constructor(
    @InjectRepository(ChatMemoryEvent)
    private readonly repository: Repository<ChatMemoryEvent>,
  ) {}

  async create(data: Partial<ChatMemoryEvent>): Promise<ChatMemoryEvent> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async listRecent(limit: number): Promise<ChatMemoryEvent[]> {
    return this.repository.find({
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  async countByEventType(eventType: string): Promise<number> {
    return this.repository.count({ where: { event_type: eventType } });
  }
}
