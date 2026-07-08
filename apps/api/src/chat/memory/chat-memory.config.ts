import type { ChatMemoryLifecycleConfig } from './chat-memory.types';

const DEFAULT_MAX_SESSION_ENTRIES = 120;
const DEFAULT_DISTILLATION_TURN_INTERVAL = 6;
const DEFAULT_CONTEXT_TOKEN_BUDGET = 600;
const DEFAULT_CONTEXT_MAX_SLICES = 6;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_RETRY_DELAY_MS = 15000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MEMORY_CONTEXT_INJECTION_ENABLED = true;
const MEMORY_CONTEXT_INJECTION_ENV_KEY = 'MEMORY_CONTEXT_INJECTION_ENABLED';

export function resolveChatMemoryConfig(): ChatMemoryLifecycleConfig {
  return {
    maxSessionEntries: readPositiveInt(
      'CHAT_MEMORY_MAX_SESSION_ENTRIES',
      DEFAULT_MAX_SESSION_ENTRIES,
    ),
    distillationTurnInterval: readPositiveInt(
      'CHAT_MEMORY_DISTILLATION_TURN_INTERVAL',
      DEFAULT_DISTILLATION_TURN_INTERVAL,
    ),
    contextTokenBudget: readPositiveInt(
      'CHAT_MEMORY_CONTEXT_TOKEN_BUDGET',
      DEFAULT_CONTEXT_TOKEN_BUDGET,
    ),
    contextMaxSlices: readPositiveInt(
      'CHAT_MEMORY_CONTEXT_MAX_SLICES',
      DEFAULT_CONTEXT_MAX_SLICES,
    ),
    pollIntervalMs: readPositiveInt(
      'CHAT_MEMORY_POLL_INTERVAL_MS',
      DEFAULT_POLL_INTERVAL_MS,
    ),
    retryDelayMs: readPositiveInt(
      'CHAT_MEMORY_RETRY_DELAY_MS',
      DEFAULT_RETRY_DELAY_MS,
    ),
    maxAttempts: readPositiveInt(
      'CHAT_MEMORY_JOB_MAX_ATTEMPTS',
      DEFAULT_MAX_ATTEMPTS,
    ),
    memoryContextInjectionEnabled: isMemoryContextInjectionEnabled(),
  };
}

export function isMemoryContextInjectionEnabled(): boolean {
  return readBoolean(
    MEMORY_CONTEXT_INJECTION_ENV_KEY,
    DEFAULT_MEMORY_CONTEXT_INJECTION_ENABLED,
  );
}

function readPositiveInt(key: string, fallback: number): number {
  const rawValue = process.env[key];
  if (typeof rawValue !== 'string') {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function readBoolean(key: string, fallback: boolean): boolean {
  const rawValue = process.env[key];
  if (typeof rawValue !== 'string') {
    return fallback;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  return fallback;
}
