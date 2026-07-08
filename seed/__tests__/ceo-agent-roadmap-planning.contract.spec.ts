// seed/__tests__/ceo-agent-roadmap-planning.contract.spec.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const AGENT_PATH = path.join(ROOT, "agents", "ceo-agent", "agent.json");

// Phase 5 regression: delegate_roadmap_planning was missing from the agent
// allow-list despite being added to the cycle YAML. Guard it here.
const ROADMAP_TOOL = "delegate_roadmap_planning";

type Rule = { effect: "allow" | "deny"; tool: string };

describe("ceo-agent allows delegate_roadmap_planning", () => {
  it("ceo-agent.json allows delegate_roadmap_planning (Phase 5 regression fix)", () => {
    const agent = JSON.parse(readFileSync(AGENT_PATH, "utf8")) as {
      tool_policy: { rules: Rule[] };
    };
    expect(
      agent.tool_policy.rules.some(
        (r) => r.tool === ROADMAP_TOOL && r.effect === "allow",
      ),
    ).toBe(true);
  });
});
