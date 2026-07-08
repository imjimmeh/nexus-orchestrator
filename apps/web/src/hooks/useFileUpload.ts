import { useCallback, useRef, useState } from "react";
import {
  ATTACHMENT_MAX_SIZE_BYTES,
  ATTACHMENT_MIME_ALLOWLIST,
} from "@nexus/core";
import { uploadAttachment } from "@/lib/api/client.attachments";
import type { UploadedFile, UseFileUploadReturn } from "./useFileUpload.types";

export type { UploadedFile, UseFileUploadReturn } from "./useFileUpload.types";

function validateFile(file: File): string | null {
  if (!(ATTACHMENT_MIME_ALLOWLIST as readonly string[]).includes(file.type)) {
    return `"${file.name}" has an unsupported file type (${file.type || "unknown"}).`;
  }

  if (file.size > ATTACHMENT_MAX_SIZE_BYTES) {
    const maxMb = ATTACHMENT_MAX_SIZE_BYTES / (1024 * 1024);
    return `"${file.name}" exceeds the ${maxMb} MB size limit.`;
  }

  return null;
}

export function useFileUpload(): UseFileUploadReturn {
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});

  // Track in-flight upload count without triggering re-renders on every tick
  const inFlightRef = useRef(0);

  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);

    const errors: string[] = [];
    const validFiles: File[] = [];
    for (const file of fileArray) {
      const err = validateFile(file);
      if (err) {
        errors.push(`${file.name}: ${err}`);
      } else {
        validFiles.push(file);
      }
    }

    if (errors.length > 0) {
      setError(errors.join("; "));
    } else {
      setError(null);
    }

    if (validFiles.length === 0) {
      return;
    }

    inFlightRef.current += validFiles.length;
    setUploading(true);

    validFiles.forEach((file) => {
      const tempKey = `${file.name}-${file.size}-${Date.now()}`;

      uploadAttachment(file, (pct) => {
        setProgress((prev) => ({ ...prev, [tempKey]: pct }));
      })
        .then((response) => {
          setUploads((prev) => [
            ...prev,
            {
              id: response.id,
              filename: response.filename,
              mimeType: response.mimeType,
              parseStatus: response.parseStatus,
            },
          ]);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Upload failed.";
          setError(message);
        })
        .finally(() => {
          setProgress((prev) => {
            const next = { ...prev };
            delete next[tempKey];
            return next;
          });

          inFlightRef.current -= 1;
          if (inFlightRef.current <= 0) {
            inFlightRef.current = 0;
            setUploading(false);
          }
        });
    });
  }, []);

  const removeUpload = useCallback((id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }, []);

  const clear = useCallback(() => {
    setUploads([]);
    setError(null);
    setProgress({});
    setUploading(false);
    inFlightRef.current = 0;
  }, []);

  return { uploads, uploading, addFiles, removeUpload, clear, error, progress };
}
