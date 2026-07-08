# Work Item Cost Prediction

## Problem

We track token spend and dollar cost per work item today (`kanban_work_items.token_spend` / `.cost_cents`), but only as a cumulative rollup updated on each terminal run. There's no way to answer, before a work item runs, "what will this probably cost?" — or "what would it cost if I used a different model?" — because:

- Cost is only known retrospectively, after execution.
- The rollup conflates all attempts (including retries) into one running total, with no per-attempt breakdown.
- There's no historical aggregation keyed by the structural properties of a work item (type, story points, workflow) that a new, not-yet-run item could be matched against.
- Model pricing (`llm_models.input_token_cents_per_million` / `.output_token_cents_per_million`) lives in the API service's database; Kanban (which owns the work-item domain) has no access to it today.

## Goals

- Pre-execution cost estimate, shown on the work item detail/creation view, with a confidence indicator.
- "What-if" comparison: same estimate recomputed against alternate models' current pricing, without needing historical execution data for that specific model.
- Retrospective/analytics reporting: predicted-vs-actual cost, and calibration accuracy (MAE/MAPE) over time.
- A design that's extensible — today's bucketing dimensions and estimation method are a first cut, not the final word.

## Non-goals (this iteration)

- Automated budget/governance gating on the prediction (may come later, once the estimate has track record).
- ML regression model training pipeline (considered, deferred — see Approaches Considered).
- Kanban board-card badge (follow-up once the estimate service exists; UI touchpoint is detail/creation view only for now).

## Approaches Considered

**A. Token-distribution bucketing + live pricing math (chosen).** Predict token usage (input/output separately) per bucket of comparable historical work items, then convert to a dollar figure by multiplying against whichever model's _current_ pricing you want to evaluate. Because token usage for a given kind of work is largely model-agnostic while price-per-token is exactly known, "what if I switch to model X" becomes pure arithmetic — it works even for a model with zero execution history and stays correct as pricing changes.

**B. Direct dollar-cost bucketing.** Group historical per-attempt `cost_cents` directly by dimension combination, take mean/median/percentile. Simpler, but "switch model" what-if only works where historical runs already exist on that exact model — a new or rarely-used model yields nothing.

**C. ML regression (gradient-boosted trees) over structured features.** More flexible, could capture non-linear interactions. Requires a training/retraining pipeline, versioning, and is harder to explain than a transparent bucket average. Overkill for current data volume; a plausible phase-2 upgrade that can reuse the same raw per-attempt history this design collects (see Extensibility).

Chosen: **A**, with B effectively nested inside it (dollar bucketing is what you get before applying the pricing-multiplication step for what-if).

## Architecture

Work items are a Kanban-domain concept, so all new components are Kanban-owned, consistent with the core/kanban boundary (`CLAUDE.md`). Three additions:

### 1. Schema extension (`packages/core`)

Extend the lifecycle-stream usage payload (`CoreWorkflowRunUsageV1Schema`, `packages/core/src/schemas/events/event-envelope.schema.ts`) to carry a per-model breakdown array — `model_id`, `provider`, `input_tokens`, `output_tokens`, `cost_cents` — alongside the existing aggregate totals. Sourced from `budget_usage_events` grouped by model, populated by the API's `workflow-core-lifecycle-stream.listener.ts` before publish. These are neutral fields (mirroring what `budget_usage_events` already stores) — no Kanban concepts leak into API/core.

### 2. New table: `kanban_work_item_run_costs`

Per-attempt cost history, written **in addition to** (not instead of) the existing rollup accrual on `kanban_work_items`. Columns:

- `work_item_id`, `run_id`, `workflow_id`
- `type`, `story_points`, `priority` — a **snapshot at execution time** (these fields can change on the work item later; bucketing needs the value that was true when the work happened)
- `attempt_number`, `is_retry`
- per-model breakdown (jsonb: `[{model_id, provider, input_tokens, output_tokens, cost_cents}]`)
- `total_input_tokens`, `total_output_tokens`, `total_cost_cents`
- `started_at`, `completed_at`

Populated by extending the same terminal-run lifecycle consumer that already runs `accrueWorkItemTokenSpend` (`core-lifecycle-stream-terminal-projection.helpers.ts`). Insert must be idempotent on `run_id` — same duplicate-event protection the existing rollup accrual already needs.

Only **terminal attempts with a final recorded cost** are inserted — a mid-flight crash with no completion payload is excluded from the historical distribution rather than counted as a $0 attempt (which would silently deflate bucket averages).

### 3. New table: `kanban_model_pricing_cache`

`model_id`, `provider`, `input_token_cents_per_million`, `output_token_cents_per_million`, `synced_at`. Populated by a scheduled sync (`@Cron`, e.g. every 15 minutes) using the existing `KanbanCoreHttpClient` + `KanbanCoreAuthTokenProvider` pattern (already used by `core-scope-client.service.ts` and siblings) against a **new internal, service-token-gated** route on the API's `ai-config/models` controller — the existing routes are user-JWT + permission gated (`agents:read`/`agents:manage`), not meant for service-to-service calls. Precedent for an internal-route variant: `secrets-internal.controller.ts`.

This keeps the estimate **read path** entirely local to Kanban with zero synchronous cross-service calls. Trade-off: pricing can be up to ~15 minutes stale, which is acceptable since pricing changes infrequently.

## Data Flow

**Write path** (extends already-running data):
Terminal workflow-run lifecycle event → Kanban's existing consumer inserts a row into `kanban_work_item_run_costs` (alongside the current `token_spend`/`cost_cents` increment) → a periodic aggregation job (e.g. hourly `@Cron`) rolls attempt-rows up into a materialized `kanban_work_item_cost_bucket_stats` table, keyed by an **ordered, configurable list of bucket-key tiers** — starting with `(workflow_id, type, story_points)` → `(workflow_id, type)` → `(global)`. Each bucket row stores sample count `n`, mean/median input and output tokens, and percentile bounds (p25/p75).

Materializing on a schedule (rather than aggregating per read) keeps the estimate endpoint fast and free of on-demand joins.

**Read path** (pure local Kanban logic, no cross-service calls):

1. Look up the bucket-stats row for the most specific configured tier for the work item's `(workflow_id, type, story_points)`. If `n` is below a configurable minimum-sample threshold (e.g. 5), fall back to the next coarser tier, then to global — recording which tier was actually used.
2. Take that tier's token distribution (mean + p25/p75 range).
3. Multiply by the work item's _currently configured_ model's cached pricing → primary point estimate + range.
4. For what-if: re-multiply the **same** token distribution by every other cached model's pricing → `{model, estimated_cost}` list, requiring no additional historical data per model.
5. Response: point estimate, range, confidence (`n`, tier used), what-if list.

**Retry handling:** the primary estimate for a _historical_ work item sums all its attempts (cost-to-completion) before that item enters a bucket — matching what a user cares about end-to-end. Per-attempt rows remain separately queryable for analytics (e.g. "how much of historical cost is retry overhead").

## Extensibility

This is a first cut, expected to need refinement once real data volume is observed — the design keeps three things swappable without touching data collection or consumers:

- **Bucket-key tiers are config, not hardcoded query logic.** Adding a new dimension (`agent_profile_id`, project/scope, description-length bucket, etc.) means adding a tier to the config and a column to `kanban_work_item_cost_bucket_stats`, not a pipeline redesign.
- **The per-attempt table is the durable source of truth; bucket stats are a derived, disposable cache.** Any future bucketing scheme — or a move to Approach C's ML regression — can be recomputed or trained directly from history already being collected, no new backfill required.
- **The estimate service's external contract is stable** regardless of internal method: callers ask for `{workItem or draft} → {point estimate, range, confidence, what-if}`; swapping bucket-averaging for a regression model later doesn't require API/UI changes.
- **Sample-size threshold is also a config value**, tunable once real bucket population is observed.

## API Surface (Kanban)

- `GET /work-items/:id/cost-estimate` — pre-execution estimate for an existing work item using its current type/story_points/workflow/model.
- `POST /work-items/cost-estimate/preview` — same computation for a draft (creation form, before a work item id exists).
- Extend `GET /work-items/cost-summary` with a `predicted_cost_cents` field per item, for predicted-vs-actual.
- `GET /work-items/cost-estimate/accuracy` — aggregate calibration (MAE/MAPE) over completed items, grouped by bucket tier used.

## UI Surface (`apps/web`)

- New "Cost estimate" panel on the work item detail/creation view: point estimate + range, a confidence note ("based on 12 similar workflow+type+points items" vs. "based on 40 items of this type — fewer exact matches"), and a compact what-if table (model → estimated cost). Follows existing budget-dashboard visual conventions (`BudgetSpendTab` etc.) and the `dataviz` skill when built.
- Extend `BudgetWorkItemsTab`/cost-summary view with a predicted-vs-actual column.
- Board-card badge: deferred — the stable estimate-service contract means this is a pure follow-up UI consumer later, no backend rework needed.

## Error Handling & Edge Cases

- **Cold start** (no data at any tier, including global): return an explicit "insufficient data" response — never fabricate a number.
- **Missing/stale pricing cache entry**: omit that model from the what-if list; surface `synced_at` so the UI can flag unusually old pricing.
- **No workflow assigned yet**: fall back straight past the `workflow_id` tier to `(type, story_points)` or `(type)`, labeled as coarser.
- **Failed/crashed attempts with no final cost**: excluded from the historical distribution (see Architecture §2).
- **Duplicate lifecycle events**: per-attempt insert is idempotent on `run_id`.
- **Cancelled/abandoned work items**: excluded from bucket stats the same way as crashed attempts (no terminal cost to record) — open question to revisit once real data shows whether abandoned-but-partially-executed items materially affect bucket accuracy.

## Testing Plan

- **Unit:** bucket-tier fallback logic (exact → coarser → global, respecting sample-size threshold); token→cost conversion arithmetic for the primary estimate and each what-if model; idempotent per-attempt insert on duplicate `run_id`.
- **Integration:** lifecycle-stream consumer writes a `kanban_work_item_run_costs` row alongside the existing rollup increment on a terminal run event.
- **Contract:** `cost-estimate` / `cost-estimate/preview` return correct confidence/tier metadata across sparse vs. well-populated buckets; `cost-estimate/accuracy` aggregates MAE/MAPE correctly against fixtures with known predicted/actual pairs.
- **Migration/backfill:** pricing-cache sync cron populates correctly against a fixture API response; one-time backfill of `kanban_work_item_run_costs` from existing `budget_usage_events`/lifecycle history (mirroring `20260619090000-backfill-work-item-token-spend.ts`) verified against known totals, so historical work items aren't excluded from bucket stats on day one. **Known limitation:** `budget_usage_events.context_id` only attributes back to a work item via `kanban_work_items.linked_run_id`/`current_execution_id`, which is cleared on terminal reconciliation — so the backfill can only reliably reconstruct per-attempt rows for work items where that linkage (or an equivalent, e.g. `kanban_core_run_projections`) is still resolvable. Older completed items may enter bucket stats only from the date this feature ships forward; this is acceptable (buckets fill in over time) but should be called out rather than silently under-populating history.
- **No live-stack dependency:** the estimate read path is fully unit-testable without Docker/live services — no cross-service HTTP is on the read path by design.
