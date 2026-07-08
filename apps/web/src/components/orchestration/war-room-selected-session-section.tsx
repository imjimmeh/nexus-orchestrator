import { Badge } from "@/components/ui/badge";
import { ProjectWarRoomMessageKind, ProjectWarRoomParticipantRole, ProjectWarRoomResolutionType, ProjectWarRoomSessionSummary } from "@/lib/api/orchestration.types";
import { WarRoomCloseSection } from "./war-room-close-section";
import { WarRoomInviteSection } from "./war-room-invite-section";
import { WarRoomMessageSection } from "./war-room-message-section";
import { WarRoomStateSummaryPanel } from "./war-room-state-summary-section";
import type { WarRoomStateSummary } from "./WarRoomSessionManagerPanel.hooks";

interface WarRoomSelectedSessionSectionProps {
  selectedSession: ProjectWarRoomSessionSummary;
  stateLoading: boolean;
  stateErrorMessage: string | null;
  state: WarRoomStateSummary | undefined;
  actionPending: boolean;
  inviteAgentProfile: string;
  inviteRole: ProjectWarRoomParticipantRole;
  messageKind: ProjectWarRoomMessageKind;
  messageBody: string;
  closeResolutionType: ProjectWarRoomResolutionType;
  closeNote: string;
  onInviteAgentProfileChange: (value: string) => void;
  onInviteRoleChange: (value: ProjectWarRoomParticipantRole) => void;
  onMessageKindChange: (value: ProjectWarRoomMessageKind) => void;
  onMessageBodyChange: (value: string) => void;
  onCloseResolutionTypeChange: (value: ProjectWarRoomResolutionType) => void;
  onCloseNoteChange: (value: string) => void;
  onInvite: () => void;
  onPostMessage: () => void;
  onCloseSession: () => void;
}

export function WarRoomSelectedSessionSection(props: Readonly<WarRoomSelectedSessionSectionProps>) {
  const { selectedSession, stateLoading, stateErrorMessage, state, actionPending, inviteAgentProfile, inviteRole, messageKind, messageBody, closeResolutionType, closeNote, onInviteAgentProfileChange, onInviteRoleChange, onMessageKindChange, onMessageBodyChange, onCloseResolutionTypeChange, onCloseNoteChange, onInvite, onPostMessage, onCloseSession } = props;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">{selectedSession.session_id}</Badge>
        <Badge variant="secondary">{selectedSession.session_status}</Badge>
        <Badge variant="secondary">{selectedSession.consensus_state}</Badge>
      </div>
      <WarRoomStateSummaryPanel isLoading={stateLoading} errorMessage={stateErrorMessage} state={state} />
      <WarRoomInviteSection actionPending={actionPending} inviteAgentProfile={inviteAgentProfile} inviteRole={inviteRole} onInviteAgentProfileChange={onInviteAgentProfileChange} onInviteRoleChange={onInviteRoleChange} onInvite={onInvite} />
      <WarRoomMessageSection actionPending={actionPending} messageKind={messageKind} messageBody={messageBody} onMessageKindChange={onMessageKindChange} onMessageBodyChange={onMessageBodyChange} onPostMessage={onPostMessage} />
      <WarRoomCloseSection actionPending={actionPending} closeResolutionType={closeResolutionType} closeNote={closeNote} onCloseResolutionTypeChange={onCloseResolutionTypeChange} onCloseNoteChange={onCloseNoteChange} onCloseSession={onCloseSession} />
    </div>
  );
}
