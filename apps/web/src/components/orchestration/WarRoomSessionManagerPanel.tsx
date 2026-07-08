/**
 * @file WarRoomSessionManagerPanel.tsx
 *
 * Top-level War Room session manager shell: open a new session, pick a
 * session, invite participants, post messages, close the session. The
 * orchestration folder splits this surface across a top-level shell
 * (`WarRoomSessionManagerPanel.tsx` + `WarRoomSessionManagerPanel.hooks.tsx`),
 * a types file, a section barrel, a state hook plus spec, query/mutation
 * hooks, and seven section components (`war-room-open-session-section`,
 * `war-room-session-selector-section`, `war-room-selected-session-section`,
 * `war-room-state-summary-section`, `war-room-invite-section`,
 * `war-room-message-section`, `war-room-close-section`).
 *
 * **Contributors must consult the file-organization note before editing
 * any file in this folder** — the split between presentation-only
 * sections, the state hook, the mutation/query hooks, and the top-level
 * shell is intentional and tested:
 *
 *     ../../../../../docs/guide/warroom-manager-panel-organization.md
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WarRoomOpenSessionSection } from "./war-room-open-session-section";
import { WarRoomSelectedSessionSection } from "./war-room-selected-session-section";
import { WarRoomSessionSelectorSection } from "./war-room-session-selector-section";
import {
  useWarRoomSessionManagerModel,
  type WarRoomSessionManagerContentProps,
} from "./WarRoomSessionManagerPanel.hooks";

interface WarRoomSessionManagerPanelProps {
  projectId: string;
  workflowRunId: string | null;
}

function WarRoomSessionManagerContent({
  projectId,
  workflowRunId,
}: Readonly<WarRoomSessionManagerContentProps>) {
  const model = useWarRoomSessionManagerModel({ projectId, workflowRunId });

  return (
    <Card>
      <CardHeader>
        <CardTitle>War Room Manager</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {model.notice ? (
          <p
            className={
              model.notice.type === "error"
                ? "text-sm text-destructive"
                : "text-sm text-muted-foreground"
            }
          >
            {model.notice.message}
          </p>
        ) : null}

        <WarRoomOpenSessionSection
          openSessionId={model.openSessionId}
          openInitialMessage={model.openInitialMessage}
          onOpenSessionIdChange={model.setOpenSessionId}
          onOpenInitialMessageChange={model.setOpenInitialMessage}
          onOpenSession={model.openSession}
          disabled={model.actionPending}
        />

        <WarRoomSessionSelectorSection
          isLoading={model.sessionsLoading}
          errorMessage={model.sessionsErrorMessage}
          sessions={model.sessions}
          selectedSessionId={model.selectedSessionId}
          onSelect={model.setSelectedSessionId}
        />

        {model.selectedSession ? (
          <WarRoomSelectedSessionSection
            selectedSession={model.selectedSession}
            stateLoading={model.sessionStateLoading}
            stateErrorMessage={model.sessionStateErrorMessage}
            state={model.sessionState}
            actionPending={model.actionPending}
            inviteAgentProfile={model.inviteAgentProfile}
            inviteRole={model.inviteRole}
            messageKind={model.messageKind}
            messageBody={model.messageBody}
            closeResolutionType={model.closeResolutionType}
            closeNote={model.closeNote}
            onInviteAgentProfileChange={model.setInviteAgentProfile}
            onInviteRoleChange={model.setInviteRole}
            onMessageKindChange={model.setMessageKind}
            onMessageBodyChange={model.setMessageBody}
            onCloseResolutionTypeChange={model.setCloseResolutionType}
            onCloseNoteChange={model.setCloseNote}
            onInvite={model.inviteParticipant}
            onPostMessage={model.postMessage}
            onCloseSession={model.closeSession}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function WarRoomSessionManagerPanel({
  projectId,
  workflowRunId,
}: Readonly<WarRoomSessionManagerPanelProps>) {
  if (!workflowRunId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>War Room Manager</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Start or resume an orchestration run to manage War Room sessions.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <WarRoomSessionManagerContent
      projectId={projectId}
      workflowRunId={workflowRunId}
    />
  );
}
