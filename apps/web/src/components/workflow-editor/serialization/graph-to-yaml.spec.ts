import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { serializeGraphToYaml } from "./graph-to-yaml";
import { parseYamlToGraph } from "./yaml-to-graph";
import {JobNode, ParsedWorkflow, WorkflowEdge} from "./types";

const SEED_DIR = path.resolve(__dirname, "../../../../../../seed/workflows");

function readSeed(filename: string): string {
  return readFileSync(path.join(SEED_DIR, filename), "utf-8");
}

const metadata: ParsedWorkflow["metadata"] = {
  workflowId: "sample-workflow",
  name: "Sample Workflow",
  description: "",
  trigger: null,
  concurrency: null,
  permissions: null,
  globalEnv: {},
  strictDependencies: false,
  active: true,
};

describe("serializeGraphToYaml", () => {
  it("serializes jobs and a dependency edge", () => {
    const nodes: JobNode[] = [
      {
        id: "prepare",
        type: "job",
        position: { x: 0, y: 0 },
        data: { label: "prepare", jobId: "prepare", jobType: "execution" },
      },
      {
        id: "finish",
        type: "job",
        position: { x: 220, y: 0 },
        data: { label: "finish", jobId: "finish", jobType: "execution" },
      },
    ];
    const edges: WorkflowEdge[] = [
      {
        id: "prepare->finish:dependency",
        source: "prepare",
        target: "finish",
        data: { kind: "dependency" },
      },
    ];

    const yaml = serializeGraphToYaml({
      metadata,
      nodes,
      edges,
    });

    expect(load(yaml)).toEqual({
      workflow_id: "sample-workflow",
      name: "Sample Workflow",
      active: true,
      jobs: [
        { id: "prepare", type: "execution" },
        { id: "finish", type: "execution", depends_on: ["prepare"] },
      ],
    });
  });

  it("serializes result-aware dependency edges as needs", () => {
    const nodes: JobNode[] = [
      {
        id: "prepare",
        type: "job",
        position: { x: 0, y: 0 },
        data: { label: "prepare", jobId: "prepare", jobType: "execution" },
      },
      {
        id: "finish",
        type: "job",
        position: { x: 220, y: 0 },
        data: {
          label: "finish",
          jobId: "finish",
          jobType: "execution",
          needs: [{ job: "stale", result: "success" }],
        },
      },
    ];
    const edges: WorkflowEdge[] = [
      {
        id: "prepare->finish:dependency",
        source: "prepare",
        target: "finish",
        data: {
          kind: "dependency",
          resultPolicy: "success_or_skipped",
          optional: true,
        },
      },
    ];

    const yaml = serializeGraphToYaml({ metadata, nodes, edges });

    expect(load(yaml)).toEqual({
      workflow_id: "sample-workflow",
      name: "Sample Workflow",
      active: true,
      jobs: [
        { id: "prepare", type: "execution" },
        {
          id: "finish",
          type: "execution",
          needs: [
            { job: "prepare", result: "success_or_skipped", optional: true },
          ],
        },
      ],
    });
  });

  it("serializes dependencies, transitions, and switch routes from current edges", () => {
    const nodes: JobNode[] = [
      {
        id: "old-target",
        type: "job",
        position: { x: 0, y: 0 },
        data: {
          label: "old-target",
          jobId: "old-target",
          jobType: "execution",
        },
      },
      {
        id: "current-dependency",
        type: "job",
        position: { x: 220, y: 0 },
        data: {
          label: "current-dependency",
          jobId: "current-dependency",
          jobType: "execution",
        },
      },
      {
        id: "policy-dependency",
        type: "job",
        position: { x: 440, y: 0 },
        data: {
          label: "policy-dependency",
          jobId: "policy-dependency",
          jobType: "execution",
        },
      },
      {
        id: "current-transition",
        type: "job",
        position: { x: 660, y: 0 },
        data: {
          label: "current-transition",
          jobId: "current-transition",
          jobType: "execution",
        },
      },
      {
        id: "current-switch",
        type: "job",
        position: { x: 880, y: 0 },
        data: {
          label: "current-switch",
          jobId: "current-switch",
          jobType: "execution",
        },
      },
      {
        id: "current-default",
        type: "job",
        position: { x: 1100, y: 0 },
        data: {
          label: "current-default",
          jobId: "current-default",
          jobType: "execution",
        },
      },
      {
        id: "route",
        type: "job",
        position: { x: 1320, y: 0 },
        data: {
          label: "route",
          jobId: "route",
          jobType: "execution",
          dependsOn: ["old-target"],
          needs: [{ job: "old-target", result: "success" }],
          transitions: [
            { condition: "{{ stale }}", next: "old-target" },
            { condition: "{{ done }}", next: "done" },
          ],
          switchCases: [
            {
              case: "{{ trigger.fast }}",
              inputs: { mode: "stale", next: "old-target" },
            },
          ],
          switchDefault: {
            inputs: { mode: "stale-default", next: "old-target" },
          },
        },
      },
    ];
    const edges: WorkflowEdge[] = [
      {
        id: "current-dependency->route:dependency",
        source: "current-dependency",
        target: "route",
        data: { kind: "dependency" },
      },
      {
        id: "policy-dependency->route:dependency",
        source: "policy-dependency",
        target: "route",
        data: { kind: "dependency", resultPolicy: "failed" },
      },
      {
        id: "route->current-transition:transition:{{ go }}",
        source: "route",
        target: "current-transition",
        data: {
          kind: "transition",
          condition: "{{ go }}",
          target: "current-transition",
        },
      },
      {
        id: "route->current-switch:switch:0",
        source: "route",
        target: "current-switch",
        data: {
          kind: "switch",
          caseCondition: "{{ trigger.fast }}",
          inputs: { mode: "fast" },
        },
      },
      {
        id: "route->current-default:switch:default",
        source: "route",
        target: "current-default",
        data: {
          kind: "switch",
          caseCondition: "default",
          inputs: { mode: "fallback" },
          isDefault: true,
        },
      },
    ];

    const yaml = serializeGraphToYaml({ metadata, nodes, edges });

    expect(load(yaml)).toEqual({
      workflow_id: "sample-workflow",
      name: "Sample Workflow",
      active: true,
      jobs: [
        { id: "old-target", type: "execution" },
        { id: "current-dependency", type: "execution" },
        { id: "policy-dependency", type: "execution" },
        { id: "current-transition", type: "execution" },
        { id: "current-switch", type: "execution" },
        { id: "current-default", type: "execution" },
        {
          id: "route",
          type: "execution",
          transitions: [
            { condition: "{{ done }}", next: "done" },
            { condition: "{{ go }}", next: "current-transition" },
          ],
          switch: [
            {
              case: "{{ trigger.fast }}",
              inputs: { mode: "fast", next: "current-switch" },
            },
          ],
          default: { inputs: { mode: "fallback", next: "current-default" } },
          depends_on: ["current-dependency"],
          needs: [{ job: "policy-dependency", result: "failed" }],
        },
      ],
    });
  });

  it("serializes switch edge targets into case and default inputs", () => {
    const nodes: JobNode[] = [
      {
        id: "route",
        type: "job",
        position: { x: 0, y: 0 },
        data: { label: "route", jobId: "route", jobType: "execution" },
      },
      {
        id: "fast",
        type: "job",
        position: { x: 220, y: 0 },
        data: { label: "fast", jobId: "fast", jobType: "execution" },
      },
      {
        id: "fallback",
        type: "job",
        position: { x: 440, y: 0 },
        data: { label: "fallback", jobId: "fallback", jobType: "execution" },
      },
    ];
    const edges: WorkflowEdge[] = [
      {
        id: "route->fast:switch:0",
        source: "route",
        target: "fast",
        data: {
          kind: "switch",
          caseCondition: "{{ trigger.fast }}",
          inputs: { mode: "fast" },
        },
      },
      {
        id: "route->fallback:switch:default",
        source: "route",
        target: "fallback",
        data: {
          kind: "switch",
          caseCondition: "default",
          inputs: { mode: "fallback" },
          isDefault: true,
        },
      },
    ];

    const yaml = serializeGraphToYaml({ metadata, nodes, edges });

    expect(load(yaml)).toEqual({
      workflow_id: "sample-workflow",
      name: "Sample Workflow",
      active: true,
      jobs: [
        {
          id: "route",
          type: "execution",
          switch: [
            {
              case: "{{ trigger.fast }}",
              inputs: { mode: "fast", next: "fast" },
            },
          ],
          default: { inputs: { mode: "fallback", next: "fallback" } },
        },
        { id: "fast", type: "execution" },
        { id: "fallback", type: "execution" },
      ],
    });
  });

  describe("round-trip", () => {
    it("preserves job and dependency structure through parse ↔ serialize ↔ parse", () => {
      const original = `
workflow_id: roundtrip
name: Round Trip
jobs:
  - id: a
    type: execution
  - id: b
    type: execution
    depends_on:
      - a
`;

      const firstParse = parseYamlToGraph(original);
      const yaml = serializeGraphToYaml(firstParse);
      const secondParse = parseYamlToGraph(yaml);

      expect(secondParse.metadata.workflowId).toBe(
        firstParse.metadata.workflowId,
      );
      expect(secondParse.nodes.map((node) => node.id)).toEqual(
        firstParse.nodes.map((node) => node.id),
      );

      const round2Edges = secondParse.edges.filter(
        (edge) => edge.data?.kind === "dependency",
      );
      const round1Edges = firstParse.edges.filter(
        (edge) => edge.data?.kind === "dependency",
      );
      expect(round2Edges).toHaveLength(round1Edges.length);
      expect(round2Edges[0].source).toBe("a");
      expect(round2Edges[0].target).toBe("b");
    });

    it("preserves needs-based dependencies through round-trip", () => {
      const original = `
workflow_id: needs-rt
name: Needs Round Trip
jobs:
  - id: provision
    type: git_operation
  - id: build
    type: execution
    needs:
      - job: provision
        result: success_or_skipped
        optional: true
`;

      const firstParse = parseYamlToGraph(original);
      const yaml = serializeGraphToYaml(firstParse);
      const secondParse = parseYamlToGraph(yaml);

      expect(secondParse.metadata.workflowId).toBe(
        firstParse.metadata.workflowId,
      );

      const needsEdges = secondParse.edges.filter(
        (edge) =>
          edge.data?.kind === "dependency" &&
          edge.data.resultPolicy !== undefined,
      );
      expect(needsEdges).toHaveLength(1);
      expect(needsEdges[0].source).toBe("provision");
      expect(needsEdges[0].target).toBe("build");
      expect(needsEdges[0].data).toMatchObject({
        resultPolicy: "success_or_skipped",
        optional: true,
      });
    });

    it("preserves switch/case routing through round-trip", () => {
      const original = `
workflow_id: switch-rt
name: Switch Round Trip
jobs:
  - id: router
    type: execution
    switch:
      - case: "{{ trigger.fast }}"
        inputs:
          mode: fast
          next: fast_path
    default:
      inputs:
        mode: fallback
        next: fallback_path
  - id: fast_path
    type: execution
  - id: fallback_path
    type: execution
`;

      const firstParse = parseYamlToGraph(original);
      const yaml = serializeGraphToYaml(firstParse);
      const secondParse = parseYamlToGraph(yaml);

      const switchEdges = secondParse.edges.filter(
        (edge) => edge.data?.kind === "switch",
      );
      expect(switchEdges).toHaveLength(2);

      const caseEdge = switchEdges.find((edge) => !edge.data?.isDefault);
      expect(caseEdge?.data).toMatchObject({
        caseCondition: "{{ trigger.fast }}",
        inputs: { mode: "fast", next: "fast_path" },
      });

      const defaultEdge = switchEdges.find((edge) => edge.data?.isDefault);
      expect(defaultEdge).toBeDefined();
      expect(defaultEdge?.data).toMatchObject({
        caseCondition: "default",
        inputs: { mode: "fallback", next: "fallback_path" },
      });
    });

    it("preserves workflow-level concurrency through round-trip", () => {
      const original = `
workflow_id: concurrency-rt
name: Concurrency Round Trip
concurrency:
  max_runs: 1
  scope: "{{ trigger.dedupeKey }}"
  on_conflict: skip
`;

      const firstParse = parseYamlToGraph(original);
      const yaml = serializeGraphToYaml(firstParse);
      const secondParse = parseYamlToGraph(yaml);

      expect(secondParse.metadata.concurrency).not.toBeNull();
      expect(secondParse.metadata.concurrency).toMatchObject({
        max_runs: 1,
        scope: "{{ trigger.dedupeKey }}",
        on_conflict: "skip",
      });
    });

    it("preserves lifecycle trigger metadata through round-trip", () => {
      const original = `
workflow_id: lifecycle-rt
name: Lifecycle Round Trip
trigger:
  type: lifecycle
  phase: ready-to-merge
  hook: before
  blocking: true
jobs: []
`;

      const firstParse = parseYamlToGraph(original);
      const yaml = serializeGraphToYaml(firstParse);
      const secondParse = parseYamlToGraph(yaml);

      expect(secondParse.metadata.trigger).toEqual({
        type: "lifecycle",
        phase: "ready-to-merge",
        hook: "before",
        blocking: true,
      });
    });

    it("preserves steps within jobs through round-trip", () => {
      const original = `
workflow_id: steps-rt
name: Steps Round Trip
jobs:
  - id: main
    type: execution
    steps:
      - id: step1
        type: agent
        prompt: "Do it"
`;

      const firstParse = parseYamlToGraph(original);
      const yaml = serializeGraphToYaml(firstParse);
      const secondParse = parseYamlToGraph(yaml);

      const stepNodes = secondParse.nodes.filter(
        (node) => node.type === "step",
      );
      expect(stepNodes).toHaveLength(1);
      expect(stepNodes[0].id).toBe("main.step1");
      expect(stepNodes[0].data).toMatchObject({
        stepId: "step1",
        stepType: "agent",
        prompt: "Do it",
      });
    });

    it("round-trips the hotfix-flow seed file", () => {
      const yaml = readSeed("hotfix-flow.workflow.yaml");
      const firstParse = parseYamlToGraph(yaml);
      const serialized = serializeGraphToYaml(firstParse);
      const secondParse = parseYamlToGraph(serialized);

      expect(secondParse.metadata.workflowId).toBe(
        firstParse.metadata.workflowId,
      );
      expect(secondParse.nodes.map((node) => node.id)).toEqual(
        firstParse.nodes.map((node) => node.id),
      );

      const firstDeps = firstParse.edges.filter(
        (edge) => edge.data?.kind === "dependency",
      );
      const secondDeps = secondParse.edges.filter(
        (edge) => edge.data?.kind === "dependency",
      );
      expect(secondDeps).toHaveLength(firstDeps.length);
    });

    it("round-trips the workflow-yaml-enhancements-demo seed file", () => {
      const yaml = readSeed("workflow-yaml-enhancements-demo.workflow.yaml");
      const firstParse = parseYamlToGraph(yaml);
      const serialized = serializeGraphToYaml(firstParse);
      const secondParse = parseYamlToGraph(serialized);

      expect(secondParse.metadata.workflowId).toBe(
        firstParse.metadata.workflowId,
      );

      const switchEdges = secondParse.edges.filter(
        (edge) => edge.data?.kind === "switch",
      );
      const originalSwitchEdges = firstParse.edges.filter(
        (edge) => edge.data?.kind === "switch",
      );
      expect(switchEdges).toHaveLength(originalSwitchEdges.length);
    });
  });

  describe("edge cases", () => {
    it("serializes an empty workflow with no jobs", () => {
      const yaml = serializeGraphToYaml({
        metadata,
        nodes: [],
        edges: [],
      });

      const parsed = load(yaml);
      expect(parsed).toEqual({
        workflow_id: "sample-workflow",
        name: "Sample Workflow",
        active: true,
        jobs: [],
      });
    });

    it("serializes a single job with no dependencies", () => {
      const nodes: JobNode[] = [
        {
          id: "lone",
          type: "job",
          position: { x: 0, y: 0 },
          data: { label: "lone", jobId: "lone", jobType: "execution" },
        },
      ];

      const yaml = serializeGraphToYaml({ metadata, nodes, edges: [] });

      expect(load(yaml)).toEqual({
        workflow_id: "sample-workflow",
        name: "Sample Workflow",
        active: true,
        jobs: [{ id: "lone", type: "execution" }],
      });
    });

    it("serializes a job with multiple non-job-type configurations", () => {
      const nodes: JobNode[] = [
        {
          id: "rich",
          type: "job",
          position: { x: 0, y: 0 },
          data: {
            label: "rich",
            jobId: "rich",
            jobType: "run_command",
            command: "npm test",
            workingDir: "/app",
            timeoutMs: 60000,
            maxRetries: 3,
            continueOnError: true,
          },
        },
      ];

      const yaml = serializeGraphToYaml({ metadata, nodes, edges: [] });

      expect(load(yaml)).toEqual({
        workflow_id: "sample-workflow",
        name: "Sample Workflow",
        active: true,
        jobs: [
          {
            id: "rich",
            type: "run_command",
            command: "npm test",
            working_dir: "/app",
            timeout_ms: 60000,
            max_retries: 3,
            continue_on_error: true,
          },
        ],
      });
    });

    it("preserves metadata fields like description and strictDependencies", () => {
      const customMetadata: ParsedWorkflow["metadata"] = {
        ...metadata,
        description: "A test workflow with strict deps",
        strictDependencies: true,
        globalEnv: { FOO: "bar" },
      };

      const yaml = serializeGraphToYaml({
        metadata: customMetadata,
        nodes: [],
        edges: [],
      });

      expect(load(yaml)).toEqual({
        workflow_id: "sample-workflow",
        name: "Sample Workflow",
        description: "A test workflow with strict deps",
        active: true,
        strict_dependencies: true,
        global_env: { FOO: "bar" },
        jobs: [],
      });
    });
  });
});
