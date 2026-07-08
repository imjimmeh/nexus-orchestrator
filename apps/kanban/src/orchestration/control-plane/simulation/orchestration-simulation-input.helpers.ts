import type {
  CreateOrchestrationIntentInput,
  LaunchAttemptStatus,
  PublishOrchestrationFactInput,
} from "../control-plane.types";
import type {
  OrchestrationSimulationStep,
  SimulationFactRecord,
  SimulationIntentRecord,
  SimulationRecordLaunchAttemptInput,
} from "./orchestration-simulation.types";

export function requirePublishFactInput(
  step: OrchestrationSimulationStep,
): PublishOrchestrationFactInput {
  const input = step.input;
  return {
    projectId: requireString(input, "projectId", step),
    factType: requireString(input, "factType", step),
    subjectKind: requireString(input, "subjectKind", step),
    subjectId: requireString(input, "subjectId", step),
    sourceType: requireString(input, "sourceType", step),
    sourceId: requireString(input, "sourceId", step),
    confidence: requireNumber(input, "confidence", step),
    payload: requireRecord(input, "payload", step),
    evidence: optionalPublishFactEvidence(input.evidence),
    metadata: optionalRecord(input.metadata),
  };
}

export function requireCreateIntentInput(
  step: OrchestrationSimulationStep,
): CreateOrchestrationIntentInput {
  const input = step.input;
  return {
    projectId: requireString(input, "projectId", step),
    lane: requireString(
      input,
      "lane",
      step,
    ) as CreateOrchestrationIntentInput["lane"],
    type: requireString(
      input,
      "type",
      step,
    ) as CreateOrchestrationIntentInput["type"],
    requester: requireString(input, "requester", step),
    reason: requireString(input, "reason", step),
    priority: optionalNumber(input.priority),
    evidence: optionalCreateIntentEvidence(input.evidence),
    resources: optionalCreateIntentResources(input.resources),
    conflictKeys: optionalCreateIntentConflictKeys(input.conflictKeys),
    workflow: optionalWorkflowTarget(input.workflow),
    idempotencyKey: optionalString(input.idempotencyKey),
    supersedesIntentId: optionalString(input.supersedesIntentId),
    freshnessRequirements: optionalRecord(input.freshnessRequirements),
    metadata: optionalRecord(input.metadata),
  };
}

export function requireRecordLaunchAttemptInput(
  step: OrchestrationSimulationStep,
): SimulationRecordLaunchAttemptInput {
  const input = step.input;
  return {
    intentId: requireString(input, "intentId", step),
    outcomeId: optionalString(input.outcomeId),
    workflowId: requireString(input, "workflowId", step),
    workflowScope: optionalString(input.workflowScope),
    workflowRunId: optionalString(input.workflowRunId),
    idempotencyKey: requireString(input, "idempotencyKey", step),
    status: requireString(input, "status", step) as LaunchAttemptStatus,
    failureReason: optionalString(input.failureReason),
    responsePayload: optionalRecord(input.responsePayload),
    metadata: optionalRecord(input.metadata),
  };
}

export function toIntentRecord(value: unknown): SimulationIntentRecord {
  const record = requireValueRecord(value, "created intent");
  return {
    type: requireRecordString(record, "type", "created intent"),
    status: requireRecordString(record, "status", "created intent"),
  };
}

export function toFactRecord(value: unknown): SimulationFactRecord {
  const record = requireValueRecord(value, "published fact");
  return {
    type: requireRecordString(record, "fact_type", "published fact"),
    freshnessStatus: requireRecordString(
      record,
      "freshness_status",
      "published fact",
    ),
  };
}

export function requireString(
  input: Record<string, unknown>,
  field: string,
  step: OrchestrationSimulationStep,
): string {
  const value = input[field];
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`Simulation step ${step.name} requires ${field}`);
  return value;
}

function requireNumber(
  input: Record<string, unknown>,
  field: string,
  step: OrchestrationSimulationStep,
): number {
  const value = input[field];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`Simulation step ${step.name} requires ${field}`);
  return value;
}

function requireRecord(
  input: Record<string, unknown>,
  field: string,
  step: OrchestrationSimulationStep,
): Record<string, unknown> {
  const value = input[field];
  if (!isRecord(value))
    throw new Error(`Simulation step ${step.name} requires ${field}`);
  return value;
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function optionalRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function optionalPublishFactEvidence(
  value: unknown,
): PublishOrchestrationFactInput["evidence"] | undefined {
  return Array.isArray(value)
    ? (value as PublishOrchestrationFactInput["evidence"])
    : undefined;
}

function optionalCreateIntentEvidence(
  value: unknown,
): CreateOrchestrationIntentInput["evidence"] | undefined {
  return Array.isArray(value)
    ? (value as CreateOrchestrationIntentInput["evidence"])
    : undefined;
}

function optionalCreateIntentResources(
  value: unknown,
): CreateOrchestrationIntentInput["resources"] | undefined {
  return Array.isArray(value)
    ? (value as CreateOrchestrationIntentInput["resources"])
    : undefined;
}

function optionalCreateIntentConflictKeys(
  value: unknown,
): CreateOrchestrationIntentInput["conflictKeys"] | undefined {
  return Array.isArray(value)
    ? (value as CreateOrchestrationIntentInput["conflictKeys"])
    : undefined;
}

function optionalWorkflowTarget(
  value: unknown,
): CreateOrchestrationIntentInput["workflow"] | undefined {
  if (!isRecord(value)) return undefined;
  const workflowId = optionalString(value.workflowId);
  return workflowId
    ? { workflowId, scope: optionalString(value.scope) }
    : undefined;
}

function requireValueRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Simulation expected ${label} record`);
  return value;
}

function requireRecordString(
  record: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = record[field];
  if (typeof value !== "string")
    throw new Error(`Simulation expected ${label}.${field}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
