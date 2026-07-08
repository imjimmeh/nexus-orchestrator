import type { OrchestrationSimulationScenario } from "./orchestration-simulation.types";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

export const EPIC_197_SCENARIOS: OrchestrationSimulationScenario[] = [
  {
    id: "imported-repo-bootstrap",
    title: "Imported repository bootstrap creates discovery intent",
    projectId: PROJECT_ID,
    steps: [
      {
        name: "repository imported fact",
        action: "publish_fact",
        input: buildFactInput({
          factType: "repository_imported",
          subjectKind: "project",
          subjectId: PROJECT_ID,
        }),
      },
      {
        name: "discover unknowns intent",
        action: "create_intent",
        input: buildIntentInput({
          lane: "discovery",
          type: "discover_unknowns",
          reason: "Bootstrap imported repository",
        }),
      },
    ],
    expected: {
      intents: [{ type: "discover_unknowns", status: "pending" }],
      facts: [{ type: "repository_imported" }],
    },
  },
  {
    id: "upstream-rediscovery",
    title: "Upstream change requests re-discovery",
    projectId: PROJECT_ID,
    steps: [
      {
        name: "upstream change fact",
        action: "publish_fact",
        input: buildFactInput({
          factType: "upstream_change_detected",
          subjectKind: "branch",
          subjectId: "main",
        }),
      },
      {
        name: "reanalyze upstream intent",
        action: "create_intent",
        input: buildIntentInput({
          lane: "upstream_analysis",
          type: "reanalyze_upstream_change",
          reason: "Upstream branch changed",
        }),
      },
    ],
    expected: {
      intents: [{ type: "reanalyze_upstream_change", status: "pending" }],
      facts: [{ type: "upstream_change_detected" }],
    },
  },
  {
    id: "parallel-discovery-implementation",
    title: "Compatible discovery and implementation intents can coexist",
    projectId: PROJECT_ID,
    steps: [
      {
        name: "discovery intent",
        action: "create_intent",
        input: buildIntentInput({
          lane: "discovery",
          type: "discover_unknowns",
          reason: "Explore unknowns",
          conflictKeys: [{ kind: "workflow_scope", value: "discovery" }],
        }),
      },
      {
        name: "implementation intent",
        action: "create_intent",
        input: buildIntentInput({
          lane: "implementation",
          type: "implement_work_item",
          reason: "Implement ready work",
          conflictKeys: [{ kind: "work_item", value: "work-item-1" }],
        }),
      },
    ],
    expected: {
      intents: [
        { type: "discover_unknowns", status: "pending" },
        { type: "implement_work_item", status: "pending" },
      ],
    },
  },
  {
    id: "qa-rejection",
    title: "QA rejection creates review/refinement intent",
    projectId: PROJECT_ID,
    steps: [
      {
        name: "qa rejection fact",
        action: "publish_fact",
        input: buildFactInput({
          factType: "qa_rejection_recorded",
          subjectKind: "work_item",
          subjectId: "work-item-1",
        }),
      },
      {
        name: "refine specification intent",
        action: "create_intent",
        input: buildIntentInput({
          lane: "specification",
          type: "refine_spec",
          reason: "QA rejected implementation",
        }),
      },
    ],
    expected: {
      intents: [{ type: "refine_spec", status: "pending" }],
      facts: [{ type: "qa_rejection_recorded" }],
    },
  },
  {
    id: "stale-link-recovery",
    title: "Stale workflow link creates repair lane intent",
    projectId: PROJECT_ID,
    steps: [
      {
        name: "repair stale link",
        action: "repair_stale_link",
        input: {
          projectId: PROJECT_ID,
          workflowRunId: "workflow-run-1",
          workItemId: "work-item-1",
        },
      },
    ],
    expected: {
      intents: [{ type: "reconcile_stale_links", status: "pending" }],
      facts: [{ type: "stale_link_detected" }],
    },
  },
  {
    id: "duplicate-wakeup",
    title: "Duplicate wakeup records no-launch reason",
    projectId: PROJECT_ID,
    steps: [
      {
        name: "existing strategy intent",
        action: "create_intent",
        input: buildIntentInput({
          lane: "strategy",
          type: "validate_project_health",
          reason: "Existing cycle",
          conflictKeys: [
            {
              kind: "workflow_scope",
              value: "project_orchestration_cycle_ceo:project",
            },
          ],
        }),
      },
      {
        name: "candidate strategy intent",
        action: "create_intent",
        input: buildIntentInput({
          lane: "strategy",
          type: "validate_project_health",
          reason: "Duplicate wakeup",
          conflictKeys: [
            {
              kind: "workflow_scope",
              value: "project_orchestration_cycle_ceo:project",
            },
          ],
        }),
      },
      {
        name: "evaluate duplicate wakeup",
        action: "evaluate_intent",
        input: { intentId: "duplicate-wakeup-candidate" },
      },
    ],
    expected: { noLaunchReasons: ["conflict_key_active"] },
  },
  {
    id: "merge-conflict",
    title: "Merge conflict creates repair intent",
    projectId: PROJECT_ID,
    steps: [
      {
        name: "merge conflict fact",
        action: "publish_fact",
        input: buildFactInput({
          factType: "merge_conflict_detected",
          subjectKind: "branch",
          subjectId: "feature/work-item-1",
        }),
      },
      {
        name: "repair merge conflict intent",
        action: "create_intent",
        input: buildIntentInput({
          lane: "repair",
          type: "repair_failed_run",
          reason: "Repair merge conflict",
        }),
      },
    ],
    expected: {
      intents: [{ type: "repair_failed_run", status: "pending" }],
      facts: [{ type: "merge_conflict_detected" }],
    },
  },
  {
    id: "event-delivery-failure-repair",
    title: "Event delivery failure creates repair intent",
    projectId: PROJECT_ID,
    steps: [
      {
        name: "failed event projection",
        action: "publish_event_projection",
        input: {
          projectId: PROJECT_ID,
          eventId: "event-1",
          eventName: "kanban.work_item.updated.v1",
          error: "delivery failed",
        },
      },
    ],
    expected: {
      intents: [{ type: "repair_failed_run", status: "pending" }],
      facts: [{ type: "event_delivery_failed" }],
    },
  },
];

function buildFactInput(overrides: Record<string, unknown>) {
  return {
    projectId: PROJECT_ID,
    factType: "project_spec_current",
    subjectKind: "project",
    subjectId: PROJECT_ID,
    sourceType: "simulation",
    sourceId: "epic-197-scenario",
    confidence: 1,
    payload: {},
    ...overrides,
  };
}

function buildIntentInput(overrides: Record<string, unknown>) {
  return {
    projectId: PROJECT_ID,
    lane: "repair",
    type: "repair_failed_run",
    requester: "epic-197-simulation",
    reason: "Scenario intent",
    conflictKeys: [],
    ...overrides,
  };
}
