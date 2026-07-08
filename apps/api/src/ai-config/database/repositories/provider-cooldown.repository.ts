import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import type { ProviderCooldownReason } from '@nexus/core';
import { ProviderCooldown } from '../entities/provider-cooldown.entity';

@Injectable()
export class ProviderCooldownRepository {
  constructor(
    @InjectRepository(ProviderCooldown)
    private readonly repository: Repository<ProviderCooldown>,
  ) {}

  async upsertCooldown(data: {
    provider_name: string;
    reason: ProviderCooldownReason;
    cooled_until: Date;
    last_failure_at: Date;
    source_run_id?: string | null;
  }): Promise<void> {
    await this.repository.upsert(
      {
        provider_name: data.provider_name,
        reason: data.reason,
        cooled_until: data.cooled_until,
        last_failure_at: data.last_failure_at,
        source_run_id: data.source_run_id ?? null,
      },
      ['provider_name'],
    );
  }

  async findActive(now: Date): Promise<ProviderCooldown[]> {
    return this.repository.find({ where: { cooled_until: MoreThan(now) } });
  }

  async findActiveProviderNames(now: Date): Promise<Set<string>> {
    const rows = await this.repository
      .createQueryBuilder('cooldown')
      .where('cooldown.cooled_until > :now', { now })
      .getMany();
    return new Set(rows.map((row) => row.provider_name));
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.repository.delete({ cooled_until: LessThanOrEqual(now) });
  }
}
