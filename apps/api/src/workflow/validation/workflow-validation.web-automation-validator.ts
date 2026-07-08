import {
  isRecord,
  type BrowserAutomationActionType,
  type IJob,
} from '@nexus/core';
import { isNonEmptyString } from './workflow-validation.guards';
import type { ValidationCollector } from './workflow-validation.types';

const SUPPORTED_WEB_AUTOMATION_ACTIONS: ReadonlySet<BrowserAutomationActionType> =
  new Set([
    'open_page',
    'navigate',
    'click',
    'type',
    'wait_for',
    'read_page',
    'screenshot',
  ]);

export function validateWebAutomationJob(
  job: IJob,
  collector: ValidationCollector,
): void {
  const inputs = isRecord(job.inputs) ? job.inputs : {};
  const action = resolveAction(job.id, inputs, collector);
  if (!action) {
    return;
  }

  validateActionRequirements(job.id, action, inputs, collector);
}

function resolveAction(
  jobId: string,
  inputs: Record<string, unknown>,
  collector: ValidationCollector,
): BrowserAutomationActionType | undefined {
  const actionValue = inputs.action;
  if (!isNonEmptyString(actionValue)) {
    collector.add(
      `Job '${jobId}' has type 'web_automation' but is missing inputs.action`,
    );
    return undefined;
  }

  if (
    !SUPPORTED_WEB_AUTOMATION_ACTIONS.has(
      actionValue as BrowserAutomationActionType,
    )
  ) {
    collector.add(
      `Job '${jobId}' has type 'web_automation' with unsupported inputs.action '${actionValue}'`,
    );
    return undefined;
  }

  return actionValue as BrowserAutomationActionType;
}

function validateActionRequirements(
  jobId: string,
  action: BrowserAutomationActionType,
  inputs: Record<string, unknown>,
  collector: ValidationCollector,
): void {
  if (requiresUrl(action) && !isNonEmptyString(inputs.url)) {
    collector.add(
      `Job '${jobId}' web_automation action '${action}' requires inputs.url`,
    );
  }

  if (action === 'type' && !isNonEmptyString(inputs.text)) {
    collector.add(
      `Job '${jobId}' web_automation action 'type' requires inputs.text`,
    );
  }

  if (requiresSelectorStrategy(action) && !hasSelectorStrategy(inputs)) {
    collector.add(
      `Job '${jobId}' web_automation action '${action}' requires selector strategy inputs (selector, selector_alias, target_text, test_id, role/name, placeholder, or name)`,
    );
  }
}

function requiresUrl(action: BrowserAutomationActionType): boolean {
  return action === 'open_page' || action === 'navigate';
}

function requiresSelectorStrategy(
  action: BrowserAutomationActionType,
): boolean {
  return action === 'click' || action === 'type';
}

function hasSelectorStrategy(inputs: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(inputs.selector) ||
    isNonEmptyString(inputs.selector_alias) ||
    isNonEmptyString(inputs.target_text) ||
    isNonEmptyString(inputs.test_id) ||
    isNonEmptyString(inputs.placeholder) ||
    (isNonEmptyString(inputs.role) && isNonEmptyString(inputs.name)) ||
    isNonEmptyString(inputs.name)
  );
}
