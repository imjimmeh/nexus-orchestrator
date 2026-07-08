import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AttachmentOwnerType } from '@nexus/core';
import { AttachmentLink } from '../entities/attachment-link.entity';
import { Attachment } from '../entities/attachment.entity';

@Injectable()
export class AttachmentLinkRepository {
  constructor(
    @InjectRepository(AttachmentLink)
    private readonly repository: Repository<AttachmentLink>,
  ) {}

  async link(
    attachmentId: string,
    ownerType: AttachmentOwnerType,
    ownerId: string,
  ): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .insert()
      .values({
        attachment_id: attachmentId,
        owner_type: ownerType,
        owner_id: ownerId,
      })
      .orIgnore()
      .execute();
  }

  async findAttachmentsForOwner(
    ownerType: AttachmentOwnerType,
    ownerId: string,
  ): Promise<Attachment[]> {
    return this.repository.manager
      .createQueryBuilder(Attachment, 'a')
      .innerJoin(AttachmentLink, 'l', 'l.attachment_id = a.id')
      .where('l.owner_type = :ownerType', { ownerType })
      .andWhere('l.owner_id = :ownerId', { ownerId })
      .getMany();
  }
}
