import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Attachment } from '../entities/attachment.entity';
import type { CreateAttachmentData } from './attachment.repository.types';

export type { CreateAttachmentData } from './attachment.repository.types';

@Injectable()
export class AttachmentRepository {
  constructor(
    @InjectRepository(Attachment)
    private readonly repository: Repository<Attachment>,
  ) {}

  findById(id: string): Promise<Attachment | null> {
    return this.repository.findOne({ where: { id } });
  }

  findByChecksum(checksum: string): Promise<Attachment | null> {
    return this.repository.findOne({ where: { checksum } });
  }

  create(data: CreateAttachmentData): Promise<Attachment> {
    return this.repository.save(this.repository.create(data));
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<Attachment>,
  ): Promise<void> {
    await this.repository.update(id, data);
  }
}
