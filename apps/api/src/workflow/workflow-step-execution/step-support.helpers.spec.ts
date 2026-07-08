import { describe, expect, it } from 'vitest';
import { ToolPolicyEffect } from '@nexus/core';
import {
  normalizeToolPolicy,
  extractModelOverrideFromTriggerState,
  extractProviderOverrideFromTriggerState,
  extractScopeNodeIdFromTriggerState,
  extractSubagentModelCascade,
} from './step-support.helpers';

describe('normalizeToolPolicy', () => {
  it('normalizes allow and deny entries from structured tool_policy rules', () => {
    const policy = normalizeToolPolicy({
      tool_policy: {
        default: ToolPolicyEffect.DENY,
        rules: [
          { effect: ToolPolicyEffect.ALLOW, tool: 'read' },
          { effect: ToolPolicyEffect.REQUIRE_APPROVAL, tool: 'bash' },
          { effect: ToolPolicyEffect.DENY, tool: 'write' },
          { effect: ToolPolicyEffect.GUARDRAIL_DENY, tool: 'edit' },
        ],
      },
    });

    expect(policy.allow).toEqual(new Set(['read', 'bash']));
    expect(policy.deny).toEqual(new Set(['write', 'edit']));
  });

  it('normalizes allow and deny entries from string tool_policy rules', () => {
    const policy = normalizeToolPolicy({
      tool_policy: {
        default: ToolPolicyEffect.DENY,
        rules: [
          'allow read *',
          'require_approval bash *',
          'deny write *',
          'guardrail_deny edit *',
        ],
      },
    });

    expect(policy.allow).toEqual(new Set(['read', 'bash']));
    expect(policy.deny).toEqual(new Set(['write', 'edit']));
  });

  it('treats default allow tool_policy as wildcard allow with explicit denies', () => {
    const policy = normalizeToolPolicy({
      tool_policy: {
        default: ToolPolicyEffect.ALLOW,
        rules: [{ effect: ToolPolicyEffect.DENY, tool: 'write' }],
      },
    });

    expect(policy.allow).toEqual(new Set(['*']));
    expect(policy.deny).toEqual(new Set(['write']));
  });
});

describe('extractModelOverrideFromTriggerState', () => {
  it('returns model from direct trigger.executionConfig', () => {
    const result = extractModelOverrideFromTriggerState({
      trigger: { executionConfig: { model: 'claude-opus-4-8' } },
    });
    expect(result).toBe('claude-opus-4-8');
  });

  it('returns model from nested trigger.resource.executionConfig', () => {
    const result = extractModelOverrideFromTriggerState({
      trigger: { resource: { executionConfig: { model: 'claude-haiku-4-5' } } },
    });
    expect(result).toBe('claude-haiku-4-5');
  });

  it('prefers direct trigger.executionConfig over nested resource', () => {
    const result = extractModelOverrideFromTriggerState({
      trigger: {
        executionConfig: { model: 'claude-opus-4-8' },
        resource: { executionConfig: { model: 'claude-haiku-4-5' } },
      },
    });
    expect(result).toBe('claude-opus-4-8');
  });

  it('returns undefined when model is absent', () => {
    expect(
      extractModelOverrideFromTriggerState({ trigger: {} }),
    ).toBeUndefined();
    expect(extractModelOverrideFromTriggerState({})).toBeUndefined();
    expect(extractModelOverrideFromTriggerState(undefined)).toBeUndefined();
  });

  it('returns undefined when model is an empty string', () => {
    const result = extractModelOverrideFromTriggerState({
      trigger: { executionConfig: { model: '   ' } },
    });
    expect(result).toBeUndefined();
  });
});

describe('extractProviderOverrideFromTriggerState', () => {
  it('returns provider from direct trigger.executionConfig', () => {
    const result = extractProviderOverrideFromTriggerState({
      trigger: { executionConfig: { provider: 'anthropic' } },
    });
    expect(result).toBe('anthropic');
  });

  it('returns provider from nested trigger.resource.executionConfig', () => {
    const result = extractProviderOverrideFromTriggerState({
      trigger: { resource: { executionConfig: { provider: 'openai' } } },
    });
    expect(result).toBe('openai');
  });

  it('returns undefined when provider is absent', () => {
    expect(extractProviderOverrideFromTriggerState({})).toBeUndefined();
    expect(extractProviderOverrideFromTriggerState(undefined)).toBeUndefined();
  });
});

describe('extractScopeNodeIdFromTriggerState', () => {
  it('returns scopeId from the top-level trigger (launch / orchestration shape)', () => {
    const result = extractScopeNodeIdFromTriggerState({
      trigger: { scopeId: 'project-458935f0' },
    });
    expect(result).toBe('project-458935f0');
  });

  it('returns scope_id (snake_case) from the top-level trigger', () => {
    const result = extractScopeNodeIdFromTriggerState({
      trigger: { scope_id: 'project-458935f0' },
    });
    expect(result).toBe('project-458935f0');
  });

  it('falls back to the nested trigger.context scope when top-level is absent', () => {
    expect(
      extractScopeNodeIdFromTriggerState({
        trigger: { context: { scopeId: 'ctx-scope' } },
      }),
    ).toBe('ctx-scope');
    expect(
      extractScopeNodeIdFromTriggerState({
        trigger: { context: { scope_id: 'ctx-scope' } },
      }),
    ).toBe('ctx-scope');
  });

  it('prefers the top-level trigger scope over the nested context scope', () => {
    const result = extractScopeNodeIdFromTriggerState({
      trigger: {
        scopeId: 'top-scope',
        context: { scopeId: 'ctx-scope' },
      },
    });
    expect(result).toBe('top-scope');
  });

  it('returns undefined when no scope is present or values are blank', () => {
    expect(extractScopeNodeIdFromTriggerState({ trigger: {} })).toBeUndefined();
    expect(
      extractScopeNodeIdFromTriggerState({ trigger: { scopeId: '   ' } }),
    ).toBeUndefined();
    expect(extractScopeNodeIdFromTriggerState({})).toBeUndefined();
    expect(extractScopeNodeIdFromTriggerState(undefined)).toBeUndefined();
  });
});

describe('extractSubagentModelCascade', () => {
  it('returns model_override and provider_override when forceModelForSubagents is true', () => {
    const result = extractSubagentModelCascade({
      trigger: {
        resource: {
          executionConfig: {
            forceModelForSubagents: true,
            model: 'claude-opus-4-8',
            provider: 'anthropic',
          },
        },
      },
    });
    expect(result).toEqual({
      model_override: 'claude-opus-4-8',
      provider_override: 'anthropic',
    });
  });

  it('returns empty object when forceModelForSubagents is false', () => {
    const result = extractSubagentModelCascade({
      trigger: {
        resource: {
          executionConfig: {
            forceModelForSubagents: false,
            model: 'claude-opus-4-8',
          },
        },
      },
    });
    expect(result).toEqual({});
  });

  it('returns empty object when forceModelForSubagents is absent', () => {
    const result = extractSubagentModelCascade({
      trigger: {
        resource: { executionConfig: { model: 'claude-opus-4-8' } },
      },
    });
    expect(result).toEqual({});
  });

  it('returns empty object with no model_override when model is absent but flag is true', () => {
    const result = extractSubagentModelCascade({
      trigger: {
        resource: {
          executionConfig: { forceModelForSubagents: true },
        },
      },
    });
    expect(result).toEqual({});
  });

  it('returns empty object when stateVariables are absent', () => {
    expect(extractSubagentModelCascade(undefined)).toEqual({});
    expect(extractSubagentModelCascade({})).toEqual({});
  });
});
