import { useMemo } from "react";
import { useWorkflowRun } from "@/hooks/useWorkflows";
import { useWorkflowRunTelemetry } from "@/hooks/useWorkflowRunTelemetry";
import { WorkflowRunRuntimeNotice, WorkflowWorkspaceTreeNode } from "@/lib/api/workflows.types";
import { buildWorkflowRunRuntimeNotice } from "@/components/sessions/workflowRunPresentation.helpers";

interface ExecutionSidebarData {
  terminalChunks: string[];
  workspaceDiff: string;
  workspaceTree: WorkflowWorkspaceTreeNode[];
  diffLoading: boolean;
  diffError: string | null;
  treeLoading: boolean;
  treeError: string | null;
  runtimeNotice: WorkflowRunRuntimeNotice | null;
}

interface WorkspaceArtifactsSnapshot {
  workspaceDiff?: { diff: string } | null;
  workspaceTree?: WorkflowWorkspaceTreeNode[] | null;
  workspaceDiffLoading?: boolean;
  workspaceDiffError?: unknown;
  workspaceTreeLoading?: boolean;
  workspaceTreeError?: unknown;
}

function formatArtifactError(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "An error occurred";
}

/**
 * Extracts execution sidebar data from workflow run telemetry and artifacts.
 * Combines terminal output, diff, and file tree into a single data structure.
 */
export function useExecutionSidebarData(
  runId: string | undefined,
  artifacts?: WorkspaceArtifactsSnapshot,
): ExecutionSidebarData {
  const { events } = useWorkflowRunTelemetry(runId);
  const workflowRun = useWorkflowRun(runId ?? "");

  const readPayloadString = (
    payload: Record<string, unknown>,
    keys: string[],
  ): string => {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string") {
        return value;
      }
    }

    return "";
  };

  // Extract terminal chunks from telemetry events
  const terminalChunks = useMemo(() => {
    if (!events) return [];

    return events
      .filter(
        (event) =>
          event.event_type === "terminal_output" ||
          event.event_type === "terminal_chunk" ||
          event.event_type === "bash_output",
      )
      .map((event) => {
        return readPayloadString(event.payload, ["output", "chunk", "content"]);
      })
      .filter((chunk) => chunk.length > 0);
  }, [events]);

  const workspaceDiff = useMemo(() => {
    const diffFromArtifacts = artifacts?.workspaceDiff?.diff;
    if (typeof diffFromArtifacts === "string") {
      return diffFromArtifacts;
    }

    if (!events) return "";

    // Find diff events in telemetry
    const diffEvent = events.find(
      (event) =>
        event.event_type === "workspace_diff" ||
        event.event_type === "diff_generated",
    );

    if (diffEvent) {
      return readPayloadString(diffEvent.payload, ["diff", "content"]);
    }

    return "";
  }, [artifacts?.workspaceDiff, events]);

  const workspaceTree: WorkflowWorkspaceTreeNode[] = useMemo(() => {
    if (Array.isArray(artifacts?.workspaceTree)) {
      return artifacts.workspaceTree;
    }

    if (!events) return [];

    // Find tree event in telemetry
    const treeEvent = events.find(
      (event) =>
        event.event_type === "workspace_tree" ||
        event.event_type === "workspace_snapshot",
    );

    if (treeEvent && Array.isArray(treeEvent.payload.tree)) {
      return treeEvent.payload.tree as WorkflowWorkspaceTreeNode[];
    }

    return [];
  }, [artifacts?.workspaceTree, events]);

  const diffError = formatArtifactError(artifacts?.workspaceDiffError);
  const treeError = formatArtifactError(artifacts?.workspaceTreeError);
  const runtimeNotice = useMemo(
    () =>
      buildWorkflowRunRuntimeNotice({ workflowRun: workflowRun.data, events }),
    [workflowRun.data, events],
  );

  return {
    terminalChunks,
    workspaceDiff,
    workspaceTree,
    diffLoading: artifacts?.workspaceDiffLoading ?? false,
    diffError,
    treeLoading: artifacts?.workspaceTreeLoading ?? false,
    treeError,
    runtimeNotice,
  };
}
