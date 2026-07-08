import { describe, expect, it } from "vitest";
import {
  DEFAULT_SKILL_DISCOVERY_MODE,
  resolveSkillDiscoveryMode,
} from "./skill-discovery-mode";

describe("resolveSkillDiscoveryMode", () => {
  it("defaults to native when nothing is set", () => {
    expect(resolveSkillDiscoveryMode({})).toBe("native");
    expect(DEFAULT_SKILL_DISCOVERY_MODE).toBe("native");
  });

  it("uses the agent-profile value when only it is set", () => {
    expect(resolveSkillDiscoveryMode({ agentProfile: "search" })).toBe(
      "search",
    );
  });

  it("uses the workflow value when only it is set", () => {
    expect(resolveSkillDiscoveryMode({ workflow: "search" })).toBe("search");
  });

  it("uses the step value when only it is set", () => {
    expect(resolveSkillDiscoveryMode({ step: "search" })).toBe("search");
  });

  it("prefers step over workflow over agent profile", () => {
    expect(
      resolveSkillDiscoveryMode({
        step: "native",
        workflow: "search",
        agentProfile: "search",
      }),
    ).toBe("native");
    expect(
      resolveSkillDiscoveryMode({ workflow: "native", agentProfile: "search" }),
    ).toBe("native");
  });

  it("treats null/undefined at a level as 'not set'", () => {
    expect(
      resolveSkillDiscoveryMode({
        step: null,
        workflow: undefined,
        agentProfile: "search",
      }),
    ).toBe("search");
  });
});
