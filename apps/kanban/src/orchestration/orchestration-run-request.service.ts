import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { WorkflowRunRequestV1 } from "@nexus/core";
import { resolveKanbanExternalMcpMounts } from "../mcp/kanban-mcp-run-mounts";
import type { ResolvedStartupContext } from "./orchestration-internal.types";
import type { StartOrchestrationInput } from "./orchestration.types";

export const PROJECT_ORCHESTRATION_CYCLE_WORKFLOW_ID =
  "project_orchestration_cycle_ceo";
export const PROJECT_DISCOVERY_WORKFLOW_ID = "project_discovery_ceo";

type BuildRunRequestArgs = {
  projectId: string;
  input: StartOrchestrationInput;
  startupContext: ResolvedStartupContext;
  getRequestId: () => string | null | undefined;
  getCausationId: () => string | null | undefined;
  getProject: (projectId: string) => Promise<{
    basePath?: string | null;
    repositoryUrl?: string | null;
  } | null>;
  selectHumanDecisionPolicy: (args: {
    orchestrationMode: "autonomous" | "supervised" | "notifications_only";
  }) => string;
};

@Injectable()
export class OrchestrationRunRequestService {
  async buildRunRequest(
    args: BuildRunRequestArgs,
  ): Promise<WorkflowRunRequestV1> {
    const correlationId = args.getRequestId() ?? randomUUID();
    const causationId =
      args.getCausationId() ?? `kanban:orchestration:start:${args.projectId}`;

    const project = await args.getProject(args.projectId).catch(() => null);
    const orchestrationMode = args.input.orchestrationMode ?? "supervised";

    const triggerInput: Record<string, unknown> = {
      scopeId: args.projectId,
      projectId: args.projectId,
      goals: args.input.goals,
      orchestrationMode,
      orchestrationId: args.projectId,
      humanDecisionPolicy: args.selectHumanDecisionPolicy({
        orchestrationMode,
      }),
      sourceContext: args.startupContext.sourceContext,
      readinessContext: args.startupContext.readinessContext,
      startupHints: args.startupContext.startupHints,
    };

    if (project?.basePath) {
      triggerInput.basePath = project.basePath;
    }
    if (project?.repositoryUrl) {
      triggerInput.repositoryUrl = project.repositoryUrl;
    }

    return {
      workflow_id: PROJECT_ORCHESTRATION_CYCLE_WORKFLOW_ID,
      input: triggerInput,
      launch_source: "kanban_orchestration",
      context: {
        scopeId: null,
        contextId: args.projectId,
        contextType: "kanban.project",
        scopeNodeId: null,
        scopePath: null,
      },
      metadata: {
        correlation_id: correlationId,
        causation_id: causationId,
        idempotency_key: `kanban:orchestration:start:${args.projectId}`,
        requested_by: args.input.requestedBy ?? null,
      },
      ...(resolveKanbanExternalMcpMounts()
        ? { external_mcp_mounts: resolveKanbanExternalMcpMounts() }
        : {}),
    };
  }

  async buildImportedHydrationRecoveryRunRequest(
    args: BuildRunRequestArgs,
  ): Promise<WorkflowRunRequestV1> {
    const correlationId = args.getRequestId() ?? randomUUID();
    const causationId =
      args.getCausationId() ??
      `kanban:orchestration:recover-imported-hydration:${args.projectId}`;

    const project = await args.getProject(args.projectId).catch(() => null);
    const orchestrationMode = args.input.orchestrationMode ?? "supervised";

    const triggerInput: Record<string, unknown> = {
      scopeId: args.projectId,
      scope_id: args.projectId,
      projectId: args.projectId,
      goals: args.input.goals,
      orchestrationMode,
      orchestrationId: args.projectId,
      humanDecisionPolicy: args.selectHumanDecisionPolicy({
        orchestrationMode,
      }),
      selectedRoute: "imported-repo-synthesis-and-hydration",
      selectedRuleId: "imported_repo_hydration_recovery",
      sourceContext: args.startupContext.sourceContext,
      readinessContext: args.startupContext.readinessContext,
      startupHints: args.startupContext.startupHints,
    };

    if (project?.basePath) {
      triggerInput.basePath = project.basePath;
    }
    if (project?.repositoryUrl) {
      triggerInput.repositoryUrl = project.repositoryUrl;
    }

    return {
      workflow_id: PROJECT_DISCOVERY_WORKFLOW_ID,
      input: triggerInput,
      launch_source: "kanban_orchestration_recovery",
      context: {
        scopeId: null,
        contextId: args.projectId,
        contextType: "kanban.project",
        scopeNodeId: null,
        scopePath: null,
      },
      metadata: {
        correlation_id: correlationId,
        causation_id: causationId,
        idempotency_key: `kanban:orchestration:recover-imported-hydration:${args.projectId}`,
        requested_by: args.input.requestedBy ?? null,
      },
      ...(resolveKanbanExternalMcpMounts()
        ? { external_mcp_mounts: resolveKanbanExternalMcpMounts() }
        : {}),
    };
  }
}
