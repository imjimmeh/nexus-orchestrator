import { isRecord } from '@nexus/core';
import type {
  ChatTelegramIngressMode,
  ChatTelegramRuntimeSettings,
} from '../../chat-actions/chat-telegram-settings.types';
import { readTelegramRuntimeCommandAndUxFields } from '../../chat-actions/chat-to-core-action-telegram-runtime-fields.utils';

export const TELEGRAM_USER_ID_REGEX = /^\d+$/u;

export function readTelegramRuntimeSettings(
  value: unknown,
): ChatTelegramRuntimeSettings | null {
  if (!isRecord(value)) {
    return null;
  }

  const requiredFields = readRequiredTelegramRuntimeFields(value);
  if (!requiredFields) {
    return null;
  }

  return {
    ...requiredFields,
    defaultScopeId: readNonEmptyString(value.defaultScopeId),
    allowedUserIds: readAllowedUserIds(value.allowedUserIds),
    botToken: readNonEmptyString(value.botToken),
    webhookSecret: readNonEmptyString(value.webhookSecret),
  };
}

export function normalizeTelegramAllowedUserIds(value: unknown): string[] {
  const userIds = new Set<string>();

  for (const candidate of readListCandidates(value)) {
    const normalized = readAllowedUserId(candidate);
    if (normalized) {
      userIds.add(normalized);
    }
  }

  return [...userIds];
}

export function normalizeTelegramEnabledCommands(
  value: unknown,
  fallback: string[],
): string[] {
  return normalizeTelegramStringList(value, fallback, /^[a-z][a-z0-9_]*$/u);
}

export function normalizeTelegramProgressEventAllowlist(
  value: unknown,
  fallback: string[],
): string[] {
  return normalizeTelegramStringList(value, fallback, /^[a-z][a-z0-9_.-]*$/u);
}

function normalizeTelegramStringList(
  value: unknown,
  fallback: string[],
  pattern: RegExp,
): string[] {
  const normalizedValues = new Set<string>();

  for (const candidate of readListCandidates(value)) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const normalized = candidate.trim().toLowerCase();
    if (!normalized || !pattern.test(normalized)) {
      continue;
    }

    normalizedValues.add(normalized);
  }

  if (normalizedValues.size > 0) {
    return [...normalizedValues];
  }

  return [...fallback];
}

function readRequiredTelegramRuntimeFields(value: Record<string, unknown>): {
  ingressMode: ChatTelegramIngressMode;
  defaultAgentProfile: string;
  pollTimeoutSeconds: number;
  pollRetryDelayMs: number;
  pollBackoffMaxMs: number;
  outboundRelayEnabled: boolean;
  outboundRelayIntervalMs: number;
  outboundRelayBatchSize: number;
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
} | null {
  const requiredCoreFields = readRequiredTelegramRuntimeCoreFields(value);
  if (!requiredCoreFields) {
    return null;
  }

  return {
    ...requiredCoreFields,
    ...readTelegramRuntimeCommandAndUxFields(value),
  };
}

function readRequiredTelegramRuntimeCoreFields(
  value: Record<string, unknown>,
): {
  ingressMode: ChatTelegramIngressMode;
  defaultAgentProfile: string;
  pollTimeoutSeconds: number;
  pollRetryDelayMs: number;
  pollBackoffMaxMs: number;
  outboundRelayEnabled: boolean;
  outboundRelayIntervalMs: number;
  outboundRelayBatchSize: number;
} | null {
  const ingressMode = readIngressMode(value.ingressMode);
  if (!ingressMode) {
    return null;
  }

  const defaultAgentProfile = readNonEmptyString(value.defaultAgentProfile);
  if (!defaultAgentProfile) {
    return null;
  }

  const pollTimeoutSeconds = readPositiveInteger(value.pollTimeoutSeconds);
  if (!pollTimeoutSeconds) {
    return null;
  }

  const pollRetryDelayMs = readPositiveInteger(value.pollRetryDelayMs);
  if (!pollRetryDelayMs) {
    return null;
  }

  const pollBackoffMaxMs = readPositiveInteger(value.pollBackoffMaxMs);
  if (!pollBackoffMaxMs) {
    return null;
  }

  const outboundRelayEnabled =
    typeof value.outboundRelayEnabled === 'boolean'
      ? value.outboundRelayEnabled
      : null;
  if (outboundRelayEnabled === null) {
    return null;
  }

  const outboundRelayIntervalMs = readPositiveInteger(
    value.outboundRelayIntervalMs,
  );
  if (!outboundRelayIntervalMs) {
    return null;
  }

  const outboundRelayBatchSize = readPositiveInteger(
    value.outboundRelayBatchSize,
  );
  if (!outboundRelayBatchSize) {
    return null;
  }

  return {
    ingressMode,
    defaultAgentProfile,
    pollTimeoutSeconds,
    pollRetryDelayMs,
    pollBackoffMaxMs,
    outboundRelayEnabled,
    outboundRelayIntervalMs,
    outboundRelayBatchSize,
  };
}

function readIngressMode(value: unknown): ChatTelegramIngressMode | null {
  if (value === 'webhook' || value === 'polling' || value === 'hybrid') {
    return value;
  }

  return null;
}

function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function readAllowedUserIds(value: unknown): string[] {
  const userIds = new Set<string>();

  for (const candidate of readListCandidates(value)) {
    const normalized = readAllowedUserId(candidate);
    if (normalized) {
      userIds.add(normalized);
    }
  }

  return [...userIds];
}

function readListCandidates(value: unknown): unknown[] {
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

function readAllowedUserId(value: unknown): string | null {
  const normalized =
    typeof value === 'number' && Number.isInteger(value) && value >= 0
      ? `${value}`
      : readNonEmptyString(value);

  if (!normalized || !TELEGRAM_USER_ID_REGEX.test(normalized)) {
    return null;
  }

  return normalized;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
