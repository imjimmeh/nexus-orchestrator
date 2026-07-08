import { useRef } from "react";
import type {
  ChangeEvent,
  KeyboardEvent,
  RefObject,
} from "react";
import { useFileUpload } from "@/hooks/useFileUpload";

/**
 * Encapsulates composer-side input orchestration for AgentChatPanel:
 *   - file attachment state via `useFileUpload`
 *   - submit handling (bundles attachment IDs and clears uploads)
 *   - keyboard handling for the textarea
 *   - hidden file-input plumbing
 */
export function useChatInput(params: {
  disabled: boolean;
  sending: boolean;
  input: string;
  onSend: (attachmentIds?: string[]) => void;
}): {
  fileInputRef: RefObject<HTMLInputElement | null>;
  uploads: ReturnType<typeof useFileUpload>["uploads"];
  uploading: boolean;
  addFiles: ReturnType<typeof useFileUpload>["addFiles"];
  removeUpload: ReturnType<typeof useFileUpload>["removeUpload"];
  handleFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleSend: () => void;
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  triggerFilePicker: () => void;
} {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploads, uploading, addFiles, removeUpload, clear } = useFileUpload();

  const handleSend = () => {
    const attachmentIds = uploads.map((upload) => upload.id);
    params.onSend(attachmentIds.length > 0 ? attachmentIds : undefined);
    clear();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (
        !params.disabled &&
        params.input.trim() &&
        !params.sending &&
        !uploading
      ) {
        handleSend();
      }
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { files } = event.target;
    if (files && files.length > 0) {
      addFiles(files);
    }
    event.target.value = "";
  };

  const triggerFilePicker = () => {
    fileInputRef.current?.click();
  };

  return {
    fileInputRef,
    uploads,
    uploading,
    addFiles,
    removeUpload,
    handleFileInputChange,
    handleSend,
    handleKeyDown,
    triggerFilePicker,
  };
}