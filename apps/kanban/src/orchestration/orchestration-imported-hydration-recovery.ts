import { BadRequestException } from "@nestjs/common";
import type { BaseRequestContextService } from "@nexus/core";
import type { ProjectOrchestration } from "@nexus/kanban-contracts";
import type { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import type { OrchestrationPersistenceRecord } from "./orchestration-internal.types";
import { OrchestrationRunRequestService } from "./orchestration-run-request.service";
import { OrchestrationStateLifecycleService } from "./orchestration-state-lifecycle.service";
import type { HumanDecisionResolutionPolicyService } from "./human-decision-resolution-policy.service";
import type { ProjectService } from "../project/project.service";

type CoreWorkflowRequester = Pick<
  CoreWorkflowClientService,
  "requestWorkflowRun"
>;

type ImportedHydrationRecoveryDeps = {
  coreClient: CoreWorkflowRequester;
  projects: ProjectService;
  requestContext: BaseRequestContextService;
  humanDecisionPolicy: HumanDecisionResolutionPolicyService;
  stateLifecycleService: OrchestrationStateLifecycleService;
  runRequestService: OrchestrationRunRequestService;
  requirePersistenceState: (
    projectId: string,
  ) => Promise<OrchestrationPersistenceRecord>;
  clearImportHydrationBlocked: (
    projectId: string,
    input: { cleared_stage: string; ready_for_cycle: boolean },
  ) => Promise<void>;
  clearCycleDecision: (
    projectId: string,
    input: { reason: string },
  ) => Promise<void>;
  savePersistenceState: (
    existing: OrchestrationPersistenceRecord,
    updates: Partial<OrchestrationPersistenceRecord>,
  ) => Promise<OrchestrationPersistenceRecord>;
  toProjectOrchestration: (
    state: OrchestrationPersistenceRecord,
  ) => ProjectOrchestration;
};

export async function recoverImportedHydration(
  project_id: string,
  deps: ImportedHydrationRecoveryDeps,
): Promise<ProjectOrchestration> {
  const existing = await deps.requirePersistenceState(project_id);
  const orchestrationMode =
    existing.mode === "autonomous" ? "autonomous" : "supervised";
  const metadata = deps.stateLifecycleService.getRecordMetadata(
    existing.metadata,
  );
  const startupContext = deps.stateLifecycleService.resolveStartupContext(
    metadata,
    {
      goals: existing.goals,
      orchestrationMode,
    },
  );

  const sourceContext = startupContext.sourceContext as
    | Record<string, unknown>
    | undefined;
  let sourceType: string | null = null;
  if (typeof sourceContext?.sourceType === "string") {
    sourceType = sourceContext.sourceType;
  } else if (typeof sourceContext?.source_type === "string") {
    sourceType = sourceContext.source_type;
  }
  const blockedStage =
    typeof metadata.blocked_stage === "string" ? metadata.blocked_stage : null;
  const isImportedRecovery =
    sourceType === "import_remote" ||
    blockedStage === "imported_repo_hydration";
  if (!isImportedRecovery) {
    throw new BadRequestException(
      "Imported hydration recovery is only available for imported repository orchestrations.",
    );
  }

  const accepted = await deps.coreClient.requestWorkflowRun(
    await deps.runRequestService.buildImportedHydrationRecoveryRunRequest({
      projectId: project_id,
      input: {
        goals: existing.goals,
        orchestrationMode,
      },
      startupContext,
      getRequestId: () => deps.requestContext.getRequestId(),
      getCausationId: () => deps.requestContext.getCausationId(),
      getProject: (pid) => deps.projects.get(pid).catch(() => null),
      selectHumanDecisionPolicy: ({ orchestrationMode }) =>
        deps.humanDecisionPolicy.selectPolicy({ orchestrationMode }),
    }),
  );

  await deps.clearImportHydrationBlocked(project_id, {
    cleared_stage: "imported_repo_hydration",
    ready_for_cycle: false,
  });
  await deps.clearCycleDecision(project_id, {
    reason: "Imported hydration recovery launched.",
  });

  const current = await deps.requirePersistenceState(project_id);
  return deps.toProjectOrchestration(
    await deps.savePersistenceState(current, {
      status: "orchestrating",
      linked_run_id: accepted.run_id,
    }),
  );
}
