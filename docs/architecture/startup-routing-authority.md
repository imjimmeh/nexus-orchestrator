# Startup Routing Authority

Status: Current
Owner: Orchestration Platform

## Purpose

Define the single source of truth for startup route selection and prevent policy drift into workflow YAML or prompts.

## Canonical Decision Owner

Startup route selection is now owned by the **Project Orchestration Cycle (CEO)** workflow (`project_orchestration_cycle_ceo`) in consultation with the **Project Orchestration Advisor** (`project_orchestration_advisor`).

The legacy `StartupRouteRouterService` and deterministic YAML rules have been deprecated and removed.

## Startup Lifecycle

1. **Initiation:** `OrchestrationService.start()` in `apps/kanban/src/orchestration/orchestration.service.ts` is called.
2. **Cycle Launch:** It launches the `project_orchestration_cycle_ceo` workflow directly.
3. **Evidence Gathering:** The Cycle CEO queries project state and orchestration history.
4. **Advisor Consultation:** If state is ambiguous or it's a first-run (bootstrap planning gap), the Cycle CEO invokes the `project_orchestration_advisor` workflow.
5. **Route Decision:** The Cycle CEO uses its own judgment + Advisor advice to decide the next action (e.g., call `project_discovery_ceo`, delegate to a specialist, or dispatch existing items).

## Input Contract

Callers provide startup context in the orchestration start payload:

- `sourceContext`
- `readinessContext`
- `startupHints`

These are passed as trigger inputs to the Cycle CEO and persisted in orchestration metadata for traceability.

## Workflow Responsibilities

### Project Orchestration Cycle (CEO)
- Authoritative entry point for all orchestration activity (start, resume, cycle).
- Resolves "bootstrap planning gaps" (goals exist but no work items).
- Decides whether to invoke discovery, synthesis, or direct dispatch.

### Project Orchestration Advisor
- Read-only evidence gathering workflow.
- Inspects codebase, history, skills, and workflows.
- Returns Markdown advice; does not make autonomous decisions.

### Project Discovery (CEO)
- Executable discovery workflow invoked by the Cycle CEO when greenfield or import-reconciliation is required.
- Legacy `trigger.selectedRoute` branches are retained for internal compatibility but are no longer supplied as authoritative inputs from `OrchestrationService`.

## Guardrails

1. **Do not reintroduce deterministic TS routing:** Avoid adding logic back to `OrchestrationService` that attempts to predict the route before launch.
2. **Favor Advisor for complex state:** Use the Advisor workflow instead of complex prompt-based state analysis in the Cycle CEO.
3. **No authoritative routes in trigger:** Do not rely on `selectedRoute` or `selectedRuleId` in new workflows; use current state and Advisor feedback instead.
4. **Cycle Idempotency:** The Cycle CEO must handle its own restart/resume state via `trigger.isRestart` and `trigger.stateSummary`.

## Extension Pattern

To add a new startup "playbook":
1. Add the necessary skills and specialist workflows.
2. Update the Advisor workflow to recognize the new pattern and suggest it.
3. Ensure the Cycle CEO has the tools (or can be prompted) to delegate to the new workflows.
