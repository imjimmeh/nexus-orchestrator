const COMMAND_MENU_SYNC_DISABLED_SIGNATURE = '__menu_sync_disabled__';
const SUPPORTED_TELEGRAM_COMMANDS = ['help', 'new', 'resume', 'agent'] as const;

const TELEGRAM_COMMAND_MENU_DESCRIPTIONS: Record<
  (typeof SUPPORTED_TELEGRAM_COMMANDS)[number],
  string
> = {
  help: 'Show command usage',
  new: 'Start a new chat session',
  resume: 'List and resume prior sessions',
  agent: 'Start with a specific agent',
};

export function resolveTelegramCommandMenu(params: {
  commandsEnabled: boolean;
  uxCommandMenuSyncEnabled: boolean;
  enabledCommands: string[];
}): {
  signature: string;
  commands: Array<{ command: string; description: string }> | null;
} {
  if (!params.commandsEnabled || !params.uxCommandMenuSyncEnabled) {
    return {
      signature: COMMAND_MENU_SYNC_DISABLED_SIGNATURE,
      commands: null,
    };
  }

  const enabledCommands = resolveEnabledCommands(params.enabledCommands);
  const commands = enabledCommands.map((command) => ({
    command,
    description: TELEGRAM_COMMAND_MENU_DESCRIPTIONS[command],
  }));

  return {
    signature: JSON.stringify(commands),
    commands,
  };
}

function resolveEnabledCommands(
  enabledCommands: string[],
): Array<(typeof SUPPORTED_TELEGRAM_COMMANDS)[number]> {
  const enabled = new Set<(typeof SUPPORTED_TELEGRAM_COMMANDS)[number]>();

  for (const commandName of enabledCommands) {
    if (isSupportedCommand(commandName)) {
      enabled.add(commandName);
    }
  }

  return enabled.size > 0 ? [...enabled] : [...SUPPORTED_TELEGRAM_COMMANDS];
}

function isSupportedCommand(
  value: string,
): value is (typeof SUPPORTED_TELEGRAM_COMMANDS)[number] {
  return (SUPPORTED_TELEGRAM_COMMANDS as readonly string[]).includes(value);
}
