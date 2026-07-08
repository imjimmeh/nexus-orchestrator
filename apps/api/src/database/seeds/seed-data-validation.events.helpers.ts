import type {
  ParsedWorkflowSeed,
  SeedValidationIssue,
} from './seed-data-validation.types';
import { addIssue } from './seed-data-validation.shared';

type WorkflowEventUsage = {
  emittedEvents: Set<string>;
  triggeredEvents: Set<string>;
};

function addWorkflowTriggerEvents(
  workflow: ParsedWorkflowSeed,
  triggeredEvents: Set<string>,
): void {
  const triggerName =
    workflow.parsed.trigger?.type === 'event'
      ? workflow.parsed.trigger.name
      : undefined;
  if (triggerName) {
    triggeredEvents.add(triggerName);
  }

  const triggerEvent = workflow.parsed.trigger?.event;
  if (triggerEvent) {
    triggeredEvents.add(triggerEvent);
  }
}

function addWorkflowEmittedEvents(
  workflow: ParsedWorkflowSeed,
  emittedEvents: Set<string>,
): void {
  for (const job of workflow.parsed.jobs ?? []) {
    const eventName =
      job.type === 'emit_event' && typeof job.inputs?.event_name === 'string'
        ? job.inputs.event_name
        : undefined;

    if (eventName) {
      emittedEvents.add(eventName);
    }
  }
}

function collectWorkflowEventUsage(
  parsedWorkflows: ParsedWorkflowSeed[],
): WorkflowEventUsage {
  const emittedEvents = new Set<string>();
  const triggeredEvents = new Set<string>();

  for (const workflow of parsedWorkflows) {
    addWorkflowTriggerEvents(workflow, triggeredEvents);
    addWorkflowEmittedEvents(workflow, emittedEvents);
  }

  return { emittedEvents, triggeredEvents };
}

function findTriggerWorkflow(
  parsedWorkflows: ParsedWorkflowSeed[],
  eventName: string,
): ParsedWorkflowSeed | undefined {
  return parsedWorkflows.find(
    (workflow) =>
      workflow.parsed.trigger?.name === eventName ||
      workflow.parsed.trigger?.event === eventName,
  );
}

function findEmitterWorkflow(
  parsedWorkflows: ParsedWorkflowSeed[],
  eventName: string,
): ParsedWorkflowSeed | undefined {
  return parsedWorkflows.find((workflow) =>
    (workflow.parsed.jobs ?? []).some(
      (job) =>
        job.type === 'emit_event' && job.inputs?.event_name === eventName,
    ),
  );
}

export function validateWorkflowTriggersAndEvents(params: {
  parsedWorkflows: ParsedWorkflowSeed[];
  warnings: SeedValidationIssue[];
}): void {
  const { emittedEvents, triggeredEvents } = collectWorkflowEventUsage(
    params.parsedWorkflows,
  );

  for (const eventName of triggeredEvents) {
    if (emittedEvents.has(eventName)) {
      continue;
    }

    const workflow = findTriggerWorkflow(params.parsedWorkflows, eventName);
    if (!workflow) {
      continue;
    }

    addIssue(params.warnings, {
      code: 'workflow-trigger-orphan',
      filePath: workflow.filePath,
      workflowId: workflow.workflowId,
      message: `Workflow is triggered by event '${eventName}' which is not emitted by any workflow`,
    });
  }

  for (const eventName of emittedEvents) {
    if (triggeredEvents.has(eventName)) {
      continue;
    }

    const workflow = findEmitterWorkflow(params.parsedWorkflows, eventName);
    addIssue(params.warnings, {
      code: 'event-emitter-without-trigger',
      filePath: workflow?.filePath,
      workflowId: workflow?.workflowId,
      message: `Event '${eventName}' is emitted but no workflow trigger consumes it`,
    });
  }
}
