import { createHash } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  isAllowedAttachmentMime,
  type AttachmentOwnerType,
  type UploadAttachmentResponse,
} from '@nexus/core';
import { AttachmentRepository } from './database/repositories/attachment.repository';
import { AttachmentLinkRepository } from './database/repositories/attachment-link.repository';
import {
  OBJECT_STORAGE,
  type IObjectStorage,
  type StoredObject,
} from './storage/object-storage.interface';
import {
  ATTACHMENTS_CONFIG,
  type AttachmentsConfig,
} from './config/attachments.config';
import {
  ATTACHMENT_PARSE_QUEUE,
  type AttachmentParseJobData,
} from './parsing/attachment-parse.types';
import { Attachment } from './database/entities/attachment.entity';
import type { UploadedFile } from './attachments.service.types';

export type { UploadedFile } from './attachments.service.types';

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly attachmentRepo: AttachmentRepository,
    private readonly linkRepo: AttachmentLinkRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: IObjectStorage,
    @InjectQueue(ATTACHMENT_PARSE_QUEUE)
    private readonly parseQueue: Queue<AttachmentParseJobData>,
    private readonly configService: ConfigService,
  ) {}

  private get config(): AttachmentsConfig {
    return this.configService.getOrThrow<AttachmentsConfig>(ATTACHMENTS_CONFIG);
  }

  async upload(
    file: UploadedFile,
    createdBy?: string,
  ): Promise<UploadAttachmentResponse> {
    if (!isAllowedAttachmentMime(file.mimetype)) {
      throw new BadRequestException(`Unsupported file type: ${file.mimetype}`);
    }
    if (file.size > this.config.maxSizeBytes) {
      throw new BadRequestException(
        `File exceeds maximum size of ${this.config.maxSizeBytes} bytes`,
      );
    }

    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.attachmentRepo.findByChecksum(checksum);
    if (existing) {
      return this.toResponse(existing);
    }

    const storageKey = `${checksum}/original`;

    const created = await this.attachmentRepo.create({
      filename: file.originalname,
      mime_type: file.mimetype,
      size_bytes: file.size,
      checksum,
      storage_key: storageKey,
      parse_status: 'pending',
      created_by: createdBy ?? null,
    });

    await this.storage.put(storageKey, file.buffer, file.mimetype);

    await this.parseQueue.add(
      `parse:${created.id}`,
      { attachmentId: created.id, visionEager: this.config.imageVisionEager },
      { jobId: created.id, removeOnComplete: 100, removeOnFail: 50 },
    );

    return this.toResponse(created);
  }

  async link(
    attachmentId: string,
    ownerType: AttachmentOwnerType,
    ownerId: string,
  ): Promise<void> {
    const attachment = await this.attachmentRepo.findById(attachmentId);
    if (!attachment)
      throw new NotFoundException(`Attachment ${attachmentId} not found`);
    await this.linkRepo.link(attachmentId, ownerType, ownerId);
  }

  async getMetadata(id: string): Promise<Attachment> {
    const attachment = await this.attachmentRepo.findById(id);
    if (!attachment) throw new NotFoundException(`Attachment ${id} not found`);
    return attachment;
  }

  async getContent(id: string): Promise<StoredObject> {
    const attachment = await this.getMetadata(id);
    if (!attachment.storage_key) {
      throw new NotFoundException('Attachment content is not yet available');
    }
    return this.storage.get(attachment.storage_key);
  }

  async listForOwner(
    ownerType: AttachmentOwnerType,
    ownerId: string,
  ): Promise<Attachment[]> {
    return this.linkRepo.findAttachmentsForOwner(ownerType, ownerId);
  }

  async getParsed(
    id: string,
  ): Promise<{ status: string; content: string | null }> {
    const attachment = await this.getMetadata(id);
    if (attachment.parse_status !== 'parsed' || !attachment.parsed_key) {
      return { status: attachment.parse_status, content: null };
    }
    const parsed = await this.storage.get(attachment.parsed_key);
    return { status: 'parsed', content: parsed.body.toString('utf-8') };
  }

  private toResponse(a: Attachment): UploadAttachmentResponse {
    return {
      id: a.id,
      filename: a.filename,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
      parseStatus: a.parse_status,
    };
  }
}
