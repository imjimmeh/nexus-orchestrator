import { describe, expect, it } from "vitest";
import type { AgentProfileChangePayload } from "@nexus/core";
import { formatProfilePatchEntries } from "./improvements-detail.helpers";

function buildPayload(
  overrides: Partial<AgentProfileChangePayload["patch"]>,
): AgentProfileChangePayload {
  return {
    profileName: "implement-agent",
    changeSummary: "Tighten the linter guidance.",
    patch: { ...overrides },
  };
}

describe("formatProfilePatchEntries", () => {
  it("renders a system_prompt append patch as a single entry with no `from` when there is no snapshot yet", () => {
    const payload = buildPayload({
      system_prompt: { mode: "append", value: "Always run the linter." },
    });

    const entries = formatProfilePatchEntries(payload, null);

    expect(entries).toEqual([
      { field: "system_prompt (append)", to: "Always run the linter." },
    ]);
  });

  it("fills `from` from the rollback snapshot once the proposal has applied", () => {
    const payload = buildPayload({
      system_prompt: { mode: "replace", value: "Be extremely terse." },
    });

    const entries = formatProfilePatchEntries(payload, {
      system_prompt: "Be helpful and thorough.",
    });

    expect(entries).toEqual([
      {
        field: "system_prompt (replace)",
        from: "Be helpful and thorough.",
        to: "Be extremely terse.",
      },
    ]);
  });

  it("renders scalar field changes (model_name, provider_name, thinking_level, tool_policy)", () => {
    const payload = buildPayload({
      model_name: "claude-sonnet-5",
      provider_name: "anthropic",
      thinking_level: "high",
      tool_policy: { allow: ["read_file"] },
    });

    const entries = formatProfilePatchEntries(payload, {
      model_name: "gpt-5",
      provider_name: "openai",
      thinking_level: null,
      tool_policy: null,
    });

    expect(entries).toEqual([
      { field: "model_name", from: "gpt-5", to: "claude-sonnet-5" },
      { field: "provider_name", from: "openai", to: "anthropic" },
      { field: "thinking_level", from: "(none)", to: "high" },
      {
        field: "tool_policy",
        from: "(none)",
        to: JSON.stringify({ allow: ["read_file"] }),
      },
    ]);
  });

  it("renders assigned_skills add/remove as separate entries", () => {
    const payload = buildPayload({
      assigned_skills: { add: ["retry-with-backoff"], remove: ["stale-skill"] },
    });

    const entries = formatProfilePatchEntries(payload, {
      assigned_skills: ["stale-skill", "other-skill"],
    });

    expect(entries).toEqual([
      {
        field: "assigned_skills (add)",
        from: "stale-skill, other-skill",
        to: "retry-with-backoff",
      },
      {
        field: "assigned_skills (remove)",
        from: "stale-skill, other-skill",
        to: "stale-skill",
      },
    ]);
  });

  it("only renders an add entry when the patch has no removals", () => {
    const payload = buildPayload({
      assigned_skills: { add: ["retry-with-backoff"] },
    });

    const entries = formatProfilePatchEntries(payload, null);

    expect(entries).toEqual([
      { field: "assigned_skills (add)", to: "retry-with-backoff" },
    ]);
  });
});
