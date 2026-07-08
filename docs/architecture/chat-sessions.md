# Chat Session Architecture

Chat runtime is owned by the API app.

## Ownership and Boundaries

### `apps/api` owns

- chat session CRUD
- message submission and event timeline
- channel adapter ingress (Telegram first)
- channel route mapping for active session selection per external identity
- chat memory lifecycle (ingestion, distillation, retrieval context)
- chat-to-core workflow run handoff through `@nexus/core` contracts
- legacy ad-hoc and session-tree routes

### `apps/kanban` owns

- project/work-item/review/war-room domains only

## Chat Modules (`apps/api/src/chat`)

- `chat-sessions`
- `chat-messages`
- `chat-actions`
- `channel-adapters`
- `memory`
- `database`

## Channel Adapter Contracts

`apps/api` chat channel ingress adapters implement:

- `ChannelAdapter` from `src/chat/channel-adapters/channel-adapter.types.ts`
- `ChannelOutboundSender` from `src/chat/channel-adapters/outbound-sender.types.ts`

Current implementation:

- `TelegramAdapterService`
- `TelegramWebhookController`
- `TelegramSenderService`
- `TelegramPollingService` (optional long-polling ingress)
- `TelegramOutboundRelayService` (terminal run relay to Telegram)

## Runtime Routes

Global prefix: `/api`

Chat session and messaging routes:

- `POST /api/sessions/chat`
- `GET /api/sessions/chat`
- `GET /api/sessions/chat/:chatId`
- `DELETE /api/sessions/chat/:chatId`
- `GET /api/sessions/chat/:chatId/participants`
- `POST /api/sessions/chat/:chatId/participants/invite`
- `GET /api/sessions/chat/:chatId/state`
- `GET /api/sessions/chat/:chatId/telemetry-auth`
- `POST /api/sessions/chat/:chatId/messages`
- `GET /api/sessions/chat/:chatId/events`
- `POST /api/sessions/chat/:chatId/question-answers`

Memory observability routes:

- `GET /api/internal/chat-memory/metrics`
- `GET /api/internal/chat-memory/jobs`
- `GET /api/internal/chat-memory/events`

Telegram ingress route:

- `POST /api/channel-adapters/telegram/webhook`

Legacy generic session routes still available in API:

- `POST /api/sessions/ad-hoc`
- `GET /api/sessions/ad-hoc`
- `GET /api/sessions/:id`
- `GET /api/sessions/:id/events`

## Telegram Ingress Behavior

Webhook path:

- `POST /api/channel-adapters/telegram/webhook`

Ingress mode (`CHAT_TELEGRAM_INGRESS_MODE`):

- `webhook` (default): inbound via webhook endpoint
- `polling`: inbound via Telegram `getUpdates` long polling from API runtime
- `hybrid`: both webhook and polling active

Security:

- If `CHAT_TELEGRAM_WEBHOOK_SECRET` is configured, requests must include matching header `x-telegram-bot-api-secret-token`.
- If the secret env var is empty, secret validation is bypassed.
- If `CHAT_TELEGRAM_ALLOWED_USER_IDS` is configured, inbound users outside the list are acknowledged and ignored before session/message/workflow side effects.

Slash command ingress:

- Command parsing runs before normal message dispatch.
- Supported commands: `/help`, `/new`, `/resume`, `/resume <index|session-id>`, `/agent <agent-profile>`.
- Command events are stored on the chat timeline as inbound `chat_messages` (`event_type=telegram_command`) plus outbound confirmation messages.
- Runtime command controls:
  - `CHAT_TELEGRAM_COMMANDS_ENABLED`
  - `CHAT_TELEGRAM_ENABLED_COMMANDS`
  - `CHAT_TELEGRAM_COMMAND_RESUME_LIST_LIMIT`

Session mapping:

- active channel routing state is persisted in `chat_channel_routes` keyed by:
  - `provider`
  - `external_thread_id`
  - `external_user_id`
- non-command messages route to `active_chat_session_id` when present
- fallback resolution remains deterministic by `provider:externalThreadId:externalUserId`
- inbound provider message IDs are used for idempotent message handling

Default dispatch routing:

- `CHAT_TELEGRAM_DEFAULT_AGENT_PROFILE` (default `friendly-general-assistant`)
- `CHAT_TELEGRAM_DEFAULT_PROJECT_ID` (optional)
- `CHAT_TELEGRAM_ALLOWED_USER_IDS` (optional comma-separated Telegram user IDs; empty allows all)

Outbound relay:

- chat message run links are polled in background
- terminal statuses (`COMPLETED`, `FAILED`, `CANCELLED`) trigger Telegram outbound sends
- replies are persisted as outbound `chat_messages` for timeline and memory lifecycle continuity

## Steering Sessions

### `session_type` Enum

The `chat_sessions` table includes a `session_type` column with two values:

- `general` (default) — standard chat sessions with no project-scoped context
- `steering` — sessions linked to a project for conversational orchestrator control

### Steering Session Behavior

Steering sessions are linked to a `project_id` and receive project context via `SteeringContextProvider`. The provider activates only when `session_type === 'steering'` and loads work items + artifacts context for the linked project, enabling the CEO agent to understand and modify project state conversationally.

### Key File

- `SteeringContextProvider`: `apps/api/src/session/chat-context-providers/steering-context.provider.ts`

### Migration

- `20260422000000-add-chat-session-type-to-chat-sessions.ts`

## Related Docs

- docs/architecture/rest-api.md
- docs/operations/chat-memory-lifecycle-runbook.md
- docs/guides/telegram-chat-setup.md
- docs/guides/chat-channel-adapter-development.md
