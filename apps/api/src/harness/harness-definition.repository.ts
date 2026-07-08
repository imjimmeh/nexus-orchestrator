import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { HarnessDefinitionEntity } from './entities/harness-definition.entity.js';

@Injectable()
export class HarnessDefinitionRepository {
  constructor(
    @InjectRepository(HarnessDefinitionEntity)
    private readonly repo: Repository<HarnessDefinitionEntity>,
  ) {}

  find() {
    return this.repo.find();
  }

  findByHarnessId(harnessId: string) {
    return this.repo.findOneBy({ harnessId });
  }

  save(entity: DeepPartial<HarnessDefinitionEntity>) {
    return this.repo.save(entity);
  }

  async remove(harnessId: string) {
    const e = await this.findByHarnessId(harnessId);
    if (e) await this.repo.remove(e);
  }
}
