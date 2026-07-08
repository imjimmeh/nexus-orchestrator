import { describe, it, expect } from "vitest";
import {
  KANBAN_SETTING_DEFAULTS,
  isKanbanSettingKey,
} from "./kanban-settings.constants";

describe("orchestration_wake_policy setting", () => {
  it("is a known key", () => {
    expect(isKanbanSettingKey("orchestration_wake_policy")).toBe(true);
  });

  it("defaults to slot_freed", () => {
    expect(KANBAN_SETTING_DEFAULTS.orchestration_wake_policy.value).toBe(
      "slot_freed",
    );
  });

  it("is a string-typed orchestration setting", () => {
    const def = KANBAN_SETTING_DEFAULTS.orchestration_wake_policy;
    expect(def.type).toBe("string");
    expect(def.group).toBe("orchestration");
  });
});

describe("self_improvement_project_id setting", () => {
  it("is a registered setting key", () => {
    expect(isKanbanSettingKey("self_improvement_project_id")).toBe(true);
  });

  it("defaults to empty (filing disabled) in the orchestration group", () => {
    const definition = KANBAN_SETTING_DEFAULTS.self_improvement_project_id;
    expect(definition.value).toBe("");
    expect(definition.type).toBe("string");
    expect(definition.group).toBe("orchestration");
  });
});
