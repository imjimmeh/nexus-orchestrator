export interface PreparedWorkflowLaunchTrigger {
  triggerData: Record<string, unknown>;
  launchDedupeKey?: string;
}
