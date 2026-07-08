import { z } from "zod";

export const ATTACHMENT_MAX_SIZE_BYTES = 25 * 1024 * 1024;

export const ATTACHMENT_MIME_ALLOWLIST = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;

export type AllowedAttachmentMime = (typeof ATTACHMENT_MIME_ALLOWLIST)[number];

export function isAllowedAttachmentMime(
  mime: string,
): mime is AllowedAttachmentMime {
  return (ATTACHMENT_MIME_ALLOWLIST as readonly string[]).includes(mime);
}

export const attachmentParseStatusSchema = z.enum([
  "pending",
  "parsing",
  "parsed",
  "failed",
  "skipped",
]);
export type AttachmentParseStatus = z.infer<typeof attachmentParseStatusSchema>;

export const attachmentOwnerTypeSchema = z.enum(["chat_message", "project"]);
export type AttachmentOwnerType = z.infer<typeof attachmentOwnerTypeSchema>;

export const uploadAttachmentResponseSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  parseStatus: attachmentParseStatusSchema,
});
export type UploadAttachmentResponse = z.infer<
  typeof uploadAttachmentResponseSchema
>;

export const attachmentDtoSchema = uploadAttachmentResponseSchema.extend({
  parseError: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type AttachmentDto = z.infer<typeof attachmentDtoSchema>;
