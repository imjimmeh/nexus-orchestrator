# EPIC-109: Provider-Specific Capabilities

Status: Proposed (Detailed Plan)
Priority: P1
Depends On: EPIC-017, EPIC-099, epic-chat-session-context-service
Last Updated: 2026-04-17
Owner: TBD

---

## 1. Executive Review of Current Plan

The direction is strong and worth shipping, but the current version is too high level to execute safely.

### 1.1 What is good

1. The problem statement is valid: capability knowledge is still fragmented across policy, runtime, and context surfaces.
2. The goals align with production pain: agents often discover constraints only after attempted tool calls.
3. The non-goals correctly avoid introducing a second permission system.

### 1.2 Issues in the current draft

1. It does not distinguish what already exists from what is missing.
2. It does not map scope items to concrete code touchpoints.
3. It lacks PR-sized implementation slices and acceptance criteria.
4. It does not define deterministic capability resolution precedence for provider/channel context.
5. It has no Definition of Done, rollout plan, or regression test matrix.

### 1.3 Adjustments made in this version

1. Added code-grounded baseline and explicit gaps.
2. Added a deterministic provider-aware capability resolution model.
3. Broke work into mergeable PR tasks with acceptance criteria.
4. Added testing strategy, telemetry requirements, rollout plan, and Definition of Done.

---

## 2. Summary

Introduce provider-specific capability awareness so agents can see and reason about what they are allowed to do in the current runtime context (for example: chat provider, channel adapter, environment tier, policy constraints, and available tools).

This epic adds a dedicated context/capability layer that is explicit, queryable, and composable with existing orchestration and chat-session context injection.

---

## 3. Current-State Baseline (Code Context)

This epic extends an existing capability foundation rather than starting from zero.

### 3.1 Existing capability and preflight foundation

1. Capability manifest model already exists in `apps/api/src/tool/capability-manifest.types.ts`.
2. Capability preflight service already resolves callable/denied/approval-required sets in:
   - `apps/api/src/tool/capability-preflight.service.ts`
   - `apps/api/src/tool/capability-preflight.types.ts`
3. Chat-specific capability snapshot resolution already exists via `resolveChatCapabilitySnapshot(...)` in `apps/api/src/tool/capability-preflight.service.ts`.

### 3.2 Existing runtime API surface

1. Runtime capability endpoints exist in:
   - `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
   - `apps/api/src/workflow/workflow-runtime-tools.service.ts`
2. `POST /workflow-runtime/get-chat-capabilities` already returns:
   - callable tools,
   - denied tools,
   - approval-required tools,
   - orchestration mode,
   - standing orders.

### 3.3 Existing chat context injection surface

1. Pluggable context orchestration exists in `apps/api/src/session/chat-session-context.service.ts`.
2. Existing providers are currently:
   - `ProjectContextProvider` in `apps/api/src/session/chat-context-providers/project-context.provider.ts`
   - `KanbanContextProvider` in `apps/api/src/session/chat-context-providers/kanban-context.provider.ts`
3. Provider wiring is centralized in `apps/api/src/session/session.module.ts`.

### 3.4 Existing session metadata that can support provider-aware resolution

The `chat_sessions` entity already stores useful dimensions in `apps/api/src/database/entities/chat-session.entity.ts`:

1. `provider`
2. `source` (`ad-hoc`, `workflow`, `subagent`)
3. `container_tier`
4. `project_id`

### 3.5 Gaps this epic closes

1. Provider/channel/source context is not first-class in capability snapshot contracts.
2. Shared input schemas in `packages/core` do not yet expose chat capability lookup schema parity.
3. Chat context injection does not include a dedicated capability summary provider.
4. Denied reasons are present, but provider/channel-specific denial semantics are not explicit.
5. Capability resolution outcomes are not yet uniformly surfaced as provider-aware telemetry events.

---

## 4. High-Level Context

Current behavior mixes capability checks across runtime, policy, and tool invocation paths. Agents can discover failures only after attempting actions.

Gaps this epic addresses:

1. capability visibility is fragmented,
2. provider/channel constraints are not consistently surfaced before action planning,
3. context injection does not yet include provider-specific capability summaries,
4. policy-aware decisioning is harder than necessary.

---

## 5. Goals

1. Define a provider-specific capability contract that is stable across runtime surfaces.
2. Expose effective capabilities for active session/provider/channel combinations.
3. Inject capability summaries into chat session context for planning-time awareness.
4. Keep capability evaluation deterministic and auditable.
5. Add test coverage for capability resolution and policy edge cases.

## 6. Non-Goals

1. Replacing IAM policy model.
2. Introducing a new permission system.
3. Full UI redesign of tool/capability administration.
4. Cross-tenant policy redesign.

---

## 7. Product and Technical Design

### 7.1 Provider-aware capability resolution contract

Introduce a provider context shape that can be reused by both runtime endpoints and context providers.

Proposed contract fields:

1. `chat_session_id`
2. `agent_profile_name`
3. `project_id` (nullable)
4. `provider` (nullable, from session when omitted)
5. `channel_adapter` (nullable, inferred from source/adapter mapping)
6. `session_source` (`ad-hoc` | `workflow` | `subagent`)
7. `container_tier`

Response additions:

1. `effective_context` block with resolved provider/channel/source/tier.
2. `resolution_version` for deterministic replay and diagnostics.
3. normalized denied reason entries with explicit authority and context type.

### 7.2 Deterministic resolution order

Capability evaluation must remain deterministic and auditable. Resolution order:

1. candidate capability set (tier/registry/runtime tool selection),
2. publication status gate,
3. policy allowlist/strategy gate,
4. provider/channel/session-source gate,
5. dynamic rule gate,
6. orchestration mode behavior gate,
7. approval-required projection.

This keeps provider/channel effects additive and explicit without bypassing existing governance.

### 7.3 Chat context injection integration

Add a `CapabilitiesContextProvider` under `apps/api/src/session/chat-context-providers/` that:

1. resolves effective capabilities for the active chat session,
2. formats a concise markdown block for planning-time visibility,
3. publishes metadata (`provider`, `channel_adapter`, `callable_count`, `denied_count`, `approval_required_count`, `resolution_version`),
4. gracefully degrades if capability resolution fails.

### 7.4 Contract parity in packages/core

Add explicit schema and type parity for chat capability lookup contracts in `packages/core` so runtime controllers and capability contracts do not drift.

### 7.5 Telemetry and observability

Add provider-aware capability resolution telemetry with stable event names and payload fields:

1. resolution context (provider/channel/source/tier),
2. outcome counts,
3. denial authority breakdown,
4. correlation fields (chat session id, workflow run id when available).

---

## 8. Scope (High Level)

1. Capability schema and resolver for provider-specific constraints.
2. Runtime endpoint/service support for effective capability lookup.
3. Chat context provider integration (capabilities block).
4. Logging/telemetry for capability resolution outcomes.
5. Unit/integration tests and baseline documentation.

---

## 9. PR-Oriented Implementation Plan

Each task is intentionally scoped for reviewable PRs.

### EPIC109-001: Core contract and schema parity

Scope:

1. Add/extend shared input schema for chat capability lookup in `packages/core`.
2. Align API request/response typing with provider-aware fields.

Expected files:

1. `packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.controller.types.ts`
3. `apps/api/src/tool/capability-preflight.types.ts`

Acceptance criteria:

1. Chat capability lookup has a shared schema in `packages/core`.
2. API/controller input types accept provider context fields without breaking existing callers.
3. Backward compatibility is preserved for requests that only provide existing fields.

### EPIC109-002: Provider-aware resolution in preflight service

Scope:

1. Extend chat snapshot resolution to include provider/channel/source context.
2. Add explicit provider-context evaluation stage and denied reason mapping.

Expected files:

1. `apps/api/src/tool/capability-preflight.service.ts`
2. `apps/api/src/tool/capability-preflight.helpers.ts`
3. `apps/api/src/tool/capability-preflight.types.ts`

Acceptance criteria:

1. Snapshot includes normalized effective context and deterministic ordering.
2. Denied reasons include actionable reason codes and authority details.
3. Existing workflow preflight behavior remains unchanged for non-chat paths.

### EPIC109-003: Runtime endpoint/service integration

Scope:

1. Extend runtime service/controller response to expose effective context metadata.
2. Ensure fallback to session-derived provider fields when omitted by caller.

Expected files:

1. `apps/api/src/workflow/workflow-runtime-tools.service.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
3. `apps/api/src/workflow/workflow-runtime-tools.controller.types.ts`

Acceptance criteria:

1. `get-chat-capabilities` returns provider-aware effective context block.
2. Existing clients still receive previous fields unchanged.
3. Unit tests cover explicit provider input and implicit session fallback.

### EPIC109-004: Chat context provider integration

Scope:

1. Add `CapabilitiesContextProvider`.
2. Register provider in session module/context service initialization.

Expected files:

1. `apps/api/src/session/chat-context-providers/capabilities-context.provider.ts` (new)
2. `apps/api/src/session/chat-session-context.service.ts`
3. `apps/api/src/session/session.module.ts`
4. `apps/api/src/session/chat-context-providers/index.ts`

Acceptance criteria:

1. Session context includes a capabilities block for applicable sessions.
2. Block content clearly distinguishes callable, denied, and approval-required tools.
3. Provider failures degrade gracefully and do not block session context injection.

### EPIC109-005: Telemetry and audit enrichment

Scope:

1. Emit provider-aware capability resolution events.
2. Ensure payload includes deterministic context fields and summary counts.

Expected files:

1. `apps/api/src/tool/capability-preflight.service.ts`
2. `apps/api/src/workflow/workflow-event-log.service.ts` (if required by implementation)
3. relevant event constants/types under `apps/api/src`.

Acceptance criteria:

1. Resolution outcomes are queryable with provider/channel/source/tier context.
2. Event payloads avoid sensitive data and remain operationally useful.
3. Telemetry additions are backward compatible with existing event consumers.

### EPIC109-006: Tests and documentation hardening

Scope:

1. Add unit/integration tests for provider-aware resolution and context injection.
2. Update epic/docs references for operators and developers.

Expected files:

1. `apps/api/src/tool/capability-preflight.service.spec.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.service.spec.ts`
3. `apps/api/src/session/chat-session-context.service.spec.ts`
4. `docs/architecture/telemetry-gateway.md` and/or relevant ops docs (as needed)

Acceptance criteria:

1. Tests cover happy path, denial path, and fallback path.
2. Context provider tests validate formatting and degraded behavior.
3. Documentation explains effective context and troubleshooting entry points.

---

## 10. Acceptance Criteria (Epic-Level)

1. Provider-aware capability resolution is available through runtime chat capability lookup.
2. Capability output includes explicit effective context and deterministic denied reasoning.
3. Chat session context injection includes a capabilities block for planning-time guidance.
4. Telemetry captures provider-aware capability outcomes for audit and debugging.
5. Existing callers that use current chat-capability inputs continue to work without required payload changes.
6. No regression in workflow preflight behavior for non-chat execution paths.

---

## 11. Test Matrix

1. Unit tests: provider-context resolution logic and denial reason authority mapping.
2. Unit tests: runtime tools service output shape for explicit provider input and fallback.
3. Unit tests: capabilities context provider formatting and failure handling.
4. Integration tests: chat capability lookup endpoint with realistic session/provider data.
5. Regression tests: existing `resolveChatCapabilitySnapshot` behavior for profile-only strategy remains valid.

Suggested verification commands (repo root):

1. `npm run lint:api`
2. `npm run test --workspace=apps/api -- src/tool/capability-preflight.service.spec.ts`
3. `npm run test --workspace=apps/api -- src/workflow/workflow-runtime-tools.service.spec.ts`
4. `npm run test --workspace=apps/api -- src/session/chat-session-context.service.spec.ts`
5. `npm run build --workspace=apps/api`

---

## 12. Risks and Mitigations

1. Risk: Contract drift between runtime controller types and shared schemas.
   Mitigation: enforce schema/type parity in `packages/core` and endpoint tests.
2. Risk: Over-denial due to misordered policy/provider checks.
   Mitigation: lock deterministic evaluation order and add explicit precedence tests.
3. Risk: Context bloat reduces prompt quality.
   Mitigation: keep capability context concise and capped; summarize counts + top denied reasons.
4. Risk: Event noise from verbose telemetry.
   Mitigation: emit compact summary events and avoid per-tool high-cardinality payloads unless needed.

---

## 13. Rollout Plan

1. Phase 1: ship schema/type additions and provider-aware resolution behind a guarded path.
2. Phase 2: enable runtime endpoint response enrichment for selected internal profiles.
3. Phase 3: enable capabilities context provider in session context injection.
4. Phase 4: validate telemetry quality and then broaden to all chat providers/channels.

Rollback strategy:

1. Keep endpoint backward-compatible fields untouched.
2. Make capabilities context provider registration independently disable-able.
3. Preserve existing preflight behavior path as fallback.

---

## 14. Definition of Done

This epic is done when all of the following are true:

1. All PR tasks EPIC109-001 through EPIC109-006 are merged.
2. Epic-level acceptance criteria are met and validated with tests.
3. Lint and targeted API tests pass for touched files.
4. API build passes for `apps/api`.
5. Provider-aware capability outcomes are visible in telemetry with usable correlation data.
6. Docs are updated to reflect runtime contract behavior and operational troubleshooting.
7. No unresolved high-severity regressions in chat capability lookup or session context injection.

---

## 15. Expected Outcome

Agents can plan with clearer constraints, reduce avoidable tool-call failures, and make safer, policy-aligned decisions earlier in a run.

Additionally, operators and developers gain deterministic, provider-aware diagnostics for why a capability was callable, denied, or approval-gated in a specific chat runtime context.
