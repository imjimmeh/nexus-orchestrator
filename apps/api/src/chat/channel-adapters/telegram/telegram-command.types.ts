export const SUPPORTED_TELEGRAM_COMMANDS = [
  'help',
  'new',
  'resume',
  'agent',
] as const;

export type SupportedTelegramCommandName =
  (typeof SUPPORTED_TELEGRAM_COMMANDS)[number];

export interface TelegramCommandMetadata {
  name: string;
  args: string[];
}
