import { describe, expect, it } from 'vitest';
import {
  buildStartDedupeKey,
  resolveTriggerDedupeContext,
} from './workflow-engine.utils';

describe('workflow engine dedupe utils', () => {
  it('uses canonical status from event trigger data for dedupe', () => {
    const context = resolveTriggerDedupeContext({
      event: 'external.resource.status_changed.v1',
      scopeId: 'project-1',
      contextId: 'resource-1',
      status: 'in-review',
      previousStatus: 'in-progress',
    });

    expect(context).toEqual({
      event: 'external.resource.status_changed.v1',
      scopeId: 'project-1',
      contextId: 'resource-1',
      status: 'in-review',
    });
    expect(buildStartDedupeKey('wf-1', context!)).toBe(
      'wf-1:external.resource.status_changed.v1:project-1:resource-1:in-review',
    );
  });

  it('ignores legacy toStatus when canonical status is present', () => {
    expect(
      resolveTriggerDedupeContext({
        event: 'external.resource.status_changed.v1',
        scopeId: 'project-1',
        contextId: 'resource-1',
        status: 'in-review',
        toStatus: 'legacy-in-review',
      }),
    ).toMatchObject({ status: 'in-review' });
  });
});
