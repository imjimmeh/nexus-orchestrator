import { useMemo } from "react";
import { ChatSessionListItem } from "@/lib/api/chat-sessions.types";
import { WorkflowRun } from "@/lib/api/workflows.types";
import type { SessionThread } from "@/components/sessions/session-thread.types";
import { resolveTriggerField } from "../../components/sessions/triggerField.helpers";

export function toListFromArray<T>(data: T[] | undefined): T[] {
  return data || [];
}

export function buildChatItems(chats: ChatSessionListItem[]): SessionThread[] {
  return chats.map((chat) => ({
    id: chat.id,
    kind: "chat" as const,
    sessionType: chat.sessionType,
    title: chat.displayName || `Chat ${chat.id.slice(0, 8)}`,
    displayName: chat.displayName || `Chat ${chat.id.slice(0, 8)}`,
    initialMessage: chat.initialMessage,
    status: chat.status,
    createdAt: chat.createdAt,
    completedAt: chat.completedAt || null,
    lastActivityAt: chat.createdAt,
    projectName: chat.projectName,
    agentProfileName: chat.agentProfileName,
  }));
}

function getWorkflowDisplayName(
  wf: WorkflowRun,
  trigger?: Record<string, unknown>,
): string {
  if (wf.display_name) return wf.display_name;
  const fromTrigger = resolveTriggerField(trigger, [
    "displayName",
    "display_name",
    "workflowName",
    "workflow_name",
  ]);
  if (fromTrigger) return fromTrigger;
  if (wf.workflow_name) return wf.workflow_name;
  return `Workflow run ${wf.id.slice(0, 8)}`;
}

export function buildWorkflowItems(workflows: WorkflowRun[]): SessionThread[] {
  return workflows.map((wf) => {
    const trigger =
      wf.state_variables && typeof wf.state_variables === "object"
        ? (wf.state_variables.trigger as Record<string, unknown> | undefined)
        : undefined;

    const displayName = getWorkflowDisplayName(wf, trigger);

    return {
      id: wf.id,
      kind: "workflow" as const,
      title: displayName,
      displayName,
      status: wf.status,
      createdAt: wf.created_at,
      completedAt: wf.completed_at || null,
      lastActivityAt: wf.updated_at,
      workflowId: wf.workflow_id,
    };
  });
}

export function useUnreadThreadState(
  threads?: SessionThread[],
  selectedKey?: string | null,
): Map<string, boolean> {
  return useMemo(() => {
    const map = new Map<string, boolean>();
    (threads || []).forEach((thread) => {
      const key =
        thread.kind === "chat" ? `chat:${thread.id}` : `workflow:${thread.id}`;
      map.set(key, false);
    });
    return map;
  }, [threads, selectedKey]);
}
