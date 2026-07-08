import type { ChatSessionSummaryDto } from '../../chat-sessions/chat-sessions.types';
import type { TelegramCommandMenuItem } from './telegram-adapter.types';
import {
  SUPPORTED_TELEGRAM_COMMANDS,
  type SupportedTelegramCommandName,
  type TelegramCommandMetadata,
} from './telegram-command.types';

const TELEGRAM_COMMAND_HELP_LINES: Record<
  SupportedTelegramCommandName,
  string[]
> = {
  help: ['/help - Show command usage'],
  new: ['/new - Start a new chat session'],
  resume: [
    '/resume - List recent sessions',
    '/resume <index|session-id> - Resume a specific session',
  ],
  agent: ['/agent <agent-profile> - Start a new session with that agent'],
};

const TELEGRAM_COMMAND_MENU_DESCRIPTIONS: Record<
  SupportedTelegramCommandName,
  string
> = {
  help: 'Show command usage',
  new: 'Start a new chat session',
  resume: 'List and resume prior sessions',
  agent: 'Start with a specific agent',
};

export function readInboundTelegramCommand(
  metadata: Record<string, unknown>,
  text: string,
): TelegramCommandMetadata | null {
  const fromMetadata = readMetadataCommand(metadata.telegramCommand);
  if (fromMetadata) {
    return fromMetadata;
  }

  return parseTelegramCommand(text);
}

export function isSupportedTelegramCommand(
  value: string,
): value is SupportedTelegramCommandName {
  return (SUPPORTED_TELEGRAM_COMMANDS as readonly string[]).includes(value);
}

export function resolveEnabledTelegramCommands(
  value: string[],
): Set<SupportedTelegramCommandName> {
  const enabled = new Set<SupportedTelegramCommandName>();

  for (const commandName of value) {
    if (isSupportedTelegramCommand(commandName)) {
      enabled.add(commandName);
    }
  }

  if (enabled.size > 0) {
    return enabled;
  }

  return new Set<SupportedTelegramCommandName>(SUPPORTED_TELEGRAM_COMMANDS);
}

export function buildTelegramHelpMessage(
  enabledCommands: Set<SupportedTelegramCommandName>,
): string {
  const lines = ['Available commands:'];

  for (const commandName of SUPPORTED_TELEGRAM_COMMANDS) {
    if (!enabledCommands.has(commandName)) {
      continue;
    }

    lines.push(...TELEGRAM_COMMAND_HELP_LINES[commandName]);
  }

  return lines.join('\n');
}

export function buildTelegramCommandMenu(
  enabledCommands: Set<SupportedTelegramCommandName>,
): TelegramCommandMenuItem[] {
  const commands: TelegramCommandMenuItem[] = [];

  for (const commandName of SUPPORTED_TELEGRAM_COMMANDS) {
    if (!enabledCommands.has(commandName)) {
      continue;
    }

    commands.push({
      command: commandName,
      description: TELEGRAM_COMMAND_MENU_DESCRIPTIONS[commandName],
    });
  }

  return commands;
}

export function buildTelegramResumeListMessage(
  sessions: ChatSessionSummaryDto[],
): string {
  const sessionLines = sessions.map(
    (session, index) =>
      `${index + 1}. ${session.id} | ${session.agentProfileName} | ${session.status}`,
  );

  return [
    'Recent sessions:',
    ...sessionLines,
    'Use /resume <index> or /resume <session-id>.',
  ].join('\n');
}

export function readTelegramCommandSelectionIndex(
  value: string,
): number | null {
  if (!/^\d+$/u.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed - 1;
}

function readMetadataCommand(value: unknown): TelegramCommandMetadata | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as {
    name?: unknown;
    args?: unknown;
  };

  const name = readNormalizedCommandName(record.name);
  if (!name) {
    return null;
  }

  const args = Array.isArray(record.args)
    ? record.args
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : [];

  return {
    name,
    args,
  };
}

function parseTelegramCommand(text: string): TelegramCommandMetadata | null {
  if (!text.startsWith('/')) {
    return null;
  }

  const [rawCommand, ...args] = text.split(/\s+/u);
  const commandToken = rawCommand.slice(1).trim();
  if (!commandToken) {
    return null;
  }

  const commandName = readNormalizedCommandName(commandToken.split('@')[0]);
  if (!commandName) {
    return null;
  }

  return {
    name: commandName,
    args,
  };
}

function readNormalizedCommandName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/u.test(normalized)) {
    return null;
  }

  return normalized;
}
