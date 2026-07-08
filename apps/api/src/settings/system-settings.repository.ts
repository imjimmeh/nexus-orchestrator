import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemSetting } from '../system/database/entities/system-setting.entity';

@Injectable()
export class SystemSettingsRepository {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly repository: Repository<SystemSetting>,
  ) {}

  async findAll(): Promise<SystemSetting[]> {
    return this.repository.find({ order: { key: 'ASC' } });
  }

  async findByKey(key: string): Promise<SystemSetting | null> {
    return this.repository.findOne({ where: { key } });
  }

  async upsert(
    key: string,
    value: unknown,
    description?: string | null,
  ): Promise<SystemSetting> {
    const existing = await this.findByKey(key);
    if (existing) {
      existing.value = value;
      if (description !== undefined) {
        existing.description = description;
      }
      return this.repository.save(existing);
    }

    const setting = this.repository.create({
      key,
      value,
      description: description ?? null,
    });
    return this.repository.save(setting);
  }
}
