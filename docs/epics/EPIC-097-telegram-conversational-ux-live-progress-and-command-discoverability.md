# EPIC-097: Telegram Conversational UX, Live Progress, and Command Discoverability

Status: Planned
Priority: P1
Depends On: EPIC-092, EPIC-095, EPIC-096
Related:
1. docs/guides/telegram-chat-setup.md
2. docs/guides/chat-channel-adapter-development.md
3. docs/architecture/chat-sessions.md
4. docs/architecture/telemetry-gateway.md
5. docs/architecture/workflow-engine.md
Last Updated: 2026-04-14

---

## 1. Epic Summary

Introduce a first-class Telegram conversational UX layer that makes long-running agent work understandable and trustworthy without exposing internal chain-of-thought.

This epic adds:

1. Typing presence while the run is active.
2. Progress/status updates for workflow lifecycle milestones.
3. Strict suppression of reasoning content in Telegram responses.
4. Better slash-command discoverability through command menu sync and in-chat guidance.

The design preserves existing safety properties:

1. Inbound allowlist controls.
2. Session-scoped routing and command semantics.
3. Provider message idempotency.
4. Existing terminal response relay behavior.

---

## 2. Problem Statement

Telegram users currently experience an opaque "request accepted, then silence" workflow for active runs. While final responses are relayed, users cannot easily tell if the system is still working, waiting on tools, waiting on container setup, or blocked on input.

Observed UX gaps:

1. No typing/presence indicator while active work is running.
2. No user-facing lifecycle status for run progress.
3. No explicit policy controls for hiding reasoning content.
4. Command discoverability depends on users already knowing slash commands.

This creates confusion and repeated retries, which increases noise, duplicates work, and perceived unreliability.

---

## 3. Goals

1. Make Telegram interactions feel live and responsive during long-running runs.
2. Make execution state observable with concise, user-safe progress messages.
3. Keep internal thinking private and user-facing output intentional.
4. Improve command discoverability for first-time and returning users.
5. Keep behavior configurable via runtime settings and safe defaults.

---

## 4. Non-Goals

1. Cross-channel UX unification for Slack/Discord in this epic.
2. Redesigning core workflow telemetry event schemas.
3. Building a full conversational UI framework inside Telegram.
4. Changing current command semantics from EPIC-096.
5. Broad E2E expansion outside directly touched Telegram/chat paths.

---

## 5. User Stories

1. As a Telegram user, when I send a request, I can see the bot is actively working.
2. As a Telegram user, I receive concise status messages for meaningful milestones.
3. As a Telegram user, I never receive hidden reasoning or internal scratchpad text.
4. As a Telegram user, I can discover available commands without memorizing docs.
5. As an operator, I can tune UX behavior with settings and safe defaults.
6. As an operator, I can troubleshoot UX state from structured metadata and logs.

---

## 6. Current State Baseline

Current Telegram flow already provides:

1. Inbound webhook/polling ingestion.
2. Session routing and slash command handling.
3. Outbound final response relay for terminal statuses.
4. Pending question relay from ask_user_questions tool events.

Current gaps:

1. No sendChatAction usage.
2. No intermediate progress relay for non-terminal run events.
3. No command menu synchronization via Telegram setMyCommands.
4. Runtime settings contract does not expose dedicated UX toggles.

---

## 7. Design Principles

1. User-safe by default: no reasoning text and no noisy internal logs.
2. Progressive disclosure: short status updates, details only when needed.
3. Idempotent relay behavior: no repeated spam from poll loops.
4. Config-first rollout: every major UX behavior behind explicit settings.
5. Minimal surface-area changes to existing adapter boundaries.

---

## 8. Scope

### In Scope

1. Telegram typing indicator support with heartbeat throttling.
2. Intermediate progress status relay from run events.
3. Reasoning suppression and response sanitization policy.
4. Telegram command menu sync and expanded in-chat command help.
5. Runtime settings model expansion in core/api/chat/web.
6. Message metadata and cursoring for dedupe/idempotent status relay.
7. Unit and integration coverage for new behavior.
8. Documentation updates for setup, operations, and troubleshooting.

### Out of Scope

1. Slack/Discord adapter UX parity.
2. Redesign of workflow event producer architecture.
3. New product-level orchestration features unrelated to Telegram UX.

---

## 9. Proposed UX Specification

### 9.1 Typing Presence

Behavior:

1. On non-command inbound acceptance, send immediate typing action.
2. While run status is PENDING or RUNNING, send periodic typing heartbeat.
3. Stop heartbeat on COMPLETED, FAILED, CANCELLED, or question relay that requires user input.
4. Suppress typing if bot token unavailable or typing feature disabled.

Default config:

1. typingEnabled: true
2. typingHeartbeatMs: 4000
3. typingMaxDurationMs: 180000

### 9.2 Progress Status Updates

Behavior:

1. Relay meaningful milestones only.
2. Prefer a single editable status message per inbound request to reduce noise.
3. Optionally fall back to multi-message mode when editMessage fails.
4. Include plain-language status text and optional short hints.

Candidate milestones:

1. Run accepted.
2. Job started.
3. Agent prompt dispatched.
4. Tool execution started/finished.
5. Container lifecycle milestones.
6. Waiting for user input.
7. Terminal state with final response.

### 9.3 Hide Thinking

Behavior:

1. Do not relay message_update, agent_telemetry, bash_output, or other scratch content.
2. Keep run details extraction focused on explicit final response fields.
3. Apply sanitization guard to strip known reasoning wrappers if encountered.
4. Keep internal telemetry persisted for observability, but never surfaced to Telegram users.

### 9.4 Command Discoverability

Behavior:

1. Keep /help as canonical textual guide.
2. Register Telegram command menu via setMyCommands.
3. Re-sync menu at startup and on settings refresh.
4. Optionally add /commands alias to /help output path.

### 9.5 Optional UX Enhancements (Phase 2+)

1. /status to show current run/session status.
2. /cancel to request run abort where authorized.
3. Inline keyboard for /resume selections.
4. Inline keyboard for ask_user_questions options.
5. Quiet/verbose mode per thread/user.

---

## 10. Architecture and Component Changes

### 10.1 Chat Service Telegram Sender

Target file: apps/chat/src/channel-adapters/telegram/telegram-sender.service.ts

Add methods:

1. sendChatAction(externalThreadId, action)
2. editMessage(externalThreadId, providerMessageId, text)
3. setMyCommands(commands)

Keep existing sendMessage path unchanged.

### 10.2 Telegram Ingress and Relay

Target files:

1. apps/chat/src/channel-adapters/telegram/telegram-ingress.service.ts
2. apps/chat/src/channel-adapters/telegram/telegram-outbound-relay.service.ts
3. apps/chat/src/channel-adapters/telegram/telegram-outbound-relay.extractor.ts

Changes:

1. Trigger immediate typing action after non-command message acceptance.
2. Add in-relay progress state machine over workflow events.
3. Add metadata-based cursor keys to dedupe relayed progress events.
4. Add safe event-to-ux mapping layer.
5. Ensure terminal relay still owns final answer dispatch.

### 10.3 Runtime Settings Pipeline

Target files:

1. packages/core/src/interfaces/telegram-settings.types.ts
2. apps/api/src/settings/telegram-settings.constants.ts
3. apps/api/src/settings/telegram-settings.service.ts
4. apps/api/src/settings/dto/update-telegram-settings.dto.ts
5. apps/chat/src/chat-actions/chat-telegram-settings.types.ts
6. apps/chat/src/chat-actions/chat-to-core-action.utils.ts
7. apps/chat/src/channel-adapters/telegram/telegram-runtime-settings.types.ts
8. apps/chat/src/channel-adapters/telegram/telegram-runtime-settings.service.ts
9. apps/web/src/lib/api/types.ts
10. apps/web/src/pages/settings/telegramSettingsCard.types.ts
11. apps/web/src/pages/settings/telegramSettingsCard.helpers.ts
12. apps/web/src/pages/settings/TelegramSettingsGeneralFields.tsx

Changes:

1. Introduce UX settings fields with defaults and validation.
2. Ensure settings round-trip from API to chat runtime and web UI.
3. Preserve backward compatibility with existing env fallbacks.

### 10.4 Workflow Event Producers (Optional but Recommended)

Target files:

1. apps/api/src/workflow/step-agent-container-support.service.ts
2. apps/api/src/workflow/step-agent-step-executor.multistep.ts

Changes:

1. Emit explicit container_starting/container_started/container_ready events.
2. Keep payloads minimal and stable for UI mapping.
3. Mark as additive and non-breaking.

---

## 11. Runtime Settings Contract (Proposed)

New Telegram UX settings (conceptual names):

1. uxTypingEnabled: boolean (default true)
2. uxTypingHeartbeatMs: number (default 4000)
3. uxStatusUpdatesEnabled: boolean (default true)
4. uxStatusMode: "single_message" | "multi_message" (default single_message)
5. uxHideThinking: boolean (default true)
6. uxExposeToolNames: boolean (default false)
7. uxCommandMenuSyncEnabled: boolean (default true)
8. uxProgressEventsAllowlist: string[] (default curated allowlist)
9. uxProgressUpdateThrottleMs: number (default 1500)
10. uxMaxProgressUpdatesPerRun: number (default 40)

Notes:

1. These names can be adjusted to match existing settings naming conventions.
2. Settings must be available to chat runtime via internal core runtime endpoint.

---

## 12. Event-to-UX Mapping Contract

Initial allowlist mapping:

| Internal Event Type | User-facing Text (example) | Relay Rule |
| --- | --- | --- |
| job_start | Started processing your request. | Relay once per job |
| agent_prompt_sent | Agent is planning next steps. | Relay once per step |
| tool_execution_start | Running a tool to gather or apply changes. | Relay throttled |
| tool_execution_end | Tool step completed. | Relay throttled |
| container_starting | Preparing execution environment. | Relay once |
| container_started | Execution environment started. | Relay once |
| container_ready | Agent is ready to continue. | Relay once |
| user_questions_posed | I need your input to continue. | Existing question relay path |
| capability_preflight_failed | Cannot continue due to tool access policy. | Relay once |

Mapping constraints:

1. No direct inclusion of raw prompts or hidden reasoning.
2. Tool names hidden unless uxExposeToolNames=true.
3. Unknown events ignored by default.

---

## 13. Persistence and Idempotency

Store relay state under inbound message metadata, for example:

1. telegramUxStatusMessageId
2. telegramUxStatusProviderMessageId
3. telegramUxLastRelayedEventCursor
4. telegramUxLastTypingAt
5. telegramUxProgressRelayCount
6. telegramUxLastProgressEventType

Rules:

1. Relay only new events beyond cursor.
2. Update cursor atomically with message metadata write.
3. Respect max relay count to prevent chat flooding loops.

---

## 14. Rollout Plan

### Phase 0: Contract and Flags

1. Add settings contract fields in core/api/chat/web.
2. Default behavior remains close to current relay path.
3. Feature flags off in production until validation complete.

### Phase 1: Typing + Command Menu

1. Enable sendChatAction heartbeat.
2. Enable setMyCommands synchronization.
3. Validate no regressions in existing command and relay flows.

### Phase 2: Progress Relay

1. Enable event-to-ux mapping relay.
2. Start with conservative allowlist and throttling.
3. Validate dedupe and metadata cursor integrity.

### Phase 3: Advanced UX

1. Add /status and optional /cancel.
2. Add inline keyboards for resume and question options.
3. Add quiet/verbose behavior controls.

### Phase 4: Operational Hardening

1. Tune defaults with production telemetry.
2. Finalize docs and runbooks.
3. Remove temporary fallback behavior if stable.

---

## 15. Acceptance Criteria

1. Non-command inbound Telegram messages show typing presence during active processing.
2. Active runs surface concise progress updates without flooding.
3. Final answer relay remains correct for COMPLETED, FAILED, and CANCELLED.
4. No chain-of-thought or reasoning scratch text is relayed to Telegram users.
5. Command menu appears in Telegram clients with current enabled command set.
6. /help remains accurate and reflects runtime-enabled commands.
7. Progress relay remains idempotent across poll cycles and restarts.
8. Existing allowlist, webhook secret, and command routing behavior stays intact.

---

## 16. Test and Quality Gates

### Unit Tests

1. telegram-sender service tests for sendChatAction, editMessage, setMyCommands.
2. outbound relay tests for event mapping, dedupe, cursor updates, and throttle.
3. extractor tests for reasoning suppression and safe response extraction.
4. runtime settings tests for new fields and env fallback behavior.
5. command menu sync tests for enabled command projection.

### Integration Tests

1. Ingress + relay flow with typing heartbeat and terminal completion.
2. Progress relay sequence with synthetic run events.
3. Question relay coexistence with progress relay.
4. Command handling unaffected by UX status features.

### API/Web Contract Tests

1. Telegram settings API returns and updates new UX fields.
2. Internal runtime settings endpoint includes new fields for chat runtime.
3. Web settings card validates and submits new UX fields correctly.

### Suggested Commands

1. npm run lint --workspace=apps/chat
2. npm run lint --workspace=apps/api
3. npm run lint --workspace=apps/web
4. npm run lint --workspace=packages/core
5. npm run test --workspace=apps/chat -- src/channel-adapters/telegram/telegram-outbound-relay.service.spec.ts
6. npm run test --workspace=apps/chat -- src/channel-adapters/telegram/telegram-runtime-settings.service.spec.ts
7. npm run test --workspace=apps/chat -- src/channel-adapters/telegram/telegram-ingress.service.spec.ts
8. npm run test --workspace=apps/api -- src/settings/telegram-settings.service.spec.ts

---

## 17. Risks and Mitigations

1. Risk: Message spam due to high event frequency.
   Mitigation: allowlist, throttling, single-message mode, max updates per run.
2. Risk: Duplicate status updates from poll retries/restarts.
   Mitigation: metadata cursoring and idempotent update checks.
3. Risk: Telegram API limits or intermittent failures.
   Mitigation: best-effort relay, fallback modes, and warning logs.
4. Risk: Reasoning leakage in edge payloads.
   Mitigation: strict suppression policy and extractor sanitization tests.
5. Risk: Settings drift across core/api/chat/web.
   Mitigation: shared interface updates and contract-focused tests.

---

## 18. Operations and Documentation Updates

Required docs updates:

1. docs/guides/telegram-chat-setup.md
2. docs/guides/chat-channel-adapter-development.md
3. docs/architecture/chat-sessions.md
4. docs/architecture/telemetry-gateway.md
5. apps/chat/README.md
6. docs/operations/README.md

Runbook additions:

1. How to tune typing and progress settings.
2. How to troubleshoot missing typing/status updates.
3. How to validate command menu sync.
4. How to verify no reasoning leakage.

---

## 19. Open Questions

1. Should tool names ever be shown by default in production?
2. Should status updates be per-thread or per-inbound-message configurable?
3. Should /cancel be exposed now or deferred behind elevated permissions?
4. Should inline keyboards be included in this epic or a follow-up epic?
5. Should message edit mode be mandatory, with multi-message only as fallback?

---

## 20. Actionable Tasks

- [ ] E097-001 Define final UX settings schema in packages/core telegram interfaces.
- [ ] E097-002 Extend API telegram settings constants/defaults/descriptions for UX fields.
- [ ] E097-003 Extend API update DTO and validation for UX fields.
- [ ] E097-004 Extend API telegram settings service read/write logic for UX fields.
- [ ] E097-005 Extend chat runtime settings types and normalization for UX fields.
- [ ] E097-006 Extend web API types and Telegram settings draft/build helpers.
- [ ] E097-007 Add web settings controls for UX toggles and numeric tuning.
- [ ] E097-008 Add Telegram sender support for sendChatAction.
- [ ] E097-009 Add Telegram sender support for editMessageText fallback behavior.
- [ ] E097-010 Add Telegram sender support for setMyCommands sync.
- [ ] E097-011 Add command menu projection from enabled command settings.
- [ ] E097-012 Add startup command menu sync orchestration service.
- [ ] E097-013 Add immediate typing action from ingress for non-command messages.
- [ ] E097-014 Add outbound relay typing heartbeat with throttle and stop conditions.
- [ ] E097-015 Add progress relay state machine in outbound relay worker.
- [ ] E097-016 Add event-to-ux mapper with allowlist and text templates.
- [ ] E097-017 Add metadata cursor storage and dedupe logic for progress relay.
- [ ] E097-018 Add single-message edit mode with fallback to multi-message mode.
- [ ] E097-019 Add progress rate limits and max updates per run safeguards.
- [ ] E097-020 Harden extractor to prevent reasoning leakage in terminal responses.
- [ ] E097-021 Add optional sanitization pass for suspicious reasoning wrappers.
- [ ] E097-022 Add optional API workflow events for container_starting/started/ready.
- [ ] E097-023 Add structured logs for typing/progress/menu sync operations.
- [ ] E097-024 Add unit tests for sender service new methods.
- [ ] E097-025 Add unit tests for relay event mapping and cursor logic.
- [ ] E097-026 Add unit tests for typing heartbeat lifecycle logic.
- [ ] E097-027 Add unit tests for hide-thinking extraction/sanitization behavior.
- [ ] E097-028 Add integration tests for ingress-to-relay UX flow.
- [ ] E097-029 Add API settings tests for new UX fields.
- [ ] E097-030 Add web settings tests for UX form behavior and payload generation.
- [ ] E097-031 Update Telegram setup guide with UX settings and command menu notes.
- [ ] E097-032 Update adapter development guide with UX relay conventions.
- [ ] E097-033 Update operations runbook with troubleshooting and observability checks.
- [ ] E097-034 Stage rollout using feature flags and monitor production metrics.
- [ ] E097-035 Validate production behavior and close open questions.

---

## 21. Exit Criteria

1. Telegram users consistently see live presence and meaningful progress for active runs.
2. Telegram responses remain concise and free of hidden reasoning content.
3. Commands are discoverable via both menu and in-chat help.
4. Operators can tune behavior at runtime through settings.
5. Tests and lint checks for touched areas are green.
