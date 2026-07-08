import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProjectWarRoomParticipantRole } from "@/lib/api/orchestration.types";

export const PARTICIPANT_ROLES: ProjectWarRoomParticipantRole[] = [
  "architect",
  "dev",
  "qa",
  "pm",
  "moderator",
];

interface WarRoomInviteSectionProps {
  actionPending: boolean;
  inviteAgentProfile: string;
  inviteRole: ProjectWarRoomParticipantRole;
  onInviteAgentProfileChange: (value: string) => void;
  onInviteRoleChange: (value: ProjectWarRoomParticipantRole) => void;
  onInvite: () => void;
}

export function WarRoomInviteSection({
  actionPending,
  inviteAgentProfile,
  inviteRole,
  onInviteAgentProfileChange,
  onInviteRoleChange,
  onInvite,
}: Readonly<WarRoomInviteSectionProps>) {
  return (
    <>
      <div className="grid gap-2 md:grid-cols-2">
        <Input
          value={inviteAgentProfile}
          onChange={(event) => {
            onInviteAgentProfileChange(event.target.value);
          }}
          placeholder="agent profile"
        />
        <Select
          value={inviteRole}
          onValueChange={(value: ProjectWarRoomParticipantRole) => {
            onInviteRoleChange(value);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="role" />
          </SelectTrigger>
          <SelectContent>
            {PARTICIPANT_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={actionPending}
        onClick={onInvite}
      >
        Invite Participant
      </Button>
    </>
  );
}
