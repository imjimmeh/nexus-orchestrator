import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { FallbackChainEntry } from '@nexus/core';
import { FallbackChainEntity } from '../entities/fallback-chain.entity';

export const GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME = 'default';

@Injectable()
export class FallbackChainRepository {
  constructor(
    @InjectRepository(FallbackChainEntity)
    private readonly repository: Repository<FallbackChainEntity>,
  ) {}

  async findByName(name: string): Promise<FallbackChainEntity | null> {
    return this.repository.findOne({ where: { name } });
  }

  async findAll(): Promise<FallbackChainEntity[]> {
    return this.repository.find({ order: { name: 'ASC' } });
  }

  async upsert(
    name: string,
    entries: FallbackChainEntry[],
  ): Promise<FallbackChainEntity> {
    await this.repository.upsert(
      { name, entries },
      { conflictPaths: ['name'] },
    );
    const result = await this.findByName(name);
    if (!result) {
      throw new Error(`FallbackChain '${name}' not found after upsert`);
    }
    return result;
  }
}
