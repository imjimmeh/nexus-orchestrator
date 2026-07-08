export const WORKFLOW_LIFECYCLE_STATUS_GROUPS = {
  dispatchActive: ["active", "paused", "on-hold", "queued"],
  meshDelegationActive: ["running"],
  uiActiveSession: [
    "pending",
    "queued",
    "running",
    "active",
    "paused",
    "on-hold",
  ],
  terminal: ["completed", "failed", "cancelled", "canceled"],
  blockedOrPaused: ["blocked", "paused", "on-hold"],
} as const;

export type WorkflowLifecycleStatusGroup =
  keyof typeof WORKFLOW_LIFECYCLE_STATUS_GROUPS;

export function getWorkflowLifecycleStatuses(
  group: WorkflowLifecycleStatusGroup,
): readonly string[] {
  return WORKFLOW_LIFECYCLE_STATUS_GROUPS[group];
}

export function isWorkflowLifecycleStatusInGroup(
  status: string,
  group: WorkflowLifecycleStatusGroup,
): boolean {
  return WORKFLOW_LIFECYCLE_STATUS_GROUPS[group].includes(status as never);
}
