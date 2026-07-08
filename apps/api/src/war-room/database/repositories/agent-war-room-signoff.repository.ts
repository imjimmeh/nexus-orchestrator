import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentWarRoomSignoff } from '../entities/agent-war-room-signoff.entity';
import type { AgentWarRoomParticipantRole } from '../entities/agent-war-room-participant.entity';

@Injectable()
export class AgentWarRoomSignoffRepository {
  constructor(
    @InjectRepository(AgentWarRoomSignoff)
    private readonly repository: Repository<AgentWarRoomSignoff>,
  ) {}

  async create(
    data: Partial<AgentWarRoomSignoff>,
  ): Promise<AgentWarRoomSignoff> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findBySessionId(sessionId: string): Promise<AgentWarRoomSignoff[]> {
    return this.repository.find({
      where: { session_id: sessionId },
      order: {
        created_at: 'ASC',
      },
    });
  }

  async findBySessionRoleAndProfile(
    sessionId: string,
    role: AgentWarRoomParticipantRole,
    agentProfile: string,
  ): Promise<AgentWarRoomSignoff | null> {
    return this.repository.findOne({
      where: {
        session_id: sessionId,
        role,
        agent_profile: agentProfile,
      },
    });
  }

  async upsertBySessionRoleAndProfile(
    sessionId: string,
    role: AgentWarRoomParticipantRole,
    agentProfile: string,
    data: Partial<AgentWarRoomSignoff>,
  ): Promise<AgentWarRoomSignoff> {
    const existing = await this.findBySessionRoleAndProfile(
      sessionId,
      role,
      agentProfile,
    );
    if (!existing) {
      return this.create({
        ...data,
        session_id: sessionId,
        role,
        agent_profile: agentProfile,
      });
    }

    Object.assign(existing, data);
    existing.session_id = sessionId;
    existing.role = role;
    existing.agent_profile = agentProfile;
    return this.repository.save(existing);
  }
}
