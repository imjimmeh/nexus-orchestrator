import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseYamlToGraph } from "./yaml-to-graph";

const SEED_DIR = path.resolve(__dirname, "../../../../../../seed/workflows");

function readSeed(filename: string): string {
  return readFileSync(path.join(SEED_DIR, filename), "utf-8");
}

describe("parseYamlToGraph", () => {
  it("parses a two-job workflow with a dependency edge", () => {
    const parsed = parseYamlToGraph(`
workflow_id: sample-workflow
name: Sample Workflow
jobs:
  prepare:
    type: execution
  finish:
    type: execution
    depends_on:
      - prepare
`);

    expect(parsed.metadata.workflowId).toBe("sample-workflow");
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes.map((node) => node.id)).toEqual(["prepare", "finish"]);
    expect(parsed.edges).toEqual([
      {
        id: "prepare->finish:dependency",
        source: "prepare",
        target: "finish",
        data: { kind: "dependency" },
      },
    ]);
  });

  it("lays out dependent jobs after their sources", () => {
    const parsed = parseYamlToGraph(`
workflow_id: sample-workflow
name: Sample Workflow
jobs:
  - id: finish
    type: execution
    depends_on:
      - prepare
  - id: prepare
    type: execution
`);

    const source = parsed.nodes.find((node) => node.id === "prepare");
    const dependent = parsed.nodes.find((node) => node.id === "finish");

    expect(source?.position.x).toBe(0);
    expect(dependent?.position.x).toBe(360);
  });

  it("throws on malformed YAML", () => {
    expect(() => parseYamlToGraph("not: valid: yaml:")).toThrow(/malformed/i);
  });

  it("parses an execution job with inner steps", () => {
    const parsed = parseYamlToGraph(`
workflow_id: test
name: Test
jobs:
  - id: main
    type: execution
    steps:
      - id: step1
        type: agent
        prompt: "Do the thing"
      - id: step2
        type: run_command
        command: "echo hello"
`);

    const jobNode = parsed.nodes.find((node) => node.type === "job");
    const stepNodes = parsed.nodes.filter((node) => node.type === "step");

    expect(jobNode?.id).toBe("main");
    expect(stepNodes).toHaveLength(2);
    expect(stepNodes[0].id).toBe("main.step1");
    expect(stepNodes[1].id).toBe("main.step2");
    expect(stepNodes[0].data).toMatchObject({
      stepType: "agent",
      prompt: "Do the thing",
    });
    expect(stepNodes[1].data).toMatchObject({
      stepType: "run_command",
      command: "echo hello",
    });
  });

  it("parses needs-based dependencies with result policies", () => {
    const parsed = parseYamlToGraph(`
workflow_id: test
name: Test
jobs:
  - id: provision
    type: git_operation
  - id: build
    type: execution
    needs:
      - job: provision
        result: success
      - job: setup
        result: success_or_skipped
        optional: true
`);

    expect(parsed.nodes).toHaveLength(2);
    const dependencyEdges = parsed.edges.filter(
      (edge) => edge.data?.kind === "dependency",
    );
    expect(dependencyEdges).toHaveLength(2);

    const provisionEdge = dependencyEdges.find(
      (edge) => edge.source === "provision",
    );
    expect(provisionEdge?.data).toMatchObject({
      kind: "dependency",
      resultPolicy: "success",
    });

    const setupEdge = dependencyEdges.find((edge) => edge.source === "setup");
    expect(setupEdge?.data).toMatchObject({
      kind: "dependency",
      resultPolicy: "success_or_skipped",
      optional: true,
    });
  });

  it("parses transition edges between jobs", () => {
    const parsed = parseYamlToGraph(`
workflow_id: test
name: Test
jobs:
  - id: source
    type: execution
    transitions:
      - condition: "{{ success }}"
        next: target_a
      - condition: "{{ failed }}"
        next: target_b
  - id: target_a
    type: execution
  - id: target_b
    type: execution
`);

    const transitionEdges = parsed.edges.filter(
      (edge) => edge.data?.kind === "transition",
    );
    expect(transitionEdges).toHaveLength(2);

    expect(transitionEdges[0]).toMatchObject({
      source: "source",
      target: "target_a",
      data: {
        kind: "transition",
        condition: "{{ success }}",
        target: "target_a",
      },
    });
    expect(transitionEdges[1]).toMatchObject({
      source: "source",
      target: "target_b",
      data: {
        kind: "transition",
        condition: "{{ failed }}",
        target: "target_b",
      },
    });
  });

  it("parses switch/case and default routing", () => {
    const parsed = parseYamlToGraph(`
workflow_id: test
name: Test
jobs:
  - id: router
    type: execution
    switch:
      - case: "{{ trigger.fast }}"
        inputs:
          mode: fast
          next: fast_job
    default:
      inputs:
        mode: fallback
        next: fallback_job
  - id: fast_job
    type: execution
  - id: fallback_job
    type: execution
`);

    const switchEdges = parsed.edges.filter(
      (edge) => edge.data?.kind === "switch",
    );
    expect(switchEdges).toHaveLength(2);

    const caseEdge = switchEdges.find((edge) => !edge.data?.isDefault);
    expect(caseEdge).toMatchObject({
      source: "router",
      target: "fast_job",
      data: {
        kind: "switch",
        caseCondition: "{{ trigger.fast }}",
        inputs: { mode: "fast", next: "fast_job" },
      },
    });

    const defaultEdge = switchEdges.find((edge) => edge.data?.isDefault);
    expect(defaultEdge).toMatchObject({
      source: "router",
      target: "fallback_job",
      data: {
        kind: "switch",
        caseCondition: "default",
        inputs: { mode: "fallback", next: "fallback_job" },
        isDefault: true,
      },
    });
  });

  it("parses workflow-level trigger configuration", () => {
    const parsed = parseYamlToGraph(`
workflow_id: test
name: Test
trigger:
  type: manual
  name: manual_trigger
  launch:
    context: scope
    allow_raw_json: true
    inputs:
      - key: objective
        label: Objective
        type: string
        required: true
`);

    expect(parsed.metadata.trigger).not.toBeNull();
    expect(parsed.metadata.trigger).toMatchObject({
      type: "manual",
      name: "manual_trigger",
    });
  });

  it("parses workflow-level concurrency configuration", () => {
    const parsed = parseYamlToGraph(`
workflow_id: test
name: Test
concurrency:
  max_runs: 3
  scope: "{{ trigger.scopeId }}"
  on_conflict: queue
`);

    expect(parsed.metadata.concurrency).not.toBeNull();
    expect(parsed.metadata.concurrency).toMatchObject({
      max_runs: 3,
      scope: "{{ trigger.scopeId }}",
      on_conflict: "queue",
    });
  });

  it("parses workflow-level permissions configuration", () => {
    const parsed = parseYamlToGraph(`
workflow_id: test
name: Test
permissions:
  allow_tools:
    - read
    - write
    - edit
  deny_tools:
    - bash
`);

    expect(parsed.metadata.permissions).not.toBeNull();
    expect(parsed.metadata.permissions).toMatchObject({
      allow_tools: ["read", "write", "edit"],
      deny_tools: ["bash"],
    });
  });

  it("parses global_env into a string record", () => {
    const parsed = parseYamlToGraph(`
workflow_id: test
name: Test
global_env:
  NODE_ENV: production
  LOG_LEVEL: debug
`);

    expect(parsed.metadata.globalEnv).toEqual({
      NODE_ENV: "production",
      LOG_LEVEL: "debug",
    });
  });

  it("parses the standard-feature-flow seed file complete with trigger and permissions", () => {
    const yaml = readSeed("standard-feature-flow.workflow.yaml");
    const parsed = parseYamlToGraph(yaml);

    expect(parsed.metadata.workflowId).toBe("standard_feature_flow");
    expect(parsed.metadata.trigger).not.toBeNull();
    expect(parsed.metadata.permissions).not.toBeNull();
    expect(parsed.nodes.length).toBeGreaterThan(2);
    expect(parsed.edges.length).toBeGreaterThan(0);

    const dependencyEdges = parsed.edges.filter(
      (edge) => edge.data?.kind === "dependency",
    );
    expect(dependencyEdges.length).toBeGreaterThan(0);

    const allIds = parsed.nodes.map((node) => node.id);
    expect(allIds).toContain("run_discovery");
    expect(allIds).toContain("run_review_gate");
  });

  it("parses the orchestration-invoke-agent seed file with concurrency and steps", () => {
    const yaml = readSeed("orchestration-invoke-agent-default.workflow.yaml");
    const parsed = parseYamlToGraph(yaml);

    expect(parsed.metadata.workflowId).toBe(
      "orchestration_invoke_agent_default",
    );
    expect(parsed.metadata.concurrency).not.toBeNull();
    expect(parsed.metadata.concurrency).toMatchObject({
      max_runs: 1,
      on_conflict: "skip",
    });

    const jobNode = parsed.nodes.find((node) => node.type === "job");
    expect(jobNode?.id).toBe("delegate");

    const stepNodes = parsed.nodes.filter((node) => node.type === "step");
    expect(stepNodes.length).toBeGreaterThan(0);
    expect(stepNodes[0].data).toMatchObject({ stepId: "delegated_task" });
  });

  it("parses the hotfix-flow seed file with steps and conditions", () => {
    const yaml = readSeed("hotfix-flow.workflow.yaml");
    const parsed = parseYamlToGraph(yaml);

    expect(parsed.metadata.workflowId).toBe("hotfix_flow");

    const recordScopeNode = parsed.nodes.find(
      (node) => node.id === "record_hotfix_scope",
    );
    expect(recordScopeNode).toBeDefined();
    expect(recordScopeNode?.data).toMatchObject({ jobType: "execution" });

    const stepNodes = parsed.nodes.filter((node) => node.type === "step");
    expect(stepNodes.length).toBeGreaterThan(0);

    const implementNode = parsed.nodes.find(
      (node) => node.id === "implement_hotfix",
    );
    expect(implementNode?.data).toMatchObject({ jobType: "invoke_workflow" });
  });

  it("parses the workflow-yaml-enhancements-demo seed file with switch and for_each", () => {
    const yaml = readSeed("workflow-yaml-enhancements-demo.workflow.yaml");
    const parsed = parseYamlToGraph(yaml);

    expect(parsed.metadata.workflowId).toBe("workflow_yaml_enhancements_demo");

    const routerNode = parsed.nodes.find(
      (node) => node.id === "route_single_event",
    );
    expect(routerNode?.data).toMatchObject({ jobType: "emit_event" });

    const batchNode = parsed.nodes.find(
      (node) => node.id === "emit_event_batch",
    );
    expect(batchNode?.data).toMatchObject({
      forEach: "{{ trigger.batch_events }}",
      continueOnError: true,
    });

    const dependencyEdges = parsed.edges.filter(
      (edge) => edge.data?.kind === "dependency",
    );
    expect(dependencyEdges).toHaveLength(1);
    expect(dependencyEdges[0]).toMatchObject({
      source: "route_single_event",
      target: "emit_event_batch",
    });
  });

  it("parses a dict-style jobs block as well as the array form", () => {
    const parsed = parseYamlToGraph(`
workflow_id: test
name: Test
jobs:
  first:
    type: execution
  second:
    type: execution
    depends_on:
      - first
`);

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes.map((node) => node.id)).toEqual(["first", "second"]);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].data).toMatchObject({ kind: "dependency" });
  });
});
