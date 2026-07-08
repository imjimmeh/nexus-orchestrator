import { SystemSetting } from "@/lib/api/settings.types";
import { KNOWN_SETTINGS, SETTING_GROUPS } from "./systemSettings.constants";

export function parseNumberInput(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export function getSettingRiskWarning(
  key: string,
  value: unknown,
): string | null {
  if (
    key === "max_concurrent_subagents_per_workflow" &&
    typeof value === "number" &&
    value > 8
  ) {
    return "High concurrency can exhaust runner capacity and increase merge conflicts.";
  }
  if (key === "agent_war_room_auto_ceo_tie_break" && value === true) {
    return "CEO tie-break bypasses consensus requirements.";
  }
  if (key === "workflow_host_mount_rw_approval_required" && value === false) {
    return "RW mounts will be allowed without explicit approval.";
  }
  return null;
}

export function getNumberRangeError(
  parsed: number | null,
  min?: number,
  max?: number,
): string | null {
  if (parsed === null || min === undefined || max === undefined) {
    return null;
  }
  return parsed < min || parsed > max
    ? `Value must be between ${min} and ${max}.`
    : null;
}

export function getNumberMinError(
  parsed: number | null,
  min?: number,
  max?: number,
): string | null {
  if (parsed === null || min === undefined || max !== undefined) {
    return null;
  }
  return parsed < min ? `Value must be at least ${min}.` : null;
}

function toStringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...(value as string[])];
}

function toJsonObjectValue(value: unknown): Record<string, string> {
  const obj: Record<string, string> = {};
  if (typeof value !== "object" || value === null) {
    return obj;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    obj[k] = JSON.stringify(v);
  }
  return obj;
}

function updateEditStateForSetting(
  state: {
    booleans: Record<string, boolean>;
    numbers: Record<string, string>;
    stringArrays: Record<string, string[]>;
    jsonObjects: Record<string, Record<string, string>>;
  },
  setting: SystemSetting,
) {
  const config = KNOWN_SETTINGS[setting.key];
  if (!config) {
    return;
  }

  switch (config.type) {
    case "boolean":
      state.booleans[setting.key] = Boolean(setting.value);
      break;
    case "number":
      state.numbers[setting.key] = String(Number(setting.value));
      break;
    case "string_array":
      state.stringArrays[setting.key] = toStringArrayValue(setting.value);
      break;
    case "json":
      state.jsonObjects[setting.key] = toJsonObjectValue(setting.value);
      break;
  }
}

export function buildSystemSettingsEditState(settings: SystemSetting[]) {
  const booleans: Record<string, boolean> = {};
  const numbers: Record<string, string> = {};
  const stringArrays: Record<string, string[]> = {};
  const jsonObjects: Record<string, Record<string, string>> = {};
  const state = { booleans, numbers, stringArrays, jsonObjects };

  for (const setting of settings) {
    updateEditStateForSetting(state, setting);
  }

  return state;
}

export function groupSystemSettings(settings: SystemSetting[]) {
  const filtered = settings.filter(
    (setting) =>
      setting.key in KNOWN_SETTINGS && !setting.key.startsWith("telegram_"),
  );
  const grouped: Record<string, SystemSetting[]> = {};
  for (const group of SETTING_GROUPS) {
    grouped[group.value] = [];
  }
  for (const setting of filtered) {
    const config = KNOWN_SETTINGS[setting.key];
    if (config && grouped[config.group]) {
      grouped[config.group].push(setting);
    }
  }
  return grouped;
}
