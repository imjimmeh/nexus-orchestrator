import { useState } from "react";
import { cn } from "@/lib/utils";
import { AttachmentChip } from "./AttachmentChip";

const apiBase =
  typeof window !== "undefined"
    ? ((window as Window & { __RUNTIME_CONFIG__?: { apiUrl?: string } })
        .__RUNTIME_CONFIG__?.apiUrl ?? "/api")
    : "/api";

export interface ImageThumbnailProps {
  attachmentId: string;
  filename: string;
  parseStatus?: string;
  className?: string;
}

export function ImageThumbnail({
  attachmentId,
  filename,
  parseStatus = "parsed",
  className,
}: ImageThumbnailProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <AttachmentChip
        filename={filename}
        parseStatus={parseStatus}
        className={className}
      />
    );
  }

  return (
    <img
      src={`${apiBase}/attachments/${encodeURIComponent(attachmentId)}/content`}
      alt={filename}
      onError={() => setHasError(true)}
      className={cn("rounded-md border border-border object-cover", className)}
    />
  );
}
