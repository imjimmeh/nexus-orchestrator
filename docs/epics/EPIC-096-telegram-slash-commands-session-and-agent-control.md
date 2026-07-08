# EPIC-096: Telegram Slash Commands for Session and Agent Control

Status: Planned
Priority: P1
Depends On: EPIC-092, EPIC-095
Related: docs/guides/telegram-chat-setup.md, docs/architecture/chat-sessions.md, docs/architecture/telemetry-gateway.md
Last Updated: 2026-04-14

---

## 1. Epic Summary

Add Telegram slash command support so chat users can control their chat flow directly in-channel.

Initial command set:

1. Switch between AI agents.
2. Start a new chat session.
3. Resume a previous chat session.

The implementation must preserve current ingress safety and idempotency behavior while introducing explicit command parsing and session routing state.

---

## 2. Context

Current Telegram ingress behavior is text-first and linear:

1. Parse inbound message text.
2. Resolve or create deterministic session by provider/thread/user.
3. Persist inbound message and dispatch to Core workflow action.

There is currently no command interpreter in Telegram ingress and no explicit active-session routing model beyond deterministic session id derivation.

This blocks user-friendly chat controls such as /new, /resume, and reliable agent switching semantics.

---

## 3. References

1. ../../docs/guides/telegram-chat-setup.md
2. ../../docs/architecture/chat-sessions.md
3. ../../docs/architecture/rest-api.md
4. ../../docs/architecture/telemetry-gateway.md
5. ../../apps/chat/src/channel-adapters/telegram/telegram-adapter.service.ts
6. ../../apps/chat/src/channel-adapters/telegram/telegram-ingress.service.ts
7. ../../apps/chat/src/chat-sessions/chat-sessions.service.ts
8. ../../apps/chat/src/chat-messages/chat-messages.service.ts
9. ../../apps/chat/src/chat-actions/chat-core-lookup.service.ts
10. ../../apps/api/src/settings/telegram-settings.service.ts
11. ../../packages/core/src/interfaces/telegram-settings.types.ts

---

## 4. Scope

### In Scope

1. Add Telegram slash command parsing and routing in apps/chat ingress flow.
2. Introduce channel session routing state to support active session switching per Telegram user/thread context.
3. Implement /help, /new, /resume, and /agent command behaviors.
4. Ensure subsequent non-command messages route to the active session for that Telegram user/thread context.
5. Add validation and policy guards for agent switching and session resume access.
6. Add command-specific observability and audit metadata on chat timeline entries.
7. Update documentation and runbooks for command usage and operations.

### Out of Scope

1. Non-Telegram channel command support (Slack, Discord, etc.).
2. Telemetry gateway websocket command handling changes for this slice.
3. Full war-room participant runtime orchestration from chat invites.
4. Advanced RBAC model beyond current internal auth and user/thread scoping.

---

## 5. Implementation Plan

### 5.1 Command Contract and UX

1. Define canonical command grammar and arguments:
   - /help
   - /new
   - /resume
   - /resume <session-id-or-index>
   - /agent <agent-profile>
2. Define deterministic success and error responses for each command.
3. Define unknown-command behavior and fallback guidance.

### 5.2 Channel Session Routing State

1. Add a new chat-domain persistence model for active routing by channel identity:
   - provider
   - external_thread_id
   - external_user_id
   - active_chat_session_id
   - last_accessed_at
2. Add repository and service APIs for read, upsert, and recent-session lookup.
3. Add migration and registration for new schema artifacts.

### 5.3 Telegram Command Parsing Path

1. Extend Telegram adapter payload typing for command-relevant metadata.
2. Introduce a dedicated Telegram command parser/router service.
3. Integrate command handling into ingress before normal message dispatch.
4. Keep provider parsing in adapter and orchestration logic in ingress-aligned services.

### 5.4 /new Command

1. Create a fresh chat session for the current Telegram identity context.
2. Resolve default agent/project from runtime settings unless explicit command overrides are supported.
3. Mark created session as active in channel routing state.
4. Respond with confirmation and brief session summary.

### 5.5 /resume Command

1. List resumable sessions for current Telegram identity context.
2. Support selecting a session by id or indexed list item.
3. Validate scope ownership (same provider/thread/user route context).
4. Switch active session pointer and confirm selection.

### 5.6 /agent Command

1. Validate target profile using existing core lookup path.
2. Apply v1 switching semantics:
   - Create new session with selected profile, then set as active.
3. Record command event metadata to preserve auditability and explain routing decisions.

### 5.7 Message Dispatch Integration

1. Route non-command inbound messages to active mapped session when present.
2. Fall back to deterministic resolve/create behavior when no active mapping exists.
3. Preserve provider message idempotency guarantees and run-link behavior.

### 5.8 Settings and Controls

1. Introduce command feature toggle and safe defaults for staged rollout.
2. Optionally extend Telegram runtime settings contract for command policy controls (enabled commands, limits) if needed by implementation.
3. Keep compatibility with existing env and runtime settings fetch behavior.

### 5.9 Observability and Operations

1. Add structured logs for command parse, command execution result, and routing changes.
2. Add metrics counters for command success, denial, parse failure, and resume misses.
3. Document operational troubleshooting for command-specific flows.

---

## 6. Deliverables

1. Telegram slash command parser and router implementation.
2. Channel session routing persistence and migration.
3. /help, /new, /resume, and /agent command support.
4. Updated ingress dispatch behavior using active session routing.
5. Unit and integration test coverage for command and routing paths.
6. Updated docs and operator runbook guidance.

---

## 7. Acceptance Criteria

1. /help returns discoverable command guidance in Telegram.
2. /new creates a new chat session and subsequent messages route to it.
3. /resume supports listing and selecting prior sessions for the same Telegram identity context.
4. /agent <profile> switches effective agent by creating and activating a new session with validated profile.
5. Non-command messages continue to dispatch through existing workflow action flow.
6. Existing webhook secret, allowlist, idempotency, and outbound relay behavior remains intact.
7. Command events are traceable in logs and chat message metadata.

---

## 8. Actionable Tasks

- [ ] E096-001 Define command grammar, validation rules, and response contract.
- [ ] E096-002 Add channel session routing entity/repository/service in apps/chat.
- [ ] E096-003 Author and register DB migration for command routing state.
- [ ] E096-004 Implement Telegram command parser and ingress integration.
- [ ] E096-005 Implement /help command behavior.
- [ ] E096-006 Implement /new command behavior and active session pointer update.
- [ ] E096-007 Implement /resume list and /resume select behaviors.
- [ ] E096-008 Implement /agent command with profile validation and session activation.
- [ ] E096-009 Integrate active routing into non-command message dispatch path.
- [ ] E096-010 Add observability (logs/metrics) for command execution and routing state transitions.
- [ ] E096-011 Add or extend tests for adapter, ingress, routing service, and message dispatch integration.
- [ ] E096-012 Update setup and architecture documentation for slash command operations.

---

## 9. Test and Quality Gates

1. npm run lint --workspace=apps/chat
2. npm run lint --workspace=apps/api
3. npm run lint --workspace=packages/core
4. npm run test --workspace=apps/chat -- src/channel-adapters/telegram/telegram-adapter.service.spec.ts
5. npm run test --workspace=apps/chat -- src/channel-adapters/telegram/telegram-ingress.service.spec.ts
6. npm run test --workspace=apps/chat -- src/chat-sessions/chat-sessions.service.spec.ts
7. npm run test --workspace=apps/chat -- src/chat-messages/chat-messages.service.spec.ts
8. npm run test --workspace=apps/api -- src/settings/telegram-settings.service.spec.ts

Note: deterministic E2E is intentionally excluded from this epic scope unless explicitly requested.

---

## 10. Risks and Mitigations

1. Risk: Session routing confusion or cross-user leakage.
   Mitigation: strict composite identity keys (provider/thread/user) and scope checks on resume.
2. Risk: Ambiguous agent switching semantics.
   Mitigation: v1 uses create-and-activate behavior for predictable session ownership.
3. Risk: Parsing false positives for normal text.
   Mitigation: command parsing requires explicit slash prefix and robust argument validation.
4. Risk: Migration drift in split-service deployments.
   Mitigation: migration registration checks and startup verification in cutover environments.

---

## 11. Exit Criteria

1. Telegram users can switch agent, start new sessions, and resume prior sessions via slash commands.
2. Active session routing is durable and deterministic for Telegram user/thread contexts.
3. Existing ingress reliability and workflow dispatch behavior are preserved.
4. Documentation and test gates for touched areas are complete and passing.
