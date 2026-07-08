import { BadRequestException } from '@nestjs/common';
import type {
  TelegramIngressModeV1,
  TelegramStatusMessageModeV1,
  UpdateTelegramSettingsRequestV1,
} from '@nexus/core';
import { TELEGRAM_SYSTEM_SETTING_DEFAULTS } from './telegram-settings.constants';

const TELEGRAM_USER_ID_REGEX = /^\d+$/u;
const TELEGRAM_COMMAND_NAME_REGEX = /^[a-z][a-z0-9_]*$/u;
const TELEGRAM_EVENT_NAME_REGEX = /^[a-z][a-z0-9_.-]*$/u;
const SUPPORTED_TELEGRAM_COMMANDS = new Set(['help', 'new', 'resume', 'agent']);

export function readOptionalTrimmedString(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readIngressModeValue(
  value: unknown,
): TelegramIngressModeV1 | null {
  if (value === 'webhook' || value === 'polling' || value === 'hybrid') {
    return value;
  }

  return null;
}

export function readIngressModeEnv(
  key: string,
  fallback: TelegramIngressModeV1,
): TelegramIngressModeV1 {
  const parsed = readIngressModeValue(readOptionalEnv(key));
  return parsed ?? fallback;
}

export function readTelegramStatusModeValue(
  value: unknown,
): TelegramStatusMessageModeV1 | null {
  if (value === 'single_message' || value === 'multi_message') {
    return value;
  }

  return null;
}

export function readTelegramStatusModeEnv(
  key: string,
  fallback: TelegramStatusMessageModeV1,
): TelegramStatusMessageModeV1 {
  return readTelegramStatusModeValue(readOptionalEnv(key)) ?? fallback;
}

export function normalizeTelegramCommandNames(value: unknown): string[] {
  const normalized = normalizeTelegramStringList(
    value,
    TELEGRAM_COMMAND_NAME_REGEX,
  );

  return normalized.filter((name) => SUPPORTED_TELEGRAM_COMMANDS.has(name));
}

export function readTelegramCommandNamesEnv(key: string): string[] {
  return normalizeTelegramCommandNames(readOptionalEnv(key));
}

export function normalizeTelegramProgressEventAllowlist(
  value: unknown,
): string[] {
  return normalizeTelegramStringList(value, TELEGRAM_EVENT_NAME_REGEX);
}

export function readTelegramProgressEventAllowlistEnv(key: string): string[] {
  return normalizeTelegramProgressEventAllowlist(readOptionalEnv(key));
}

export function normalizeTelegramAllowedUserIds(value: unknown): string[] {
  const normalizedIds = new Set<string>();

  for (const candidate of readAllowedUserIdCandidates(value)) {
    const normalized = readAllowedUserId(candidate);
    if (normalized) {
      normalizedIds.add(normalized);
    }
  }

  return [...normalizedIds];
}

export function readAllowedUserIdsEnv(key: string): string[] {
  return normalizeTelegramAllowedUserIds(readOptionalEnv(key));
}

export function buildTelegramSecretMetadata(
  existing: Record<string, unknown> | undefined = {},
): Record<string, unknown> {
  return {
    ...existing,
    managed_by: 'telegram-settings',
    scope: 'chat-telegram',
    updated_at: new Date().toISOString(),
  };
}

export function readTelegramSettingDescription(key: string): string {
  return TELEGRAM_SYSTEM_SETTING_DEFAULTS[key]?.description ?? key;
}

export function requireTelegramTrimmedString(
  value: unknown,
  fieldName: string,
): string {
  const normalized = readOptionalTrimmedString(value);
  if (normalized) {
    return normalized;
  }

  throw new BadRequestException(`${fieldName} must be a non-empty string`);
}

export function validateTelegramSecretUpdatePayload(
  payload: UpdateTelegramSettingsRequestV1,
): void {
  if (payload.clearBotToken === true && payload.botToken !== undefined) {
    throw new BadRequestException(
      'clearBotToken cannot be combined with botToken',
    );
  }

  if (
    payload.clearWebhookSecret === true &&
    payload.webhookSecret !== undefined
  ) {
    throw new BadRequestException(
      'clearWebhookSecret cannot be combined with webhookSecret',
    );
  }
}

export function readPositiveInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function readPositiveIntegerEnv(key: string, fallback: number): number {
  const parsed = readPositiveInteger(readOptionalEnv(key));
  return parsed ?? fallback;
}

export function readBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  return null;
}

export function readBooleanEnv(key: string, fallback: boolean): boolean {
  const parsed = readBoolean(readOptionalEnv(key));
  return parsed ?? fallback;
}

export function readOptionalEnv(key: string): string | null {
  const value = process.env[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readAllowedUserIdCandidates(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Fall back to delimiter parsing when input is not valid JSON.
    }
  }

  return trimmed.split(/[\n,]/u);
}

function normalizeTelegramStringList(
  value: unknown,
  pattern: RegExp,
): string[] {
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

  return [...normalizedValues];
}

function readAllowedUserId(value: unknown): string | null {
  const normalized =
    typeof value === 'number' && Number.isInteger(value) && value >= 0
      ? `${value}`
      : readOptionalTrimmedString(value);

  if (!normalized || !TELEGRAM_USER_ID_REGEX.test(normalized)) {
    return null;
  }

  return normalized;
}
