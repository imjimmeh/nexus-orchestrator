import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as path from 'node:path';
import { normalizeOptionalString } from '@nexus/core';
import type { MutatingActionResult } from './workflow-runtime-orchestration-actions.service.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Narrows an unknown value to a plain object, or `{}` for non-objects/arrays. */
export function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** First value that is a non-empty string and a valid UUID, else null. */
export function firstUuid(values: unknown[]): string | null {
  for (const value of values) {
    const candidate = normalizeOptionalString(value);
    if (candidate && UUID_PATTERN.test(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** First value that normalizes to a non-empty string, else null. */
export function firstNormalizedString(values: unknown[]): string | null {
  for (const value of values) {
    const candidate = normalizeOptionalString(value);
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

/**
 * True only when an error genuinely indicates the requested workflow/run is
 * not found — a 404-shaped error whose message names the exact identifier and
 * carries not-found + resource semantics. Avoids swallowing unrelated 404s.
 */
export function isKnownWorkflowNotFoundError(
  error: unknown,
  requestedIdentifier: string,
  resourceTerms: string[],
): boolean {
  const record = normalizeRecord(error);
  const response = normalizeRecord(record.response);
  const hasNotFoundStatus =
    error instanceof NotFoundException ||
    [
      record.status,
      record.statusCode,
      response.status,
      response.statusCode,
    ].some((status) => status === 404);
  if (!hasNotFoundStatus) {
    return false;
  }

  const message = collectErrorText([record, response]).toLowerCase();
  const hasRequestedIdentifier = hasExactIdentifier(
    message,
    requestedIdentifier,
  );
  const hasNotFoundSemantics =
    message.includes('not found') ||
    message.includes('missing') ||
    message.includes('could not be found');
  const hasResourceSemantics = resourceTerms.some((term) =>
    message.includes(term),
  );

  return hasRequestedIdentifier && hasNotFoundSemantics && hasResourceSemantics;
}

function hasExactIdentifier(message: string, identifier: string): boolean {
  const escapedIdentifier = identifier
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const identifierPattern = new RegExp(
    `(^|[^a-z0-9_-])${escapedIdentifier}($|[^a-z0-9_-])`,
    'u',
  );
  return identifierPattern.test(message);
}

function collectErrorText(records: Record<string, unknown>[]): string {
  const parts: string[] = [];
  for (const record of records) {
    collectStringErrorValue(record.message, parts);
    collectStringErrorValue(record.error, parts);
  }
  return parts.join(' ');
}

function collectStringErrorValue(value: unknown, parts: string[]): void {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (typeof item === 'string') {
      parts.push(item);
    }
  }
}

/**
 * Infers the managed-clone workspace base path for a scope + repository, or
 * null when either is absent. Mirrors the host workspace layout.
 */
export function inferManagedCloneBasePath(
  scopeId: string | null,
  repositoryUrl: string | null,
): string | null {
  if (!scopeId || !repositoryUrl) {
    return null;
  }

  const workspaceBasePath =
    process.env.NEXUS_WORKSPACE_BASE_PATH?.trim() ||
    path.posix.join('/data', 'nexus-workspaces');

  const pathModule = shouldUseWindowsPath(workspaceBasePath)
    ? path.win32
    : path.posix;

  return pathModule.join(workspaceBasePath, 'clones', scopeId);
}

function shouldUseWindowsPath(basePath: string): boolean {
  return /^[a-z]:/iu.test(basePath) || basePath.includes('\\');
}

export function normalizeStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException(
      `${field} must be a non-empty string array. Suggested fix: provide at least one value in ${field}.`,
    );
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (normalized.length === 0) {
    throw new BadRequestException(
      `${field} must contain non-empty strings. Suggested fix: remove blank values and trim whitespace.`,
    );
  }

  return Array.from(new Set(normalized));
}

export function toMutatingActionResponse(
  result: MutatingActionResult,
): Record<string, unknown> {
  const actionRequestId = result.actionRequest ? result.actionRequest.id : null;
  const baseResponse = {
    ok: result.ok,
    requested_action: result.requestedAction,
    mode_evaluation: result.modeEvaluation,
    execution_status: result.executionStatus,
    correlation_id: result.correlationId,
    action_request_id: actionRequestId,
    recommendation: result.recommendation,
    authority_source: toNullable(result.authoritySource),
    error: result.error,
    ...(result.errorCode ? { error_code: result.errorCode } : {}),
    ...(result.errorMessage ? { error_message: result.errorMessage } : {}),
    ...(result.requestedWorkflowId
      ? { requested_workflow_id: result.requestedWorkflowId }
      : {}),
  };

  if (result.requestedAction === 'invoke_agent_workflow') {
    const alreadyActive = result.alreadyActive === true;
    return {
      ...baseResponse,
      run_id: toNullable(result.runId),
      workflow_run_id: toNullable(result.runId),
      already_active: alreadyActive,
      was_launched: !alreadyActive && result.executionStatus === 'executed',
      agent_profile_actual: toNullable(result.agentProfileActual),
    };
  }

  return {
    ...baseResponse,
    run_id: toNullable(result.runId),
    created_profile_id: toNullable(result.createdProfileId),
    created_profile_name: toNullable(result.createdProfileName),
  };
}

function toNullable(value: string | null | undefined): string | null {
  return value ?? null;
}
