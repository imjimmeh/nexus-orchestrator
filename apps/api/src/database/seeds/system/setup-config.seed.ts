import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SetupConfig } from '../../../system/database/entities/setup-config.entity';

@Injectable()
export class SetupConfigSeedService {
  private readonly logger = new Logger(SetupConfigSeedService.name);

  constructor(
    @InjectRepository(SetupConfig)
    private readonly setupConfigRepo: Repository<SetupConfig>,
  ) {}

  async seed(): Promise<void> {
    const existing = await this.setupConfigRepo.findOne({
      where: { key: 'requires_setup' },
    });
    if (existing) {
      return;
    }

    await this.setupConfigRepo.save(
      this.setupConfigRepo.create({
        key: 'requires_setup',
        requires_setup: true,
      }),
    );

    this.logger.log('Seeded setup config: requires_setup = true');
  }
}

export async function seedSetupConfig(dataSource: DataSource): Promise<void> {
  const service = new SetupConfigSeedService(
    dataSource.getRepository(SetupConfig),
  );
  await service.seed();
}
