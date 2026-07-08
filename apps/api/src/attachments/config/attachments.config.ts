import { registerAs } from '@nestjs/config';
import type { AttachmentsConfig } from './attachments.config.types';

export { type AttachmentsConfig } from './attachments.config.types';

export const ATTACHMENTS_CONFIG = 'attachments';

function buildGarageConfig(): AttachmentsConfig['garage'] {
  return {
    endpoint: process.env.GARAGE_S3_ENDPOINT?.trim() ?? 'http://garage:3900',
    region: process.env.GARAGE_S3_REGION?.trim() ?? 'garage',
    bucket: process.env.GARAGE_S3_BUCKET?.trim() ?? 'nexus-uploads',
    accessKeyId: process.env.GARAGE_S3_ACCESS_KEY_ID?.trim() ?? '',
    secretAccessKey: process.env.GARAGE_S3_SECRET_ACCESS_KEY?.trim() ?? '',
  };
}

export const attachmentsConfig = registerAs(
  ATTACHMENTS_CONFIG,
  (): AttachmentsConfig => ({
    enabled: process.env.ATTACHMENTS_ENABLED?.trim() === 'true',
    maxSizeBytes:
      Number(process.env.ATTACHMENTS_MAX_SIZE_BYTES?.trim()) ||
      25 * 1024 * 1024,
    imageVisionEager:
      process.env.ATTACHMENTS_IMAGE_VISION_EAGER?.trim() !== 'false',
    imageVisionBatchCap:
      Number(process.env.ATTACHMENTS_IMAGE_VISION_BATCH_CAP?.trim()) || 10,
    garage: buildGarageConfig(),
  }),
);
