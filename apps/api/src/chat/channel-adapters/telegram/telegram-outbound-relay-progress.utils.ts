import type { TelegramProgressRelayEvent } from './telegram-outbound-relay-active-run.types';

type TelegramProgressRelayEventEntry = {
  event: TelegramProgressRelayEvent;
  eventType: string;
  cursor: string;
};

const TOOL_EXECUTION_START_EVENT = 'tool_execution_start';
const TOOL_EXECUTION_END_EVENT = 'tool_execution_end';
const TOOL_EXECUTION_BATCH_EVENT = 'tool_execution_batch';

const PROGRESS_EVENT_MESSAGE_BY_TYPE: Record<string, string> = {
  job_start: 'Started processing your request.',
  agent_prompt_sent: 'Agent is planning next steps.',
  tool_execution_start: 'Running a tool to gather or apply changes.',
  tool_execution_end: 'Tool step completed.',
  container_starting: 'Preparing execution environment.',
  container_started: 'Execution environment started.',
  container_ready: 'Agent is ready to continue.',
  capability_preflight_failed:
    'Cannot continue because required tool access is unavailable.',
  user_questions_posed: 'I need your input to continue.',
};

export function selectLatestProgressRelayEvent(params: {
  events: TelegramProgressRelayEvent[];
  allowlistedEventTypes: Set<string>;
  afterCursor: string | null;
}): {
  event: TelegramProgressRelayEvent;
  cursor: string;
  eventType: string;
} | null {
  const entries = params.events.map(
    (event, index): TelegramProgressRelayEventEntry => {
      const eventType = normalizeEventType(event.event_type);
      return {
        event,
        eventType,
        cursor: buildProgressEventCursor(event, index),
      };
    },
  );

  const cursorIndex =
    params.afterCursor === null
      ? -1
      : entries.findIndex((entry) => entry.cursor === params.afterCursor);

  const matches: TelegramProgressRelayEventEntry[] = [];

  for (let index = cursorIndex + 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry.eventType) {
      continue;
    }

    if (!params.allowlistedEventTypes.has(entry.eventType)) {
      continue;
    }

    matches.push(entry);
  }

  if (matches.length === 0) {
    return null;
  }

  const groupedToolProgress = buildConsecutiveToolProgressEvent(matches);
  if (groupedToolProgress) {
    return groupedToolProgress;
  }

  const latestMatch = matches[matches.length - 1];
  return {
    event: latestMatch.event,
    cursor: latestMatch.cursor,
    eventType: latestMatch.eventType,
  };
}

export function buildProgressRelayText(params: {
  eventType: string;
  payload: Record<string, unknown>;
  exposeToolNames: boolean;
}): string | null {
  if (params.eventType === TOOL_EXECUTION_BATCH_EVENT) {
    return buildToolBatchEventText(params.payload, params.exposeToolNames);
  }

  if (params.exposeToolNames) {
    const toolText = buildToolEventText(params.eventType, params.payload);
    if (toolText) {
      return toolText;
    }
  }

  return PROGRESS_EVENT_MESSAGE_BY_TYPE[params.eventType] ?? null;
}

function buildProgressEventCursor(
  event: TelegramProgressRelayEvent,
  index: number,
): string {
  const timestamp =
    typeof event.timestamp === 'string' && event.timestamp.trim().length > 0
      ? event.timestamp.trim()
      : 'na';

  return `${timestamp}|${event.event_type}|${index}`;
}

function normalizeEventType(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().toLowerCase();
}

function buildToolEventText(
  eventType: string,
  payload: Record<string, unknown>,
): string | null {
  if (
    eventType !== TOOL_EXECUTION_START_EVENT &&
    eventType !== TOOL_EXECUTION_END_EVENT
  ) {
    return null;
  }

  const toolName = readToolName(payload);
  if (!toolName) {
    return null;
  }

  if (eventType === TOOL_EXECUTION_START_EVENT) {
    return `Running tool: ${toolName}.`;
  }

  return `Completed tool: ${toolName}.`;
}

function buildConsecutiveToolProgressEvent(
  entries: TelegramProgressRelayEventEntry[],
): {
  event: TelegramProgressRelayEvent;
  cursor: string;
  eventType: string;
} | null {
  const trailingToolEntries = collectTrailingToolEntries(entries);
  if (trailingToolEntries.length < 2) {
    return null;
  }

  const toolUseCount = trailingToolEntries.reduce((count, entry) => {
    if (entry.eventType === TOOL_EXECUTION_START_EVENT) {
      return count + 1;
    }

    return count;
  }, 0);

  if (toolUseCount < 2) {
    return null;
  }

  const toolNames = collectUniqueToolNames(trailingToolEntries);
  const latestToolEntry = trailingToolEntries[trailingToolEntries.length - 1];

  return {
    event: {
      event_type: TOOL_EXECUTION_BATCH_EVENT,
      timestamp: latestToolEntry.event.timestamp,
      payload: {
        toolNames,
        toolUseCount,
      },
    },
    cursor: latestToolEntry.cursor,
    eventType: TOOL_EXECUTION_BATCH_EVENT,
  };
}

function collectTrailingToolEntries(
  entries: TelegramProgressRelayEventEntry[],
): TelegramProgressRelayEventEntry[] {
  const trailing: TelegramProgressRelayEventEntry[] = [];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!isToolExecutionEventType(entry.eventType)) {
      break;
    }

    trailing.unshift(entry);
  }

  return trailing;
}

function collectUniqueToolNames(
  entries: TelegramProgressRelayEventEntry[],
): string[] {
  const seen = new Set<string>();
  const uniqueNames: string[] = [];

  for (const entry of entries) {
    const toolName = readToolName(entry.event.payload);
    if (!toolName || seen.has(toolName)) {
      continue;
    }

    seen.add(toolName);
    uniqueNames.push(toolName);
  }

  return uniqueNames;
}

function buildToolBatchEventText(
  payload: Record<string, unknown>,
  exposeToolNames: boolean,
): string {
  const toolUseCount = readToolUseCount(payload.toolUseCount);
  const toolNames = readToolNames(payload.toolNames);

  if (exposeToolNames && toolNames.length > 0) {
    return `Running tools: ${toolNames.join(', ')}.`;
  }

  if (toolUseCount !== null) {
    if (toolUseCount === 1) {
      return 'Running a tool to gather or apply changes.';
    }

    return `Running ${toolUseCount} tool calls.`;
  }

  return 'Running tools to gather or apply changes.';
}

function isToolExecutionEventType(eventType: string): boolean {
  return (
    eventType === TOOL_EXECUTION_START_EVENT ||
    eventType === TOOL_EXECUTION_END_EVENT
  );
}

function readToolUseCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return null;
  }

  return value;
}

function readToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const names: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      names.push(trimmed);
    }
  }

  return names;
}

function readToolName(payload: Record<string, unknown>): string | null {
  const candidates = [payload.toolName, payload.tool_name, payload.name];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}
