import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { IWorkflowDefinition } from "@nexus/core";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(__dirname, "../../../..");
const workflowsDir = resolve(repositoryRoot, "seed", "workflows");
const promptsDir = resolve(workflowsDir, "prompts");

function readWorkflow(filename: string): IWorkflowDefinition {
  return yaml.load(
    readFileSync(join(workflowsDir, filename), "utf8"),
  ) as IWorkflowDefinition;
}

// Subagents only receive SDK-native tools. api_callback capabilities are
// materialised as mounted tool definitions for workflow steps via
// prepareToolMount, but the subagent provisioning path writes a name
// allowlist only — no tool definitions. Source of truth:
// SDK_NATIVE_SUBAGENT_TOOLS in
// apps/api/src/workflow/workflow-subagents/subagent-tool-merge.helpers.ts
const SDK_NATIVE_SUBAGENT_TOOLS = new Set([
  "bash",
  "edit",
  "find",
  "grep",
  "ls",
  "read",
  "write",
]);

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

describe("work-item refinement workflow seed contract", () => {
  it("only grants SDK-native tools to spawned subagents in the war-room-align prompt", () => {
    const toolLists = extractSubagentToolLists(
      "work-item-refinement-default/war-room-align.md",
    );

    expect(toolLists.length).toBeGreaterThan(0);

    for (const tools of toolLists) {
      for (const tool of tools) {
        expect(
          SDK_NATIVE_SUBAGENT_TOOLS.has(tool),
          `subagent spawn template lists non-SDK-native tool '${tool}', which never materialises for a subagent`,
        ).toBe(true);
      }
    }
  });

  it("declares architect_refinement's implementation_plan as a required string", () => {
    const definition = readWorkflow(
      "work-item-refinement-default.workflow.yaml",
    );

    const architectRefinementJob = (definition.jobs ?? []).find(
      (job) => job.id === "architect_refinement",
    );

    expect(
      architectRefinementJob,
      "expected an architect_refinement job in work-item-refinement-default.workflow.yaml",
    ).toBeDefined();

    const outputContract = architectRefinementJob?.output_contract;

    expect(
      outputContract?.types?.implementation_plan,
      "architect_refinement.output_contract.types.implementation_plan must be 'string'",
    ).toBe("string");

    expect(
      outputContract?.required,
      "architect_refinement.output_contract.required must list implementation_plan",
    ).toContain("implementation_plan");

    expect(
      outputContract?.optional ?? [],
      "architect_refinement.output_contract.optional must NOT list implementation_plan",
    ).not.toContain("implementation_plan");
  });

  it("gates transition_to_todo behind a genuine refinement completion condition", () => {
    const definition = readWorkflow(
      "work-item-refinement-default.workflow.yaml",
    );

    const jobs = definition.jobs ?? [];
    const markRefinementCompletedJob = jobs.find(
      (job) => job.id === "mark_refinement_completed",
    );
    const transitionToTodoJob = jobs.find(
      (job) => job.id === "transition_to_todo",
    );

    expect(
      markRefinementCompletedJob,
      "expected a mark_refinement_completed job in work-item-refinement-default.workflow.yaml",
    ).toBeDefined();
    expect(
      transitionToTodoJob,
      "expected a transition_to_todo job in work-item-refinement-default.workflow.yaml",
    ).toBeDefined();

    const condition = transitionToTodoJob?.condition;

    expect(
      condition,
      "transition_to_todo must carry a condition — otherwise a condition-skipped " +
        "mark_refinement_completed (e.g. missing implementation_plan) still lets the " +
        "work item transition to todo with no real plan",
    ).toBeDefined();

    // The condition must require the same genuine-completion signals as
    // mark_refinement_completed's own condition, so a condition-skipped
    // mark_refinement_completed cannot be bypassed.
    expect(condition).toContain(
      "jobs.architect_refinement.output.implementation_plan",
    );
    expect(condition).toContain(
      "jobs.architect_refinement.output.subtask_blueprint",
    );
    expect(condition).toContain(
      "jobs.architect_refinement.output.split_recommendation",
    );
    expect(condition).toContain("split_required");
    expect(condition).toContain(
      "jobs.plan_validation.output.validation_result",
    );
    expect(condition).toContain(
      "jobs.materialize_refinement_subtasks.output.ok",
    );

    // It must mirror mark_refinement_completed's condition exactly, so the
    // gate can never drift out of sync with the job it depends on.
    expect(condition).toBe(markRefinementCompletedJob?.condition);
  });

  it("architect_refinement's architect_refine step has no job-level model/provider override", () => {
    // architect_refinement currently keeps the DB default model/provider
    // (no job-level inputs.model/inputs.provider override). If a future
    // change reintroduces a pin here (e.g. to work around a specific
    // model's structured-output reliability), update this assertion to
    // match rather than leaving it silently green against a value that
    // no longer reflects the YAML.
    const definition = readWorkflow(
      "work-item-refinement-default.workflow.yaml",
    );

    const architectRefinementJob = (definition.jobs ?? []).find(
      (job) => job.id === "architect_refinement",
    );

    expect(
      architectRefinementJob,
      "expected an architect_refinement job in work-item-refinement-default.workflow.yaml",
    ).toBeDefined();

    const inputs = architectRefinementJob?.inputs;

    expect(inputs?.model).toBeUndefined();
    expect(inputs?.provider).toBeUndefined();
  });
});
