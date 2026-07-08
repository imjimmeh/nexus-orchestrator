const TELEGRAM_STATUS_MESSAGE_ID_METADATA_KEY = 'telegramUxStatusMessageId';
const TELEGRAM_STATUS_PROVIDER_MESSAGE_ID_METADATA_KEY =
  'telegramUxStatusProviderMessageId';

interface TryEditTelegramStatusMessageParams {
  metadata?: Record<string, unknown> | null;
  externalThreadId: string;
  text: string;
  telegramSender: {
    editMessageText: (params: {
      externalThreadId: string;
      providerMessageId: string;
      text: string;
    }) => Promise<boolean>;
  };
  warn: (message: string) => void;
}

type TryEditTelegramStatusMessageResult =
  | { edited: false }
  | {
      edited: true;
      statusMessageId: string;
      statusProviderMessageId: string;
    };

function readNonEmptyMetadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function tryEditTelegramStatusMessage(
  params: TryEditTelegramStatusMessageParams,
): Promise<TryEditTelegramStatusMessageResult> {
  const statusMessageId = readNonEmptyMetadataString(
    params.metadata,
    TELEGRAM_STATUS_MESSAGE_ID_METADATA_KEY,
  );
  const statusProviderMessageId = readNonEmptyMetadataString(
    params.metadata,
    TELEGRAM_STATUS_PROVIDER_MESSAGE_ID_METADATA_KEY,
  );
  if (!statusMessageId || !statusProviderMessageId) {
    return { edited: false };
  }

  try {
    const edited = await params.telegramSender.editMessageText({
      externalThreadId: params.externalThreadId,
      providerMessageId: statusProviderMessageId,
      text: params.text,
    });
    if (!edited) {
      return { edited: false };
    }

    return {
      edited: true,
      statusMessageId,
      statusProviderMessageId,
    };
  } catch (error) {
    params.warn(
      `Failed to edit Telegram status message ${statusMessageId}: ${(error as Error).message}`,
    );
    return { edited: false };
  }
}
