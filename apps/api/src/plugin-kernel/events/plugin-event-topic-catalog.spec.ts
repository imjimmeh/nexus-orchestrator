import { describe, expect, it } from 'vitest';
import {
  doesPluginOwnNamespaceTopic,
  isApprovedExactPluginEventTopic,
  isPluginNamespaceTopic,
  isValidTopicPattern,
  listApprovedExactPluginEventTopics,
  matchesTopicPattern,
} from './plugin-event-topic-catalog';

describe('plugin event topic catalog', () => {
  it('accepts approved exact internal topics', () => {
    expect(isApprovedExactPluginEventTopic('workflow.run.started.v1')).toBe(
      true,
    );
    expect(isApprovedExactPluginEventTopic('tool.invoked.v1')).toBe(true);
    expect(listApprovedExactPluginEventTopics()).toContain(
      'memory.recorded.v1',
    );
  });

  it('rejects unknown internal topics', () => {
    expect(isApprovedExactPluginEventTopic('workflow.run.cancelled.v1')).toBe(
      false,
    );
    expect(isApprovedExactPluginEventTopic('tool.executed.v1')).toBe(false);
  });

  it('accepts plugin namespace topics and ownership', () => {
    const topic = 'plugin.acme.audit.event.created';

    expect(isPluginNamespaceTopic(topic)).toBe(true);
    expect(doesPluginOwnNamespaceTopic('acme', topic)).toBe(true);
  });

  it('rejects plugin namespace impersonation', () => {
    const topic = 'plugin.acme.audit.event.created';

    expect(doesPluginOwnNamespaceTopic('other-plugin', topic)).toBe(false);
  });

  it('matches exact topic patterns', () => {
    expect(
      matchesTopicPattern(
        'workflow.run.completed.v1',
        'workflow.run.completed.v1',
      ),
    ).toBe(true);
    expect(
      matchesTopicPattern(
        'workflow.run.completed.v1',
        'workflow.run.failed.v1',
      ),
    ).toBe(false);
  });

  it('matches suffix wildcard topic patterns', () => {
    expect(
      matchesTopicPattern('workflow.run.*', 'workflow.run.completed.v1'),
    ).toBe(true);
    expect(
      matchesTopicPattern(
        'plugin.acme.audit.*',
        'plugin.acme.audit.event.created',
      ),
    ).toBe(true);
    expect(
      matchesTopicPattern('workflow.run.*', 'workflow.step.completed.v1'),
    ).toBe(false);
  });

  it('rejects wildcard placement that is not suffix-based', () => {
    expect(isValidTopicPattern('workflow.*.completed.v1')).toBe(false);
    expect(isValidTopicPattern('*.workflow.run.completed.v1')).toBe(false);
  });
});
