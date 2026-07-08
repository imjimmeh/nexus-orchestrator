import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectWarRoomResolutionType } from "@/lib/api/orchestration.types";

export const RESOLUTION_TYPES: ProjectWarRoomResolutionType[] = [
  "consensus",
  "deadlock",
  "ceo_tie_break",
  "manual",
];

interface WarRoomCloseSectionProps {
  actionPending: boolean;
  closeResolutionType: ProjectWarRoomResolutionType;
  closeNote: string;
  onCloseResolutionTypeChange: (value: ProjectWarRoomResolutionType) => void;
  onCloseNoteChange: (value: string) => void;
  onCloseSession: () => void;
}

export function WarRoomCloseSection({
  actionPending,
  closeResolutionType,
  closeNote,
  onCloseResolutionTypeChange,
  onCloseNoteChange,
  onCloseSession,
}: Readonly<WarRoomCloseSectionProps>) {
  return (
    <>
      <div className="grid gap-2 md:grid-cols-2">
        <Select
          value={closeResolutionType}
          onValueChange={(value: ProjectWarRoomResolutionType) => {
            onCloseResolutionTypeChange(value);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="resolution type" />
          </SelectTrigger>
          <SelectContent>
            {RESOLUTION_TYPES.map((resolution) => (
              <SelectItem key={resolution} value={resolution}>
                {resolution}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={closeNote}
          onChange={(event) => {
            onCloseNoteChange(event.target.value);
          }}
          placeholder="resolution note (optional)"
        />
      </div>
      <Button
        type="button"
        variant="destructive"
        disabled={actionPending}
        onClick={onCloseSession}
      >
        Close Session
      </Button>
    </>
  );
}
