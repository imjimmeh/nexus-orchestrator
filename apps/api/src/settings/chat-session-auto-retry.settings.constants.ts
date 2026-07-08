/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the chat-session-auto-retry
 * knobs (work item 52666e94-e403-4d00-97ab-95a3cc8af256, milestone 1).
 *
 * String-literal keys are used here so the fragment can be imported by
 * `system-settings.defaults.ts` without dragging in the chat-session
 * retry module. The implementing module reads each key by its
 * string-literal name via `SystemSettingsService.get()` on every
 * provider-failure path, so operator changes take effect on the next
 * failure without restarting the API.
 *
 * Extracted out of `system-settings.defaults.ts` so that file stays
 * under the project's `max-lines` lint cap while the operator-tunable
 * knob surface continues to grow across milestones. The spread keeps
 * the seeded defaults byte-identical to the pre-refactor registry.
 */
export const CHAT_SESSION_AUTO_RETRY_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  chat_session_auto_retry_enabled: {
    value: true,
    description:
      'Enable automatic chat session retries for transient provider failures',
  },
  chat_session_auto_retry_max_attempts: {
    value: 5,
    description:
      'Maximum number of automatic chat session retry attempts for transient provider failures',
  },
  chat_session_auto_retry_initial_delay_ms: {
    value: 60000,
    description:
      'Initial delay in milliseconds before the first automatic chat session retry',
  },
  chat_session_auto_retry_max_delay_ms: {
    value: 3600000,
    description:
      'Maximum delay in milliseconds applied to chat session retry backoff',
  },
  chat_session_auto_retry_backoff_multiplier: {
    value: 2,
    description:
      'Exponential multiplier applied between automatic chat session retry attempts',
  },
  chat_session_auto_retry_reset_buffer_ms: {
    value: 60000,
    description:
      'Additional delay in milliseconds added after provider rate limit reset timestamps before retrying chat sessions',
  },
  chat_session_auto_retry_max_in_flight: {
    value: 20,
    description:
      'Maximum number of chat session auto-retry attempts allowed in flight before new retries are suppressed',
  },
};
