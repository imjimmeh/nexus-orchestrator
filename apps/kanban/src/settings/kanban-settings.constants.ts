import type { KanbanSettingKey } from "@nexus/kanban-contracts";

type KanbanSettingType = "boolean" | "number" | "string";
type KanbanSettingGroup =
  | "dispatch"
  | "auto-restart"
  | "work-item-lease"
  | "orchestration";

type KanbanSettingDefinition = {
  value: boolean | number | string;
  description: string;
  type: KanbanSettingType;
  group: KanbanSettingGroup;
  min?: number;
  max?: number;
  options?: readonly string[];
};

export const ORCHESTRATION_AUTO_RESTART_COOLDOWN_SECONDS_ENV_KEY =
  "ORCHESTRATION_AUTO_RESTART_COOLDOWN_SECONDS";
export const ORCHESTRATION_AUTO_RESTART_COOLDOWN_DEFAULT_SECONDS = 300;

export const KANBAN_SETTING_DEFAULTS: Record<
  KanbanSettingKey,
  KanbanSettingDefinition
> = {
  work_item_dispatch_max_active_per_project: {
    value: 3,
    description:
      "Maximum active work items (in-progress/in-review/ready-to-merge) per project for auto-dispatch.",
    type: "number",
    group: "dispatch",
    min: 0,
    max: 50,
  },
  work_item_scheduler_enabled: {
    value: false,
    description:
      "Enable dependency-aware critical-path scheduler for coordinator dispatch recommendations.",
    type: "boolean",
    group: "dispatch",
  },
  work_item_scheduler_scope_weight_large: {
    value: 2,
    description:
      "Default critical-path effort weight for large-scope work items.",
    type: "number",
    group: "dispatch",
    min: 1,
    max: 10,
  },
  work_item_scheduler_scope_weight_standard: {
    value: 1,
    description:
      "Default critical-path effort weight for standard-scope work items.",
    type: "number",
    group: "dispatch",
    min: 1,
    max: 10,
  },
  work_item_preflight_pipeline_enabled: {
    value: false,
    description:
      "Enable dispatch routing through refinement before in-progress execution.",
    type: "boolean",
    group: "dispatch",
  },
  work_item_preflight_required: {
    value: false,
    description:
      "Require refinement pipeline before in-progress, even when optional routing is disabled.",
    type: "boolean",
    group: "dispatch",
  },
  work_item_dispatch_polling_enabled: {
    value: false,
    description:
      "Enable periodic polling to reconcile orchestrating projects for dispatch opportunities.",
    type: "boolean",
    group: "dispatch",
  },
  work_item_dispatch_poll_interval_seconds: {
    value: 30,
    description: "Polling cadence in seconds for dispatch capacity checks.",
    type: "number",
    group: "dispatch",
    min: 5,
    max: 300,
  },
  work_item_dispatch_poll_batch_size: {
    value: 50,
    description:
      "Maximum orchestrating projects scanned per dispatch polling tick.",
    type: "number",
    group: "dispatch",
    min: 1,
    max: 200,
  },
  orchestration_auto_restart_enabled: {
    value: true,
    description:
      "Automatically restart project orchestration after a linked workflow run fails.",
    type: "boolean",
    group: "auto-restart",
  },
  orchestration_auto_restart_max_attempts: {
    value: 3,
    description:
      "Maximum number of automatic orchestration restart attempts recorded in orchestration decision history.",
    type: "number",
    group: "auto-restart",
    min: 1,
    max: 10,
  },
  orchestration_auto_restart_cooldown_seconds: {
    value: resolveOrchestrationAutoRestartCooldownSecondsDefault(),
    description:
      "Minimum cooldown in seconds before dispatch polling reactivates failed orchestration.",
    type: "number",
    group: "auto-restart",
    min: 0,
    max: 3600,
  },
  work_item_run_lease_enabled: {
    value: true,
    description:
      "Enable the per-work-item orchestration lease for requestWorkItemRun. When false, requestWorkItemRun skips the per-work-item lease acquisition/release and falls back to the pre-ADR conditional linkRunIfUnlinked UPDATE only — see ADR-20260623-work-item-run-link-lease.md and the rollback runbook at docs/operations/README.md#work-item-run-link-lease-contention.",
    type: "boolean",
    group: "work-item-lease",
  },
  orchestration_wake_policy: {
    value: "slot_freed",
    description:
      "When to wake the Project Orchestration Cycle on a terminal work-item run. 'slot_freed' wakes only when the item frees its dispatch slot (e.g. merge into done); 'every_terminal' wakes on every terminal run (legacy).",
    type: "string",
    group: "orchestration",
    options: ["slot_freed", "every_terminal"],
  },
  self_improvement_project_id: {
    value: "",
    description:
      "Project id that receives improvement.task.requested engineering briefs from core as new work items. Empty disables filing — events are parked (warning + dead letter). See docs/operations/self-improvement-project.md.",
    type: "string",
    group: "orchestration",
  },
};

export function isKanbanSettingKey(key: string): key is KanbanSettingKey {
  return Object.prototype.hasOwnProperty.call(KANBAN_SETTING_DEFAULTS, key);
}

function resolveOrchestrationAutoRestartCooldownSecondsDefault(): number {
  const raw = process.env[ORCHESTRATION_AUTO_RESTART_COOLDOWN_SECONDS_ENV_KEY];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return ORCHESTRATION_AUTO_RESTART_COOLDOWN_DEFAULT_SECONDS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return ORCHESTRATION_AUTO_RESTART_COOLDOWN_DEFAULT_SECONDS;
  }

  return Math.trunc(parsed);
}
