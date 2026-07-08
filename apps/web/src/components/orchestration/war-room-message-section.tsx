import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectWarRoomMessageKind } from "@/lib/api/orchestration.types";

export const MESSAGE_KINDS: ProjectWarRoomMessageKind[] = [
  "proposal",
  "question",
  "response",
  "system",
];

interface WarRoomMessageSectionProps {
  actionPending: boolean;
  messageKind: ProjectWarRoomMessageKind;
  messageBody: string;
  onMessageKindChange: (value: ProjectWarRoomMessageKind) => void;
  onMessageBodyChange: (value: string) => void;
  onPostMessage: () => void;
}

export function WarRoomMessageSection({
  actionPending,
  messageKind,
  messageBody,
  onMessageKindChange,
  onMessageBodyChange,
  onPostMessage,
}: Readonly<WarRoomMessageSectionProps>) {
  return (
    <>
      <div className="grid gap-2 md:grid-cols-2">
        <Select
          value={messageKind}
          onValueChange={(value: ProjectWarRoomMessageKind) => {
            onMessageKindChange(value);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="message kind" />
          </SelectTrigger>
          <SelectContent>
            {MESSAGE_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {kind}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={messageBody}
          onChange={(event) => {
            onMessageBodyChange(event.target.value);
          }}
          placeholder="message body"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={actionPending}
        onClick={onPostMessage}
      >
        Send Message
      </Button>
    </>
  );
}
