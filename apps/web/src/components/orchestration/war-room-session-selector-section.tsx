import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectWarRoomSessionSummary } from "@/lib/api/orchestration.types";

interface WarRoomSessionSelectorSectionProps {
  isLoading: boolean;
  errorMessage: string | null;
  sessions: ProjectWarRoomSessionSummary[];
  selectedSessionId: string;
  onSelect: (sessionId: string) => void;
}

export function WarRoomSessionSelectorSection({
  isLoading,
  errorMessage,
  sessions,
  selectedSessionId,
  onSelect,
}: Readonly<WarRoomSessionSelectorSectionProps>) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Select Session
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading sessions...</p>
      ) : null}
      {!isLoading && errorMessage ? (
        <p className="text-sm text-destructive">{errorMessage}</p>
      ) : null}
      {!isLoading && !errorMessage && sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sessions created for this run yet.
        </p>
      ) : null}
      {!isLoading && !errorMessage && sessions.length > 0 ? (
        <Select value={selectedSessionId} onValueChange={onSelect}>
          <SelectTrigger>
            <SelectValue placeholder="Select session" />
          </SelectTrigger>
          <SelectContent>
            {sessions.map((session) => (
              <SelectItem key={session.session_id} value={session.session_id}>
                {session.session_id} · {session.session_status} ·{" "}
                {session.consensus_state}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
