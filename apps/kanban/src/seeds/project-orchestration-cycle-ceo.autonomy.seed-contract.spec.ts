import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const seedRoot = resolve(__dirname, "../../../../seed/workflows");

function readSeed(relativePath: string): string {
  return readFileSync(resolve(seedRoot, relativePath), "utf8");
}

interface WorkflowJob {
  id?: string;
  condition?: string;
  inputs?: Record<string, string>;
}

interface Workflow {
  jobs?: WorkflowJob[];
}

function loadCeoWorkflowYaml(): Workflow {
  const raw = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
  return yaml.load(raw) as Workflow;
}

describe("CEO workflow autonomy vars", () => {
  it("derives strategize/dispatch autonomous_mode from vars.autonomy.dispatch", () => {
    const wf = loadCeoWorkflowYaml();
    const strategize = wf.jobs?.find(
      (j: { id: string }) => j.id === "strategize",
    );
    const dispatch = wf.jobs?.find((j: { id: string }) => j.id === "dispatch");
    expect(strategize?.inputs?.autonomous_mode).toContain(
      "vars.autonomy.dispatch",
    );
    expect(dispatch?.inputs?.autonomous_mode).toContain(
      "vars.autonomy.dispatch",
    );
  });

  it("gates promote_safe_backlog on vars.autonomy.backlog_promotion", () => {
    const wf = loadCeoWorkflowYaml();
    const promote = wf.jobs?.find(
      (j: { id: string }) => j.id === "promote_safe_backlog",
    );
    expect(promote?.condition).toContain("vars.autonomy.backlog_promotion");
    expect(promote?.condition).not.toContain(
      "groomed_board_summary.autonomous_mode",
    );
  });

  it("promotes safe backlog while todo depth is below the target buffer, not only at zero", () => {
    const wf = loadCeoWorkflowYaml();
    const promote = wf.jobs?.find(
      (j: { id: string }) => j.id === "promote_safe_backlog",
    );
    // Fix C: the engine keeps a shallow todo buffer groomed rather than only
    // back-filling at exactly zero todo. The condition must compare todo_count
    // against the configurable target depth var (`lt`, not `eq 0`).
    expect(promote?.condition).toContain("vars.backlog.target_todo_depth");
    expect(promote?.condition).toContain("todo_count");
    expect(promote?.condition).not.toMatch(
      /groomed_board_summary\.todo_count 0/,
    );
  });
});
