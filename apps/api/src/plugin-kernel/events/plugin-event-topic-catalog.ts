const APPROVED_EXACT_TOPICS = [
  'workflow.run.started.v1',
  'workflow.run.completed.v1',
  'workflow.run.failed.v1',
  'workflow.step.started.v1',
  'workflow.step.completed.v1',
  'workflow.step.failed.v1',
  'tool.invoked.v1',
  'memory.recorded.v1',
] as const;

type ApprovedExactPluginEventTopic = (typeof APPROVED_EXACT_TOPICS)[number];

const SUFFIX_WILDCARD = '.*';
const PLUGIN_TOPIC_PREFIX = 'plugin.';
const TOPIC_SEGMENT_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const PLUGIN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?$/;

export function listApprovedExactPluginEventTopics(): readonly ApprovedExactPluginEventTopic[] {
  return APPROVED_EXACT_TOPICS;
}

export function isApprovedExactPluginEventTopic(topic: string): boolean {
  return APPROVED_EXACT_TOPICS.some((approvedTopic) => approvedTopic === topic);
}

export function isPluginNamespaceTopic(topic: string): boolean {
  if (!topic.startsWith(PLUGIN_TOPIC_PREFIX)) {
    return false;
  }

  const withoutPrefix = topic.slice(PLUGIN_TOPIC_PREFIX.length);
  const firstSeparator = withoutPrefix.indexOf('.');
  if (firstSeparator <= 0) {
    return false;
  }

  const pluginId = withoutPrefix.slice(0, firstSeparator);
  const eventName = withoutPrefix.slice(firstSeparator + 1);

  return PLUGIN_ID_PATTERN.test(pluginId) && isAllowedEventTopicTail(eventName);
}

export function isApprovedTopicForPlugin(
  topic: string,
  pluginId?: string,
): boolean {
  if (isApprovedExactPluginEventTopic(topic)) {
    return true;
  }

  if (!pluginId) {
    return false;
  }

  return doesPluginOwnNamespaceTopic(pluginId, topic);
}

export function doesPluginOwnNamespaceTopic(
  pluginId: string,
  topic: string,
): boolean {
  if (!PLUGIN_ID_PATTERN.test(pluginId) || !isPluginNamespaceTopic(topic)) {
    return false;
  }

  return topic.startsWith(`${PLUGIN_TOPIC_PREFIX}${pluginId}.`);
}

export function matchesTopicPattern(
  topicPattern: string,
  topic: string,
): boolean {
  if (!isValidTopicPattern(topicPattern)) {
    return false;
  }

  if (!isValidConcreteTopic(topic)) {
    return false;
  }

  if (topicPattern.endsWith(SUFFIX_WILDCARD)) {
    const prefix = topicPattern.slice(0, -SUFFIX_WILDCARD.length);
    return topic.startsWith(`${prefix}.`);
  }

  return topicPattern === topic;
}

export function isValidTopicPattern(topicPattern: string): boolean {
  if (
    !topicPattern ||
    (topicPattern.includes('*') && !topicPattern.endsWith(SUFFIX_WILDCARD))
  ) {
    return false;
  }

  if (topicPattern.endsWith(SUFFIX_WILDCARD)) {
    const prefix = topicPattern.slice(0, -SUFFIX_WILDCARD.length);
    return isValidConcreteTopic(prefix);
  }

  return isValidConcreteTopic(topicPattern);
}

export function isApprovedTopicPatternForPlugin(
  topicPattern: string,
  pluginId: string,
): boolean {
  if (!isValidTopicPattern(topicPattern)) {
    return false;
  }

  if (topicPattern.endsWith(SUFFIX_WILDCARD)) {
    const prefix = topicPattern.slice(0, -SUFFIX_WILDCARD.length);
    if (prefix.startsWith(PLUGIN_TOPIC_PREFIX)) {
      return doesPluginOwnNamespaceTopic(pluginId, topicPattern);
    }

    return APPROVED_EXACT_TOPICS.some((topic) =>
      topic.startsWith(`${prefix}.`),
    );
  }

  return isApprovedTopicForPlugin(topicPattern, pluginId);
}

function isValidConcreteTopic(topic: string): boolean {
  const segments = topic.split('.').filter((segment) => segment.length > 0);
  return (
    segments.length > 1 &&
    segments.every((segment) => TOPIC_SEGMENT_PATTERN.test(segment))
  );
}

function isAllowedEventTopicTail(eventTail: string): boolean {
  if (!eventTail) {
    return false;
  }

  if (eventTail.endsWith(SUFFIX_WILDCARD)) {
    return isValidConcreteTopic(eventTail.slice(0, -SUFFIX_WILDCARD.length));
  }

  return isValidConcreteTopic(eventTail);
}
