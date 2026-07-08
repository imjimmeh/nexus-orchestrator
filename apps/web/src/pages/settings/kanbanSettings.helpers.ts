import { KanbanSetting } from "@/lib/api/settings.types";
import {
  KANBAN_SETTING_GROUPS,
  KNOWN_KANBAN_SETTINGS,
} from "./kanbanSettings.constants";

type KanbanSettingsEditState = {
  booleans: Record<string, boolean>;
  numbers: Record<string, string>;
};

function updateEditStateForSetting(
  state: KanbanSettingsEditState,
  setting: KanbanSetting,
): void {
  const config = KNOWN_KANBAN_SETTINGS[setting.key];
  if (!config) {
    return;
  }

  if (config.type === "boolean") {
    state.booleans[setting.key] = Boolean(setting.value);
  }
  if (config.type === "number") {
    state.numbers[setting.key] = String(Number(setting.value));
  }
}

export function buildKanbanSettingsEditState(
  settings: KanbanSetting[],
): KanbanSettingsEditState {
  const state: KanbanSettingsEditState = { booleans: {}, numbers: {} };
  for (const setting of settings) updateEditStateForSetting(state, setting);
  return state;
}

export function groupKanbanSettings(
  settings: KanbanSetting[],
): Record<string, KanbanSetting[]> {
  const grouped: Record<string, KanbanSetting[]> = {};
  for (const group of KANBAN_SETTING_GROUPS) grouped[group.value] = [];
  for (const setting of settings) {
    const config = KNOWN_KANBAN_SETTINGS[setting.key];
    if (config && grouped[config.group]) grouped[config.group].push(setting);
  }
  return grouped;
}
