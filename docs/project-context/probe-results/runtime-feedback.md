---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: runtime-feedback
outcome: success
inferred_status: implemented
confidence_score: 0.97
evidence_refs:
  - apps/api/src/runtime-feedback/runtime-feedback.module.ts
  - apps/api/src/runtime-feedback/runtime-feedback.controller.ts
  - apps/api/src/runtime-feedback/runtime-feedback.controller.spec.ts
  - apps/api/src/runtime-feedback/runtime-feedback-ingestion.service.ts
  - apps/api/src/runtime-feedback/runtime-feedback-ingestion.service.spec.ts
  - apps/api/src/runtime-feedback/runtime-feedback-policy.service.ts
  - apps/api/src/runtime-feedback/runtime-feedback-policy.service.spec.ts
  - apps/api/src/runtime-feedback/runtime-feedback-redaction.service.ts
  - apps/api/src/runtime-feedback/runtime-feedback-redaction.service.spec.ts
  - apps/api/src/runtime-feedback/runtime-feedback-diagnostics.service.ts
  - apps/api/src/runtime-feedback/runtime-feedback-diagnostics.service.spec.ts
  - apps/api/src/runtime-feedback/runtime-feedback.integration.spec.ts
  - apps/api/src/runtime-feedback/runtime-feedback.types.ts
  - packages/core/src/schemas/memory/runtime-feedback.schema.ts
  - apps/api/src/runtime/database/entities/runtime-feedback-signal-group.entity.ts
  - apps/api/src/database/migrations/20260517100000-create-runtime-feedback-signal-groups.ts
  - apps/api/src/database/migrations/20260517110000-add-runtime-feedback-window-state.ts
  - apps/api/src/tool-runtime/tool-contract-repair.adapter.ts
  - docs/plans/2026-05-17-epic-179-runtime-feedback-closeout.md
  - docs/plans/2026-05-17-epic-180-repair-policy-autonomy-diagnostics-implementation.md
source_paths:
  - apps/api/src/runtime-feedback/
  - apps/api/src/runtime/database/entities/runtime-feedback-signal-group.entity.ts
  - apps/api/src/runtime/database/repositories/runtime-feedback-signal-group.repository.ts
  - apps/api/src/database/migrations/20260517100000-create-runtime-feedback-signal-groups.ts
  - apps/api/src/database/migrations/20260517110000-add-runtime-feedback-window-state.ts
  - packages/core/src/schemas/memory/runtime-feedback.schema.ts
  - apps/api/src/tool-runtime/tool-contract-repair.adapter.ts
  - apps/api/src/workflow/workflow-repair/workflow-failure-classification.service.ts
  - apps/api/src/app.module.ts
updated_at: 2026-07-02T00:00:00.000Z
---

# Probe Result: Runtime Feedback Capability Module (NEW)

## Narrative Summary

The `apps/api/src/runtime-feedback/` module is fully implemented end-to-end and serves as the API-side capability for ingesting normalized runtime feedback signals, deduplicating them into persisted groups via a `runtime_feedback_signal_groups` table, applying a conservative promotion policy, and creating `learning_candidates` of type `runtime_feedback` once enough signals accumulate. The module exposes a read-only `GET /runtime-feedback/diagnostics` endpoint (JWT-guarded, Zod-validated query) that returns sparse aggregate counts and recent groups, and it deliberately does **not** expose signal ingestion via HTTP — producers are internal services that depend on `RuntimeFeedbackIngestionService` directly. Persistence, schema, and policy are tightly coupled to the shared contract in `packages/core/src/schemas/memory/runtime-feedback.schema.ts`. Coverage is strong: every service and the controller has a dedicated `*.spec.ts`, plus a high-fidelity in-memory integration test that wires the module together with `ToolContractRepairAdapter` and `WorkflowFailureClassificationService`. Although the directory header advertises "Runtime Feedback Capability Module (NEW)", in-tree planning docs (EPIC-179 / EPIC-180, dated 2026-05-17) describe the implementation as closed out; this is a mature module, not greenfield work.

## Capability Updates

- **Module wiring.** `RuntimeFeedbackModule` imports `AuthModule`, `DatabaseModule`, `ObservabilityModule`; registers the four services + the controller; and re-exports `RuntimeFeedbackIngestionService` and `RuntimeFeedbackRedactionService` so producer modules can consume them. It is registered in `apps/api/src/app.module.ts` and is imported by:
  - `apps/api/src/tool-runtime/tool-runtime.module.ts` (consumes `RuntimeFeedbackIngestionService` via `ToolContractRepairAdapter`)
  - `apps/api/src/workflow/workflow-step-execution/workflow-step-execution.module.ts`
  - `apps/api/src/workflow/workflow-repair/workflow-repair.module.ts` (consumes via `WorkflowFailureClassificationService`)
  - `apps/api/src/workflow/workflow-retrospective/workflow-retrospective.module.ts`

- **Signal contract.** `runtimeFeedbackSignalSchema` in `@nexus/core` defines a strict Zod object with typed `signal_type` (six-value enum: `tool_contract_repair`, `failure_classification`, `repair_outcome`, `workflow_anomaly`, `review_qa_finding`, `memory_miss`), `severity` (`low|medium|high|critical`), `confidence` (0..1), SHA-able `dedupe_fingerprint` (8..512 chars), and constrained `evidence` (1..20 items) / `examples` (≤10, must be pre-marked `redacted:true`). Diagnostics query schema re-uses `runtimeFeedbackSignalTypeSchema` for filtering.

- **Ingestion pipeline (`RuntimeFeedbackIngestionService`).** `ingest(rawSignal)` parses via Zod, SHA-256-hashes the dedupe fingerprint, and walks: (1) upsert group via `findByFingerprint` + `createGroup`/`incrementOccurrence` with a `23505` race fallback that re-loads and updates instead of overwriting; (2) `policy.evaluate(...)` decides promotion; (3) on skip, calls `updateSkippedMetadataIfCandidateMissing` (which is a no-op once a group is candidate-linked) and emits a `runtime.feedback.signal_skipped` event; (4) on promote, creates a `learning_candidate` (`RUNTIME_FEEDBACK_CANDIDATE_TYPE='runtime_feedback'`, status `pending`, `recurrence_count` = group occurrence) and, on unique-violation, links to the existing candidate via `candidates.findByFingerprint`; (5) emits `runtime.feedback.candidate_created` plus per-signal `runtime.feedback.signal_ingested` events into `EventLedgerService.emitBestEffort`. All payloads contain the SHA-256 fingerprint hash (never raw text), and `signals_json` / `diagnostics_json` are redacted before they leave ingestion. The ingestion service is the only place the API creates `runtime_feedback` candidates — producers only emit signals.

- **Policy (`RuntimeFeedbackPolicyService`).** Pure / stateless `evaluate(...)` with documented thresholds (`MIN_CONFIDENCE=0.75`, `MIN_OCCURRENCES=3`, `AGGREGATION_WINDOW_MS=7d`, `COOLDOWN_MS=7d`); decision precedence is `candidate_exists` → `cooldown_active` → `confidence_below_threshold` → `frequency_window_expired` (resets window) → `frequency_below_threshold` → promote. Severity `critical` or `high` overrides both the window-expiry and minimum-occurrence gates. Result types (`promote`, `skippedReason`, `cooldownUntil`, `resetWindow`) are exported via `RuntimeFeedbackPromotionDecision`.

- **Redaction (`RuntimeFeedbackRedactionService`).** Case-insensitive regex masks summaries that match `api[-_]key|access[-_]token|credential|bearer|secret|password|authorization` or `raw\s+transcript|transcript\s+body|full\s+transcript|raw\s+job\s+output|job\s+output\s*:|job-output`. Summaries over 500 chars are truncated with an ellipsis. Examples are returned with `redacted:true` stamped on each entry.

- **Diagnostics (`RuntimeFeedbackDiagnosticsService` + controller).** Read-only `GET /runtime-feedback/diagnostics` returns `{total, limit, offset, signalCounts, candidateCounts, skippedReasonCounts, recentGroups}`. Query schema (Zod) accepts optional `signalType` (enum-validated), optional `candidateCreated` (boolean with `'true'/'false'` string coercion), `limit` (1..100, default 20), `offset` (≥0, default 0). JWT-guarded. Response explicitly projects away `evidence_json` / `examples_json` / `diagnostics_json` so the API never leaks raw signal content.

- **Persistence.** `runtime_feedback_signal_groups` (UUID PK, unique fingerprint index, `(signal_type, scope_type, scope_id)` composite index, `candidate_id` index) is created by migration `20260517100000`; window-state columns (`window_occurrence_count`, `window_started_at`) are added in `20260517110000`. Repository exposes `findByFingerprint`, `createGroup`, `incrementOccurrence`, `updateGroup`, `updateSkippedMetadataIfCandidateMissing`, `listDiagnostics`, `listDiagnosticCounts`. Entity lives in `apps/api/src/runtime/database/entities/runtime-feedback-signal-group.entity.ts`.

- **Producers (out of scope but referenced).** `ToolContractRepairAdapter.repair(...)` and `WorkflowFailureClassificationService.classifyRunFailure(...)` are the in-tree producers that call `RuntimeFeedbackIngestionService.ingest(...)`. EPIC-179 closeout explicitly notes `review_qa_finding` and `memory_miss` are deferred contract-supplied types (no automatic producer yet); `workflow_anomaly` is being produced narrowly from output-contract retry exhaustion per EPIC-180.

- **Event observability.** `RUNTIME_FEEDBACK_EVENT_NAMES` in `runtime-feedback.types.ts` registers the three event-name constants (`signal_ingested`, `signal_skipped`, `candidate_created`). All events go through `EventLedgerService.emitBestEffort` with `domain: 'memory'` and best-effort error handling, and link via `workflowRunId` / `jobId` when present on the signal's `affected` block.

## Health Findings

- **Test coverage.** Excellent and well-structured:
  - `runtime-feedback.controller.spec.ts` — 4 tests covering delegation, schema validation, JwtAuthGuard metadata, route metadata.
  - `runtime-feedback-redaction.service.spec.ts` — `it.each` over representative secret/raw-output patterns, plus length truncation and example-stamping.
  - `runtime-feedback-policy.service.spec.ts` — 5 tests pinning every branch (low-confidence, low-frequency, severity override, cooldown, window expiry) against fixed `NOW`/`buildSignal` fixtures.
  - `runtime-feedback-diagnostics.service.spec.ts` — Nest `Test.createTestingModule`, verifies that internal fields (`evidence_json`, `examples_json`, `diagnostics_json`) are **not** projected into the response, and exercises optional filters.
  - `runtime-feedback-ingestion.service.spec.ts` — heavy 800+ line suite covering: skip path, group missing on update, candidate promotion on third signal, atomic incrementOccurrence delegation, unique-violation → existing candidate, SHA-256 fingerprint of long inputs, secret-safe diagnostics, window reset, redaction propagation, full event payload shape.
  - `runtime-feedback.integration.spec.ts` — in-memory `LearningCandidateRepository` and `RuntimeFeedbackSignalGroupRepository` doubles that faithfully implement create/find-by-fingerprint/upgrade/increment/skip-if-candidate semantics with the `23505` race; integrates `ToolContractRepairAdapter`, `WorkflowFailureClassificationService`, `RepairPolicyService`, `WorkflowFailureEvidenceCollectorService`; verifies candidate creation from tool-repair signals, failure-classification signals, low-confidence diagnostic-only path, and secret-safe `signals_json`.

- **Code quality.** Strict-mode Zod schemas (`strict()`), discriminated-enum severity gating, deterministic SHA-256 fingerprinting of arbitrarily long inputs (the spec asserts `^[a-f0-9]{64}$` on the resulting fingerprint, and tests assert the raw text never appears in candidate payloads or emitted event payloads). Pure-policy service (no NestJS DI dependencies beyond class-scoped). Constant exports (`MIN_CONFIDENCE`, `MIN_OCCURRENCES`, `AGGREGATION_WINDOW_MS`) make the gating policy auditable from one file.

- **API surface.** `RuntimeFeedbackController` is intentionally transport-only (delegates to `diagnostics.getDiagnostics`); service owns the projection logic. JWT guard is registered with `@UseGuards(JwtAuthGuard)` at controller level. Zod query validation via the existing `@ZodQuery` decorator and `ZodValidationPipe`.

- **Churn.** File timestamps cluster on 2026-05-19 (initial impl) with two updates on 2026-06-17 (post-closeout hardening: policy dedup, diagnostics DTO split into `.service.types.ts` + `.diagnostics.types.ts`) and one minor update on 2026-06-26 (module file). The two `.types.ts` files (`runtime-feedback-diagnostics.types.ts` vs. `runtime-feedback-diagnostics.service.types.ts`) duplicate the `RuntimeFeedbackDiagnosticsResponse` shape with a small drift (the `.diagnostics.types.ts` version is missing `windowOccurrenceCount` and `windowStartedAt` but includes `dedupeFingerprint`). Either is essentially identical for type inference from the schema — the controller and `*.integration.spec.ts` use the post-hardening schema-derived form via `.diagnostics.types.ts`; the `.service.types.ts` file appears unused. Worth a cleanup pass to delete the stale `.service.types.ts`.

- **Module boundary posture.** Module name ends with `(NEW)` in the prompt header, but on-disk code is feature-complete and integrated. Routing (`Controller`), provider list, exports, AppModule registration, and consumer module wiring all match AGENTS.md guidance (controllers are transport-only; service owns domain logic; JWT guard at controller; Zod-validated query DTO).

## Open Questions

- Is `runtime-feedback-diagnostics.service.types.ts` (the unused, slightly divergent copy of the response interface) slated for deletion? It does not appear to be imported anywhere; consumers use the schema-inferred type from `runtime-feedback-diagnostics.types.ts`.
- The diagnostic flow projects away evidence/examples/diagnostics_json, but operators still need a way to inspect why a particular group was skipped. There is no `GET /runtime-feedback/groups/:id` deep-dive endpoint, and the closeout plan does not call one out — was this intentionally out of scope, or still pending?
- `workflow_anomaly` has a narrow producer from output-contract retry exhaustion per EPIC-180 notes, but no in-tree file under `runtime-feedback/` references it. Confirm that the producer wiring lives in `workflow-step-execution` or `workflow-repair` rather than in the runtime-feedback module itself.
- The probe playbook referenced `kanban_project_state` / `kanban_orchestration_timeline` tools that are not part of the agent's available tooling in this run; the probe relied on direct file inspection only.
