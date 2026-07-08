import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentWarRoomSession } from '../entities/agent-war-room-session.entity';

@Injectable()
export class AgentWarRoomSessionRepository {
  constructor(
    @InjectRepository(AgentWarRoomSession)
    private readonly repository: Repository<AgentWarRoomSession>,
  ) {}

  async create(
    data: Partial<AgentWarRoomSession>,
  ): Promise<AgentWarRoomSession> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findBySessionId(
    sessionId: string,
  ): Promise<AgentWarRoomSession | null> {
    return this.repository.findOne({ where: { session_id: sessionId } });
  }

  async updateBySessionId(
    sessionId: string,
    data: Partial<AgentWarRoomSession>,
  ): Promise<AgentWarRoomSession | null> {
    const session = await this.findBySessionId(sessionId);
    if (!session) {
      return null;
    }

    Object.assign(session, data);
    return this.repository.save(session);
  }

  async findByRun(
    workflowRunId: string,
    params?: {
      activeOnly?: boolean;
    },
  ): Promise<AgentWarRoomSession[]> {
    const queryBuilder = this.repository
      .createQueryBuilder('session')
      .where('session.workflow_run_id = :workflowRunId', { workflowRunId });

    if (params?.activeOnly) {
      queryBuilder.andWhere('session.status = :status', { status: 'open' });
    }

    return queryBuilder.orderBy('session.opened_at', 'DESC').getMany();
  }
}
