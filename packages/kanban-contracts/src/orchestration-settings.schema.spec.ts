import { describe, it, expect } from "vitest";
import { resolveProjectOrchestrationSettings } from "./orchestration-settings.schema";

describe("resolveProjectOrchestrationSettings", () => {
  it("returns empty object for null/undefined", () => {
    expect(resolveProjectOrchestrationSettings(null)).toEqual({});
    expect(resolveProjectOrchestrationSettings(undefined)).toEqual({});
  });

  it("passes through a valid wakePolicy", () => {
    expect(
      resolveProjectOrchestrationSettings({ wakePolicy: "every_terminal" }),
    ).toEqual({ wakePolicy: "every_terminal" });
  });

  it("drops an invalid wakePolicy back to empty", () => {
    expect(
      resolveProjectOrchestrationSettings({ wakePolicy: "bogus" }),
    ).toEqual({});
  });
});
