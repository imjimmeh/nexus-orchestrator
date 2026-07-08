import { TelegramSettings, UpdateTelegramSettingsRequest } from "@/lib/api/settings.types";
import type {
  TelegramSecretDraft,
  TelegramSettingsDraft,
} from "./telegramSettingsCard.types";

const TELEGRAM_USER_ID_REGEX = /^\d+$/u;
const TELEGRAM_COMMAND_REGEX = /^[a-z][a-z0-9_]*$/u;
const TELEGRAM_EVENT_NAME_REGEX = /^[a-z][a-z0-9_.-]*$/u;

export function toDraft(settings: TelegramSettings): TelegramSettingsDraft {
  return {
    ingressMode: settings.ingressMode,
    defaultAgentProfile: settings.defaultAgentProfile,
    defaultScopeId: settings.defaultScopeId ?? "",
    allowedUserIdsText: (settings.allowedUserIds ?? []).join("\n"),
    pollTimeoutSeconds: settings.pollTimeoutSeconds,
    pollRetryDelayMs: settings.pollRetryDelayMs,
    pollBackoffMaxMs: settings.pollBackoffMaxMs,
    outboundRelayEnabled: settings.outboundRelayEnabled,
    outboundRelayIntervalMs: settings.outboundRelayIntervalMs,
    outboundRelayBatchSize: settings.outboundRelayBatchSize,
    commandsEnabled: settings.commandsEnabled,
    enabledCommandsText: (settings.enabledCommands ?? []).join("\n"),
    commandResumeListLimit: settings.commandResumeListLimit,
    uxTypingEnabled: settings.uxTypingEnabled,
    uxTypingHeartbeatMs: settings.uxTypingHeartbeatMs,
    uxStatusUpdatesEnabled: settings.uxStatusUpdatesEnabled,
    uxStatusMode: settings.uxStatusMode,
    uxHideThinking: settings.uxHideThinking,
    uxExposeToolNames: settings.uxExposeToolNames,
    uxCommandMenuSyncEnabled: settings.uxCommandMenuSyncEnabled,
    uxProgressEventsAllowlistText: (
      settings.uxProgressEventsAllowlist ?? []
    ).join("\n"),
    uxProgressUpdateThrottleMs: settings.uxProgressUpdateThrottleMs,
    uxMaxProgressUpdatesPerRun: settings.uxMaxProgressUpdatesPerRun,
  };
}

export function readPositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function hasInvalidNumericFields(draft: TelegramSettingsDraft): boolean {
  const numbers = [
    draft.pollTimeoutSeconds,
    draft.pollRetryDelayMs,
    draft.pollBackoffMaxMs,
    draft.outboundRelayIntervalMs,
    draft.outboundRelayBatchSize,
    draft.commandResumeListLimit,
    draft.uxTypingHeartbeatMs,
    draft.uxProgressUpdateThrottleMs,
    draft.uxMaxProgressUpdatesPerRun,
  ];

  return numbers.some((value) => !Number.isInteger(value) || value <= 0);
}

function hasInvalidSecretActions(secretDraft: TelegramSecretDraft): boolean {
  if (secretDraft.clearBotToken && secretDraft.botToken.trim().length > 0) {
    return true;
  }

  if (
    secretDraft.clearWebhookSecret &&
    secretDraft.webhookSecret.trim().length > 0
  ) {
    return true;
  }

  return false;
}

function parseAllowedUserIdsInput(value: string): {
  values: string[];
  invalidEntries: string[];
} {
  const normalizedIds = new Set<string>();
  const invalidEntries = new Set<string>();

  for (const token of value.split(/[\n,]/u)) {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (TELEGRAM_USER_ID_REGEX.test(trimmed)) {
      normalizedIds.add(trimmed);
      continue;
    }

    invalidEntries.add(trimmed);
  }

  return {
    values: [...normalizedIds],
    invalidEntries: [...invalidEntries],
  };
}

function parseTelegramNameListInput(
  value: string,
  pattern: RegExp,
): {
  values: string[];
  invalidEntries: string[];
} {
  const normalizedValues = new Set<string>();
  const invalidEntries = new Set<string>();

  for (const token of value.split(/[\n,]/u)) {
    const normalized = token.trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    if (pattern.test(normalized)) {
      normalizedValues.add(normalized);
      continue;
    }

    invalidEntries.add(token.trim());
  }

  return {
    values: [...normalizedValues],
    invalidEntries: [...invalidEntries],
  };
}

function formatInvalidEntries(invalidEntries: string[]): string {
  const preview = invalidEntries.slice(0, 3).join(", ");
  const suffix =
    invalidEntries.length > 3 ? ` (+${invalidEntries.length - 3} more)` : "";

  return `${preview}${suffix}`;
}

function readTelegramNameListValidationError(params: {
  value: string;
  pattern: RegExp;
  emptyMessage: string;
  invalidEntriesPrefix: string;
}): string | null {
  const parsed = parseTelegramNameListInput(params.value, params.pattern);
  if (parsed.values.length === 0) {
    return params.emptyMessage;
  }

  if (parsed.invalidEntries.length === 0) {
    return null;
  }

  return `${params.invalidEntriesPrefix}${formatInvalidEntries(parsed.invalidEntries)}.`;
}

export function getValidationError(
  draft: TelegramSettingsDraft | null,
  secretDraft: TelegramSecretDraft,
): string | null {
  if (!draft) {
    return null;
  }

  if (draft.defaultAgentProfile.trim().length === 0) {
    return "Default agent profile is required.";
  }

  if (hasInvalidNumericFields(draft)) {
    return "Polling and relay numeric fields must be positive whole numbers.";
  }

  const enabledCommandsError = readTelegramNameListValidationError({
    value: draft.enabledCommandsText,
    pattern: TELEGRAM_COMMAND_REGEX,
    emptyMessage:
      "Enabled commands must include at least one valid command name.",
    invalidEntriesPrefix:
      "Enabled commands must use Telegram command token format. Invalid entries: ",
  });
  if (enabledCommandsError) {
    return enabledCommandsError;
  }

  const progressAllowlistError = readTelegramNameListValidationError({
    value: draft.uxProgressEventsAllowlistText,
    pattern: TELEGRAM_EVENT_NAME_REGEX,
    emptyMessage:
      "Progress events allowlist must include at least one valid event name.",
    invalidEntriesPrefix:
      "Progress events allowlist includes invalid entries: ",
  });
  if (progressAllowlistError) {
    return progressAllowlistError;
  }

  if (hasInvalidSecretActions(secretDraft)) {
    return "Choose either secret update or clear action for each credential.";
  }

  const parsedAllowedUserIds = parseAllowedUserIdsInput(
    draft.allowedUserIdsText,
  );
  if (parsedAllowedUserIds.invalidEntries.length > 0) {
    return `Allowed user IDs must be numeric Telegram user IDs. Invalid entries: ${formatInvalidEntries(parsedAllowedUserIds.invalidEntries)}.`;
  }

  return null;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

type UpdateTelegramSettingsValue =
  UpdateTelegramSettingsRequest[keyof UpdateTelegramSettingsRequest];

function setIfChanged(
  payload: UpdateTelegramSettingsRequest,
  key: keyof UpdateTelegramSettingsRequest,
  nextValue: UpdateTelegramSettingsValue,
  currentValue: UpdateTelegramSettingsValue,
): void {
  if (nextValue === currentValue) {
    return;
  }

  const writablePayload = payload as Record<
    string,
    UpdateTelegramSettingsValue
  >;
  writablePayload[key as string] = nextValue;
}

function setArrayIfChanged(
  payload: UpdateTelegramSettingsRequest,
  key: keyof UpdateTelegramSettingsRequest,
  nextValue: string[],
  currentValue: string[],
): void {
  if (!areStringArraysEqual(nextValue, currentValue)) {
    setIfChanged(payload, key, nextValue, currentValue);
  }
}

function applyCoreNonSecretChanges(
  payload: UpdateTelegramSettingsRequest,
  settings: TelegramSettings,
  draft: TelegramSettingsDraft,
): void {
  setIfChanged(payload, "ingressMode", draft.ingressMode, settings.ingressMode);

  const trimmedProfile = draft.defaultAgentProfile.trim();
  setIfChanged(
    payload,
    "defaultAgentProfile",
    trimmedProfile,
    settings.defaultAgentProfile,
  );

  const normalizedProjectId =
    draft.defaultScopeId.trim().length > 0 ? draft.defaultScopeId.trim() : null;
  setIfChanged(
    payload,
    "defaultScopeId",
    normalizedProjectId,
    settings.defaultScopeId,
  );

  const normalizedAllowedUserIds = parseAllowedUserIdsInput(
    draft.allowedUserIdsText,
  ).values;
  setArrayIfChanged(
    payload,
    "allowedUserIds",
    normalizedAllowedUserIds,
    settings.allowedUserIds,
  );

  setIfChanged(
    payload,
    "pollTimeoutSeconds",
    draft.pollTimeoutSeconds,
    settings.pollTimeoutSeconds,
  );
  setIfChanged(
    payload,
    "pollRetryDelayMs",
    draft.pollRetryDelayMs,
    settings.pollRetryDelayMs,
  );
  setIfChanged(
    payload,
    "pollBackoffMaxMs",
    draft.pollBackoffMaxMs,
    settings.pollBackoffMaxMs,
  );
  setIfChanged(
    payload,
    "outboundRelayEnabled",
    draft.outboundRelayEnabled,
    settings.outboundRelayEnabled,
  );
  setIfChanged(
    payload,
    "outboundRelayIntervalMs",
    draft.outboundRelayIntervalMs,
    settings.outboundRelayIntervalMs,
  );
  setIfChanged(
    payload,
    "outboundRelayBatchSize",
    draft.outboundRelayBatchSize,
    settings.outboundRelayBatchSize,
  );
}

function applyCommandNonSecretChanges(
  payload: UpdateTelegramSettingsRequest,
  settings: TelegramSettings,
  draft: TelegramSettingsDraft,
): void {
  setIfChanged(
    payload,
    "commandsEnabled",
    draft.commandsEnabled,
    settings.commandsEnabled,
  );

  const normalizedEnabledCommands = parseTelegramNameListInput(
    draft.enabledCommandsText,
    TELEGRAM_COMMAND_REGEX,
  ).values;
  setArrayIfChanged(
    payload,
    "enabledCommands",
    normalizedEnabledCommands,
    settings.enabledCommands,
  );

  setIfChanged(
    payload,
    "commandResumeListLimit",
    draft.commandResumeListLimit,
    settings.commandResumeListLimit,
  );
}

function applyUxNonSecretChanges(
  payload: UpdateTelegramSettingsRequest,
  settings: TelegramSettings,
  draft: TelegramSettingsDraft,
): void {
  setIfChanged(
    payload,
    "uxTypingEnabled",
    draft.uxTypingEnabled,
    settings.uxTypingEnabled,
  );
  setIfChanged(
    payload,
    "uxTypingHeartbeatMs",
    draft.uxTypingHeartbeatMs,
    settings.uxTypingHeartbeatMs,
  );
  setIfChanged(
    payload,
    "uxStatusUpdatesEnabled",
    draft.uxStatusUpdatesEnabled,
    settings.uxStatusUpdatesEnabled,
  );
  setIfChanged(
    payload,
    "uxStatusMode",
    draft.uxStatusMode,
    settings.uxStatusMode,
  );
  setIfChanged(
    payload,
    "uxHideThinking",
    draft.uxHideThinking,
    settings.uxHideThinking,
  );
  setIfChanged(
    payload,
    "uxExposeToolNames",
    draft.uxExposeToolNames,
    settings.uxExposeToolNames,
  );
  setIfChanged(
    payload,
    "uxCommandMenuSyncEnabled",
    draft.uxCommandMenuSyncEnabled,
    settings.uxCommandMenuSyncEnabled,
  );

  const normalizedProgressAllowlist = parseTelegramNameListInput(
    draft.uxProgressEventsAllowlistText,
    TELEGRAM_EVENT_NAME_REGEX,
  ).values;
  setArrayIfChanged(
    payload,
    "uxProgressEventsAllowlist",
    normalizedProgressAllowlist,
    settings.uxProgressEventsAllowlist,
  );
  setIfChanged(
    payload,
    "uxProgressUpdateThrottleMs",
    draft.uxProgressUpdateThrottleMs,
    settings.uxProgressUpdateThrottleMs,
  );
  setIfChanged(
    payload,
    "uxMaxProgressUpdatesPerRun",
    draft.uxMaxProgressUpdatesPerRun,
    settings.uxMaxProgressUpdatesPerRun,
  );
}

function applyNonSecretChanges(
  payload: UpdateTelegramSettingsRequest,
  settings: TelegramSettings,
  draft: TelegramSettingsDraft,
): void {
  applyCoreNonSecretChanges(payload, settings, draft);
  applyCommandNonSecretChanges(payload, settings, draft);
  applyUxNonSecretChanges(payload, settings, draft);
}

function applySecretChanges(
  payload: UpdateTelegramSettingsRequest,
  secretDraft: TelegramSecretDraft,
): void {
  const trimmedBotToken = secretDraft.botToken.trim();
  if (trimmedBotToken.length > 0) {
    payload.botToken = trimmedBotToken;
  }

  if (secretDraft.clearBotToken) {
    payload.clearBotToken = true;
  }

  const trimmedWebhookSecret = secretDraft.webhookSecret.trim();
  if (trimmedWebhookSecret.length > 0) {
    payload.webhookSecret = trimmedWebhookSecret;
  }

  if (secretDraft.clearWebhookSecret) {
    payload.clearWebhookSecret = true;
  }
}

export function buildUpdatePayload(params: {
  settings: TelegramSettings | undefined;
  draft: TelegramSettingsDraft | null;
  secretDraft: TelegramSecretDraft;
}): UpdateTelegramSettingsRequest | null {
  if (!params.settings || !params.draft) {
    return null;
  }

  const payload: UpdateTelegramSettingsRequest = {};
  applyNonSecretChanges(payload, params.settings, params.draft);
  applySecretChanges(payload, params.secretDraft);

  return Object.keys(payload).length > 0 ? payload : null;
}
