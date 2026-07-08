import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentWarRoomBlackboard } from '../entities/agent-war-room-blackboard.entity';

@Injectable()
export class AgentWarRoomBlackboardRepository {
  constructor(
    @InjectRepository(AgentWarRoomBlackboard)
    private readonly repository: Repository<AgentWarRoomBlackboard>,
  ) {}

  async create(
    data: Partial<AgentWarRoomBlackboard>,
  ): Promise<AgentWarRoomBlackboard> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findBySessionId(sessionId: string): Promise<AgentWarRoomBlackboard[]> {
    return this.repository.find({
      where: { session_id: sessionId },
      order: { version: 'ASC' },
    });
  }

  async findLatestBySessionId(
    sessionId: string,
  ): Promise<AgentWarRoomBlackboard | null> {
    return this.repository.findOne({
      where: { session_id: sessionId },
      order: { version: 'DESC' },
    });
  }
}
