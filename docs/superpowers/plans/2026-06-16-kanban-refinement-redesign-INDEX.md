# Kanban Refinement & Planning Redesign — Implementation Plan Index

> **Source design:** `docs/superpowers/specs/2026-06-16-kanban-refinement-planning-redesign-design.md`

This redesign is split into four independently-shippable phases. Each phase has its own plan file and produces working, tested software on its own. Implement in order — later phases assume earlier ones have landed.

| Phase           | Plan file                                               | Goal                                                                                 | Risk                                             |
| --------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| 1 — Correctness | `2026-06-16-kanban-refinement-phase1-correctness.md`    | Split AC-coverage validation + umbrella-parent auto-resolution                       | Low — pure bug-closing, no routing/effort change |
| 2 — Efficiency  | `2026-06-16-kanban-refinement-phase2-adaptive.md`       | Hybrid triage → adaptive refinement depth + live `risk_level` + mode-aware plan-gate | Medium — changes refinement control flow         |
| 3 — Contention  | `2026-06-16-kanban-refinement-phase3-reconciliation.md` | Cross-item `target_files` overlap detection in dispatch                              | Low–Medium — dispatch sequencing                 |
| 4 — Learning    | `2026-06-16-kanban-refinement-phase4-feedback.md`       | QA-rejection feedback loop into triage + refinement context                          | Medium — new aggregation surface                 |

## Conventions for all phases

- **TDD:** Red → Green → Refactor. Write the failing test, run it to confirm it fails, implement minimally, run to confirm pass, commit.
- **Build order:** `npm run build --workspace=packages/core` and `--workspace=packages/kanban-contracts` before kanban when contracts change.
- **Kanban tests:** `npm run test:kanban` (Vitest). Target a single file with `npm run test --workspace=apps/kanban -- <path>`.
- **Seed validation:** `npm run validate:seed-data` after any workflow YAML change.
- **Boundary rule:** all of this is Kanban-owned. Do **not** add work-item/kanban domain terms to `apps/api` or `packages/core`. New tools, workflows, and services live in `apps/kanban`, `packages/kanban-contracts`, or `seed/workflows`.
- **Lint:** never suppress. `npm run lint:kanban` must pass.

## Cross-phase decisions (locked)

- Umbrella parent resolves to **`done`** (it carries no branch/merge artifact of its own). Documented in Phase 1.
- Triage tracks: `trivial | standard | complex` (the `large` track is handled upstream by the existing split workflow before refinement).
- Stage-4 plan-gate fires only when `risk_level == "high"` **and** orchestration mode `!= autonomous`.
