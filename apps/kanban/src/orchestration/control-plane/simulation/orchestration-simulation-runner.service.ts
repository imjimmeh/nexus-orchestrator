import { Injectable } from "@nestjs/common";
import { OrchestrationControlPlaneSchedulerService } from "../orchestration-control-plane-scheduler.service";
import type {
  CreateOrchestrationIntentInput,
  PublishOrchestrationFactInput,
} from "../control-plane.types";
import {
  optionalRecord,
  optionalString,
  requireCreateIntentInput,
  requirePublishFactInput,
  requireRecordLaunchAttemptInput,
  requireString,
  toFactRecord,
  toIntentRecord,
} from "./orchestration-simulation-input.helpers";
import type {
  OrchestrationSimulationResult,
  OrchestrationSimulationScenario,
  OrchestrationSimulationStep,
  SimulationFactRecord,
  SimulationIntentRecord,
  SimulationLaunchAttemptRecord,
} from "./orchestration-simulation.types";

interface SimulationState {
  readonly diagnostics: string[];
  readonly intents: SimulationIntentRecord[];
  readonly facts: SimulationFactRecord[];
  readonly noLaunchReasons: string[];
  readonly launchAttempts: SimulationLaunchAttemptRecord[];
}

@Injectable()
export class OrchestrationSimulationRunnerService {
  constructor(
    private readonly scheduler: OrchestrationControlPlaneSchedulerService,
  ) {}

  async runScenario(
    scenario: OrchestrationSimulationScenario,
  ): Promise<OrchestrationSimulationResult> {
    const state: SimulationState = {
      diagnostics: [],
      intents: [],
      facts: [],
      noLaunchReasons: [],
      launchAttempts: [],
    };

    for (const step of scenario.steps) {
      await this.runStep(step, state);
    }

    const missingDiagnostics = this.collectMissingExpectations(scenario, state);
    return {
      scenarioId: scenario.id,
      passed: missingDiagnostics.length === 0,
      diagnostics: [...state.diagnostics, ...missingDiagnostics],
    };
  }

  private async runStep(
    step: OrchestrationSimulationStep,
    state: SimulationState,
  ): Promise<void> {
    switch (step.action) {
      case "publish_fact":
        await this.publishFactStep(step, state);
        return;
      case "create_intent":
        await this.createIntentStep(step, state);
        return;
      case "evaluate_intent":
        await this.evaluateIntentStep(step, state);
        return;
      case "record_launch_attempt":
        await this.recordLaunchAttemptStep(step, state);
        return;
      case "publish_event_projection":
        await this.publishEventProjectionStep(step, state);
        return;
      case "repair_stale_link":
        await this.repairStaleLinkStep(step, state);
        return;
    }
  }

  private async publishFactStep(
    step: OrchestrationSimulationStep,
    state: SimulationState,
  ): Promise<void> {
    const input = requirePublishFactInput(step);
    const fact = await this.scheduler.publishFact(input);
    const record = toFactRecord(fact);
    state.facts.push(record);
    state.diagnostics.push(
      `${step.name}:published:${record.type}:${record.freshnessStatus}`,
    );
  }

  private async createIntentStep(
    step: OrchestrationSimulationStep,
    state: SimulationState,
  ): Promise<void> {
    const input = requireCreateIntentInput(step);
    const intent = await this.scheduler.createIntent(input);
    const record = toIntentRecord(intent);
    state.intents.push(record);
    state.diagnostics.push(
      `${step.name}:intent:${record.type}:${record.status}`,
    );
  }

  private async evaluateIntentStep(
    step: OrchestrationSimulationStep,
    state: SimulationState,
  ): Promise<void> {
    const input = step.input;
    const intentId = requireString(input, "intentId", step);
    const policy = optionalRecord(input.policy);
    const decision = await this.scheduler.evaluateIntent(
      intentId,
      policy ?? {},
    );
    state.noLaunchReasons.push(decision.reason);
    state.diagnostics.push(
      `${step.name}:${decision.status}:${decision.reason}`,
    );
  }

  private async recordLaunchAttemptStep(
    step: OrchestrationSimulationStep,
    state: SimulationState,
  ): Promise<void> {
    const input = requireRecordLaunchAttemptInput(step);
    const attempt = await this.scheduler.recordLaunchAttempt(input);
    const record = {
      workflowId: attempt.workflow_id,
      status: attempt.status,
    };
    state.launchAttempts.push(record);
    state.diagnostics.push(
      `${step.name}:launch:${record.workflowId}:${record.status}`,
    );
  }

  private async publishEventProjectionStep(
    step: OrchestrationSimulationStep,
    state: SimulationState,
  ): Promise<void> {
    const projectId = requireString(step.input, "projectId", step);
    const eventId = requireString(step.input, "eventId", step);
    const eventName = requireString(step.input, "eventName", step);
    const error = requireString(step.input, "error", step);

    await this.publishFactFromInput(
      step,
      state,
      {
        projectId,
        factType: "event_delivery_failed",
        subjectKind: "domain_event",
        subjectId: eventId,
        sourceType: "kanban_event_delivery_projection",
        sourceId: eventId,
        confidence: 1,
        payload: { eventName, error },
      },
      "event-projection",
    );
    await this.createIntentFromInput(
      step,
      state,
      {
        projectId,
        lane: "repair",
        type: "repair_failed_run",
        requester: "event_delivery_projection",
        reason: `Repair failed event delivery ${eventId}`,
        conflictKeys: [
          { kind: "workflow_scope", value: `event-replay:${eventId}` },
        ],
        resources: [{ kind: "external_event", id: eventId }],
        workflow: { workflowId: "repair_failed_run", scope: eventId },
        idempotencyKey: `repair:event-delivery:${eventId}`,
      },
      "repair-intent",
    );
  }

  private async repairStaleLinkStep(
    step: OrchestrationSimulationStep,
    state: SimulationState,
  ): Promise<void> {
    const projectId = requireString(step.input, "projectId", step);
    const workflowRunId = requireString(step.input, "workflowRunId", step);
    const workItemId = optionalString(step.input.workItemId);
    const subjectId = workItemId ?? workflowRunId;

    await this.publishFactFromInput(
      step,
      state,
      {
        projectId,
        factType: "stale_link_detected",
        subjectKind: workItemId ? "work_item" : "workflow_run",
        subjectId,
        sourceType: "simulation_reconciler",
        sourceId: workflowRunId,
        confidence: 1,
        payload: { projectId, workflowRunId, workItemId: workItemId ?? null },
      },
      "stale-link-fact",
    );
    await this.createIntentFromInput(
      step,
      state,
      {
        projectId,
        lane: "repair",
        type: "reconcile_stale_links",
        requester: "simulation_reconciler",
        reason: `Reconcile stale run link ${workflowRunId}`,
        conflictKeys: [{ kind: "workflow_run", value: workflowRunId }],
        resources: [{ kind: "workflow_run", id: workflowRunId }],
        workflow: {
          workflowId: "reconcile_stale_links",
          scope: workflowRunId,
        },
        idempotencyKey: `repair:stale-link:${workflowRunId}`,
      },
      "repair-intent",
    );
  }

  private async publishFactFromInput(
    step: OrchestrationSimulationStep,
    state: SimulationState,
    input: PublishOrchestrationFactInput,
    diagnosticLabel: string,
  ): Promise<void> {
    const fact = await this.scheduler.publishFact(input);
    const record = toFactRecord(fact);
    state.facts.push(record);
    state.diagnostics.push(
      `${step.name}:${diagnosticLabel}:${record.type}:${record.freshnessStatus}`,
    );
  }

  private async createIntentFromInput(
    step: OrchestrationSimulationStep,
    state: SimulationState,
    input: CreateOrchestrationIntentInput,
    diagnosticLabel: string,
  ): Promise<void> {
    const intent = await this.scheduler.createIntent(input);
    const record = toIntentRecord(intent);
    state.intents.push(record);
    state.diagnostics.push(
      `${step.name}:${diagnosticLabel}:${record.type}:${record.status}`,
    );
  }

  private collectMissingExpectations(
    scenario: OrchestrationSimulationScenario,
    state: SimulationState,
  ): string[] {
    return [
      ...this.collectMissingIntents(scenario, state),
      ...this.collectMissingFacts(scenario, state),
      ...this.collectMissingNoLaunchReasons(scenario, state),
      ...this.collectMissingLaunchedWorkflows(scenario, state),
    ];
  }

  private collectMissingIntents(
    scenario: OrchestrationSimulationScenario,
    state: SimulationState,
  ): string[] {
    return (scenario.expected.intents ?? []).flatMap((expected) =>
      state.intents.some(
        (intent) =>
          intent.type === expected.type && intent.status === expected.status,
      )
        ? []
        : [`missing intent ${expected.type} with status ${expected.status}`],
    );
  }

  private collectMissingFacts(
    scenario: OrchestrationSimulationScenario,
    state: SimulationState,
  ): string[] {
    return (scenario.expected.facts ?? []).flatMap((expected) =>
      state.facts.some(
        (fact) =>
          fact.type === expected.type &&
          (expected.freshnessStatus === undefined ||
            fact.freshnessStatus === expected.freshnessStatus),
      )
        ? []
        : [
            `missing fact ${expected.type}${
              expected.freshnessStatus
                ? ` with freshness ${expected.freshnessStatus}`
                : ""
            }`,
          ],
    );
  }

  private collectMissingNoLaunchReasons(
    scenario: OrchestrationSimulationScenario,
    state: SimulationState,
  ): string[] {
    return (scenario.expected.noLaunchReasons ?? []).flatMap((reason) =>
      state.noLaunchReasons.includes(reason)
        ? []
        : [`missing no-launch reason ${reason}`],
    );
  }

  private collectMissingLaunchedWorkflows(
    scenario: OrchestrationSimulationScenario,
    state: SimulationState,
  ): string[] {
    return (scenario.expected.launchedWorkflows ?? []).flatMap((workflowId) =>
      state.launchAttempts.some((attempt) => attempt.workflowId === workflowId)
        ? []
        : [`missing launched workflow ${workflowId}`],
    );
  }
}
