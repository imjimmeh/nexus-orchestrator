# EPIC-208: CEO-Driven Strategic Refresh Loop

**Epic ID:** EPIC-208
**Status:** Proposed
**Priority:** P1
**Theme:** Continuous Strategic Planning, Long-Term Roadmap, Backlog Replenishment & Grooming
**Created:** 2026-06-12
**Depends On:** EPIC-046 (Autonomous Project Orchestrator), EPIC-059 / EPIC-061 (Project Goals First-Class & Agent-Driven), EPIC-151 (Kanban Project/Work-Item/Goals Source of Truth), EPIC-203 (Conversational Project Onboarding & Charter), EPIC-138 (Imported-Repository Reality Mapping)
**Soft Depends On:** EPIC-058 (CEO Context Continuity on Restart), EPIC-164 (Imported-Repo Backlog Reconciliation), EPIC-165 (Autonomous Human-Decision Policy)

**Detailed design:** `docs/superpowers/specs/2026-06-12-strategic-refresh-loop-design.md`

---

## 1. Context

The Nexus orchestration lifecycle is **excellent at executing a known backlog** but has **no continuous strategic refresh loop**. Discovery, charter capture, and ideation are all _front-loaded_ — they run hard at onboarding and then go quiet — while the execution cycle (`project-orchestration-cycle-ceo`) runs indefinitely. Three concrete consequences:

1. **Discovery is one-and-done.** It fires once on `ProjectOrchestrationStartedEvent`, is explicitly guarded against re-running, and has **no cron**. Its artifacts — `CAPABILITY_MAP.md`, `ARCHITECTURE.md`, `CODEBASE_HEALTH.md` — are written once and then drift. After N merged work items the "what we have" picture still reflects day one.

2. **Ideation is reactive and starved, not strategic.** `project-goal-backlog-planning` (run by the `product-manager` agent) exists, but the CEO only fires `delegate_goal_backlog_planning` under a narrow last-resort mandate (`todo_count == 0` **and** backlog effectively empty **and** unmet goals exist). It produces only **1–3 items** per run. It is an _empty-board rescue_, not a recurring "what are the best next features" rhythm — and it dedups against the _stale_ capability map, so the "have vs. want" gap analysis is doubly weak.

3. **The charter doesn't drive decisions.** The charter is auto-rendered from `memory_segments` + goals but injected into **zero** runtime prompts — agents must self-fetch via `read` / `query_memory`. Critically, the orchestration cycle's `decide.md` never loads it. Strategic decisions happen without vision, non-goals, success-criteria, or preferences in context.

There is also **no planning altitude** between flat `goals` and flat `work items` — nowhere to hold "themes / initiatives / what we're focusing on this horizon," and nowhere for the CEO to record _long-term_ planning intent that persists across cycles.

These are not three separate holes — they are **one missing loop**: nothing continuously _re-perceives_ state, _re-thinks_ priorities against the charter, and _replenishes_ the backlog proactively.

### What already exists (we build on it, not around it)

- **Orchestration cycle:** `project-orchestration-cycle-ceo.workflow.yaml` (`ceo-agent`, two prompt files `cycle.md` → `decide.md`), event-driven on `ProjectOrchestrationCycleRequestedEvent`, `max_runs:1` / `on_conflict:skip`.
- **Durable delegation:** the CEO's `delegate_*` projected tools launch workflows and **durably await** their results (EPIC-170 / durable-await infra), resuming the CEO with results in context.
- **Discovery workflows:** `project-discovery-ceo`, `project-codebase-deep-investigation`, `imported-repo-synthesis-and-hydration` — produce `docs/project-context/*`.
- **Ideation:** `project-goal-backlog-planning` + `product-manager` agent.
- **Charter & goals:** `KanbanProjectGoalEntity`, `memory_segments` (project-scoped), `record_project_memory`, auto-rendered `CHARTER.md` (EPIC-203).
- **Timeline continuity:** `kanban.orchestration_timeline` — already "source of truth for persistent session state" (EPIC-058).

### Target State

- A **two-phase CEO cycle**: a guaranteed **Strategize** beat (perceive → re-think → groom → replenish → record intent) followed by the existing **Dispatch** beat.
- A structured **initiative** layer between goals and work items (horizons, priorities, status, goal links, work-item linkage).
- **Staleness awareness** surfaced to the CEO so it _judges_ when to delegate refresh — not a dumb refresh tool, not a cron.
- **Continuity** via durable strategic intent the CEO writes and re-reads each cycle.
- A **merge heartbeat** (`WorkItemMergeCompletedEvent → ProjectOrchestrationCycleRequestedEvent`) keeping the loop "constant" without wall-clock scheduling.
- The **charter finally injected** into the strategic decision context.

---

## 2. Design Pillars

| Pillar                          | Mechanism                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Backlog never starves**       | Strategize forecasts starvation (backlog depth vs. burn rate) and proactively delegates ideation _ahead_ of an empty board, scoped to the active "now" initiative. |
| **"Have vs. want" stays fresh** | CEO perceives staleness signals (`lastDiscoveryAt` + merges/commits since) and delegates a **delta-aware re-discovery** when the capability map has drifted.       |
| **Charter drives decisions**    | Strategize loads charter (vision / non-goals / success-criteria / preferences) into context; the CEO may also adjust charter & initiatives as reality evolves.     |
| **Long-term planning**          | New `initiative` entity holds the roadmap; a dedicated roadmap-planning pass maintains horizons/priorities independent of short-term backlog churn.                |
| **CEO-driven, constant**        | Everything routes through the CEO cycle (no separate strategist loop/cron); the merge heartbeat + human trigger keep it turning.                                   |

---

## 3. The Initiative Layer (new planning altitude)

Project-domain, so it lives **kanban-side** (`apps/kanban`, `packages/kanban-contracts`, `packages/kanban-mcp`), consistent with the core/kanban boundary.

```
goals (existing)            ── why we're building
  ▲  many-to-many
  │
kanban_initiatives (NEW)    ── what we're focusing on, and when
  id, scope_id, title, description
  horizon  ∈ now | next | later
  priority int
  status   ∈ proposed | active | paused | done | dropped
  last_reviewed_at, created_at, updated_at
  │  one-to-many
  ▼
work_items (existing, + nullable initiative_id)  ── how we deliver
```

---

## 4. Two-Phase Cycle (Strategize → Dispatch)

Same `ceo-agent`, same job, two steps sharing the session:

1. **`strategize`** (new prompt) — loads staleness signals + charter + initiatives + prior strategic intent + recent timeline. Reasons explicitly: _did the last turns move us toward the active initiatives? does the backlog support the "now" horizon? what's stale?_ Then delegates specialist passes (awaiting), grooms directly (re-prioritise / defer / split / link work↔initiative), adjusts initiatives & charter, **records strategic intent**, and hands a groomed board to Dispatch.
2. **`dispatch`** (existing `decide.md`, slimmed to tactical) — the proven promote / lifecycle-start mandate, reading the groomed board.

The split makes the strategic beat **structurally unskippable** under tactical pressure — the root cause of today's "only ideate when desperate" behaviour.

---

## 5. Specialist Passes (CEO delegates → durably awaits → synthesizes)

| Pass                              | Build                                                                            | Delegated when CEO judges…                 | Tool                             |
| --------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------- |
| Re-discovery / capability refresh | **Generalize** existing investigation workflow with a delta-aware `refresh` mode | capability map stale vs. merges since scan | `delegate_rediscovery`           |
| Charter refinement                | Exists (`project-charter-ceo` refine mode)                                       | reality drifted from charter               | `delegate_charter_refinement`    |
| Roadmap / initiative planning     | **NEW** workflow + strategist profile                                            | horizons stale or goals lack initiatives   | `delegate_roadmap_planning`      |
| Backlog ideation                  | Exists (`project-goal-backlog-planning`), prompt extended to be initiative-aware | backlog thin for the "now" horizon         | `delegate_goal_backlog_planning` |

The CEO does **light grooming directly** (cheap, no research); it **delegates heavy/research-intensive** passes so its own turn stays cheap.

---

## 6. Phased Delivery

Epic-sized; each phase ships independently and has its own implementation plan (`docs/plans/`).

| Phase | Scope                                                                                                               | Outcome                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **1** | Initiative entity, migration, kanban tools, work-item linkage, `project_state` surfacing                            | New altitude exists; no behaviour change           |
| **2** | Staleness signals + strategic-intent continuity in `project_state` / timeline                                       | CEO can _perceive_ staleness & recall prior intent |
| **3** | Two-phase cycle (`strategize`/`dispatch`), charter-in-context, light grooming, record intent, merge→cycle heartbeat | The loop turns; strategy guaranteed each cycle     |
| **4** | Generalize discovery → delta-aware `refresh` mode + `delegate_rediscovery`                                          | "Have vs. want" stays fresh                        |
| **5** | Roadmap-planning workflow + `delegate_roadmap_planning`; initiative-aware ideation                                  | Long-term planning + proactive replenishment       |
| **6** | `delegate_charter_refinement` + drift detection                                                                     | Charter self-readjusts as reality evolves          |

---

## 7. Boundary & Quality

- **Core/Kanban boundary:** initiative entity, tools, and strategic-intent storage are kanban-domain; projected delegation tools stay neutral (`scopeId`/`scope_id` only). No Kanban identifiers leak into API/core.
- **TDD:** entity/service/tool unit tests → workflow-contract tests (Strategize must produce intent + groom decision; Dispatch behaviour preserved) → e2e of a stale-board cycle that delegates the right passes then dispatches.
- **No lint suppression**; documentation updated in `docs/guide`.

---

## 8. Risks & Open Questions

- **Token cost:** two CEO turns per cycle + delegated passes. Mitigated by light-grooming-direct / heavy-delegate split and staleness-gated delegation (only when signals warrant).
- **Heartbeat storms:** rapid merges could fan out many cycles; `max_runs:1` / `on_conflict:skip` already coalesces, but verify under burst.
- **Initiative ↔ goal cardinality:** join table (chosen) vs. array — see detailed design §2.
- **Strategic-intent store:** reuse orchestration timeline (chosen) vs. dedicated table — see detailed design §6.

---

## 9. References

**Detailed design:** `docs/superpowers/specs/2026-06-12-strategic-refresh-loop-design.md`

**Integration points:**

- `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml` + `seed/workflows/prompts/project-orchestration-cycle-ceo/{cycle,decide}.md`
- `seed/agents/ceo-agent/{agent.json,PROMPT.md}`
- `seed/workflows/project-goal-backlog-planning.workflow.yaml` + `seed/workflows/prompts/project-goal-backlog-planning/research-and-ideate.md`
- `seed/workflows/project-codebase-deep-investigation.workflow.yaml`, `project-discovery-ceo.workflow.yaml`
- `apps/kanban/src/mcp/tools/` (read + mutation tool patterns), `apps/kanban/src/project/` (charter/goals services)
- Event wiring for `WorkItemMergeCompletedEvent → ProjectOrchestrationCycleRequestedEvent`
