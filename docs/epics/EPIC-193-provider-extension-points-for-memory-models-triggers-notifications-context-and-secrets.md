# EPIC-193: Provider Extension Points for Memory, Models, Triggers, Notifications, Context, and Secrets

**Status:** Implemented
**Priority:** P1
**Created:** 2026-05-17
**Updated:** 2026-05-17
**Owner:** Platform Extensibility / Runtime Platform
**Parent:** EPIC-188
**Depends on:** EPIC-189, EPIC-190, EPIC-191, EPIC-192
**Related:** EPIC-093, EPIC-107, EPIC-109, EPIC-124, EPIC-177

## Summary

Refactor provider-style API subsystems behind plugin contribution resolvers so third-party plugins can add memory providers, model providers, trigger sources, notification providers, schedule providers, context providers, and secret providers.

## Problem Statement

Several Nexus features are currently extensible only through code changes or environment configuration. Memory backend selection is controlled by `MEMORY_BACKEND`. Model providers and configured models are database-backed but not plugin-contributed. Triggers, notifications, schedules, context assembly, and secret lookup have hardcoded service seams. A flexible plugin platform needs provider extension points that can add these capabilities without changing core API code.

## Goals

- Add provider contribution contracts for memory, models, triggers, notifications, schedules, context, and secrets.
- Keep existing APIs stable while internal resolver seams become plugin-aware.
- Allow provider plugins to be enabled, disabled, inspected, and quarantined like other plugins.
- Ensure provider calls are policy-checked and auditable.
- Support provider hooks for indexing, enrichment, synchronization, and side effects.

## Non-Goals

- Replace existing Postgres memory or configured LLM provider storage immediately.
- Let provider plugins bypass existing auth, policy, or audit controls.
- Require all providers to be third-party plugins before bundled migration work begins.

## Provider Contribution Types

### `memory.provider`

Adds query, write, search, and optional delete behavior through the memory manager.

Acceptance criteria:

- Existing `query_memory` and `record_learning` tool contracts can remain stable while the backend resolver becomes plugin-aware.
- Postgres and Honcho can later become bundled provider plugins.
- Provider failures return normalized errors and can fall back only when policy/config explicitly allows fallback.

### `memory.hook`

Observes memory write/query events for indexing, summarization, enrichment, or synchronization.

Acceptance criteria:

- Hooks receive approved event payloads only.
- Hook failures do not corrupt memory writes.

### `model.provider`

Contributes LLM provider adapters and model catalogs behind the existing AI config precedence.

Acceptance criteria:

- Plugin models participate in provider/model resolution without hardcoding API service imports.
- Secret access for provider credentials is mediated by the kernel.

### `trigger.source`

Emits workflow launch events from external systems.

Acceptance criteria:

- Trigger plugins can publish approved launch requests through kernel-mediated APIs.
- Trigger source failures and denied launches are auditable.

### `notification.provider`

Sends messages through plugin-provided channels such as Slack, email, Telegram, or webhooks.

Acceptance criteria:

- Notifications remain mediated by API policy and secrets.
- Provider-specific delivery errors are normalized.

### `schedule.provider`

Contributes schedule backends or schedule-driven trigger sources.

Acceptance criteria:

- Schedule plugins can emit approved scheduled events or workflow launches.
- Existing scheduled job behavior continues during migration.

### `context.provider`

Adds runtime context to agents, such as project metadata, external docs, customer data, or environment state.

Acceptance criteria:

- Context providers are scoped, permission-checked, and size-limited.
- Context provenance is visible to downstream consumers.

### `secret.provider`

Optionally contributes secret lookup backends while keeping secret access mediated by the API.

Acceptance criteria:

- Secret values are never exposed in inspect/list responses or logs.
- Secret provider access is scoped and audited.

## Workstreams

### 1. Provider Resolver Pattern

- Define a common resolver pattern for selecting plugin and built-in providers.
- Support priority, explicit selection, fallback policy, and health checks.

### 2. Memory Provider Seam

- Refactor memory backend selection behind a plugin-aware resolver.
- Preserve current Postgres, Honcho, and dual behavior.

### 3. Model Provider Seam

- Add plugin-aware model provider resolution behind existing AI config precedence.

### 4. Trigger, Notification, Schedule, Context, and Secret Seams

- Add contribution contracts and minimal projection adapters for each provider family.

## Backlog

- [ ] E193-001 Define provider contribution schemas.
- [ ] E193-002 Add common provider resolver interfaces and tests.
- [ ] E193-003 Add plugin-aware memory provider resolver.
- [ ] E193-004 Add memory hook support.
- [ ] E193-005 Add plugin-aware model provider resolver.
- [ ] E193-006 Add trigger source contribution support.
- [ ] E193-007 Add notification provider contribution support.
- [ ] E193-008 Add schedule provider contribution support.
- [ ] E193-009 Add context provider contribution support.
- [ ] E193-010 Add secret provider contribution support.

## Acceptance Criteria

- A plugin can add a memory provider without modifying `MemoryBackendFactory` for each new backend.
- A plugin can add a model provider or model catalog behind existing AI provider selection.
- Trigger, notification, schedule, context, and secret provider contributions have validated contracts and policy-mediated calls.
- Existing provider behavior remains operational and covered by migration tests.
