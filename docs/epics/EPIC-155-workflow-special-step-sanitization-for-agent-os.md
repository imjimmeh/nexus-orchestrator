# EPIC-155: Workflow Special-Step Sanitization for Agent OS

Status: Proposed
Priority: P0
Depends On: EPIC-153, EPIC-154
Related: EPIC-090, EPIC-121, EPIC-127, docs/analysis/2026-04-25-kanban-api-decoupling-plan.md
Last Updated: 2026-04-29

---

## 1. Summary

Remove kanban-owned mutation behavior from core workflow special steps. Core should provide generic workflow primitives such as event emission, HTTP webhook calls, and MCP tool calls. Kanban workflows should mutate project/work-item state through kanban-owned MCP tools or kanban HTTP APIs.

This epic removes `amend_entity` as a core kanban mutation bridge.

---

## 2. Current State Review

1. `apps/api/src/workflow/workflow-special-steps/step-amend-entity-special-step.handler.ts` has `owningDomain: 'kanban'` and requires `trigger.projectId`.
2. The amend-entity handler directly imports API work-item repositories, subtask repositories, project helpers, `WorkItemService`, and workflow steering services.
3. `apps/api/src/workflow/workflow-special-steps/step-emit-event-special-step.handler.ts` exists as a generic primitive.
4. No `http_webhook` or `mcp_tool_call` special-step handlers were found.
5. Seed workflows and validation tests still reference `amend_entity` as the canonical way to mutate kanban state.

---

## 3. Goals

1. Keep generic `emit_event` as a core primitive.
2. Add `http_webhook` as a generic outbound integration primitive if still needed after MCP migration.
3. Add `mcp_tool_call` as a generic workflow-to-tool primitive for non-agent special-step calls.
4. Replace kanban `amend_entity` workflow usage with kanban MCP tool calls or kanban-owned HTTP commands.
5. Remove amend-entity handler, validation, result modes, and core project dependencies after migration.
6. Keep core special steps domain-agnostic.

---

## 4. Non-Goals

1. Do not move workflow execution out of core.
2. Do not let workflows write kanban database rows directly.
3. Do not add bespoke special steps for each kanban action.
4. Do not remove seeded kanban workflows without replacing their behavior.

---

## 5. High-Level Work

1. Define input and output contracts for `http_webhook` and `mcp_tool_call` special steps.
2. Implement validation and execution for the new generic special steps behind `WorkflowSpecialStepsModule`.
3. Add policy controls for allowed outbound URLs and allowed MCP servers/tools.
4. Update seed workflows to replace `amend_entity` with kanban MCP tool calls or kanban HTTP commands.
5. Update workflow dry-run and validation logic to understand the new primitives.
6. Remove `StepAmendEntitySpecialStepHandler` and its helper/service dependencies after seed workflows no longer use it.
7. Remove amend-entity result modes and type declarations from shared workflow legacy types.
8. Add regression tests proving old kanban lifecycle behavior still works through the new seam.

---

## 6. Deliverables

1. Generic `http_webhook` special-step handler if selected for implementation.
2. Generic `mcp_tool_call` special-step handler.
3. Updated seeded kanban workflows with no `amend_entity` jobs.
4. Removed core amend-entity handler and kanban mutation helpers.
5. Validation and runtime tests for generic special-step primitives.

---

## 7. Acceptance Criteria

1. Core special-step handlers do not import project, work-item, goals, war-room, or kanban services.
2. No seeded workflow uses `amend_entity`.
3. Kanban workflow mutations go through kanban-owned APIs or MCP tools.
4. `http_webhook` and `mcp_tool_call` have explicit policy and audit coverage.
5. `WorkflowSpecialStepsModule` remains domain-agnostic.

---

## 8. Suggested Quality Gates

1. `npm run test:api`
2. `npm run validate:seed-data`
3. `npm run test:kanban`
4. Seed workflow dry-run tests.
5. Import-boundary tests proving special steps are domain-agnostic.

---

## 9. Risks

1. Risk: replacing `amend_entity` changes workflow behavior.
2. Mitigation: create before/after workflow behavior snapshots for refinement, implementation, review, merge, and dispatch flows.
3. Risk: generic HTTP webhooks become an unsafe escape hatch.
4. Mitigation: require allowlists, secrets policy, timeout limits, and audit events.
