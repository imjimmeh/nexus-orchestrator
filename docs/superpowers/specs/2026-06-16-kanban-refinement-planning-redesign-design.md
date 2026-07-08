# Kanban Refinement & Planning Redesign — Target-State Design

- **Date:** 2026-06-16
- **Status:** Approved design (pre-implementation)
- **Scope:** The refinement/planning tier of the Nexus kanban orchestration system — how work items are triaged, refined, split, validated, reconciled, and exited to `todo`. **Out of scope:** implementation execution (`in-progress` onward), the strategic CEO cycle internals (kept as-is).

## 1. Context

The current refinement/planning process is event-driven and agent-orchestrated across three tiers (strategic CEO cycle → per-item refinement/split → re-adjustment paths). The bones are strong: idempotent CEO cycle with concurrency gating, durable-await delegation, a multi-agent refinement pipeline, and structural plan validation (AC→task coverage, exact `target_files`, testable `verification`).

Investigation surfaced concrete gaps and inefficiencies:

| #   | Finding                                                                                                                            | Status            | Evidence                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------- |
| 1   | Umbrella parents never auto-resolve when all children reach `done` — they stay `blocked` forever                                   | **Confirmed gap** | `work-item-split-default.workflow.yaml:117-136`; EPIC-040 (_Not Started_)                   |
| 2   | Split AC-coverage is prompt-instruction only; a dropped parent AC is never detected                                                | **Confirmed gap** | `prompts/work-item-split-default/split.md:34-35`; no validator in code                      |
| 3   | `risk_level` is emitted, persisted, and passed to QA — but nothing branches on it (dead output)                                    | **Confirmed gap** | `work-item-refinement-default.workflow.yaml:200,256`; no conditional consumers              |
| 4   | Refinement is one-size-fits-all: ~5 heavy agents + war-room mesh for every standard item, regardless of triviality                 | Inefficiency      | `work-item-refinement-default.workflow.yaml` step sequence                                  |
| 5   | No cross-item plan reconciliation — concurrently-refined items can claim overlapping `target_files` → merge conflicts at execution | Inefficiency      | plans store exact `target_files`; no overlap check                                          |
| 6   | No planning feedback loop — QA rejection signal never flows back into refinement quality                                           | Opportunity       | `metadata.qaFeedback`, `executionConfig.rejectionFeedback` are write-only w.r.t. refinement |

## 2. Design Principles

1. **Effort proportional to risk/scope** — do not spend five heavy agents and a war-room on a trivial fix.
2. **No silent requirement loss** — validate AC coverage at _every_ decomposition boundary, not only within a single item.
3. **Every signal is consumed or not generated** — `risk_level` either drives routing or we stop emitting it.
4. **Plans meet reality before they cost execution tokens** — reconcile against the codebase and against other in-flight plans.
5. **Closed loops** — decomposition closes (umbrella auto-resolves); quality closes (rejections teach refinement).
6. **Reuse existing surfaces** — the supervised-mode approval queue already exists; the human plan-gate hooks into it rather than adding new HITL UI.

## 3. Target End-to-End Flow

### Stage 0 — Intake & Triage (NEW)

When an item transitions to `refinement`, a triage step assigns a **refinement track**: `trivial | standard | complex | large`.

- **Hybrid mechanism:** deterministic default (from `scope`, AC count, description size, touched-area hints, and the area's historical rejection rate from the feedback loop), with an LLM classifier consulted **only on ambiguity** (e.g., signals disagree or are borderline).
- The track is a _plan-of-plan_: it decides which downstream refinement steps run. This replaces today's "always run everything."

### Stage 1 — Decomposition (large / complex)

Split runs as today, but is now gated by a **coverage validation step** (cross-cutting B): the union of children's acceptance criteria must cover every parent AC. A dropped AC fails the step and re-prompts or flags. The parent then enters a _managed_ umbrella state (cross-cutting A).

### Stage 2 — Adaptive Refinement Pipeline (depth = track)

| Track      | Steps run                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `trivial`  | architect-lite only (implementation plan + subtask blueprint). Skip codebase-analysis, PM, war-room. |
| `standard` | codebase-analysis + architect + plan-validation. PM only if ACs flagged ambiguous; war-room skipped. |
| `complex`  | full pipeline including war-room.                                                                    |
| `large`    | routed via Stage 1 split first; children re-enter at their own track.                                |

**`risk_level` becomes live:** the architect can **escalate the track mid-refinement** ("riskier than triage thought") to add a war-room round and/or trigger the Stage 4 human plan-gate. This eliminates the dead-output problem.

### Stage 3 — Plan Validation + Reconciliation (ENHANCED)

- **Keep** today's structural validation: every AC covered by ≥1 task, exact `target_files` (no wildcards), independently-testable `verification`.
- **Add cross-item reconciliation** (cross-cutting D): check this plan's `target_files` against other in-flight/refined plans. Overlap → flag contention so the CEO/dispatch **sequences** the conflicting items rather than running them in parallel. Directly attacks the recurring file-contention / stale-branch / merge-conflict pain.

### Stage 4 — Exit to `todo` + Mode-Aware Risk Gate

On refinement exit, the `refinement → todo` transition is gated by `risk_level` **and** the project's orchestration mode:

| Mode                 | High-risk plan exit (`risk_level == high`)                                                                                  | Low/standard-risk exit                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `autonomous`         | Transition directly to `todo`                                                                                               | Transition directly                                      |
| `supervised`         | **HITL** — route the transition through the existing supervised approval queue (approve/reject in the pending-action panel) | Transition directly                                      |
| `notifications_only` | **HITL** — record the exit as a recommendation only; no auto-transition                                                     | Recorded per existing notifications-only mutation policy |

Only **high-risk** exits are gated, so supervised users are not drowned in approvals for routine items. The gate reuses the existing supervised approval machinery — no new human-in-the-loop UI is required.

> Mode reference: modes are `autonomous`, `supervised`, `notifications_only` (defined in `packages/kanban-contracts/src/orchestration.schema.ts`; stored on `kanban_orchestrations.mode`). There is no "disabled" mode — `notifications_only` is its equivalent.

## 4. Cross-Cutting Mechanisms

- **A. Umbrella lifecycle (EPIC-040):** a listener on child `kanban.work_item.status_changed.v1` events; when all children of a split parent reach `done`, re-check coverage and auto-transition the parent out of `blocked` (to `done` or `ready-to-merge`). Closes the "blocked forever" leak that also pollutes the CEO's staleness math.
- **B. Coverage validator:** one reusable AC-coverage check applied at **both** decomposition boundaries — `work_item_split_default` and the `materialize_split_children` path in `work_item_refinement_default`.
- **C. Risk router:** `triage track + risk_level` jointly decide which refinement steps run and whether the Stage 4 gate applies.
- **D. Plan reconciliation index:** a lightweight registry of `(item → target_files)` for in-flight/refined plans, queried during Stage 3 and at promotion.
- **E. Feedback loop:** QA rejections → categorized → (i) aggregate metrics, (ii) injected as "known failure patterns for this area" context into future refinement (codebase-analysis or architect step), (iii) bump high-rejection areas to a higher triage track in Stage 0.

## 5. What Stays Unchanged

- CEO `strategize → dispatch` cycle, concurrency/staleness gates, durable-await delegation.
- Event-driven status triggers via `WorkflowTriggerRegistryService`.
- Plan storage in `execution_config.implementationPlan`; `metadata.refinement` / `.split` / `.preflight` shape.
- The war-room mechanism itself — now invoked _conditionally_ by track/risk rather than always.

## 6. Phased Rollout

Each phase is independently shippable and de-risks the next.

1. **Phase 1 — Correctness:** coverage validator (B) + umbrella auto-resolution (A). Pure bug-closing, low risk; no behavioral change to effort or routing.
2. **Phase 2 — Efficiency:** intake & triage (Stage 0) + risk router (C) → adaptive refinement depth (Stage 2) + mode-aware Stage 4 gate. Biggest token-cost win; introduces `risk_level` consumption.
3. **Phase 3 — Contention:** plan reconciliation index (D) + Stage 3 enhancement.
4. **Phase 4 — Learning:** QA feedback loop (E), including its inputs back into Stage 0 triage.

## 7. Open Questions / Follow-ups

- Exact deterministic thresholds for triage tracks (AC count, description size, area churn) — to be tuned in Phase 2 design.
- Whether umbrella resolution targets `done` directly or `ready-to-merge` (depends on whether an umbrella ever carries its own merge artifact) — to be settled in Phase 1 design.
- Storage location for the plan reconciliation index (derived on read from in-flight plans vs. a materialized projection) — Phase 3 design.
- Retention/aggregation window for feedback-loop rejection metrics — Phase 4 design.

## 8. Decision Log

| Decision                | Choice                                                                          | Rationale                                                         |
| ----------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Triage mechanism        | Hybrid (deterministic default, LLM on ambiguity)                                | Avoids per-item LLM cost while handling edge cases                |
| Human plan-gate trigger | Mode-aware: HITL for `supervised` + `notifications_only`; none for `autonomous` | Matches existing mode semantics; reuses supervised approval queue |
| Gate scope              | High-risk exits only                                                            | Prevents approval fatigue in supervised mode                      |
| Rollout                 | Correctness → efficiency → contention → learning                                | Close silent-failure holes before optimizing                      |
