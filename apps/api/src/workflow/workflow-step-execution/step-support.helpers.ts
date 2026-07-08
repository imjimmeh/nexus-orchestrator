import { asRecord, isRecord } from '@nexus/core';
import type { NormalizedToolPolicy } from './step-support.helpers.types';

const TOOL_POLICY_ALLOW_EFFECTS = new Set(['allow', 'require_approval']);
const TOOL_POLICY_DENY_EFFECTS = new Set(['deny', 'guardrail_deny']);

interface JsonScanState {
  depth: number;
  start: number;
  inString: boolean;
  isEscaped: boolean;
  candidates: string[];
}

function getTrimmedString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function addToolPolicyRule(
  allow: Set<string>,
  deny: Set<string>,
  effect: unknown,
  tool: unknown,
): void {
  if (typeof effect !== 'string' || typeof tool !== 'string') {
    return;
  }

  const normalizedTool = tool.trim();
  if (normalizedTool.length === 0) {
    return;
  }

  if (TOOL_POLICY_ALLOW_EFFECTS.has(effect)) {
    allow.add(normalizedTool);
  }
  if (TOOL_POLICY_DENY_EFFECTS.has(effect)) {
    deny.add(normalizedTool);
  }
}

function addStringToolPolicyRule(
  allow: Set<string>,
  deny: Set<string>,
  rule: string,
): void {
  const [effect, tool] = rule.trim().split(/\s+/, 3);
  addToolPolicyRule(allow, deny, effect, tool);
}

function addStructuredToolPolicyRules(
  allow: Set<string>,
  deny: Set<string>,
  toolPolicy: unknown,
): void {
  const toolPolicyRecord = asRecord(toolPolicy);
  if (!toolPolicyRecord) {
    return;
  }

  if (toolPolicyRecord.default === 'allow') {
    allow.add('*');
  }

  if (!Array.isArray(toolPolicyRecord.rules)) {
    return;
  }

  for (const rule of toolPolicyRecord.rules) {
    if (typeof rule === 'string') {
      addStringToolPolicyRule(allow, deny, rule);
      continue;
    }

    const ruleRecord = asRecord(rule);
    addToolPolicyRule(allow, deny, ruleRecord?.effect, ruleRecord?.tool);
  }
}

export function normalizeToolPolicy(policy: unknown): NormalizedToolPolicy {
  const allow = new Set<string>();
  const deny = new Set<string>();

  const policyRecord = asRecord(policy);
  if (!policyRecord) {
    return { allow, deny };
  }

  addStructuredToolPolicyRules(allow, deny, policyRecord.tool_policy);

  return { allow, deny };
}

export function extractAgentProfileFromTriggerState(
  stateVariables?: Record<string, unknown>,
): string | undefined {
  const trigger = asRecord(stateVariables?.trigger);
  const directExecutionConfig = asRecord(trigger?.executionConfig);
  const directProfile = getTrimmedString(
    directExecutionConfig,
    'agentProfileId',
  );
  if (directProfile) {
    return directProfile;
  }

  const triggerResource = asRecord(trigger?.resource ?? trigger?.context);
  const nestedExecutionConfig = asRecord(triggerResource?.executionConfig);
  return getTrimmedString(nestedExecutionConfig, 'agentProfileId');
}

function resolveExecutionConfigFromTrigger(
  stateVariables?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const trigger = stateVariables ? asRecord(stateVariables.trigger) : {};
  if (isRecord(trigger.executionConfig)) {
    return trigger.executionConfig;
  }
  const resource = asRecord(trigger.resource ?? trigger.context);
  return isRecord(resource.executionConfig)
    ? resource.executionConfig
    : undefined;
}

export function extractModelOverrideFromTriggerState(
  stateVariables?: Record<string, unknown>,
): string | undefined {
  return getTrimmedString(
    resolveExecutionConfigFromTrigger(stateVariables),
    'model',
  );
}

export function extractProviderOverrideFromTriggerState(
  stateVariables?: Record<string, unknown>,
): string | undefined {
  return getTrimmedString(
    resolveExecutionConfigFromTrigger(stateVariables),
    'provider',
  );
}

/**
 * Resolves the scope node id a run executes under so scoped AI defaults
 * (harness/provider/model) can be applied. Mirrors the launch/orchestration
 * trigger shape where the scope lives at the top level (`trigger.scopeId`),
 * with a fallback to the nested `trigger.context` shape used by some dispatch
 * triggers. Returns undefined so precedence falls back to the platform default.
 */
export function extractScopeNodeIdFromTriggerState(
  stateVariables?: Record<string, unknown>,
): string | undefined {
  const trigger = asRecord(stateVariables?.trigger);
  const topLevel =
    getTrimmedString(trigger, 'scopeId') ??
    getTrimmedString(trigger, 'scope_id');
  if (topLevel) {
    return topLevel;
  }

  const context = asRecord(trigger?.context);
  return (
    getTrimmedString(context, 'scopeId') ??
    getTrimmedString(context, 'scope_id')
  );
}

export function extractSubagentModelCascade(
  stateVariables?: Record<string, unknown>,
): { model_override?: string; provider_override?: string } {
  const config = resolveExecutionConfigFromTrigger(stateVariables);
  if (!config || config.forceModelForSubagents !== true) {
    return {};
  }
  const model = getTrimmedString(config, 'model');
  if (!model) {
    return {};
  }
  const provider = getTrimmedString(config, 'provider');
  return {
    model_override: model,
    ...(provider ? { provider_override: provider } : {}),
  };
}

function parseRecordJson(
  jsonCandidate: string,
): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(jsonCandidate);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function extractJsonFence(response: string): string | null {
  const jsonFenceRegex = /```json\s*\n([\s\S]*?)```/;
  const fencedMatch = jsonFenceRegex.exec(response);
  return fencedMatch?.[1]?.trim() || null;
}

function handleStringState(state: JsonScanState, char: string): void {
  if (state.isEscaped) {
    state.isEscaped = false;
    return;
  }

  if (char === '\\') {
    state.isEscaped = true;
    return;
  }

  if (char === '"') {
    state.inString = false;
  }
}

function handleObjectBoundaries(
  response: string,
  state: JsonScanState,
  char: string,
  index: number,
): void {
  if (char === '{') {
    if (state.depth === 0) {
      state.start = index;
    }
    state.depth += 1;
    return;
  }

  if (char !== '}' || state.depth === 0) {
    return;
  }

  state.depth -= 1;
  if (state.depth === 0 && state.start !== -1) {
    state.candidates.push(response.slice(state.start, index + 1));
    state.start = -1;
  }
}

function lastNonEmptyCandidate(candidates: string[]): string | null {
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i].trim();
    if (candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

export function extractLastBalancedJsonObject(response: string): string | null {
  const state: JsonScanState = {
    depth: 0,
    start: -1,
    inString: false,
    isEscaped: false,
    candidates: [],
  };

  for (let index = 0; index < response.length; index += 1) {
    const char = response[index];

    if (state.inString) {
      handleStringState(state, char);
      continue;
    }

    if (char === '"') {
      state.inString = true;
      continue;
    }

    handleObjectBoundaries(response, state, char, index);
  }

  return lastNonEmptyCandidate(state.candidates);
}

export function extractStructuredOutput(
  response: string,
): Record<string, unknown> | null {
  const fenced = extractJsonFence(response);
  if (fenced) {
    const parsedFenced = parseRecordJson(fenced);
    if (parsedFenced) {
      return parsedFenced;
    }
  }

  const candidate = extractLastBalancedJsonObject(response);
  if (!candidate) {
    return null;
  }

  return parseRecordJson(candidate);
}
