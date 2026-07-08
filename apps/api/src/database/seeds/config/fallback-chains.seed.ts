import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FallbackChainEntity } from '../../../ai-config/database/entities/fallback-chain.entity';
import { GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME } from '../../../ai-config/database/repositories/fallback-chain.repository';

@Injectable()
export class FallbackChainSeedService {
  private readonly logger = new Logger(FallbackChainSeedService.name);

  constructor(
    @InjectRepository(FallbackChainEntity)
    private readonly repository: Repository<FallbackChainEntity>,
  ) {}

  async seed(): Promise<void> {
    const existing = await this.repository.findOne({
      where: { name: GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME },
    });
    if (existing) {
      return;
    }
    await this.repository.save(
      this.repository.create({
        name: GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME,
        entries: [],
      }),
    );
    this.logger.log('Created default fallback chain (empty)');
  }
}
