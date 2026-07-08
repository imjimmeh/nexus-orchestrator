import type {
  OrchestrationAutonomyValue,
  OrchestrationPolicyMode,
  OrchestrationPolicyKeyDescriptor,
} from "./orchestration-policy.types";
import {
  OrchestrationAutonomyValueSchema,
  OrchestrationMergeAutonomyValueSchema,
} from "./orchestration-policy.schema";

export const AUTONOMY_DISPATCH_KEY = "autonomy.dispatch";
export const AUTONOMY_BACKLOG_PROMOTION_KEY = "autonomy.backlog_promotion";
export const AUTONOMY_MERGE_KEY = "autonomy.merge";

const AUTONOMY_ENUM = OrchestrationAutonomyValueSchema.options;
const MERGE_ENUM = OrchestrationMergeAutonomyValueSchema.options;

export const ORCHESTRATION_POLICY_REGISTRY: readonly OrchestrationPolicyKeyDescriptor[] =
  [
    {
      key: AUTONOMY_DISPATCH_KEY,
      valueType: "string",
      defaultValue: "auto",
      enumValues: AUTONOMY_ENUM,
      group: "autonomy",
      label: "Dispatch",
      description:
        "Whether the CEO cycle dispatches work autonomously (auto), asks for approval (ask), or only records recommendations (off).",
    },
    {
      key: AUTONOMY_BACKLOG_PROMOTION_KEY,
      valueType: "string",
      defaultValue: "auto",
      enumValues: AUTONOMY_ENUM,
      group: "autonomy",
      label: "Backlog promotion",
      description:
        "Whether zero-todo backlog promotion happens automatically (auto), asks (ask), or is disabled (off).",
    },
    {
      key: AUTONOMY_MERGE_KEY,
      valueType: "string",
      defaultValue: "ask",
      enumValues: MERGE_ENUM,
      group: "autonomy",
      label: "Merge / high-risk transitions",
      description:
        "Whether high-risk work-item transitions proceed automatically (auto) or queue for human approval (ask).",
    },
    {
      key: "backlog.bootstrap_enabled",
      valueType: "boolean",
      defaultValue: true,
      group: "backlog",
      label: "Bootstrap enabled",
      description: "Whether bootstrap work-item generation runs.",
    },
    {
      key: "backlog.ideation_enabled",
      valueType: "boolean",
      defaultValue: true,
      group: "backlog",
      label: "Ideation enabled",
      description: "Whether the ideation gate may fire.",
    },
    {
      key: "backlog.target_todo_depth",
      valueType: "number",
      defaultValue: 3,
      group: "backlog",
      label: "Target todo depth",
      description:
        "Todo-queue depth the engine keeps groomed: while todo_count is below this, the deterministic promote_safe_backlog job back-fills ready backlog instead of waiting for the queue to hit zero.",
      min: 0,
      max: 50,
      step: 1,
    },
    {
      key: "gates.rediscovery_merge_threshold",
      valueType: "number",
      defaultValue: 10,
      group: "gates",
      label: "Rediscovery merge threshold",
      description:
        "Merges-since-discovery count at/above which deep rediscovery is triggered.",
      min: 1,
      max: 100,
      step: 1,
    },
    {
      key: "gates.roadmap_when_no_active_initiative",
      valueType: "boolean",
      defaultValue: true,
      group: "gates",
      label: "Roadmap when no active initiative",
      description:
        "Whether roadmap planning fires when there is no active now-horizon initiative.",
    },
    {
      key: "gates.ideation_starvation_cycles",
      valueType: "number",
      defaultValue: 2,
      group: "gates",
      label: "Ideation starvation cycles",
      description: "Starvation-forecast cycles at/under which ideation fires.",
      min: 0,
      max: 20,
      step: 1,
    },
    {
      key: "promotion.max_items_per_cycle",
      valueType: "number",
      defaultValue: -1,
      group: "promotion",
      label: "Max promotions per cycle",
      description:
        "Promotion volume cap per cycle. -1 = unbounded, 0 = disabled.",
      min: -1,
      max: 100,
      step: 1,
    },
  ];

const REGISTRY_BY_KEY = new Map(
  ORCHESTRATION_POLICY_REGISTRY.map((d) => [d.key, d]),
);

export function findPolicyDescriptor(
  key: string,
): OrchestrationPolicyKeyDescriptor | undefined {
  return REGISTRY_BY_KEY.get(key);
}

export function autonomyValuesForMode(
  mode: OrchestrationPolicyMode,
): Record<string, OrchestrationAutonomyValue> {
  switch (mode) {
    case "autonomous":
      return {
        [AUTONOMY_DISPATCH_KEY]: "auto",
        [AUTONOMY_BACKLOG_PROMOTION_KEY]: "auto",
        [AUTONOMY_MERGE_KEY]: "auto",
      };
    case "supervised":
      return {
        [AUTONOMY_DISPATCH_KEY]: "ask",
        [AUTONOMY_BACKLOG_PROMOTION_KEY]: "ask",
        [AUTONOMY_MERGE_KEY]: "ask",
      };
    case "notifications_only":
      return {
        [AUTONOMY_DISPATCH_KEY]: "off",
        [AUTONOMY_BACKLOG_PROMOTION_KEY]: "off",
        [AUTONOMY_MERGE_KEY]: "ask",
      };
  }
}

export function modeFromAutonomyValues(
  values: Record<string, unknown>,
): OrchestrationPolicyMode {
  const dispatch = values[AUTONOMY_DISPATCH_KEY];
  if (dispatch === "off") return "notifications_only";
  if (dispatch === "ask") return "supervised";
  return "autonomous";
}

function validateBoolean(
  key: string,
  value: unknown,
): { ok: true } | { ok: false; error: string } {
  if (typeof value !== "boolean") {
    return { ok: false, error: `${key} expects a boolean` };
  }
  return { ok: true };
}

function validateNumber(
  key: string,
  value: unknown,
  descriptor: OrchestrationPolicyKeyDescriptor,
): { ok: true } | { ok: false; error: string } {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return { ok: false, error: `${key} expects a number` };
  }
  if (descriptor.min !== undefined && value < descriptor.min) {
    return { ok: false, error: `${key} must be >= ${descriptor.min}` };
  }
  if (descriptor.max !== undefined && value > descriptor.max) {
    return { ok: false, error: `${key} must be <= ${descriptor.max}` };
  }
  return { ok: true };
}

function validateString(
  key: string,
  value: unknown,
  descriptor: OrchestrationPolicyKeyDescriptor,
): { ok: true } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: `${key} expects a string` };
  }
  if (descriptor.enumValues && !descriptor.enumValues.includes(value)) {
    return {
      ok: false,
      error: `${key} must be one of ${descriptor.enumValues.join(", ")}`,
    };
  }
  return { ok: true };
}

export function validatePolicyEntry(
  key: string,
  value: unknown,
): { ok: true } | { ok: false; error: string } {
  const descriptor = REGISTRY_BY_KEY.get(key);
  if (!descriptor) {
    return { ok: false, error: `Unknown orchestration policy key: ${key}` };
  }

  switch (descriptor.valueType) {
    case "boolean":
      return validateBoolean(key, value);
    case "number":
      return validateNumber(key, value, descriptor);
    case "string":
      return validateString(key, value, descriptor);
  }
}
