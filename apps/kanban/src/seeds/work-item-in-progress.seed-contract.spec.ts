import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { IWorkflowDefinition } from "@nexus/core";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(__dirname, "../../../..");
const workflowsDir = resolve(repositoryRoot, "seed", "workflows");
const promptsDir = resolve(workflowsDir, "prompts");

// Subagents receive SDK-native tools plus projected delegation tools that are
// materialised from the workflow delegation catalog.
const SUPPORTED_SUBAGENT_TOOLS = new Set([
  "bash",
  "delegate_ui_ux_testing",
  "delegate_web_research",
  "edit",
  "find",
  "grep",
  "ls",
  "read",
  "write",
]);

function readWorkflow(filename: string): IWorkflowDefinition {
  return yaml.load(
    readFileSync(join(workflowsDir, filename), "utf8"),
  ) as IWorkflowDefinition;
}

function extractSubagentToolLists(promptRelativePath: string): string[][] {
  const prompt = readFileSync(join(promptsDir, promptRelativePath), "utf8");
  const toolListPattern = /tools:\s*\[([^\]]*)\]/g;
  return [...prompt.matchAll(toolListPattern)].map((match) =>
    match[1]
      .split(",")
      .map((tool) => tool.trim().replaceAll(/["']/g, ""))
      .filter((tool) => tool.length > 0),
  );
}

function readPrompt(promptRelativePath: string): string {
  return readFileSync(join(promptsDir, promptRelativePath), "utf8");
}

describe("work-item in-progress workflow seed contract", () => {
  it("declares a runtime tier for every job", () => {
    const definition = readWorkflow(
      "work-item-in-progress-default.workflow.yaml",
    );

    for (const job of definition.jobs ?? []) {
      expect(job.tier, `${job.id} must declare tier`).toMatch(
        /^(light|heavy)$/,
      );
    }
  });

  it("only grants supported tools to spawned subagents in the implement prompt", () => {
    const toolLists = extractSubagentToolLists(
      "work-item-in-progress-default/implement.md",
    );

    expect(toolLists.length).toBeGreaterThan(0);

    for (const tools of toolLists) {
      for (const tool of tools) {
        expect(
          SUPPORTED_SUBAGENT_TOOLS.has(tool),
          `subagent spawn template lists unsupported tool '${tool}'`,
        ).toBe(true);
      }
    }
  });

  it("only grants SDK-native tools to spawned subagents in the war-room-align prompt", () => {
    const toolLists = extractSubagentToolLists(
      "work-item-in-progress-default/war-room-align.md",
    );

    expect(toolLists.length).toBeGreaterThan(0);

    for (const tools of toolLists) {
      for (const tool of tools) {
        expect(
          SUPPORTED_SUBAGENT_TOOLS.has(tool),
          `subagent spawn template lists unsupported tool '${tool}'`,
        ).toBe(true);
      }
    }
  });

  it("keeps the war-room alignment prompt resumable and idempotent", () => {
    const prompt = readPrompt(
      "work-item-in-progress-default/war-room-align.md",
    );
    const stateReadIndex = prompt.indexOf("`get_war_room_state`");
    const openIndex = prompt.indexOf("`open_war_room`");

    expect(prompt).toContain(
      "Stable session ID: `plan-alignment-{{trigger.contextId}}`",
    );
    expect(stateReadIndex).toBeGreaterThanOrEqual(0);
    expect(openIndex).toBeGreaterThanOrEqual(0);
    expect(stateReadIndex).toBeLessThan(openIndex);
    expect(prompt).toContain(
      "Resume from persisted war-room state; never restart from Step 1 if the room exists.",
    );
    expect(prompt).toContain(
      "Do not repost an existing plan-under-review blackboard version or reviewer question message.",
    );
    expect(prompt).toContain(
      "session_id: plan-alignment-{{trigger.contextId}}",
    );
    expect(prompt).not.toContain("topic:");
  });

  it("grants every parent tool required by the war-room alignment prompt", () => {
    const definition = readWorkflow(
      "work-item-in-progress-default.workflow.yaml",
    );
    const job = definition.jobs?.find(
      (candidate) => candidate.id === "war_room_plan_alignment",
    );
    const rules: Array<Record<string, unknown>> =
      job?.permissions &&
      typeof job.permissions === "object" &&
      "tool_policy" in job.permissions &&
      job.permissions.tool_policy &&
      typeof job.permissions.tool_policy === "object" &&
      "rules" in job.permissions.tool_policy &&
      Array.isArray(job.permissions.tool_policy.rules)
        ? (job.permissions.tool_policy.rules as unknown as Array<
            Record<string, unknown>
          >)
        : [];
    const allowedTools = rules
      .filter(
        (rule) => rule.effect === "allow" && typeof rule.tool === "string",
      )
      .map((rule) => rule.tool);

    expect(allowedTools).toContain("wait_for_subagents");
  });

  it("documents a fallback when delta replan has no markdown spec path", () => {
    const prompt = readPrompt("work-item-in-progress-default/delta-replan.md");

    expect(prompt).toContain(
      "{{#if trigger.resource.metadata.workItemMarkdownPath}}",
    );
    expect(prompt).toContain(
      "Do not fail solely because `workItemMarkdownPath` is absent.",
    );
    expect(prompt).not.toContain(
      "Read `{{trigger.resource.metadata.workItemMarkdownPath}}` completely.",
    );
  });
});
