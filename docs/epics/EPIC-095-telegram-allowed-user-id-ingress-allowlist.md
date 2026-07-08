# EPIC-095: Telegram Allowed User ID Ingress Allowlist

Status: Planned
Priority: P1
Depends On: EPIC-092
Related: docs/guides/telegram-chat-setup.md, docs/architecture/chat-sessions.md
Last Updated: 2026-04-14

---

## 1. Epic Summary

Add a configurable Telegram allowed user ID policy so inbound messages from users not explicitly listed are ignored before session resolution and workflow dispatch.

This epic introduces a single source of truth for Telegram user allowlisting across Core settings, Chat runtime configuration, and Web admin controls.

---

## 2. Context

Telegram ingress currently validates webhook secrets and message shape, then accepts messages for session routing and action dispatch.

There is no built-in user-level access policy for inbound Telegram messages, which creates risk for accidental or unauthorized bot interactions.

This epic hardens ingress by introducing an explicit allowlist of Telegram user IDs:

1. Allowed user IDs are centrally configured through system settings.
2. Chat ingress enforces the allowlist for both webhook and polling paths.
3. Non-allowed users are acknowledged but ignored with no session/message side effects.

---

## 3. References

1. docs/guides/telegram-chat-setup.md
2. docs/architecture/chat-sessions.md
3. packages/core/src/interfaces/telegram-settings.types.ts
4. apps/api/src/settings/telegram-settings.service.ts
5. apps/api/src/settings/dto/update-telegram-settings.dto.ts
6. apps/chat/src/channel-adapters/telegram/telegram-ingress.service.ts
7. apps/chat/src/channel-adapters/telegram/telegram-runtime-settings.service.ts
8. apps/web/src/pages/settings/TelegramSettingsCard.tsx
9. docker-compose.yaml

---

## 4. Scope

### In Scope

1. Add Telegram allowed user ID field to shared contracts in packages/core.
2. Persist and read allowed user IDs through Core Telegram settings APIs.
3. Add runtime propagation from Core settings to Chat Telegram runtime settings.
4. Enforce allowlist in Chat ingress before session resolution and message persistence.
5. Add Web settings controls for viewing and updating allowed user IDs.
6. Update operational documentation and environment variable references.

### Out of Scope

1. Channel-specific RBAC beyond Telegram user ID allowlisting.
2. Multi-channel identity federation or external identity provider integration.
3. Role/permission policy model for per-project Telegram access.

---

## 5. Implementation Plan

### 5.1 Shared Contract Updates

1. Extend Telegram settings interfaces in packages/core with allowedUserIds.
2. Include allowedUserIds in view and runtime payloads and update requests.
3. Keep type compatibility across API, Chat, and Web workspaces via shared imports.

### 5.2 Core Settings Persistence and Validation

1. Add system setting key for telegram_allowed_user_ids with default empty list.
2. Add parser/normalizer utilities for string array input, trimming, dedupe, and invalid value filtering.
3. Support env fallback via CHAT_TELEGRAM_ALLOWED_USER_IDS for bootstrap and recovery.
4. Wire read/write behavior in TelegramSettingsService and update DTO validation.

### 5.3 Chat Runtime and Ingress Enforcement

1. Extend Chat telegram runtime types and response parsing for allowedUserIds.
2. Extend TelegramRuntimeSettingsService env fallback and normalization.
3. Enforce allowlist in TelegramIngressService for webhook and polling paths.
4. Return acknowledged ignored response for non-allowed users and skip session/message side effects.

### 5.4 Web Settings and Operator UX

1. Extend Web API types for allowedUserIds.
2. Add Telegram settings form control for allowed user IDs.
3. Normalize and diff payload generation for updates.
4. Add inline validation messaging for malformed entries.

### 5.5 Operational Documentation and Rollout

1. Document allowlist behavior, defaults, and examples in Telegram setup guides.
2. Update compose and README env variable references.
3. Add rollout guidance for existing deployments to avoid unexpected ingress behavior.

---

## 6. Deliverables

1. Shared contract support for Telegram allowed user IDs.
2. Core settings API support for allowed user ID read/write.
3. Chat ingress enforcement for webhook and polling.
4. Web admin settings controls for allowed user IDs.
5. Updated docs and environment configuration guidance.

---

## 7. Acceptance Criteria

1. Telegram settings APIs expose allowedUserIds in both masked settings view and internal runtime settings.
2. Messages from Telegram users not present in allowedUserIds are ignored for webhook and polling ingress.
3. Ignored messages do not create chat sessions, do not persist chat messages, and do not trigger workflow runs.
4. Allowed users continue to follow existing session resolution and action dispatch behavior.
5. Configuration changes are effective through existing runtime settings refresh behavior without service restarts.

---

## 8. Actionable Tasks

- [ ] E095-001 Extend telegram settings contracts in packages/core for allowedUserIds.
- [ ] E095-002 Add Core telegram setting key/default/description for allowed user IDs.
- [ ] E095-003 Add Core utils and service normalization for allowed user IDs and env fallback.
- [ ] E095-004 Extend update DTO and controller/service contract coverage for allowedUserIds.
- [ ] E095-005 Extend Chat core-response parsing and runtime settings normalization for allowedUserIds.
- [ ] E095-006 Enforce allowlist in Telegram ingress service for webhook and polling paths.
- [ ] E095-007 Add/extend API and Chat unit tests for allowed and ignored user flows.
- [ ] E095-008 Extend Web Telegram settings types and form payload helpers.
- [ ] E095-009 Add Web UI control for allowed user IDs with client-side validation.
- [ ] E095-010 Update docs and compose env references for CHAT_TELEGRAM_ALLOWED_USER_IDS.

---

## 9. Test and Quality Gates

1. npm run lint:api
2. npm run lint:chat
3. npm run lint:web
4. npm run test --workspace=apps/api -- src/settings/telegram-settings.service.spec.ts
5. npm run test --workspace=apps/chat -- src/channel-adapters/telegram/telegram-ingress.service.spec.ts
6. npm run test --workspace=apps/chat -- src/channel-adapters/telegram/telegram-runtime-settings.service.spec.ts
7. npm run test:unit:web

---

## 10. Risks and Mitigations

1. Risk: Existing Telegram deployments may unexpectedly stop processing when allowlist is enabled without proper values.
   Mitigation: explicit rollout checklist, env examples, and validation warnings in docs/UI.
2. Risk: Inconsistent normalization across API, Chat, and Web could allow drift.
   Mitigation: shared contract updates first, strict parser tests, and end-to-end payload shape verification.
3. Risk: Silent ignore behavior could reduce operator visibility.
   Mitigation: add structured ingress logs and ignored-message counters without storing sensitive message content.

---

## 11. Exit Criteria

1. Telegram allowlist is configurable via API and Web settings.
2. Chat ingress consistently ignores non-allowed Telegram users before side effects.
3. Documentation and compose settings clearly describe configuration and expected behavior.
4. Targeted API, Chat, and Web quality gates pass for touched areas.
