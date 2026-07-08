import { Loader2, Paperclip } from "lucide-react";
import type {
  ChangeEvent,
  KeyboardEvent,
  RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentChip } from "@/components/attachments";
import { ATTACHMENT_MIME_ALLOWLIST } from "@nexus/core";

const ACCEPT_ATTRIBUTE = ATTACHMENT_MIME_ALLOWLIST.join(",");
const ATTACHMENTS_ENABLED =
  import.meta.env.VITE_ATTACHMENTS_ENABLED !== "false";

export interface AgentChatComposerAttachment {
  id: string;
  filename: string;
  parseStatus: string;
}

export interface AgentChatComposerProps {
  input: string;
  inputPlaceholder: string;
  disabled: boolean;
  sending: boolean;
  sendLabel: string;
  onInputChange: (value: string) => void;
  attachments: ReadonlyArray<AgentChatComposerAttachment>;
  uploading: boolean;
  onRemoveUpload: (id: string) => void;
  onSend: () => void;
  onAttachClick: () => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

function AttachmentsRow({
  attachmentsEnabled,
  attachments,
  onRemoveUpload,
}: Readonly<{
  attachmentsEnabled: boolean;
  attachments: ReadonlyArray<AgentChatComposerAttachment>;
  onRemoveUpload: (id: string) => void;
}>) {
  if (!attachmentsEnabled || attachments.length === 0) {
    return null;
  }
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((upload) => (
        <AttachmentChip
          key={upload.id}
          filename={upload.filename}
          parseStatus={upload.parseStatus}
          onRemove={() => onRemoveUpload(upload.id)}
        />
      ))}
    </div>
  );
}

function SendControls({
  attachmentsEnabled,
  disabled,
  uploading,
  input,
  sending,
  sendLabel,
  onClickSend,
  onClickAttach,
  onFileInputChange,
  fileInputRef,
}: Readonly<{
  attachmentsEnabled: boolean;
  disabled: boolean;
  uploading: boolean;
  input: string;
  sending: boolean;
  sendLabel: string;
  onClickSend: () => void;
  onClickAttach: () => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
}>) {
  const attachButtonDisabled = disabled || uploading;
  const sendButtonDisabled =
    disabled || !input.trim() || sending || uploading;
  return (
    <div className="flex items-center gap-2">
      {attachmentsEnabled && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Attach files"
            disabled={attachButtonDisabled}
            onClick={onClickAttach}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
          </Button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            disabled={attachButtonDisabled}
            onChange={onFileInputChange}
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
          />
        </>
      )}

      <Button onClick={onClickSend} size="sm" disabled={sendButtonDisabled}>
        {sending ? (
          <>
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            Sending...
          </>
        ) : (
          sendLabel
        )}
      </Button>
    </div>
  );
}

export function AgentChatComposer({
  input,
  inputPlaceholder,
  disabled,
  sending,
  sendLabel,
  onInputChange,
  attachments,
  uploading,
  onRemoveUpload,
  onSend,
  onAttachClick,
  onFileInputChange,
  fileInputRef,
  onKeyDown,
}: Readonly<AgentChatComposerProps>) {
  return (
    <div className="border-t px-4 py-3">
      <Textarea
        value={input}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={inputPlaceholder}
        className="mb-2 min-h-[80px] resize-none"
        disabled={disabled}
      />

      <AttachmentsRow
        attachmentsEnabled={ATTACHMENTS_ENABLED}
        attachments={attachments}
        onRemoveUpload={onRemoveUpload}
      />

      <SendControls
        attachmentsEnabled={ATTACHMENTS_ENABLED}
        disabled={disabled}
        uploading={uploading}
        input={input}
        sending={sending}
        sendLabel={sendLabel}
        onClickSend={onSend}
        onClickAttach={onAttachClick}
        onFileInputChange={onFileInputChange}
        fileInputRef={fileInputRef}
      />
    </div>
  );
}