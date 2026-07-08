import { BadRequestException } from '@nestjs/common';
import type {
  BrowserAutomationActionType,
  IBrowserAutomationActionRequest,
} from '@nexus/core';
import type { BrowserRuntimeActionInput } from './workflow-runtime-browser-actions.types';

export const DEFAULT_SESSION_ID = 'default';
export const DEFAULT_ARTIFACT_LIMIT = 20;
export const MAX_ARTIFACT_LIMIT = 100;

export function buildBrowserActionInputs(
  action: BrowserAutomationActionType,
  sessionId: string,
  params: BrowserRuntimeActionInput,
): IBrowserAutomationActionRequest {
  return {
    action,
    session_id: sessionId,
    url: params.url,
    text: params.text,
    selector: params.selector,
    selector_alias: params.selector_alias,
    selector_aliases: params.selector_aliases,
    role: params.role,
    name: params.name,
    target_text: params.target_text,
    placeholder: params.placeholder,
    test_id: params.test_id,
    wait_for: params.wait_for,
    wait_state: params.wait_state,
    duration_ms: params.duration_ms,
    full_page: params.full_page,
    policy: params.policy,
    timeout_ms: params.timeout_ms,
    retry_budget: params.retry_budget,
    backoff_initial_ms: params.backoff_initial_ms,
    backoff_factor: params.backoff_factor,
    backoff_max_ms: params.backoff_max_ms,
    pacing_ms: params.pacing_ms,
  };
}

export function resolveSessionId(value: string | undefined): string {
  const trimmed = toOptionalString(value);
  return trimmed ?? DEFAULT_SESSION_ID;
}

export function requireNonEmptyString(value: unknown, field: string): string {
  const normalized = toOptionalString(value);
  if (!normalized) {
    throw new BadRequestException(`${field} is required`);
  }

  return normalized;
}

export function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function toBoundedInteger(
  value: unknown,
  fallback: number,
  options: {
    min: number;
    max: number;
  },
): number {
  const numeric = toNumber(value);
  if (numeric === null) {
    return fallback;
  }

  const rounded = Math.round(numeric);
  if (rounded < options.min) {
    return options.min;
  }

  if (rounded > options.max) {
    return options.max;
  }

  return rounded;
}

export function resolveDomainPolicyViolation(params: {
  action: BrowserAutomationActionType;
  rawUrl: string | undefined;
  allowedDomainsEnv: string | undefined;
  deniedDomainsEnv: string | undefined;
}): string | null {
  if (
    (params.action !== 'open_page' && params.action !== 'navigate') ||
    !params.rawUrl
  ) {
    return null;
  }

  let hostname = '';
  try {
    hostname = new URL(params.rawUrl).hostname.trim().toLowerCase();
  } catch {
    return 'Browser runtime action requires a valid absolute url';
  }

  if (!hostname) {
    return 'Browser runtime action requires a valid url hostname';
  }

  const denylist = readDomainList(params.deniedDomainsEnv);
  if (denylist.some((entry) => matchesDomain(hostname, entry))) {
    return `Browser runtime policy denied host '${hostname}'`;
  }

  const allowlist = readDomainList(params.allowedDomainsEnv);
  if (
    allowlist.length > 0 &&
    !allowlist.some((entry) => matchesDomain(hostname, entry))
  ) {
    return `Browser runtime policy allowlist rejected host '${hostname}'`;
  }

  return null;
}

function readDomainList(raw: string | undefined): string[] {
  if (typeof raw !== 'string') {
    return [];
  }

  const unique = new Set<string>();
  for (const value of raw.split(',')) {
    const normalized = value.trim().toLowerCase();
    if (normalized.length > 0) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

function matchesDomain(hostname: string, pattern: string): boolean {
  return hostname === pattern || hostname.endsWith(`.${pattern}`);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
