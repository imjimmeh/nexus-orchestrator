import { useEffect, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { ATTACHMENT_MIME_ALLOWLIST } from "@nexus/core";
import { cn } from "@/lib/utils";
import { useFileUpload } from "@/hooks/useFileUpload";

export interface FileDropzoneProps {
  /** Called with uploaded attachment IDs after the internal upload completes. Not used when onFilesSelected is provided. */
  onUploaded?: (ids: string[]) => void;
  /** Optional callback invoked with the raw File objects when the user selects files. When provided, the internal upload logic is bypassed and the caller is responsible for uploading. */
  onFilesSelected?: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
}

const ACCEPT_ATTRIBUTE = ATTACHMENT_MIME_ALLOWLIST.join(",");

export function FileDropzone({
  onUploaded,
  onFilesSelected,
  disabled = false,
  className,
}: FileDropzoneProps) {
  // Only use internal upload state when not delegating to an external handler
  const internalUpload = useFileUpload();
  const { uploads, addFiles, error } = onFilesSelected
    ? { uploads: [], addFiles: () => undefined, error: null }
    : internalUpload;
  const [isDragActive, setIsDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Track which upload IDs we have already reported so we only call onUploaded
  // with genuinely new IDs.
  const reportedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!onUploaded) return;

    const newIds = uploads
      .map((u) => u.id)
      .filter((id) => !reportedIdsRef.current.has(id));

    if (newIds.length > 0) {
      newIds.forEach((id) => reportedIdsRef.current.add(id));
      onUploaded(newIds);
    }
  }, [uploads, onUploaded]);

  function handleDragOver(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    if (!disabled) {
      setIsDragActive(true);
    }
  }

  function handleDragLeave(): void {
    setIsDragActive(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setIsDragActive(false);

    if (disabled) {
      return;
    }

    const { files } = event.dataTransfer;
    if (files.length > 0) {
      const fileArray = Array.from(files);
      if (onFilesSelected) {
        onFilesSelected(fileArray);
      } else {
        addFiles(files);
      }
    }
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const { files } = event.target;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      if (onFilesSelected) {
        onFilesSelected(fileArray);
      } else {
        addFiles(files);
      }
    }
    // Reset so the same file can be re-selected after removal
    event.target.value = "";
  }

  function handleClick(): void {
    if (!disabled) {
      inputRef.current?.click();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Enter" || event.key === " ") {
      handleClick();
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="File upload drop zone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-sm transition-colors",
          isDragActive
            ? "border-primary bg-primary/5 text-primary"
            : "border-border text-muted-foreground hover:border-primary/50 hover:bg-muted/50",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <UploadCloud className="h-8 w-8" aria-hidden="true" />
        <span>
          {isDragActive
            ? "Drop files here"
            : "Drag files here or click to browse"}
        </span>

        {/* native file input required — browser file-picker API does not work with Radix Button */}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          disabled={disabled}
          onChange={handleInputChange}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
