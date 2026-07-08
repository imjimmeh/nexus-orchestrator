import type { AttachmentParseStatus } from '@nexus/core';

export interface CreateAttachmentData {
  filename: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  storage_key: string;
  parse_status?: AttachmentParseStatus;
  parsed_key?: string | null;
  parse_error?: string | null;
  created_by?: string | null;
}
