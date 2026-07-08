import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChatSessionParticipant, ChatSessionParticipantRole } from "@/lib/api/chat-sessions.types";

type InviteCandidate = {
  name: string;
  tierPreference: string | null;
};

type ChatCollaborationProps = Readonly<{
  visible: boolean;
  chatSessionState: string | null;
  chatParticipants: ChatSessionParticipant[];
  chatParticipantCount: number;
  chatActiveParticipantCount: number;
  chatInvitedParticipantCount: number;
  chatParticipantsLoading: boolean;
  chatParticipantsError: string | null;
  chatSessionStateLoading: boolean;
  chatSessionStateError: string | null;
  inviteCandidates: InviteCandidate[];
  inviteAgentProfile: string;
  inviteRole: ChatSessionParticipantRole;
  invitePending: boolean;
  inviteError: string | null;
  inviteDenialReason: string | null;
  onInviteAgentProfileChange: (value: string) => void;
  onInviteRoleChange: (value: ChatSessionParticipantRole) => void;
  onInviteParticipant: () => void;
}>;

function participantStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") {
    return "default";
  }

  if (status === "invited") {
    return "secondary";
  }

  if (status === "declined" || status === "removed") {
    return "destructive";
  }

  return "outline";
}

function ChatCollaborationBadges(
  props: Readonly<{
    chatSessionState: string | null;
    chatParticipantCount: number;
    chatActiveParticipantCount: number;
    chatInvitedParticipantCount: number;
  }>,
) {
  const {
    chatSessionState,
    chatParticipantCount,
    chatActiveParticipantCount,
    chatInvitedParticipantCount,
  } = props;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {chatSessionState && (
        <Badge variant="outline">{`Session: ${chatSessionState}`}</Badge>
      )}
      <Badge variant="outline">{`Total: ${String(chatParticipantCount)}`}</Badge>
      <Badge variant="secondary">
        {`Active: ${String(chatActiveParticipantCount)}`}
      </Badge>
      <Badge variant="secondary">
        {`Invited: ${String(chatInvitedParticipantCount)}`}
      </Badge>
    </div>
  );
}

function ChatCollaborationStatusMessages(
  props: Readonly<{
    chatSessionStateLoading: boolean;
    chatSessionStateError: string | null;
    chatParticipantsLoading: boolean;
    chatParticipantsError: string | null;
  }>,
) {
  const {
    chatSessionStateLoading,
    chatSessionStateError,
    chatParticipantsLoading,
    chatParticipantsError,
  } = props;

  return (
    <>
      {chatSessionStateLoading && (
        <p className="text-sm text-muted-foreground">
          Refreshing collaboration state...
        </p>
      )}

      {chatSessionStateError && (
        <p className="text-sm text-destructive">{chatSessionStateError}</p>
      )}

      {chatParticipantsLoading && (
        <p className="text-sm text-muted-foreground">Loading participants...</p>
      )}

      {chatParticipantsError && (
        <p className="text-sm text-destructive">{chatParticipantsError}</p>
      )}
    </>
  );
}

function ChatParticipantsRoster(
  props: Readonly<{
    chatParticipantsLoading: boolean;
    chatParticipants: ChatSessionParticipant[];
  }>,
) {
  const { chatParticipantsLoading, chatParticipants } = props;

  if (chatParticipantsLoading) {
    return null;
  }

  if (chatParticipants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No participants have joined this chat yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {chatParticipants.map((participant) => (
        <div
          key={participant.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded border p-2"
        >
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium">
              {participant.agentProfile}
            </p>
            <p className="text-xs text-muted-foreground">
              {`Role: ${participant.role}`}
              {participant.invitedBy
                ? ` · Invited by ${participant.invitedBy}`
                : ""}
            </p>
          </div>
          <Badge
            variant={participantStatusVariant(participant.participationStatus)}
          >
            {participant.participationStatus}
          </Badge>
        </div>
      ))}
    </div>
  );
}

function InviteParticipantControls(
  props: Readonly<{
    inviteCandidates: InviteCandidate[];
    inviteAgentProfile: string;
    inviteRole: ChatSessionParticipantRole;
    invitePending: boolean;
    inviteError: string | null;
    inviteDenialReason: string | null;
    onInviteAgentProfileChange: (value: string) => void;
    onInviteRoleChange: (value: ChatSessionParticipantRole) => void;
    onInviteParticipant: () => void;
  }>,
) {
  const {
    inviteCandidates,
    inviteAgentProfile,
    inviteRole,
    invitePending,
    inviteError,
    inviteDenialReason,
    onInviteAgentProfileChange,
    onInviteRoleChange,
    onInviteParticipant,
  } = props;
  const canInvite =
    inviteCandidates.length > 0 && inviteAgentProfile.trim().length > 0;

  return (
    <>
      <div className="grid gap-2 md:grid-cols-3">
        <Select
          value={inviteAgentProfile}
          onValueChange={onInviteAgentProfileChange}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                inviteCandidates.length > 0
                  ? "Select agent"
                  : "No available agents"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {inviteCandidates.map((candidate) => (
              <SelectItem key={candidate.name} value={candidate.name}>
                {candidate.tierPreference
                  ? `${candidate.name} (${candidate.tierPreference})`
                  : candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={inviteRole}
          onValueChange={(value) => {
            onInviteRoleChange(value as ChatSessionParticipantRole);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="participant">participant</SelectItem>
            <SelectItem value="moderator">moderator</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          onClick={onInviteParticipant}
          disabled={!canInvite || invitePending}
        >
          Invite Agent
        </Button>
      </div>

      {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
      {inviteDenialReason && (
        <p className="text-sm text-amber-700">{`Invite denied: ${inviteDenialReason}`}</p>
      )}
    </>
  );
}

export function ChatCollaborationSection(props: ChatCollaborationProps) {
  const {
    visible,
    chatSessionState,
    chatParticipants,
    chatParticipantCount,
    chatActiveParticipantCount,
    chatInvitedParticipantCount,
    chatParticipantsLoading,
    chatParticipantsError,
    chatSessionStateLoading,
    chatSessionStateError,
    inviteCandidates,
    inviteAgentProfile,
    inviteRole,
    invitePending,
    inviteError,
    inviteDenialReason,
    onInviteAgentProfileChange,
    onInviteRoleChange,
    onInviteParticipant,
  } = props;

  if (!visible) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat Collaboration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ChatCollaborationBadges
          chatSessionState={chatSessionState}
          chatParticipantCount={chatParticipantCount}
          chatActiveParticipantCount={chatActiveParticipantCount}
          chatInvitedParticipantCount={chatInvitedParticipantCount}
        />

        <ChatCollaborationStatusMessages
          chatSessionStateLoading={chatSessionStateLoading}
          chatSessionStateError={chatSessionStateError}
          chatParticipantsLoading={chatParticipantsLoading}
          chatParticipantsError={chatParticipantsError}
        />

        <ChatParticipantsRoster
          chatParticipantsLoading={chatParticipantsLoading}
          chatParticipants={chatParticipants}
        />

        <InviteParticipantControls
          inviteCandidates={inviteCandidates}
          inviteAgentProfile={inviteAgentProfile}
          inviteRole={inviteRole}
          invitePending={invitePending}
          inviteError={inviteError}
          inviteDenialReason={inviteDenialReason}
          onInviteAgentProfileChange={onInviteAgentProfileChange}
          onInviteRoleChange={onInviteRoleChange}
          onInviteParticipant={onInviteParticipant}
        />
      </CardContent>
    </Card>
  );
}
