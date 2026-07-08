# Configurable Orchestration via a Scoped Variable Store

- **Status:** Approved design (pre-implementation)
- **Date:** 2026-06-19
- **Author:** Jimmeh (with Claude)
- **Related:** `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`, `apps/api/src/workflow/state-manager.service.ts`, `apps/api/src/config-resolution/`, `apps/kanban/src/orchestration/`

## 1. Problem

Orchestration behavior in Nexus is effectively one-size-fits-all and buried in seed YAML and code:

- **Per-project behavior cannot differ** without editing seed workflows. Every project gets the same gate thresholds, the same backlog-generation behavior, the same autonomy.
- **Users cannot change it.** The knobs exist but live in hardcoded Handlebars conditions, a coarse `mode` column, agent profiles, and code — none of it editable without a redeploy.
- **It is not granular enough.** A single `autonomous` / `supervised` / `notifications_only` flag is the only autonomy lever. There is no way to be autonomous for dispatch but ask for approval on backlog promotion, or to tune when ideation fires.

We want orchestration to be **configurable per project, by a user, at a useful granularity** — and to generalize that mechanism so any workflow can read configurable values, not just the CEO cycle.

## 2. How it works today (constraints that shape the design)

Three facts established by code investigation:

1. **Gate metrics are computed in kanban, thresholds are hardcoded in YAML.**
   `ProjectStrategicStateService.buildStrategicState()` (`apps/kanban/src/orchestration/strategic/project-strategic-state.service.ts:43-96`) computes `mergesSinceDiscovery`, `activeNowInitiativeCount`, `recentBurnRatePerCycle`, `starvationForecastCycles`, surfaced via the `kanban.project_state` tool. The CEO workflow then evaluates gate conditions with **literal thresholds baked into the YAML**, e.g.:

   ```yaml
   condition: "{{#if (gte jobs.load_state.output.result.strategic.staleness.mergesSinceDiscovery 10)}}true{{else}}false{{/if}}"
   ```

2. **Autonomy is a single coarse flag, enforced in kanban.**
   `orchestration-run-request.service.ts` (`apps/kanban`) sets `orchestrationMode` (default `"supervised"`) and passes it into the workflow trigger input; the CEO YAML references `{{ inputs.autonomous_mode }}`. Enforcement lives in `HumanDecisionResolutionPolicy.selectPolicy()` (`apps/kanban/src/orchestration/human-decision-resolution-policy.service.ts:21-72`), which maps `orchestrationMode` → `decide_without_approval` / `ask_when_uncertain`. The mode is persisted on `KanbanOrchestrationEntity.mode`.

3. **Templating is Handlebars; there is no `vars` namespace.**
   `state-manager.service.ts::substituteTemplate()` (`apps/api`) compiles templates against a context of `state_variables` + `trigger` + `inputs` + `jobs`. `Workflow.overrides` (jsonb) and the `config-resolution/scoped-config-resolver.service.ts` are **not** in the render path today.

## 3. Core idea

Introduce **one** new mechanism: a generic, scoped **variable store** whose resolved values are injected into the workflow template context under a `vars` namespace. Every hardcoded orchestration knob becomes `{{ vars.* }}`. The "Orchestration Policy" is a **curated UI over a well-known subset of those keys** — not a separate system.

```
vars (global)                    vars (project override)
  gates.rediscovery_merge_threshold: 10   gates.rediscovery_merge_threshold: 5
  backlog.ideation_enabled: true          autonomy.dispatch: ask
  autonomy.dispatch: auto                 promotion.max_items_per_cycle: 3

CEO workflow YAML:
  condition: "{{#if (gte ...staleness.mergesSinceDiscovery vars.gates.rediscovery_merge_threshold)}}..."
  when:      "{{ vars.backlog.ideation_enabled }}"
```

## 4. Architecture

Four layers, each with a single owner. The split is deliberate to keep the core/kanban boundary intact.

| Layer                   | Owner                        | Responsibility                                                                                                                                                            |
| ----------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Variable store**      | `apps/api` + `packages/core` | Generic scoped typed key/value store (`global` + per-scope). Knows nothing about orchestration — keys, typed values, override layering only. Kanban-neutral.              |
| **Engine injection**    | `apps/api/src/workflow`      | At run launch, resolve effective `vars` for `trigger.scopeId`, snapshot into `state_variables.vars`, inject into the Handlebars context.                                  |
| **Policy key registry** | `packages/kanban-contracts`  | The curated schema: which well-known keys exist, their type, default, enum values, UI grouping, description. All orchestration _meaning_ lives here.                      |
| **UI**                  | `apps/web`                   | A generic **Variables** editor (global + project, raw) and a curated **Orchestration Policy** panel rendering the registry as toggles/sliders. Both write the same store. |

**Boundary rationale:** the API/core store is a dumb typed key-value map — it never learns a kanban concept (no `kanban`, work-item, or project-domain identifiers; satisfies `nexus-boundaries/no-core-kanban-residue`). All orchestration semantics (key names, defaults, enum constraints) live in `kanban-contracts`. Kanban enforcement consumes per-phase autonomy values **passed in via tool params** (the same path `orchestrationMode` travels today), so kanban never reaches into the API store.

## 5. Data model

New entity **`scoped_variables`** in `apps/api` (generic, Kanban-neutral):

| Column                      | Type                                     | Notes                                                                                                                                      |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                        | uuid                                     | PK                                                                                                                                         |
| `scope_node_id`             | uuid nullable                            | `NULL` = global; otherwise the project/scope node                                                                                          |
| `key`                       | varchar(128)                             | dotted key, e.g. `gates.rediscovery_merge_threshold`; validated against a key-format regex only (store layer enforces no domain semantics) |
| `value`                     | jsonb                                    | the value                                                                                                                                  |
| `value_type`                | enum(`string`,`number`,`boolean`,`json`) | drives coercion so numeric comparisons (`gte`/`lte`) get real numbers                                                                      |
| `source`                    | enum(`seeded`,`admin`)                   | provenance (file-based source deferred to a future phase)                                                                                  |
| `description`               | text nullable                            | optional free-form note                                                                                                                    |
| `created_by` / `updated_by` | varchar nullable                         | audit                                                                                                                                      |
| `created_at` / `updated_at` | timestamptz                              | audit                                                                                                                                      |

Indexes:

- Unique `(scope_node_id, key)`.
- Partial unique on `key WHERE scope_node_id IS NULL` (one global per key).

Entity/repository/migration follow the `adding-entity-migration` skill conventions (domain-local directory under the owning module, repository pattern, `DatabaseModule` registration).

## 6. Resolution semantics

`VariableResolverService.resolveEffective(scopeId)` returns a flat map `Record<string, { value, type, layer }>`:

1. Start from **global** variables (`scope_node_id IS NULL`).
2. Walk scope ancestry root → leaf (reuse the ancestry query pattern in `config-resolution/scoped-config-resolver.service.ts`), overlaying each layer. **Leaf wins.**
3. Override is **whole-key replacement**, not deep-merge — predictable and simple.
4. Each entry carries a `layer` trace (`global` | the scope node id) so the UI can show provenance.

Values are coerced by `value_type` at resolution so templates receive correctly-typed primitives.

## 7. Engine injection — snapshot at launch

At workflow run creation, the engine resolves effective vars for `trigger.scopeId`, coerces by `value_type`, and writes the map **once** into `state_variables.vars`. Templates read `{{ vars.* }}` from that snapshot via the existing `substituteTemplate` context.

**Decision: snapshot, not lazy-per-render.**

- A long-running cycle (or any multi-step run) sees a _consistent_ policy even if a variable is edited mid-run.
- The snapshot is captured in the run's `state_variables`, making the effective policy auditable per run.
- New values take effect on the **next** run/cycle — the correct granularity for orchestration.
- Lazy resolution was rejected: simpler to implement but introduces mid-run inconsistency and non-reproducible runs.

Runs launched without a `scopeId` (global/manual) resolve only the global layer.

## 8. Curated orchestration keys (initial set)

Seeded as **global** defaults; the registry (key → type, default, enum, group, description) lives in `packages/kanban-contracts`. Defaults preserve today's exact behavior.

| Key                                       | Type                    | Default                            | Replaces / controls                         |
| ----------------------------------------- | ----------------------- | ---------------------------------- | ------------------------------------------- |
| `autonomy.dispatch`                       | enum `auto`/`ask`/`off` | `auto`                             | dispatch side of coarse `autonomous_mode`   |
| `autonomy.backlog_promotion`              | enum `auto`/`ask`/`off` | `auto`                             | zero-todo backlog promotion mandate gating  |
| `autonomy.merge`                          | enum `auto`/`ask`       | `ask`                              | gated high-risk transitions                 |
| `backlog.bootstrap_enabled`               | boolean                 | `true`                             | whether bootstrap work-item generation runs |
| `backlog.ideation_enabled`                | boolean                 | `true`                             | ideation gate on/off                        |
| `gates.rediscovery_merge_threshold`       | number                  | `10`                               | hardcoded `10` in rediscovery gate          |
| `gates.roadmap_when_no_active_initiative` | boolean                 | `true`                             | roadmap-planning gate                       |
| `gates.ideation_starvation_cycles`        | number                  | `2`                                | hardcoded `<= 2` in ideation gate           |
| `promotion.max_items_per_cycle`           | number                  | `-1` (= unbounded; `0` = disabled) | promotion volume cap per cycle              |

This set is the initial curated surface; the store itself accepts arbitrary keys for general workflow use.

## 9. Migrating the existing `mode`

- The coarse `KanbanOrchestrationEntity.mode` (`autonomous` / `supervised` / `notifications_only`) becomes a **preset** in the curated UI: selecting it writes the three `autonomy.*` keys at once.
- **Per-key overrides win** over the preset.
- To avoid a dual source of truth, **kanban enforcement reads per-phase autonomy values passed in via tool params** (resolved from `vars` by the workflow and forwarded into the kanban tool call), exactly as `orchestrationMode` flows today. The `mode` column is **derived / retained for display only**.
- A migration seeds the global autonomy defaults and **backfills** existing projects' per-phase `autonomy.*` keys from their current `mode`.

## 10. Phasing

Three independently-shippable phases; each leaves the system working. Each becomes its own implementation-plan → execution cycle.

### Phase 1 — Foundation (keystone)

- `scoped_variables` entity + migration + repository.
- `VariableResolverService` (global + scope-ancestry overlay, typed coercion, layer trace).
- Engine injection: snapshot effective `vars` into `state_variables.vars` at launch; expose under `{{ vars.* }}`.
- REST CRUD for variables (global + per-scope) + a "resolve effective for scope" endpoint.
- Refactor the CEO workflow YAML: gate thresholds + backlog/ideation toggles → `{{ vars.* }}`, with seeded global defaults preserving today's exact values.
- **Net behavior change: zero** until someone edits a variable. This is the explicit Phase 1 acceptance bar.

### Phase 2 — Curated policy + autonomy per phase

- `kanban-contracts` policy-key registry (keys, types, defaults, enums, groups, descriptions).
- Per-phase autonomy: wire `HumanDecisionResolutionPolicy` / gated transitions to consume per-phase values via tool params; `mode` → derived/display-only; backfill migration.
- Web: generic **Variables** editor (global + project) and curated **Orchestration Policy** panel.

### Phase 3 — Polish (optional / later)

- Effective-config inspector in UI (layer trace: value from global vs project).
- Server-side validation of well-known keys against the registry on write.
- Audit history of variable changes.

**Explicitly out of scope:** file-based `.nexus/variables.yaml` GitOps sync (chosen authoring surfaces are Web UI + defaults/overrides). Deferrable to a later phase if desired; the `source` enum already reserves room for it.

## 11. Testing strategy

Per project TDD conventions (`testing-unit-patterns`, Vitest/NestJS):

- **Store + resolver (unit):** global-only resolution; project overlay overrides global; leaf-wins across multi-level ancestry; type coercion per `value_type`; layer-trace correctness; unknown key returns undefined.
- **Engine injection (unit/integration):** `vars` snapshot present in `state_variables` at launch; templates resolve `{{ vars.* }}`; mid-run edits do not affect an in-flight run; scopeless runs see only global.
- **CEO refactor (regression):** with seeded defaults, gate conditions evaluate identically to the hardcoded values (golden-path: thresholds 10 / 2, toggles true). A dry-run comparison before/after the YAML refactor proves zero behavior change.
- **Phase 2 enforcement:** per-phase autonomy param drives `HumanDecisionResolutionPolicy`; `mode` backfill migration produces the expected `autonomy.*` keys; preset write sets all three keys; per-key override beats preset.
- **API contract:** CRUD endpoints (global + scoped), effective-resolution endpoint, validation of key format and `value_type`.

## 12. Risks & mitigations

- **Behavior drift during CEO refactor.** Mitigation: seeded defaults equal current literals; regression dry-run comparison is a Phase 1 gate.
- **Dual source of truth for autonomy.** Mitigation: `mode` becomes derived/display-only; per-phase keys are authoritative; backfill migration.
- **Core/kanban boundary regression.** Mitigation: store + resolver carry no domain identifiers; registry lives in `kanban-contracts`; lint rule `nexus-boundaries/no-core-kanban-residue` guards it.
- **Typed-coercion bugs in Handlebars comparisons.** Mitigation: explicit `value_type` coercion at resolution + unit tests for numeric gates.
- **Snapshot staleness surprising users.** Mitigation: document "applies next cycle"; surface the snapshot in run detail (Phase 3 inspector).

## 13. Open questions (none blocking)

- Whether to expose a per-project "reset to global" affordance in the UI (Phase 2 nicety).
- ~~Whether `promotion.max_items_per_cycle = 0` should mean unbounded or disabled~~ — **resolved:** `0` = disabled, `-1` = unbounded, default `-1` (preserves today's uncapped behavior).
