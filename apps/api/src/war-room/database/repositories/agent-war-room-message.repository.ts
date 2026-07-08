import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentWarRoomMessage } from '../entities/agent-war-room-message.entity';

@Injectable()
export class AgentWarRoomMessageRepository {
  constructor(
    @InjectRepository(AgentWarRoomMessage)
    private readonly repository: Repository<AgentWarRoomMessage>,
  ) {}

  async create(
    data: Partial<AgentWarRoomMessage>,
  ): Promise<AgentWarRoomMessage> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findBySessionId(sessionId: string): Promise<AgentWarRoomMessage[]> {
    return this.repository.find({
      where: { session_id: sessionId },
      order: { created_at: 'ASC' },
    });
  }

  async countBySessionId(sessionId: string): Promise<number> {
    return this.repository.count({
      where: { session_id: sessionId },
    });
  }
}
