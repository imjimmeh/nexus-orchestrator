import type { InboundChannelMessage } from '../channel-adapter.types';
import type { ChatSessionSummaryDto } from '../../chat-sessions/chat-sessions.types';
import type { CommandExecutionResult } from './telegram-command-router.types';
import type { TelegramChannelRuntimeSettings } from './telegram-runtime-settings.types';
import type {
  SupportedTelegramCommandName,
  TelegramCommandMetadata,
} from './telegram-command.types';

export type TelegramCommandContext = {
  command: TelegramCommandMetadata;
  contextSession: ChatSessionSummaryDto;
  inbound: InboundChannelMessage;
  settings: TelegramChannelRuntimeSettings;
  enabledCommands: Set<SupportedTelegramCommandName>;
};

export interface TelegramCommandHandler {
  readonly command: SupportedTelegramCommandName;
  handle(context: TelegramCommandContext): Promise<CommandExecutionResult>;
}
