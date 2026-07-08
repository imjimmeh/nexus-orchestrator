# Playbook Orchestration Architecture

Status: Current
Domain: Startup routing and orchestration bootstrapping

## 1. Overview

Startup orchestration is advisor-led and cycle-driven.

The initial route decision is no longer deterministic at the domain boundary. Instead, the system launches a core orchestration cycle that uses current state evidence and an advisor workflow to decide how to proceed.

## 2. Canonical Authority

The canonical orchestrator is the **Project Orchestration Cycle (CEO)** workflow (`project_orchestration_cycle_ceo`).

It consults the **Project Orchestration Advisor** (`project_orchestration_advisor`) for evidence-backed recommendations when state is ambiguous or a bootstrap gap is detected.

`OrchestrationService.start` in `apps/kanban/src/orchestration/orchestration.service.ts`:

1. Resolves startup context (source, readiness, hints) from input.
2. Launches the `project_orchestration_cycle_ceo` workflow directly.
3. Persists the startup context in orchestration metadata.

## 3. Trigger Contract

The core cycle workflow consumes:

- `trigger.scopeId`
- `trigger.goals`
- `trigger.sourceContext`
- `trigger.readinessContext`
- `trigger.startupHints`

It no longer expects `selectedRoute` or `selectedRuleId` as authoritative inputs.

## 4. Advisor-Led Bootstrap

When the Cycle CEO detects a "bootstrap planning gap" (persisted goals exist but no work items are found), it follows this path:

1. **Invoke Advisor:** Calls `project_orchestration_advisor` to gather codebase, history, and skill evidence.
2. **Review Advice:** The Advisor returns a Markdown memo with recommendations.
3. **Decide Delegation:** The Cycle CEO selects a bootstrap path (e.g., `project_discovery_ceo`, specialist agent, or synthesis workflow) based on the advice.

## 5. Invariants

- **Cycle-First:** All orchestration begins with a cycle reconciler, not a discovery runner.
- **Advisor is Read-Only:** The Advisor provides evidence but never makes mutations or autonomous decisions.
- **State-Driven:** Decisions are based on observed project state and history, not hardcoded routing tables.

## 6. Related Docs

- `docs/architecture/startup-routing-authority.md`
- `docs/architecture/ARCH-kanban-workflow.md`
- `docs/guides/github-private-repository-import-and-orchestration.md`
