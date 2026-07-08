const POLLING_NUMERIC_FIELDS = [
  {
    key: "pollTimeoutSeconds",
    inputId: "telegram-poll-timeout",
    label: "Poll Timeout Seconds",
  },
  {
    key: "pollRetryDelayMs",
    inputId: "telegram-poll-retry",
    label: "Poll Retry Delay (ms)",
  },
  {
    key: "pollBackoffMaxMs",
    inputId: "telegram-poll-backoff",
    label: "Poll Backoff Max (ms)",
  },
] as const;

const RELAY_NUMERIC_FIELDS = [
  {
    key: "outboundRelayIntervalMs",
    inputId: "telegram-relay-interval",
    label: "Relay Interval (ms)",
  },
  {
    key: "outboundRelayBatchSize",
    inputId: "telegram-relay-batch",
    label: "Relay Batch Size",
  },
] as const;

const COMMANDS_NUMERIC_FIELDS = [
  {
    key: "commandResumeListLimit",
    inputId: "telegram-command-resume-limit",
    label: "Command Resume List Limit",
  },
] as const;

const UX_NUMERIC_FIELDS = [
  {
    key: "uxTypingHeartbeatMs",
    inputId: "telegram-ux-typing-heartbeat-ms",
    label: "Typing Heartbeat (ms)",
  },
  {
    key: "uxProgressUpdateThrottleMs",
    inputId: "telegram-ux-progress-throttle-ms",
    label: "Progress Update Throttle (ms)",
  },
  {
    key: "uxMaxProgressUpdatesPerRun",
    inputId: "telegram-ux-progress-max-updates",
    label: "Max Progress Updates Per Run",
  },
] as const;

export {
  COMMANDS_NUMERIC_FIELDS,
  POLLING_NUMERIC_FIELDS,
  RELAY_NUMERIC_FIELDS,
  UX_NUMERIC_FIELDS,
};
