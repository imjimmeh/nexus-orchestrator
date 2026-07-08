# ADR-20260627: Refinement Routing Restoration

**Status:** Accepted
**Date:** 2026-06-27
**Author:** feat/refinement-routing-restoration

## Context

The `refinement` consumer pipeline (`work_item_refinement_default` and
`work_item_split_default` workflows) has been intact since the initial kanban
implementation. Both workflows subscribe to `kanban.work_item.status_changed.v1`
with `trigger.status == "refinement"` and fire whenever an item enters the
`refinement` lane.

However, the original _producer_ of `refinement` entries was deleted during the
kanban ownership cutover on 2026-06-11. Since that date the consumer pipeline
has been fully operational but structurally starved — no new items have entered
`refinement` via any automated path. The only way to put an item in `refinement`
was an explicit manual status change.

### Prior producer pattern

Before the cutover, a preflight settings block in the dispatch or transition
path evaluated per-item conditions and rerouted eligible items to `refinement`.
The settings keys (`work_item_preflight_*`) remained in configuration as dead
references after the code was removed.

### Why restore it now

Three requirements drove the restoration:

1. **Scope validation before implementation**: Large or under-specified items
   benefit from automated planning before an agent starts executing. Without
   refinement, items go straight to `in-progress` regardless of their readiness.

2. **Auto-split path**: The `work_item_split_default` workflow can only run on
   items that have entered `refinement`. Large items reaching `in-progress`
   directly either fail or produce incomplete work.

3. **Backward compatibility with legacy items**: `todo` items accumulated during
   the starved period were never refined. A dispatch-time safety-net can
   retroactively route them through refinement without requiring a one-off
   migration or manual intervention.

## Decision

Restore refinement producers as two deterministic, opt-in gates backed by
kanban settings — both defaulting to `false` so existing projects are unaffected
until they opt in.

### Gate 1: Promotion reroute (`work_item_preflight_pipeline_enabled`)

**Where:** `WorkItemTransitionStatusTool` (`apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.ts`)

**Logic:** On any `backlog → todo` transition request, call `resolvePromotionReroute`
(in `apps/kanban/src/work-item/work-item-preflight-routing.helper.ts`). If the
item has never cleared refinement (`metadata.refinement.hasClearedRefinementOnce`
is not `true`) and the setting is enabled, rewrite the effective target status
to `"refinement"`. The status-changed event fires for `refinement`, triggering
the consumer pipeline transparently. The caller (e.g. CEO agent) receives a
successful response; the reroute is an implementation detail.

**Loop-guard:** `hasClearedRefinementOnce` is checked by the helper before
rerouting. Items that have already cleared refinement pass through to `todo`
normally.

### Gate 2: Dispatch safety-net (`work_item_preflight_required`)

**Where:** `dispatchWorkItems` core function (`apps/kanban/src/dispatch/dispatch-work-items.core.ts`)

**Logic:** Before launching any `todo` candidate, call `shouldGateDispatchToRefinement`.
If the setting is enabled and the item has never cleared refinement, call
`WorkItemService.updateStatus` to transition to `refinement` and record the
item in `result.skipped` with reason `refinement_required`. The next CEO/dispatch
cycle will see the item in `refinement` (or back in `todo` after refinement
completes) and proceed normally.

This gate acts as a retroactive backstop for items that reached `todo` before
Gate 1 was enabled, and for items promoted via direct API calls that bypass the
MCP tool.

### CEO discretionary path

The CEO agent retains the ability to call
`kanban.work_item_transition_status` with `status: "refinement"` directly for
any item it judges under-specified. This path requires no settings and is
always available. CEO prompts were updated in Task 4 to permit both refinement
transitions and backward moves (e.g. `todo → refinement`).

### Loop-guard mechanism

`metadata.refinement.hasClearedRefinementOnce` is the single source of truth
for "this item has passed refinement". The refinement workflow sets this flag
on successful completion. Both gates check it before rerouting. Split children
(produced by `work_item_split_default`) start as new `backlog` items with no
flag set, so they go through refinement independently.

## Consequences

### Positive

- The refinement consumer pipeline is unblocked without any schema changes.
- Both gates are opt-in (`default: false`), so existing projects continue
  without disruption until they explicitly enable refinement routing.
- The loop-guard prevents re-refinement of already-refined items regardless of
  which gate fires.
- Large items now reliably reach `work_item_split_default` because they enter
  `refinement` before dispatch.
- The implementation is pure business logic in helper functions with no new
  NestJS providers, making it straightforward to unit test and easy to revert.

### Risks and mitigations

| Risk                                                                                                               | Mitigation                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy un-refined `todo` items bounce to `refinement` on first dispatch with `work_item_preflight_required = true` | One-time, per-item bounce; items re-enter `todo` after refinement completes. No items are lost.                                                                   |
| CEO agent unaware of reroute sets item to `todo` again immediately                                                 | CEO prompts updated to expect rerouting; additionally the loop-guard prevents a second reroute once the refinement is cleared.                                    |
| Split children re-split indefinitely                                                                               | `work_item_split_default` condition gates on `scope == "large"`; children are created as `standard` scope.                                                        |
| Settings keys left as dead config if both gates are disabled                                                       | Both settings have well-defined defaults (`false`) and are read via `KanbanSettingsService.getBoolean`, which returns `false` when absent. No dead-config hazard. |

## Related

- `docs/guide/22-kanban-lifecycle.md` — updated with producer/consumer summary and how-to-enable table
- `.agents/skills/kanban-work-item-lifecycle/SKILL.md` — updated with "Producers of `refinement`" section
- `apps/kanban/src/work-item/work-item-preflight-routing.helper.ts` — gate logic (Tasks 1–3)
- `apps/kanban/src/mcp/tools/mutation/work-item-transition-status.tool.ts` — Gate 1 integration (Task 2)
- `apps/kanban/src/dispatch/dispatch-work-items.core.ts` — Gate 2 integration (Task 3)
