import {
  AutomationHookActionType,
  AutomationHookTriggerType,
} from '@nexus/core';
import { describe, expect, it } from 'vitest';
import { AutomationHook } from './database/entities/automation-hook.entity';
import {
  isWithinCooldownWindow,
  matchesTriggerFilter,
} from './automation-hooks.utils';

function buildHook(overrides?: Partial<AutomationHook>): AutomationHook {
  const now = new Date('2026-04-12T16:00:00.000Z');
  return {
    id: 'hook-1',
    scopeId: 'project-1',
    enabled: true,
    trigger_type: AutomationHookTriggerType.WORKFLOW_RUN_FAILED,
    trigger_filter: null,
    priority: 100,
    action_type: AutomationHookActionType.RECORD_METADATA,
    action_payload: {},
    cooldown_window_seconds: 60,
    last_fired_at: null,
    created_by: null,
    updated_by: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('automation-hooks.utils', () => {
  it('matches nested trigger filters by dotted path', () => {
    const payload = {
      resource: {
        status: {
          to: 'blocked',
        },
      },
    };

    expect(
      matchesTriggerFilter(
        {
          'resource.status.to': 'blocked',
        },
        payload,
      ),
    ).toBe(true);
    expect(
      matchesTriggerFilter(
        {
          'resource.status.to': 'done',
        },
        payload,
      ),
    ).toBe(false);
  });

  it('returns false when cooldown is disabled', () => {
    const hook = buildHook({
      cooldown_window_seconds: 0,
      last_fired_at: new Date('2026-04-12T15:59:00.000Z'),
    });

    expect(
      isWithinCooldownWindow(hook, new Date('2026-04-12T16:00:00.000Z')),
    ).toBe(false);
  });

  it('returns true when now is inside cooldown window', () => {
    const hook = buildHook({
      cooldown_window_seconds: 120,
      last_fired_at: new Date('2026-04-12T15:59:30.000Z'),
    });

    expect(
      isWithinCooldownWindow(hook, new Date('2026-04-12T16:00:00.000Z')),
    ).toBe(true);
  });
});
