# Phase 1 — pgvector foundation + embeddings: clean, ranked, deduped, semantically-retrieved memory

**Epic:** [EPIC-212](../../epics/EPIC-212-memory-learning-loop-rebuild.md)
**Created:** 2026-06-25
**Status:** Ready to execute (after Phase 0 ships)
**Scope:** The vector foundation for the learning loop — swap the primary DB to pgvector, store embeddings in a **dimension-native** `memory_embeddings` table, make the embedding model **frontend-configurable and provider-agnostic** (reusing the existing AI-config stack), make `ICandidateSimilarity` embedding-primary, cluster/score candidates, and replace recency-truncated injection with hybrid vector recall. Migrations + a compose image change + new module + provider-UI additions. Reversible behind settings (lexical fallback when embeddings are off).

## Goal

The primary database serves `vector` cosine queries. The embedding model is chosen and changed **from the frontend** like any other provider/model — OpenAI, Voyage, Cohere, Google, or a **custom/self-hosted** endpoint — and its **dimension can change (e.g. 384 ↔ 1536) at any time with no schema change**. Every new and backfilled memory/candidate carries an embedding under the active model. The 26× `ambiguous_failure` rows collapse to one cluster on **semantic** similarity. Most importantly, when an agent starts a step, injection returns the memories **relevant to the task** — not merely the most recent — directly satisfying the operator ask to _"add embeddings retrieval."_

This phase delivers the EPIC-212 Pillar C foundation and the read-side retrieval upgrade; it depends only on Phase 0 having shipped the `remember` tool, the templated-emitter kill-switch, and the struggle candidate.

## Non-Goals (Phase 1)

- No LLM retrospective analyst / routing / governance matrix — Phase 2.
- Single **active** embedding model (runtime-switchable) — **not** per-request multi-model routing.
- No second vector store — embeddings live in the **primary** DB (`memory_embeddings`), not Honcho/`honcho-db`.
- No semantic search over arbitrary code/transcripts — only `memory_segments` and `learning_candidates`.
- **No seeded/hardcoded default embedding model** — embeddings are opt-in; absent an operator-configured active model, the loop runs lexical/recency and contacts no provider.
- No `FeedbackWeightTunerService` (weight auto-tuning) — Phase 3.

## Design note — why dimension-native storage, not a fixed/padded `vector(N)` column

The requirement is to switch embedding models with **different dimensions** at any time without a DB/schema change. Two candidate designs were considered:

- **Padded fixed-width column (rejected).** Zero-padding a 384-d vector out to a fixed `vector(1536)`/`vector(2048)` is _mathematically harmless for cosine and L2_ — the padding zeros add nothing to the dot product or norm, so `cosine(pad(a), pad(b)) == cosine(a, b)` **provided all compared vectors share the same real dimension** (true, since a model switch re-embeds the whole active corpus). But it is the worse option here: (1) it **does not** remove the need to tag rows with their model and filter queries to the active model (a 384-d MiniLM vector and a 1536-d OpenAI vector are incomparable even when both are padded to the same width); (2) `vector(2048)` **forfeits the ANN index** — pgvector HNSW/IVFFlat indexes cap at **2000 dims** for `vector` (`halfvec` caps at 4000), so "2048 just in case" loses the very index padding was meant to preserve; (3) truncation to fit a wider model only holds for **Matryoshka** models; (4) it wastes 4–5× storage/compute padding small models.
- **Dimension-native storage (chosen).** A dedicated `memory_embeddings` table with an **unbounded `vector` column** (pgvector permits a typeless `vector` that stores any dimension), each row tagged with `model_id` + `dim`. Retrieval is **exact, scope-filtered cosine KNN** over the **active** model's rows (all share a dim, so `<=>` is valid). Switching models is a **non-destructive re-embed** (embed the corpus under the new model alongside the old, flip the active pointer, GC the old) — zero DDL, dims change freely, and the owner tables (`memory_segments`/`learning_candidates`) are never altered.

**ANN tradeoff:** an unbounded `vector` cannot carry an HNSW index. But memory retrieval **filters by scope (project + global) first**, so exact KNN runs over a small subset and is fast — and _more correct_ than ANN-then-filter (HNSW pre-filtering under-returns). If a global corpus ever grows large enough to need ANN, the additive follow-up is a per-active-model materialized `halfvec(N)` index table — an optimization, not a change to the logical model.

## No seeded or hardcoded default — embeddings are opt-in

There is **no seed default and no hardcoded model constant**. The embedding model is configured entirely from the frontend (Task 3). **If no active embedding model is configured, no embeddings are generated** — no external provider is ever contacted — and the loop runs purely lexical/recency (the Phase-0 behaviour). The existence of a `default_for_embedding` model is the **sole** enable signal; there is no separate `memory_embedding_enabled` flag.

Operators choosing a model (informational, not a default to bake in): **`text-embedding-3-small`** (OpenAI; cheap, Matryoshka), **`voyage-3.5`** (Voyage — Anthropic's recommended partner; **Anthropic has no embeddings API**), or a **self-hosted** small model (e.g. `all-MiniLM-L6-v2` @384 via an OpenAI-compatible server; zero external cost). Verify the 384↔1536 switch (Task 10) using whichever two the operator configures.

## Phase 0 landed — what's already in place (2026-06-25, branch `epic-212-memory-learning-loop`)

Phase 1 builds directly on these shipped Phase-0 artifacts (do not re-create them):

- **`apps/api/src/memory/signals/` exists** with `template-noise.classifier.ts` (pure `classifyTemplateNoise → {isTemplate,isLowSignal}`) and `struggle-detector.service.ts` (+ `.types.ts`). Phase-1 Task 6 **formalizes `MemorySignalsModule`** around these (today they are registered directly in `MemoryModule.providers`).
- **`RecordLearningService.recordLearning(context, params, options?)` seam** — `RecordLearningOptions { candidateType, sourceTool, sourceQualityConfidence, humanApprovedAt, signalsJsonExtra }`. Already consumed by `remember` (`agent_capture`) and the struggle detector (`struggle`). Exact-fingerprint dedup now **reinforces** (bumps `last_seen_at` + `recurrence_count`). Phase-1 Task 6/7 layer near-dup (vector) on top of this same seam.
- **`ICandidateSimilarity` does NOT exist yet** — Phase-1 Task 6 introduces it (embedding-primary + lexical fallback). The `tokenize()` to extract is at `apps/api/src/ai-config/services/skill-search/strategies/tfidf-match.strategy.ts`.
- **Templated emitters are GATED, not deleted** (`learning_templated_emitters_enabled`, default off, via `resolveTemplatedEmittersEnabled` in `apps/api/src/settings/learning-emitters.settings.ts`). The EPIC end-state is deletion — fold that hygiene step into this phase's Task 11 (or a follow-up) once ranking is proven.
- **Phase-0 carry-forwards to resolve here:**
  - `list_pending_learning_candidates` returns a `total` that is the **pre-filter** DB count (template rows are excluded from `items` only). **Task 11's sweep input contract must make the count honest** (filter before counting, or add a `total_sweep_eligible`).
  - `StruggleDetectorService.detect` caps at `STRUGGLE_DETECTION_EVENT_LIMIT = 1000` events/run (warns on saturation). Add cursor pagination in this phase if real runs approach it.

## Pre-flight verification (do before writing code)

1. **Confirm a publishable `pgvector/pgvector:pg18` tag** (PG 18 is recent). If absent, fall back to a minimal `FROM postgres:18` Dockerfile installing the pgvector package — keep PG major **18** so the volume stays compatible. Record the resolved image ref here before editing compose.
2. **Confirm volume compatibility.** PG major stays 18 → `postgres_data` reused, no dump/restore (the official pgvector pg18 image is the same PG 18 server; Debian base is fine — on-disk format depends on major version + compile options, identical across the official builds). **Snapshot the volume before first deploy regardless.**
3. **Confirm the AI-config reuse seam.** `llm-provider.entity.ts` has `provider_id`, `secret_id`, `runtime_env.base_url`, `is_active`, scope; `llm-model.entity.ts` has `supports_vision` + `default_for_execution`-style use-case flags; `AiConfigurationService.resolveRunnerProviderConfig` resolves base*url + auth from `secret_store`. Confirm where the model-selection precedence (`ModelSelectionFactory` / `default_for*\*`) lives so an `embedding` use case slots in.
4. **Confirm the injection read site.** Locate the EPIC-202 memory-injection assembly that today reads `memory-segment.repository.ts` recency-ordered reads + `memory-token-budget.resolver.ts`. Record the exact call site `MemoryRetrievalService` will replace.
5. **Confirm test/integration DBs.** List every spec that runs `migrationsRun: true` against a real Postgres (`memory-drift-detection.integration.spec.ts`, gitops reconciliation, kanban integration, `packages/e2e-tests/src/stack/containers.ts:31`). All must move to the pgvector image or the `CREATE EXTENSION vector` migration fails.

## Task 1 — pgvector image swap + `CREATE EXTENSION vector` migration · S

- **Compose + env:** `docker-compose.yaml:3` and `.env.example:42` — change the `POSTGRES_IMAGE` default `postgres:18-alpine` → the resolved pgvector pg18 ref. Pin a specific pgvector version for reproducibility.
- **Migration (TDD on the SQL, mirroring `20260517000000-api-post-cutover-baseline.spec.ts`):**
  - _Red:_ a `.spec.ts` asserting the migration's first statement is `CREATE EXTENSION IF NOT EXISTS vector;`.
  - _Green:_ add `apps/api/src/database/migrations/<ts>-enable-pgvector.ts` (idempotent `IF NOT EXISTS`, mirroring the `uuid-ossp` precedent); register in `database.module.ts` `registeredMigrations`.
- **Test stacks:** bump `packages/e2e-tests/src/stack/containers.ts:31` and every `migrationsRun: true` integration spec's image to the pgvector ref.
- **Docs:** update `docs/guide/45-stack-harness.md`, `docs/guide/33-port-map.md`, `docs/guide/03-container-architecture.md` image references (currently `postgres:18-alpine`).

**Acceptance:** `docker compose up -d --build` brings up Postgres; `SELECT extname FROM pg_extension WHERE extname='vector';` returns a row; the integration specs still run migrations green.

## Task 2 — Dimension-native `memory_embeddings` table · S

- **Migration:**
  ```sql
  CREATE TABLE memory_embeddings (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_type   text  NOT NULL,        -- 'memory_segment' | 'learning_candidate'
    owner_id     uuid  NOT NULL,
    model_id     uuid  NOT NULL,        -- FK -> llm_models.id (active embedding model)
    dim          int   NOT NULL,
    embedding    vector NOT NULL,       -- UNBOUNDED: any dimension; app enforces dim == row.dim
    content_hash text  NOT NULL,        -- detect stale embeddings on content change
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (owner_type, owner_id, model_id)
  );
  CREATE INDEX idx_memory_embeddings_owner ON memory_embeddings (owner_type, owner_id);
  CREATE INDEX idx_memory_embeddings_model ON memory_embeddings (model_id);
  ```
  No fixed-dim column, **no ANN index** (unbounded `vector` can't be indexed; exact scope-filtered KNN — see the design note). The owner tables (`memory_segments`, `learning_candidates`) are **not** altered.
- **TDD:** migration `.spec.ts` asserting the DDL; an integration smoke that inserts two rows with literal `vector` values of the **same** dim under one `model_id` and runs `ORDER BY embedding <=> $1`; and a guard test that mixing dims under one `model_id` is rejected app-side.

**Acceptance:** the table accepts arbitrary-dimension `vector` rows; same-model cosine ordering works; a 384-d set and a 1536-d set can coexist under different `model_id`s.

## Task 3 — Embedding provider/model config (frontend, provider-agnostic) · L

**Reuse the AI-config stack — do not build a parallel one.**

- **Backend model fields:** add to `llm-model.entity.ts` (+ migration) `supports_embedding boolean default false`, `embedding_dimension int null`, `default_for_embedding boolean default false` (mirroring `supports_vision` / `default_for_execution`). Optionally an `embedding` value for a provider `capability` (or infer from `supports_embedding`). The active model = the `llm_models` row with `default_for_embedding=true` + `is_active`.
- **Selection:** extend `ModelSelectionFactory` / the use-case resolver with an `embedding` use case; `AiConfigurationService.resolveRunnerProviderConfig(capability:'embedding')` returns base_url + auth + the per-model `embedding_dimension`. Custom provider + `runtime_env.base_url` + `secret_store` credential are already supported.
- **Frontend (`apps/web/src/pages/providers/`):**
  - `ProviderFormFields.tsx` — a "Capability" selector (LLM / Embedding / Both); the advanced `runtime_env` (base_url) section already exists for self-hosted/custom.
  - `ModelForm.tsx` / `ModelDialogs.tsx` — `supports_embedding`, `embedding_dimension`, and a `default_for_embedding` toggle (copy the `default_for_execution` pattern); a capability badge in the model subtable.
  - `useModels.ts` / DTOs — carry the new fields.
- **No seed:** the feature ships with **no** embedding provider/model configured (no `default_for_embedding` row). An operator enables embeddings by adding an embedding-capable provider+model and toggling `default_for_embedding` — until then the resolver returns "no active model" and the loop stays lexical/recency.
- **TDD:** entity/DTO contract tests; a UI test that creating a custom embedding provider with a base_url + selecting an embedding default round-trips; resolver test that `capability:'embedding'` returns the `default_for_embedding` model + its dimension **and returns a clear "none configured" result when no row is flagged** (not an error).

**Acceptance:** an operator adds/edits an embedding provider (incl. custom + base_url) and picks the active embedding model **from the UI**; the backend resolves it via the existing credential precedence; with no default flagged, resolution reports "none configured" and nothing is embedded.

## Task 4 — `EmbeddingProviderService` · M

**TDD:**

- _Red:_ with **no** active model configured, `embed(...)` returns a "disabled / none-configured" result (empty, never an error) and contacts no provider; with one configured it resolves via `AiConfigurationService.resolveRunnerProviderConfig(capability:'embedding')` and returns vectors of `embedding_dimension` length from a **mocked** OpenAI-compatible client; a provider error returns the same fail-soft empty result and logs (never throws into the write path); for a Matryoshka model the requested `dimensions` param is passed through.
- _Green:_ implement `EmbeddingProviderService` — the "no active model" and "provider down" paths are the **same** fail-soft branch (callers can't tell the difference; both yield lexical fallback). OpenAI-compatible `/v1/embeddings` transport; provider-adapter indirection so Voyage/Cohere drop in; batched; bounded concurrency; redact secrets/NUL via the `event-ledger` utilities before sending. Record token spend to `budget_usage_events`.
- _Refactor:_ the adapter registry keyed by `provider_id`.

**Files:** ADD `apps/api/src/memory/signals/embedding-provider.service.ts` (+ adapters), `packages/core` `IEmbeddingProvider` contract.

## Task 5 — Embed-on-write + backfill · M

**TDD:**

- _Red:_ with no active model configured, create/content-change enqueues **nothing** (or the consumer no-ops) — zero `memory_embeddings` rows, zero provider calls; with a model configured, an `embedding.enqueue` job is queued and the consumer calls `EmbeddingProviderService.embed`, upserting a `memory_embeddings` row tagged with the **active** `model_id` + `dim` + `content_hash`; provider failure leaves the row absent and the owner usable (lexical fallback).
- _Green:_ a BullMQ queue + consumer (async — the write path never blocks on the network), gated on an active model existing; `EmbeddingBackfillService.run(batchSize)` walks owners with no active-model embedding, oldest-first, rate-capped (a no-op when no model is configured).
- _Refactor:_ one shared `embedOwner` path for both owner types + backfill + reindex.

**Files:** ADD `embedding-write.consumer.ts`, `embedding-backfill.service.ts` in `apps/api/src/memory/signals/`; wire enqueues into the segment/candidate create paths.

**Acceptance:** creating a memory/candidate populates a `memory_embeddings` row within seconds; backfill fills historical owners; killing the provider degrades to no-embedding without errors.

## Task 6 — `ICandidateSimilarity`: embedding-primary, lexical fallback · M

**TDD:**

- _Red:_ `EmbeddingSimilarityService.findNearest(text, k, scope)` embeds the query, runs exact `ORDER BY embedding <=> $1 LIMIT k` over `memory_embeddings WHERE model_id = active AND owner_type = … AND owner_id IN (<scope-filtered ids>)`; when the query can't be embedded (provider down) it **falls back** to `LexicalSimilarityService` (extracted TF-IDF/MinHash `tokenize()`); a hybrid score fuses both (reciprocal-rank fusion) so exact IDs/paths/commands aren't lost.
- _Green:_ implement both services behind `ICandidateSimilarity`; move `tokenize()` to a shared util.
- _Refactor:_ a single `similarity.config` (weights, thresholds) in `system_settings`.

**Files:** ADD `embedding-similarity.service.ts`, `lexical-similarity.service.ts`, shared `tokenize` util; formalize `MemorySignalsModule` (registered in the CLAUDE.md Workflow Module Boundaries table).

## Task 7 — Embedding-cosine clustering + dedup · M

**TDD:**

- _Red:_ `CandidateClustererService.cluster(pending)` groups candidates whose cosine ≥ threshold (agglomerative) over the **active-model** embeddings; elects a canonical; sets `recurrence_count = cluster size`; marks the rest `merged` with `diagnostics_json.merged_into = canonicalId`. The 26× `ambiguous_failure` fixture collapses to one cluster of 26.
- _Green:_ implement; a scheduled clustering pass runs before the 2am sweep.
- _Refactor:_ share threshold/config with Task 6.

**Files:** ADD `candidate-clusterer.service.ts` in `apps/api/src/memory/signals/`.

## Task 8 — `CandidateScoringService` (populate the dead columns) · M

**TDD:**

- _Red:_ scoring populates `recurrence_count` (cluster size), `stage_diversity_count`, `recency_decay` (`exp(-λΔdays)`), `source_quality_confidence` (per-source prior; templated = 0.2, `agent_capture`/`struggle_backed` high), composite `score` (logistic), and `signals_json`.
- _Green:_ implement; scheduled pass relies on the existing `idx_learning_candidates_status_score`. **No migration** — the columns already exist (`learning-candidate.entity.ts:45-67`).
- _Refactor:_ weights in `system_settings` (Phase 3 tunes them).

**Files:** ADD `candidate-scoring.service.ts` in `apps/api/src/memory/signals/`.

## Task 9 — `MemoryRetrievalService`: hybrid vector injection · L

**The user-visible win.** Replace recency-ordered injection with relevance recall.

**TDD:**

- _Red:_ `retrieve({ scopeId, queryText, tokenBudget })` embeds `queryText`, runs scope-filtered exact KNN over `memory_embeddings` (active model) joined to non-archived `memory_segments` for project + global, ranks by `cosine × recency_decay × usefulness × pinned_boost`, returns top-K trimmed to `tokenBudget`; provider-down falls back to the current recency path.
- _Green:_ implement using `EmbeddingSimilarityService` + `memory-token-budget.resolver.ts`; swap the EPIC-202 injection call site (pre-flight #4) behind a `memory_retrieval_mode` setting (`recency` | `hybrid`, default `hybrid`).
- _Refactor:_ share ranking weights with the scoring config.

**Files:** ADD `apps/api/src/memory/signals/memory-retrieval.service.ts`; EDIT the injection assembly call site.

**Acceptance:** for a task about "dev DB credentials," injection surfaces the credential memory even when newer unrelated memories exist; toggling `memory_retrieval_mode=recency` restores prior behaviour.

## Task 10 — Non-destructive model/dimension switch · M

**TDD:**

- _Red:_ setting a different `llm_models` row as `default_for_embedding` (or changing its `embedding_dimension`) triggers `EmbeddingReindexService` to enqueue a re-embed of every owner under the **new** `model_id`; queries keep using the **old** model until the new set is complete; on completion the active pointer flips and old-model rows are GC'd by a reaper; progress is observable (count embedded / total).
- _Green:_ implement `EmbeddingReindexService` reusing the shared `embedOwner` path; the active-model resolution already reads `default_for_embedding`, so the flip is atomic; a `memory_embeddings` GC reaper drops superseded `model_id` rows.
- _Refactor:_ guard against thrashing (debounce rapid switches).

**Files:** ADD `embedding-reindex.service.ts` + a GC reaper in `apps/api/src/memory/signals/`.

**Acceptance:** switching the active model from a 384-d to a 1536-d model (and back) re-embeds the corpus and serves correct results throughout, with **no migration and no `memory_embeddings` schema change**.

## Task 11 — Sweep contract, write-guard, grants, tab · M

- **Sweep input contract:** `list_pending_learning_candidates` returns clustered, score-ranked, template-filtered candidates with `signals_json`; update `seed/workflows/prompts/memory-learning-sweep/sweep.md` to consume top-ranked-to-budget and trust `struggle_backed`/`agent_capture` provenance.
- **`remember` write-guard upgrade:** promote Phase-0 exact-fingerprint dedup to full near-dup via `ICandidateSimilarity` (now vector) + the per-job write budget.
- **Grants:** roll `remember`/`update_memory` to the full profile floor (Phase 0 seeded 3–4); contract test for `jobScoped ∩ profileAllowed`.
- **Web:** `LearningTabClusterCard.tsx` (clusters, score, routing badge), score-breakdown popover over the now-populated axes, suppressed-noise drawer.

**Acceptance:** the tab shows scored clusters, not a flat noisy list; the sweep consumes ranked-to-budget input; near-dup `remember` calls reinforce instead of inserting.

## Verification & exit criteria

- `npm run build --workspace=packages/core` → `npm run build:api` → `npm run build:web` succeed (new core contracts + provider-UI fields).
- `npm run test:api` + `npm run test:unit:web` green for all new/changed specs (run targeted specs during iteration; full suite before PR).
- `npm run lint:api` / `npm run lint:web` clean — **no** `eslint-disable`/`@ts-ignore`.
- Integration specs that run migrations pass against the pgvector image.
- **Manual smoke (live stack):** rebuild with the pgvector image → `vector` extension present → **with no embedding model configured, confirm zero `memory_embeddings` rows and zero provider calls while the loop still works (lexical/recency)** → add a custom embedding provider + flag the default model **from /providers** → backfill runs → a fresh memory is embedded → injection returns task-relevant memories (toggle `memory_retrieval_mode` to compare) → **switch the active model to a different dimension and confirm a clean re-embed with no migration** → the 26 `ambiguous_failure` rows show as one cluster (`recurrence_count: 26`).
- Update `docs/guide/35-memory-learning.md` (embedding config in /providers, the `memory_embeddings` model, hybrid retrieval, model-switch flow) and the guide image references in Task 1; update the EPIC-212 progress table.

## Settings introduced (Phase 1)

> Embedding configuration lives in `llm_providers`/`llm_models` (frontend-managed) — **not** in `system_settings`. The active model + its dimension come from the `default_for_embedding` row, and **its existence is the enable signal** (no separate on/off flag, no seeded default).

| Setting                               | Default  | Purpose                                                                                                |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `memory_retrieval_mode`               | `hybrid` | `recency` (old) \| `hybrid` (vector recall). No-op until a model is configured (falls back to recency) |
| `candidate_similarity_threshold`      | `0.85`   | Cosine threshold for near-dup/cluster collapse                                                         |
| `memory_embedding_reindex_batch_size` | `200`    | Re-embed batch size on a model switch                                                                  |

## Rollback

- Set `memory_retrieval_mode=recency` to restore recency-truncated injection; **un-flag `default_for_embedding` (or deactivate the embedding model) in /providers** to stop all provider calls (similarity/clustering fall back to lexical and the loop still functions) — the config is the kill-switch.
- The DB image swap is the only non-trivial revert: PG major is unchanged so the volume is compatible both ways, but **snapshot before first deploy**. `memory_embeddings` + the `vector` extension + the `llm_models` columns are additive (a down-migration drops the table/columns; the extension can stay).
