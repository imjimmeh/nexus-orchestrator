import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachmentDto } from "@nexus/core";
import { cn } from "@/lib/utils";
import { useFileUpload } from "@/hooks/useFileUpload";
import {
  linkAttachment,
  getProjectAttachments,
} from "@/lib/api/client.attachments";
import { FileDropzone } from "./FileDropzone";
import { AttachmentChip } from "./AttachmentChip";
import { ImageThumbnail } from "./ImageThumbnail";

const ATTACHMENTS_ENABLED =
  import.meta.env.VITE_ATTACHMENTS_ENABLED !== "false";

export interface AddFilesPanelProps {
  projectId: string;
  className?: string;
}

const IMAGE_MIME_PREFIXES = ["image/"];

function isImageMime(mimeType: string): boolean {
  return IMAGE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
}

export function AddFilesPanel({ projectId, className }: AddFilesPanelProps) {
  const { uploads, uploading, addFiles, error } = useFileUpload();
  const [existingAttachments, setExistingAttachments] = useState<
    AttachmentDto[]
  >([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Track IDs already linked so we don't double-link on re-renders
  const linkedIdsRef = useRef<Set<string>>(new Set());
  // Track previous uploading value to detect the transition from true → false
  const prevUploadingRef = useRef<boolean>(false);

  const loadExisting = useCallback(async () => {
    try {
      const attachments = await getProjectAttachments(projectId);
      setExistingAttachments(attachments);
      // Seed linked-IDs with already-known attachments so we skip re-linking
      attachments.forEach((a) => linkedIdsRef.current.add(a.id));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to load attachments";
      setLoadError(message);
    }
  }, [projectId]);

  useEffect(() => {
    void loadExisting();
  }, [loadExisting]);

  // Link newly uploaded attachments when an upload batch completes (uploading: true → false)
  useEffect(() => {
    const wasUploading = prevUploadingRef.current;
    prevUploadingRef.current = uploading;

    // Only act when uploading transitions from true to false
    if (!wasUploading || uploading) return;

    const freshIds = uploads
      .map((u) => u.id)
      .filter((id) => !linkedIdsRef.current.has(id));
    if (freshIds.length === 0) return;

    void (async () => {
      await Promise.all(
        freshIds.map(async (id) => {
          await linkAttachment(id, "project", projectId);
          linkedIdsRef.current.add(id);
        }),
      );
      await loadExisting();
    })();
  }, [uploading, uploads, projectId, loadExisting]);

  if (!ATTACHMENTS_ENABLED) {
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        <p className="text-sm text-muted-foreground">
          File uploads are not yet available.
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <FileDropzone onFilesSelected={addFiles} disabled={uploading} />

      {(loadError ?? error) && (
        <p role="alert" className="text-xs text-destructive">
          {loadError ?? error}
        </p>
      )}

      {existingAttachments.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">Project Files</h3>
          <div className="flex flex-wrap gap-2">
            {existingAttachments.map((attachment) =>
              isImageMime(attachment.mimeType) ? (
                <ImageThumbnail
                  key={attachment.id}
                  attachmentId={attachment.id}
                  filename={attachment.filename}
                  parseStatus={attachment.parseStatus}
                  className="h-16 w-16"
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
        </div>
      )}
    </div>
  );
}
