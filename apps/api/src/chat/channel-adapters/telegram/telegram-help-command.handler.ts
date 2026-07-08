import { Injectable } from '@nestjs/common';
import type { CommandExecutionResult } from './telegram-command-router.types';
import { buildTelegramHelpMessage } from './telegram-command-router.utils';
import type {
  TelegramCommandContext,
  TelegramCommandHandler,
} from './telegram-command-handler.types';

@Injectable()
export class TelegramHelpCommandHandler implements TelegramCommandHandler {
  readonly command = 'help' as const;

  handle(context: TelegramCommandContext): Promise<CommandExecutionResult> {
    return Promise.resolve({
      status: 'success',
      chatSession: context.contextSession,
      responseText: buildTelegramHelpMessage(context.enabledCommands),
    });
  }
}
