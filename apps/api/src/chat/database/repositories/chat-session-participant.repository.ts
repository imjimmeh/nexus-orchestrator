import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatSessionParticipant } from '../entities/chat-session-participant.entity';

@Injectable()
export class ChatSessionParticipantRepository {
  constructor(
    @InjectRepository(ChatSessionParticipant)
    private readonly repository: Repository<ChatSessionParticipant>,
  ) {}

  async create(
    data: Partial<ChatSessionParticipant>,
  ): Promise<ChatSessionParticipant> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findByChatSessionId(
    chatSessionId: string,
  ): Promise<ChatSessionParticipant[]> {
    return this.repository.find({
      where: { chat_session_id: chatSessionId },
      order: { created_at: 'ASC' },
    });
  }

  async findByChatSessionAndAgentProfile(
    chatSessionId: string,
    agentProfile: string,
  ): Promise<ChatSessionParticipant | null> {
    return this.repository.findOne({
      where: {
        chat_session_id: chatSessionId,
        agent_profile: agentProfile,
      },
    });
  }

  async upsertByChatSessionAndAgentProfile(
    chatSessionId: string,
    agentProfile: string,
    data: Partial<ChatSessionParticipant>,
  ): Promise<ChatSessionParticipant> {
    const existing = await this.findByChatSessionAndAgentProfile(
      chatSessionId,
      agentProfile,
    );

    if (!existing) {
      return this.create({
        ...data,
        chat_session_id: chatSessionId,
        agent_profile: agentProfile,
      });
    }

    Object.assign(existing, data);
    existing.chat_session_id = chatSessionId;
    existing.agent_profile = agentProfile;

    return this.repository.save(existing);
  }

  async countByChatSessionId(chatSessionId: string): Promise<number> {
    return this.repository.count({ where: { chat_session_id: chatSessionId } });
  }

  async countInvitesByChatSessionId(chatSessionId: string): Promise<number> {
    return this.repository
      .createQueryBuilder('participant')
      .where('participant.chat_session_id = :chatSessionId', { chatSessionId })
      .andWhere('participant.invited_by IS NOT NULL')
      .getCount();
  }
}
