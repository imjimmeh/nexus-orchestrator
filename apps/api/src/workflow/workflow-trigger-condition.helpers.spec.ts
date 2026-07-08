import { describe, expect, it } from 'vitest';
import { evaluateTriggerCondition } from './workflow-trigger-condition.helpers';

describe('evaluateTriggerCondition', () => {
  it('returns true when condition is undefined', () => {
    expect(evaluateTriggerCondition(undefined, { foo: 'bar' })).toBe(true);
  });

  it('returns true when condition is empty or whitespace', () => {
    expect(evaluateTriggerCondition('', { foo: 'bar' })).toBe(true);
    expect(evaluateTriggerCondition('   ', { foo: 'bar' })).toBe(true);
  });

  it('returns true when handlebars expression renders truthy', () => {
    const payload = { resource: { scope: 'large' } };
    expect(
      evaluateTriggerCondition(
        "{{#if (eq resource.scope 'large')}}true{{else}}false{{/if}}",
        payload,
      ),
    ).toBe(true);
  });

  it('supports trigger.* namespace in addition to root payload access', () => {
    const payload = { resource: { scope: 'large' } };
    expect(
      evaluateTriggerCondition(
        "{{#if (eq trigger.resource.scope 'large')}}true{{else}}false{{/if}}",
        payload,
      ),
    ).toBe(true);
  });

  it('returns false when handlebars expression renders falsy', () => {
    const payload = { resource: { scope: 'standard' } };
    expect(
      evaluateTriggerCondition(
        "{{#if (eq trigger.resource.scope 'large')}}true{{else}}false{{/if}}",
        payload,
      ),
    ).toBe(false);
  });

  it('returns false for malformed templates rather than throwing', () => {
    expect(evaluateTriggerCondition('{{#if }}true{{/if}}', {})).toBe(false);
  });

  it('treats any non-"true" output as false (strict)', () => {
    expect(evaluateTriggerCondition('maybe', {})).toBe(false);
    expect(evaluateTriggerCondition('1', {})).toBe(false);
  });

  describe('refinement workflow trigger condition', () => {
    const REFINEMENT_CONDITION =
      "{{#if (and (eq trigger.status 'refinement') trigger.resource (or (not (eq trigger.resource.scope 'large')) trigger.resource.metadata.split.parentId) (or (not trigger.resource.metadata.refinement.hasClearedRefinementOnce) trigger.resource.metadata.refinement.retroactiveRefinementRequired (and trigger.resource.metadata.refinement.hasClearedRefinementOnce (not (eq trigger.previousStatus 'todo')))))}}true{{else}}false{{/if}}";

    const standardResource = (overrides: Record<string, unknown> = {}) => ({
      id: 'wi-1',
      scope_id: 'project-1',
      title: 'Test resource',
      description: null,
      status: 'refinement',
      scope: 'standard',
      priority: 'p2',
      assignedAgentId: null,
      tokenSpend: 0,
      currentExecutionId: null,
      waitingForInput: false,
      executionConfig: undefined,
      metadata: null,
      dependsOn: [],
      blockedBy: [],
      subtasks: [],
      linkedRunId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    });

    it('triggers for standard-scope item entering refinement for the first time (no metadata)', () => {
      const payload = {
        status: 'refinement',
        previousStatus: 'backlog',
        resource: standardResource(),
      };

      expect(evaluateTriggerCondition(REFINEMENT_CONDITION, payload)).toBe(
        true,
      );
    });

    it('does not trigger when status is not refinement', () => {
      const payload = {
        status: 'in-progress',
        previousStatus: 'todo',
        resource: standardResource(),
      };

      expect(evaluateTriggerCondition(REFINEMENT_CONDITION, payload)).toBe(
        false,
      );
    });

    it('triggers when metadata.refinement is an empty object (first refinement)', () => {
      const payload = {
        status: 'refinement',
        previousStatus: 'backlog',
        resource: standardResource({
          metadata: { refinement: {} },
        }),
      };

      expect(evaluateTriggerCondition(REFINEMENT_CONDITION, payload)).toBe(
        true,
      );
    });

    it('triggers when hasClearedRefinementOnce is false', () => {
      const payload = {
        status: 'refinement',
        previousStatus: 'backlog',
        resource: standardResource({
          metadata: {
            refinement: { hasClearedRefinementOnce: false },
          },
        }),
      };

      expect(evaluateTriggerCondition(REFINEMENT_CONDITION, payload)).toBe(
        true,
      );
    });

    it('skips when hasClearedRefinementOnce is true and previous status was todo (already refined, back to todo, moved again)', () => {
      const payload = {
        status: 'refinement',
        previousStatus: 'todo',
        resource: standardResource({
          metadata: {
            refinement: { hasClearedRefinementOnce: true },
          },
        }),
      };

      expect(evaluateTriggerCondition(REFINEMENT_CONDITION, payload)).toBe(
        false,
      );
    });

    it('triggers retroactively when retroactiveRefinementRequired is true', () => {
      const payload = {
        status: 'refinement',
        previousStatus: 'todo',
        resource: standardResource({
          metadata: {
            refinement: {
              hasClearedRefinementOnce: true,
              retroactiveRefinementRequired: true,
            },
          },
        }),
      };

      expect(evaluateTriggerCondition(REFINEMENT_CONDITION, payload)).toBe(
        true,
      );
    });

    it('triggers for large-scope item with split parentId', () => {
      const payload = {
        status: 'refinement',
        previousStatus: 'backlog',
        resource: standardResource({
          scope: 'large',
          metadata: {
            split: { parentId: 'parent-1' },
          },
        }),
      };

      expect(evaluateTriggerCondition(REFINEMENT_CONDITION, payload)).toBe(
        true,
      );
    });
  });
});
