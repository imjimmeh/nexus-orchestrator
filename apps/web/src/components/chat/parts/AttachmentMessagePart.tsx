import type { AttachmentDto } from "@nexus/core";
import { AttachmentChip, ImageThumbnail } from "@/components/attachments";

export function AttachmentMessagePart({
  attachments,
}: Readonly<{ attachments: AttachmentDto[] }>) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((attachment) =>
        attachment.mimeType.startsWith("image/") ? (
          <ImageThumbnail
            key={attachment.id}
            attachmentId={attachment.id}
            filename={attachment.filename}
            parseStatus={attachment.parseStatus}
            className="h-24 w-24"
          />
        ) : (
          <AttachmentChip
            key={attachment.id}
            filename={attachment.filename}
            parseStatus={attachment.parseStatus}
          />
        ),
      )}
    </div>
  );
}