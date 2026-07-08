import { SystemSettingsService } from '../../settings/system-settings.service';
import {
  CHAT_SESSION_LEARNING_FLUSH_ENABLED_DEFAULT,
  CHAT_SESSION_LEARNING_FLUSH_ENABLED_SETTING,
} from '../../settings/chat-session-learning-flush.settings';

export async function resolveChatSessionFlushEnabled(
  settings: SystemSettingsService,
): Promise<boolean> {
  const raw = await settings.get<unknown>(
    CHAT_SESSION_LEARNING_FLUSH_ENABLED_SETTING,
    CHAT_SESSION_LEARNING_FLUSH_ENABLED_DEFAULT,
  );
  return raw === true;
}
