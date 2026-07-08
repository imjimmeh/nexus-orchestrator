import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentWarRoomParticipant } from '../entities/agent-war-room-participant.entity';

@Injectable()
export class AgentWarRoomParticipantRepository {
  constructor(
    @InjectRepository(AgentWarRoomParticipant)
    private readonly repository: Repository<AgentWarRoomParticipant>,
  ) {}

  async create(
    data: Partial<AgentWarRoomParticipant>,
  ): Promise<AgentWarRoomParticipant> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findBySessionId(sessionId: string): Promise<AgentWarRoomParticipant[]> {
    return this.repository.find({
      where: { session_id: sessionId },
      order: {
        created_at: 'ASC',
      },
    });
  }

  async findBySessionAndAgentProfile(
    sessionId: string,
    agentProfile: string,
  ): Promise<AgentWarRoomParticipant | null> {
    return this.repository.findOne({
      where: {
        session_id: sessionId,
        agent_profile: agentProfile,
      },
    });
  }

  async upsertBySessionAndAgentProfile(
    sessionId: string,
    agentProfile: string,
    data: Partial<AgentWarRoomParticipant>,
  ): Promise<AgentWarRoomParticipant> {
    const existing = await this.findBySessionAndAgentProfile(
      sessionId,
      agentProfile,
    );
    if (!existing) {
      return this.create({
        ...data,
        session_id: sessionId,
        agent_profile: agentProfile,
      });
    }

    Object.assign(existing, data);
    existing.session_id = sessionId;
    existing.agent_profile = agentProfile;
    return this.repository.save(existing);
  }
}
