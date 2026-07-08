export const ATTACHMENT_PARSE_QUEUE = 'attachment-parse';

export interface AttachmentParseJobData {
  attachmentId: string;
  visionEager: boolean;
}
