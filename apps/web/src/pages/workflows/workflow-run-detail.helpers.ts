import { WorkflowRunStatus } from "@/lib/api/common.types";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";

type StepOutput = {
  stepId: string;
  output: Record<string, unknown>;
};

type RunPhase = "Planning" | "Delegation" | "Implementation" | "Review Handoff";

function toLowerText(value: unknown): string {
  if (typeof value === "string") {
    return value.toLowerCase();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return `${value}`.toLowerCase();
  }

  return "";
}

export function parseStepOutputsFromRunState(
  stateVariables: Record<string, unknown>,
): StepOutput[] {
  const collectOutputs = (source: unknown): StepOutput[] => {
    if (!source || typeof source !== "object") {
      return [];
    }

    const outputs: StepOutput[] = [];
    for (const [stepId, value] of Object.entries(
      source as Record<string, unknown>,
    )) {
      if (!value || typeof value !== "object") {
        continue;
      }

      const output = (value as { output?: unknown }).output;
      if (!output || typeof output !== "object") {
        continue;
      }

      outputs.push({
        stepId,
        output: output as Record<string, unknown>,
      });
    }

    return outputs;
  };

  const fromJobs = collectOutputs(stateVariables.jobs);
  if (fromJobs.length > 0) {
    return fromJobs;
  }

  return collectOutputs(stateVariables.steps);
}

export function parseTurnEndOutputs(
  events: WorkflowTelemetryEvent[],
): StepOutput[] {
  const outputs: StepOutput[] = [];

  for (const event of events) {
    if (event.event_type !== "turn_end") {
      continue;
    }

    const stepId = event.payload.stepId;
    const output = event.payload.output;

    if (typeof stepId !== "string") {
      continue;
    }

    if (!output || typeof output !== "object") {
      continue;
    }

    outputs.push({
      stepId,
      output: output as Record<string, unknown>,
    });
  }

  return outputs;
}

export function readRunTrigger(
  stateVariables: unknown,
): Record<string, unknown> | null {
  if (!stateVariables || typeof stateVariables !== "object") {
    return null;
  }

  const trigger = (stateVariables as { trigger?: unknown }).trigger;
  if (!trigger || typeof trigger !== "object") {
    return null;
  }

  return trigger as Record<string, unknown>;
}

export function readInitialUserMessage(
  trigger: Record<string, unknown> | null,
): string | undefined {
  let candidate: string | undefined;
  if (typeof trigger?.task_prompt === "string") {
    candidate = trigger.task_prompt;
  } else if (typeof trigger?.taskPrompt === "string") {
    candidate = trigger.taskPrompt;
  }

  if (!candidate) {
    return undefined;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isDispatchControlRun(
  trigger: Record<string, unknown> | null,
): boolean {
  const action = trigger?.action;
  return action === "dispatch_start_work_items";
}

export function getChatEmptyMessage(isDispatchControlRunRun: boolean): string {
  if (isDispatchControlRunRun) {
    return "No agent chat is expected for orchestration dispatch control runs. This action only updates work item status.";
  }

  return "No chat or telemetry messages yet.";
}

export function extractPhaseMarkers(
  events: WorkflowTelemetryEvent[],
): RunPhase[] {
  const hasPlanning = events.some((event) => {
    const stepId = toLowerText(event.payload.stepId);
    const eventType = event.event_type.toLowerCase();
    return (
      stepId.includes("plan") ||
      stepId.includes("spec") ||
      eventType.includes("orchestration") ||
      eventType.includes("project_state")
    );
  });

  const hasDelegation = events.some((event) => {
    const toolName = toLowerText(event.payload.toolName);
    const eventType = event.event_type.toLowerCase();
    return (
      toolName === "spawn_subagent_async" ||
      toolName.includes("wait_for_subagents") ||
      eventType.includes("subagent")
    );
  });

  const hasImplementation = events.some((event) => {
    const toolName = toLowerText(event.payload.toolName);
    const eventType = event.event_type.toLowerCase();
    const stepId = toLowerText(event.payload.stepId);
    return (
      eventType === "bash_output" ||
      toolName.includes("write") ||
      toolName.includes("bash") ||
      stepId.includes("implement")
    );
  });

  const hasReviewHandoff = events.some((event) => {
    const stepId = toLowerText(event.payload.stepId);
    const eventType = event.event_type.toLowerCase();
    return (
      stepId.includes("review") ||
      eventType.includes("qa") ||
      eventType.includes("merge")
    );
  });

  const phases: RunPhase[] = [];
  if (hasPlanning) phases.push("Planning");
  if (hasDelegation) phases.push("Delegation");
  if (hasImplementation) phases.push("Implementation");
  if (hasReviewHandoff) phases.push("Review Handoff");
  return phases;
}

export function readWorkItemIdFromTrigger(
  trigger: Record<string, unknown> | null,
): string | null {
  if (typeof trigger?.workItemId === "string") {
    return trigger.workItemId;
  }

  const workItem = trigger?.workItem;
  if (!workItem || typeof workItem !== "object") {
    return null;
  }

  const workItemId = (workItem as { id?: unknown }).id;
  return typeof workItemId === "string" ? workItemId : null;
}

export function isTerminalWorkflowRunStatus(
  status: WorkflowRunStatus | undefined,
): boolean {
  return (
    status === "FAILED" || status === "CANCELLED" || status === "COMPLETED"
  );
}

function readFailureMessage(
  payload: Record<string, unknown> | undefined,
): string | undefined {
  if (!payload) {
    return undefined;
  }

  const directMessage = payload.message;
  if (typeof directMessage === "string" && directMessage.trim().length > 0) {
    return directMessage;
  }

  const errorValue = payload.error;
  if (typeof errorValue === "string" && errorValue.trim().length > 0) {
    return errorValue;
  }

  if (errorValue && typeof errorValue === "object") {
    const nestedMessage = (errorValue as { message?: unknown }).message;
    if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
      return nestedMessage;
    }
  }

  return undefined;
}

export function getWorkflowFailureReason(
  events: WorkflowTelemetryEvent[],
  status: WorkflowRunStatus | undefined,
): string | undefined {
  if (status !== "FAILED") {
    return undefined;
  }

  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.event_type !== "workflow.failed") {
      continue;
    }

    const message = readFailureMessage(event.payload);
    if (message) {
      return message;
    }
  }

  return "Workflow failed without a reported error message.";
}
