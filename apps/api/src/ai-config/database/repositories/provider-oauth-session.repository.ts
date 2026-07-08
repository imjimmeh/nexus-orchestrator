import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ProviderOAuthSession } from '../entities/provider-oauth-session.entity';
import { CreateProviderOAuthSessionData } from './provider-oauth-session.repository.types';

@Injectable()
export class ProviderOAuthSessionRepository {
  constructor(
    @InjectRepository(ProviderOAuthSession)
    private readonly repository: Repository<ProviderOAuthSession>,
  ) {}

  async create(
    data: CreateProviderOAuthSessionData,
  ): Promise<ProviderOAuthSession> {
    const session = this.repository.create(data);
    return this.repository.save(session);
  }

  async findUnusedByStateHash(
    stateHash: string,
    now: Date,
  ): Promise<ProviderOAuthSession | null> {
    return this.repository
      .createQueryBuilder('session')
      .addSelect('session.code_verifier')
      .where('session.state_hash = :stateHash', { stateHash })
      .andWhere('session.used_at IS NULL')
      .andWhere('session.expires_at > :now', { now })
      .getOne();
  }

  async markUsed(id: string, usedAt: Date): Promise<void> {
    await this.repository.update(id, { used_at: usedAt });
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.repository.delete({
      expires_at: LessThan(now),
    });
  }
}
