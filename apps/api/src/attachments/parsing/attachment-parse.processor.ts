import { Inject, Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AttachmentRepository } from '../database/repositories/attachment.repository';
import {
  OBJECT_STORAGE,
  type IObjectStorage,
} from '../storage/object-storage.interface';
import { DocumentParserService } from './document-parser.service';
import { ImageDescriberService } from './image-describer.service';
import {
  ATTACHMENT_PARSE_QUEUE,
  type AttachmentParseJobData,
} from './attachment-parse.types';

const IMAGE_MIME_PREFIX = 'image/';
const PARSED_CONTENT_TYPE = 'text/markdown';
const PARSE_WORKER_CONCURRENCY = 3;

@Injectable()
@Processor(ATTACHMENT_PARSE_QUEUE, { concurrency: PARSE_WORKER_CONCURRENCY })
export class AttachmentParseProcessor extends WorkerHost {
  private readonly logger = new Logger(AttachmentParseProcessor.name);

  constructor(
    private readonly attachments: AttachmentRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: IObjectStorage,
    private readonly documentParser: DocumentParserService,
    private readonly imageDescriber: ImageDescriberService,
  ) {
    super();
  }

  async process(job: Job<AttachmentParseJobData>): Promise<void> {
    const { attachmentId, visionEager } = job.data;
    const attachment = await this.attachments.findById(attachmentId);
    if (!attachment) {
      this.logger.warn(`Attachment ${attachmentId} not found; skipping parse`);
      return;
    }

    try {
      const isImage = attachment.mime_type.startsWith(IMAGE_MIME_PREFIX);
      if (isImage && !visionEager) {
        await this.attachments.update(attachmentId, {
          parse_status: 'skipped',
        });
        return;
      }

      await this.attachments.update(attachmentId, { parse_status: 'parsing' });
      const original = await this.storage.get(attachment.storage_key);

      const markdown = isImage
        ? (
            await this.imageDescriber.describe(
              attachment.filename,
              original.body,
              attachment.mime_type,
            )
          ).markdown
        : (await this.documentParser.parse(attachment.filename, original.body))
            .content;

      const parsedKey = `${attachmentId}/parsed.md`;
      await this.storage.put(
        parsedKey,
        Buffer.from(markdown, 'utf-8'),
        PARSED_CONTENT_TYPE,
      );
      await this.attachments.update(attachmentId, {
        parse_status: 'parsed',
        parsed_key: parsedKey,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown parse error';
      this.logger.error(
        `Failed to parse attachment ${attachmentId}: ${message}`,
      );
      await this.attachments.update(attachmentId, {
        parse_status: 'failed',
        parse_error: message,
      });
    }
  }
}
