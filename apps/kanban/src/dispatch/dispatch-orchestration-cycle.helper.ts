const ORCHESTRATION_LIFECYCLE_WORK_ITEM_ID = "__orchestration_lifecycle__";

interface OrchestrationCycleEventInput {
  projectId: string;
  source: string;
  reason: string;
  dedupeKey: string;
  basePath: string | null;
  repositoryUrl: string | null;
}

/**
 * Builds the `ProjectOrchestrationCycleRequestedEvent` emitted when a cycle is
 * requested. Carries the imported repo's host-visible workspace root so
 * downstream delegations can resolve a real `workspace_root` instead of
 * stalling on an empty trigger.
 */
export function buildOrchestrationCycleEvent(
  input: OrchestrationCycleEventInput,
): {
  eventName: "ProjectOrchestrationCycleRequestedEvent";
  payload: Record<string, unknown>;
} {
  return {
    eventName: "ProjectOrchestrationCycleRequestedEvent",
    payload: {
      scopeId: input.projectId,
      workItemId: ORCHESTRATION_LIFECYCLE_WORK_ITEM_ID,
      source: input.source,
      reason: input.reason,
      dedupeKey: input.dedupeKey,
      ...(input.basePath ? { basePath: input.basePath } : {}),
      ...(input.repositoryUrl ? { repositoryUrl: input.repositoryUrl } : {}),
    },
  };
}
