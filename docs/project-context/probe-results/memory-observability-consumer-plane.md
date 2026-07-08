---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: memory-observability-consumer-plane
outcome: success
inferred_status: implemented
confidence_score: 0.9
evidence_refs:
  - apps/web/src/lib/api/memory.ts
  - apps/web/src/lib/api/memory.types.ts
  - apps/web/src/hooks/useMemoryMetrics.ts
  - apps/web/src/hooks/useMemoryMetrics.spec.tsx
  - apps/web/src/features/control-plane/MemoryHealthCard.tsx
  - apps/web/src/features/control-plane/ControlPlaneBoard.tsx
  - apps/web/src/features/control-plane/ControlPlaneBoard.spec.tsx
  - apps/api/src/memory/memory-metrics.controller.ts
  - apps/api/src/memory/memory-metrics.service.ts
  - apps/api/src/memory/memory-metrics.types.ts
  - docs/work-items/1e5b3af0-5551-487b-a5ac-7e4715887672.md
source_paths:
  - apps/web/src/lib/api/memory.ts
  - apps/web/src/lib/api/memory.types.ts
  - apps/web/src/hooks/useMemoryMetrics.ts
  - apps/web/src/hooks/useMemoryMetrics.spec.tsx
  - apps/web/src/features/control-plane/MemoryHealthCard.tsx
  - apps/web/src/features/control-plane/ControlPlaneBoard.tsx
updated_at: 2026-06-16T16:20:36Z
---

# Probe Result: Memory observability WebUI consumer plane (1e5b3af0 merge)

## Narrative Summary

The 1e5b3af0 work item (Add per-backend memory observability counters and distillation outcome metrics) calls out slice (5) explicitly: "Add a WebUI hook `useMemoryMetrics` + a small `MemoryHealthCard` in ControlPlaneBoard." All six in-scope files for the WebUI consumer plane are present on disk (file timestamps Jun 16 11:48 UTC, matching the merge wave), and they form a complete, internally consistent consumer pipeline from HTTP request to rendered card.

`memory.ts` adds a new `getMemoryMetrics()` function alongside the pre-existing segment and chat-observability helpers; `memory.types.ts` declares `MemoryMetricsResponse` (and a deep object tree of `MemoryMetricsBackendMetrics` / `DistillationMetrics` / `LearningMetrics` types) and explicitly notes that the shape is duplicated verbatim from `apps/api/src/memory/memory-metrics.types.ts` with a "keep both files in sync" warning. `useMemoryMetrics.ts` wraps the call in a TanStack Query `useQuery` with a 30s default `refetchInterval` (overrideable). `MemoryHealthCard.tsx` is a stateless, presentational component that renders backend write/read/active-segment counts, distillation outcomes + last-run details, and learning promotions + last promoted candidate, and degrades gracefully with a `Loading…` placeholder when the snapshot is `undefined`. `ControlPlaneBoard.tsx` composes the hook (`useMemoryMetrics({ refetchInterval: 30_000 })`) and embeds the card below the lane/fact/outcome/stale-link grids.

The contract is corroborated by the producer side: `apps/api/src/memory/memory-metrics.controller.ts` exposes `GET /memory/metrics` guarded by JWT auth + `memory:read` permission, and returns `{ success: true, data: MemoryMetricsSnapshot }`, matching the web client's path and response shape.

## Capability Updates

- **WebUI memory metrics consumer (new in 1e5b3af0)**: `memoryApi.getMemoryMetrics()` → `GET /memory/metrics` → `MemoryMetricsResponse` (backend.read/write/active_segments/fallback, distillation.completed_total + last, learning.promoted_total + last_promoted, generated_at).
- **WebUI memory metrics hook (new)**: `useMemoryMetrics({ refetchInterval? })` (default 30s) — TanStack Query with `queryKey: ["memory", "metrics"]`.
- **WebUI memory health card (new)**: `MemoryHealthCard` in `apps/web/src/features/control-plane/` — renders five sections (Backend writes, Backend reads, Active segments, Distillation completed, Learning promoted) plus a `generated_at` footer; loading placeholder present.
- **ControlPlaneBoard integration (new)**: card is rendered in a single-column grid below the existing board content, sourced from `useMemoryMetrics({ refetchInterval: 30_000 })` and passed as the `snapshot` prop.
- **Type contract duplication (intentional)**: `apps/web/src/lib/api/memory.types.ts` carries a JSDoc comment marking the snapshot as a verbatim mirror of `apps/api/src/memory/memory-metrics.types.ts::MemoryMetricsSnapshot` because the web app intentionally does not depend on the api package. Manual sync is required on contract changes.
- **Pre-existing surface (unchanged)**: `getUserMemorySegments`, `getSystemMemorySegments`, `getChatMemorySegments`, `getChatMemoryObservability` remain available in the same module.

## Health Findings

### Test coverage

- **Hook tests**: `useMemoryMetrics.spec.tsx` (3.2KB) provides two vitest + Testing Library cases using the `vi.hoisted` mock pattern: (a) the snapshot returned by the API flows through the query, and (b) a custom `refetchInterval` is accepted. Mock cleanup via `vi.clearAllMocks()` in `beforeEach`. No negative-path test (e.g. error propagation, retry behavior, refetch firing).
- **Board tests**: `ControlPlaneBoard.spec.tsx` (7.4KB, sibling to `ControlPlaneBoard.tsx`) provides five cases, two of which cover the new card explicitly — "renders the Memory Health card when the metrics hook returns a snapshot" (asserts the card title and description) and "renders the Memory Health card loading placeholder when the hook has no data yet" (asserts `Loading…`). The hook is mocked via `vi.hoisted`, so the board spec exercises the card through the board composition only — it does not test the card's internal sections (e.g. backend rows, distillation last-run block, learning last-promoted block) directly.
- **Missing test file**: No dedicated `MemoryHealthCard.spec.tsx` exists. Section-level rendering (per-backend write badges, latency badge math, distillation-failure destructive variant, null `last` / `last_promoted` empty states, `generated_at` footer) is uncovered. Recommend adding a focused spec for the card.
- **API client tests**: No spec file for `memory.ts` itself (consistent with other `lib/api/*.ts` modules in this repo).

### Code quality

- All new code uses TypeScript strictness, `readonly` modifiers on props and snapshot fields, `ReadonlyArray<...>` for label lists, and `as const` query keys — patterns consistent with the rest of `apps/web/src`.
- The card uses `Badge` from `@/components/ui/badge` and `Card*` from `@/components/ui/card`, both present and exercised in the repo.
- `LatencyBadge` correctly guards against division by zero (`summary.count === 0`) and falls back to a `latency 0 reads` badge, which is a nice touch.
- Distillation failure badge correctly uses `variant="destructive"` only when `failure > 0`, avoiding alarm fatigue when failure count is zero.
- `useMemoryMetrics` returns `UseQueryResult<MemoryMetricsResponse, Error>` — typing is consistent with other hooks in the same directory.
- No unsafe casts or `any` observed in any of the six files.

### Drift / alignment observations

- **Type drift (low severity)**: API `DistillationOutcome = 'success' | 'failure' | 'skipped'` (apps/api/src/memory/memory-metrics.types.ts:11), but web `MemoryMetricsDistillationOutcome = "success" | "failure"` (apps/web/src/lib/api/memory.types.ts:90). The card only iterates the two booleans, so `'skipped'` is silently excluded from the web view. Not a current functional break, but a divergence that the JSDoc on the web side is meant to flag. If the API ever starts emitting `'skipped'`, the web `MemoryMetricsResponse` type and `DISTILLATION_OUTCOME_LABELS` should be updated together.
- **Path alignment**: Web calls `/memory/metrics`; API `@Controller('memory/metrics')` exposes `@Get()` — aligned. Web `getChatMemoryObservability` calls `/memory/chat/observability`; API `ChatMemoryAdminController` (`@Controller('memory/chat')`) exposes `@Get('observability')` — aligned. Both use the same `apps/web/src/lib/api/client.ts` `api.get<T>(path, { params })` shape.
- **Permissions**: API requires `memory:read` on `/memory/metrics` and `memory:manage` on `/memory/chat/observability`; the web side sends a bearer token through the shared client, so no extra client-side wiring is required.

### Churn / scope hygiene

- All six in-scope files have an identical mtime of Jun 16 11:48, suggesting a single, well-bounded commit landing the whole consumer-plane slice together. Good hygiene.
- No lingering TODOs, no commented-out blocks, no debug `console.log` observed.
- Card is a single self-contained component (no hidden coupling to other features), making it easy to extract or repurpose.

## Open Questions

- The playbook step 1 references `kanban.project_state` and `kanban.orchestration_timeline` runtime tools; these were not available in this subagent's toolset, so the probe relied solely on filesystem + grep evidence. If a parent workflow needs the kanban snapshot for cross-checking, it should call those tools itself.
- The work item's "Acceptance" line requires "dashboard renders live counts" and "counters increment under integration test" — the API integration test (`memory-metrics.service.spec.ts`, 7.1KB, Jun 16 16:06) exists but was not in scope; the consumer-plane spec confirms renderability of a mocked snapshot but does not exercise the polling loop end-to-end. Worth verifying that an integration test wires the board to a real API.
- Should the `'skipped'` distillation outcome be surfaced in the web card? Current implementation deliberately hides it. Product/UX intent is unclear from code alone.
- Should the per-backend `fallback` map in `MemoryMetricsResponse.backend.fallback` (e.g. `postgres->honcho:read`) be visualized? It is captured in the type but not rendered. Likely intentional for now, but worth confirming.
