type SettingType = "boolean" | "number";

type KnownKanbanSettingConfig = {
  label: string;
  description: string;
  type: SettingType;
  group: string;
  min?: number;
  max?: number;
};

export const KNOWN_KANBAN_SETTINGS: Record<string, KnownKanbanSettingConfig> = {
  work_item_dispatch_max_active_per_project: {
    label: "Max Active Dispatches per Project",
    description:
      "Maximum active work items (in-progress/in-review/ready-to-merge) per project for auto-dispatch.",
    type: "number",
    group: "dispatch",
    min: 0,
    max: 50,
  },
  work_item_scheduler_enabled: {
    label: "Enable Critical-Path Scheduler",
    description:
      "Enable dependency-aware critical-path scheduler for coordinator dispatch recommendations.",
    type: "boolean",
    group: "dispatch",
  },
  work_item_scheduler_scope_weight_large: {
    label: "Scope Weight — Large",
    description:
      "Default critical-path effort weight for large-scope work items.",
    type: "number",
    group: "dispatch",
    min: 1,
    max: 10,
  },
  work_item_scheduler_scope_weight_standard: {
    label: "Scope Weight — Standard",
    description:
      "Default critical-path effort weight for standard-scope work items.",
    type: "number",
    group: "dispatch",
    min: 1,
    max: 10,
  },
  work_item_preflight_pipeline_enabled: {
    label: "Enable Preflight Pipeline",
    description:
      "Enable dispatch routing through refinement before in-progress execution.",
    type: "boolean",
    group: "dispatch",
  },
  work_item_preflight_required: {
    label: "Require Preflight",
    description:
      "Require refinement pipeline before in-progress, even when optional routing is disabled.",
    type: "boolean",
    group: "dispatch",
  },
  work_item_dispatch_polling_enabled: {
    label: "Enable Dispatch Polling",
    description:
      "Enable periodic polling to reconcile orchestrating projects for dispatch opportunities.",
    type: "boolean",
    group: "dispatch",
  },
  work_item_dispatch_poll_interval_seconds: {
    label: "Dispatch Poll Interval (seconds)",
    description: "Polling cadence in seconds for dispatch capacity checks.",
    type: "number",
    group: "dispatch",
    min: 5,
    max: 300,
  },
  work_item_dispatch_poll_batch_size: {
    label: "Dispatch Poll Batch Size",
    description:
      "Maximum orchestrating projects scanned per dispatch polling tick.",
    type: "number",
    group: "dispatch",
    min: 1,
    max: 200,
  },
  orchestration_auto_restart_enabled: {
    label: "Enable Auto Restart",
    description:
      "Automatically restart project orchestration after a linked workflow run fails.",
    type: "boolean",
    group: "auto-restart",
  },
  orchestration_auto_restart_max_attempts: {
    label: "Max Restart Attempts",
    description: "Maximum automatic orchestration restart attempts.",
    type: "number",
    group: "auto-restart",
    min: 1,
    max: 10,
  },
  orchestration_auto_restart_cooldown_seconds: {
    label: "Restart Cooldown (seconds)",
    description:
      "Minimum cooldown in seconds before dispatch polling reactivates failed orchestration.",
    type: "number",
    group: "auto-restart",
    min: 0,
    max: 3600,
  },
};

export const KANBAN_SETTING_GROUPS = [
  { value: "dispatch", label: "Kanban Dispatch & Scheduling" },
  { value: "auto-restart", label: "Project Orchestration Auto Restart" },
];
