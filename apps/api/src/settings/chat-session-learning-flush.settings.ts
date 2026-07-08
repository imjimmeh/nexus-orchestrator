import type { SystemSettingsService } from './system-settings.service';

/** Setting key for the chat session learning flush master switch. */
export const CHAT_SESSION_LEARNING_FLUSH_ENABLED_SETTING =
  'chat_session_learning_flush_enabled';

/** Default: OFF. */
export const CHAT_SESSION_LEARNING_FLUSH_ENABLED_DEFAULT = false;

/**
 * SYSTEM_SETTING_DEFAULTS fragment for chat session learning flush.
 */
export const CHAT_SESSION_LEARNING_FLUSH_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [CHAT_SESSION_LEARNING_FLUSH_ENABLED_SETTING]: {
    value: CHAT_SESSION_LEARNING_FLUSH_ENABLED_DEFAULT,
    description:
      'Enable Chat Session Learning Flush. When true, completing or failing a chat session will trigger a background LLM review sweep to extract learning candidates.',
  },
};

/**
 * Resolve the chat session learning flush enabled setting.
 */
export async function resolveChatSessionLearningFlushEnabled(
  settings: SystemSettingsService,
): Promise<boolean> {
  const raw = await settings.get<unknown>(
    CHAT_SESSION_LEARNING_FLUSH_ENABLED_SETTING,
    CHAT_SESSION_LEARNING_FLUSH_ENABLED_DEFAULT,
  );
  return raw === true;
}
