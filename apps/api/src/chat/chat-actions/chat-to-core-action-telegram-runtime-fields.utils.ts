const TELEGRAM_COMMAND_NAME_REGEX = /^[a-z][a-z0-9_]*$/u;
const TELEGRAM_EVENT_NAME_REGEX = /^[a-z][a-z0-9_.-]*$/u;
const DEFAULT_ENABLED_COMMANDS = ['help', 'new', 'resume', 'agent'];
const DEFAULT_COMMAND_RESUME_LIST_LIMIT = 8;
const DEFAULT_UX_PROGRESS_EVENTS_ALLOWLIST = [
  'job_start',
  'agent_prompt_sent',
  'tool_execution_start',
  'tool_execution_end',
  'container_starting',
  'container_started',
  'container_ready',
  'capability_preflight_failed',
];

export function readTelegramRuntimeCommandAndUxFields(
  value: Record<string, unknown>,
): {
  commandsEnabled: boolean;
  enabledCommands: string[];
  commandResumeListLimit: number;
  uxTypingEnabled: boolean;
  uxTypingHeartbeatMs: number;
  uxStatusUpdatesEnabled: boolean;
  uxStatusMode: 'single_message' | 'multi_message';
  uxHideThinking: boolean;
  uxExposeToolNames: boolean;
  uxCommandMenuSyncEnabled: boolean;
  uxProgressEventsAllowlist: string[];
  uxProgressUpdateThrottleMs: number;
  uxMaxProgressUpdatesPerRun: number;
} {
  return {
    ...readTelegramCommandSettings(value),
    ...readTelegramUxSettings(value),
  };
}

function readTelegramCommandSettings(value: Record<string, unknown>): {
  commandsEnabled: boolean;
  enabledCommands: string[];
  commandResumeListLimit: number;
} {
  const enabledCommands = readNormalizedStringList(
    value.enabledCommands,
    TELEGRAM_COMMAND_NAME_REGEX,
  ).values;

  return {
    commandsEnabled: readBoolean(value.commandsEnabled) ?? true,
    enabledCommands:
      enabledCommands.length > 0 ? enabledCommands : DEFAULT_ENABLED_COMMANDS,
    commandResumeListLimit:
      readPositiveInteger(value.commandResumeListLimit) ??
      DEFAULT_COMMAND_RESUME_LIST_LIMIT,
  };
}

function readTelegramUxSettings(value: Record<string, unknown>): {
  uxTypingEnabled: boolean;
  uxTypingHeartbeatMs: number;
  uxStatusUpdatesEnabled: boolean;
  uxStatusMode: 'single_message' | 'multi_message';
  uxHideThinking: boolean;
  uxExposeToolNames: boolean;
  uxCommandMenuSyncEnabled: boolean;
  uxProgressEventsAllowlist: string[];
  uxProgressUpdateThrottleMs: number;
  uxMaxProgressUpdatesPerRun: number;
} {
  return {
    ...readTypingAndStatusUxSettings(value),
    ...readProgressUxSettings(value),
  };
}

function readTypingAndStatusUxSettings(value: Record<string, unknown>): {
  uxTypingEnabled: boolean;
  uxTypingHeartbeatMs: number;
  uxStatusUpdatesEnabled: boolean;
  uxStatusMode: 'single_message' | 'multi_message';
  uxHideThinking: boolean;
  uxExposeToolNames: boolean;
  uxCommandMenuSyncEnabled: boolean;
} {
  return {
    uxTypingEnabled: readBoolean(value.uxTypingEnabled) ?? true,
    uxTypingHeartbeatMs: readPositiveInteger(value.uxTypingHeartbeatMs) ?? 4000,
    uxStatusUpdatesEnabled: readBoolean(value.uxStatusUpdatesEnabled) ?? true,
    uxStatusMode: readStatusModeValue(value.uxStatusMode) ?? 'single_message',
    uxHideThinking: readBoolean(value.uxHideThinking) ?? true,
    uxExposeToolNames: readBoolean(value.uxExposeToolNames) ?? false,
    uxCommandMenuSyncEnabled:
      readBoolean(value.uxCommandMenuSyncEnabled) ?? true,
  };
}

function readProgressUxSettings(value: Record<string, unknown>): {
  uxProgressEventsAllowlist: string[];
  uxProgressUpdateThrottleMs: number;
  uxMaxProgressUpdatesPerRun: number;
} {
  const progressEventsAllowlist = readNormalizedStringList(
    value.uxProgressEventsAllowlist,
    TELEGRAM_EVENT_NAME_REGEX,
  ).values;

  return {
    uxProgressEventsAllowlist:
      progressEventsAllowlist.length > 0
        ? progressEventsAllowlist
        : DEFAULT_UX_PROGRESS_EVENTS_ALLOWLIST,
    uxProgressUpdateThrottleMs:
      readPositiveInteger(value.uxProgressUpdateThrottleMs) ?? 1500,
    uxMaxProgressUpdatesPerRun:
      readPositiveInteger(value.uxMaxProgressUpdatesPerRun) ?? 40,
  };
}

function readNormalizedStringList(
  value: unknown,
  pattern: RegExp,
): { values: string[] } {
  const normalizedValues = new Set<string>();

  for (const candidate of readAllowedUserIdCandidates(value)) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const normalized = candidate.trim().toLowerCase();
    if (!normalized || !pattern.test(normalized)) {
      continue;
    }

    normalizedValues.add(normalized);
  }

  return {
    values: [...normalizedValues],
  };
}

function readAllowedUserIdCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Fall back to delimiter parsing when value is not valid JSON.
    }
  }

  return trimmed.split(/[\n,]/u);
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value !== 'boolean') {
    return null;
  }

  return value;
}

function readStatusModeValue(
  value: unknown,
): 'single_message' | 'multi_message' | null {
  if (value === 'single_message' || value === 'multi_message') {
    return value;
  }

  return null;
}
