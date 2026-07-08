import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface WarRoomOpenSessionSectionProps {
  openSessionId: string;
  openInitialMessage: string;
  onOpenSessionIdChange: (value: string) => void;
  onOpenInitialMessageChange: (value: string) => void;
  onOpenSession: () => void;
  disabled: boolean;
}

export function WarRoomOpenSessionSection({
  openSessionId,
  openInitialMessage,
  onOpenSessionIdChange,
  onOpenInitialMessageChange,
  onOpenSession,
  disabled,
}: Readonly<WarRoomOpenSessionSectionProps>) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-xs font-medium text-muted-foreground">Open Session</p>
      <Input
        value={openSessionId}
        onChange={(event) => {
          onOpenSessionIdChange(event.target.value);
        }}
        placeholder="session id (optional)"
      />
      <Textarea
        rows={2}
        value={openInitialMessage}
        onChange={(event) => {
          onOpenInitialMessageChange(event.target.value);
        }}
        placeholder="initial message (optional)"
      />
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={onOpenSession}
      >
        Open Session
      </Button>
    </div>
  );
}
