# EPIC-197: Concurrent Re-entrant Orchestration Control Plane

**Status:** Proposed  
**Priority:** P0  
**Created:** 2026-05-18  
**Updated:** 2026-05-18  
**Owner:** Orchestration Platform / Kanban Runtime  
**Parent:** None  
**Depends on:** EPIC-188, EPIC-192  
**Related:** EPIC-093, EPIC-177, EPIC-193, `docs/orchestration/README.md`, `docs/orchestration/workflow-catalog.md`, `docs/orchestration/agent-tool-skill-catalog.md`, `docs/analysis/ANALYSIS-2026-05-18-orchestration-process-gaps.md`

## Summary

Replace the current phase-like orchestration model with a concurrent, re-entrant orchestration control plane based on lanes, intents, facts, freshness, and policy-based scheduling. A project must be able to run discovery, spec refinement, work-item generation, dispatch, implementation, QA, merge, repair, upstream-change analysis, and strategy review at the same time when conditions allow, and any lane must be able to restart later when new evidence invalidates prior assumptions.

## Problem Statement

Nexus orchestration currently mixes project status, workflow YAML, prompt rules, Kanban lifecycle events, direct workflow launches, MCP tool mutations, and run-link cleanup into a loosely coupled process. The result is powerful but brittle:

- Some flows look linear even though real projects need concurrent and recurring work streams.
- Discovery is treated like an initial phase, but later upstream changes, failed implementations, stale specs, or missed context may require new discovery at any time.
- CEO prompts decide strategy and directly mutate the board, which makes prompt/tool permission drift dangerous.
- Dispatch, wakeup, status transition, terminal-run handling, and event delivery rules are scattered across services, YAML, and prompts.
- There is no durable project “world model” describing facts, confidence, freshness, active intents, suppressed intents, and conflicts.
- Operators cannot easily answer “why did this workflow run?”, “why did this not run?”, “what is stale?”, or “what can safely run concurrently?”

## Goals

- Support multiple concurrent orchestration lanes per project rather than one global project phase/state.
- Add durable intent records for requested orchestration work such as discovery, spec refinement, work-item generation, dispatch, review, repair, and upstream-change analysis.
- Add a project blackboard/world model where agents and services publish facts, evidence, confidence, freshness, and invalidation signals.
- Add a policy scheduler that decides which compatible intents can run now, which must wait, and which are suppressed due to conflicts or stale prerequisites.
- Split CEO strategy decisions from system execution so agents emit structured decision/intention objects and services validate/apply them.
- Make event delivery, launch decisions, run-link cleanup, and no-launch reasons durable and observable.
- Preserve Kanban ownership of Kanban domain behavior and keep API/core workflow runtime Kanban-neutral.
- Add contract validation so prompts, workflow YAML, tools, MCP manifests, and output contracts stay aligned.
- Add simulation/evaluation scenarios that exercise concurrent and re-entrant orchestration behavior without relying on real long-running agents.

## Non-Goals

- Do not introduce a single project-level finite state machine.
- Do not force projects through a linear sequence of discovery → specs → work items → implementation → review.
- Do not move Kanban status names or work-item domain rules into API/core.
- Do not replace all existing workflows in one rewrite.
- Do not require every orchestration action to be performed by the CEO agent.
- Do not remove manual launch or human steering flows.

## Core Concepts

### Orchestration Lanes

A lane is an independently tracked stream of orchestration activity. A project may have many active lanes at once.

Initial lane families:

- `discovery` — investigate unknown or stale areas.
- `strategy` — decide project direction and next work.
- `specification` — refine PRD/SDD/work-item specs.
- `work_item_generation` — publish or reconcile work items from specs.
- `dispatch` — select and start eligible implementation work.
- `implementation` — execute work-item implementation workflows.
- `qa` — review and validate work.
- `merge` — merge ready work and hydrate specs.
- `repair` — handle failed workflows, environment issues, stale links, and recovery.
- `upstream_sync` — analyze upstream merges or external changes.

### Intents

An intent is a durable request for orchestration work. Intents are not project states. They can coexist, conflict, be superseded, be retried, or be completed independently.

Example intent types:

- `discover_unknowns`
- `reanalyze_upstream_change`
- `refine_spec`
- `generate_work_items`
- `dispatch_candidates`
- `implement_work_item`
- `review_work_item`
- `merge_work_item`
- `repair_failed_run`
- `reconcile_stale_links`
- `validate_project_health`

Each intent records:

- scope and affected resources
- reason and evidence
- requester/source
- priority
- lane
- conflict keys
- freshness/staleness requirements
- eligible workflow/capability
- launch attempts and no-launch reasons
- terminal outcome

### Blackboard / World Model

The blackboard is a durable project knowledge surface for orchestration decisions.

Examples of facts:

- `area_discovery_confidence(apps/api/src/workflow) = 0.62`
- `spec_stale_after_commit(TASK-auth, abc123)`
- `work_item_blocked_by_missing_contract(TASK-api)`
- `target_branch_claimed(feature/foo, run-id)`
- `upstream_merge_touched(apps/kanban/src/dispatch)`
- `workflow_run_failed_at(provision_worktree)`

Facts include provenance, timestamps, confidence, TTL/freshness, and invalidation links.

### Policy Scheduler

The scheduler consumes intents and facts, then decides:

- launch now
- queue/wait
- suppress due to active conflict
- split into child intents
- ask for human input
- mark blocked
- supersede stale intent
- repair/reconcile before launching

Conflict dimensions include:

- same work item
- same target branch
- overlapping files/modules
- stale spec versus active implementation
- dependency not satisfied
- active run link
- human approval required
- lane-specific capacity
- project-level safety caps

### CEO Decision Object + Executor

CEO agents should emit structured decisions/intents rather than directly performing all mutations. A service-owned executor validates and applies those decisions.

Example decision shape:

```json
{
  "decision": "dispatch_candidates",
  "rationale": "Two todo work items are unblocked and target different branches.",
  "intents": [
    {
      "type": "dispatch_candidates",
      "workItemIds": ["..."],
      "priority": "high",
      "evidence": ["kanban.project_state snapshot ..."]
    }
  ],
  "suppressions": [
    {
      "intentKey": "merge_work_item:...",
      "reason": "target branch claimed by active implementation"
    }
  ]
}
```

## Workstreams

### 1. Orchestration World Model and Intent Persistence

Add persistence for lanes, intents, facts, conflict keys, freshness, no-launch reasons, and scheduler outcomes.

Acceptance criteria:

- A project can have multiple active intents across different lanes.
- Intents can reference work items, modules, files, commits, branches, workflow runs, and external events.
- Facts include provenance, confidence, freshness, and invalidation metadata.
- Existing Kanban project/work-item state remains source of truth for Kanban domain data.

### 2. Policy Scheduler and Conflict Resolution

Create a scheduler service that evaluates pending intents against the blackboard and current Kanban/Core runtime state.

Acceptance criteria:

- Scheduler can launch compatible intents concurrently.
- Scheduler records durable no-launch reasons.
- Scheduler prevents conflicting work on the same work item, target branch, or unsafe file/module overlap.
- Scheduler supports lane-level and project-level capacity limits.
- Scheduler can request repair/reconciliation before launching blocked intents.

### 3. CEO Decision Executor

Refactor CEO workflows so agent output is a structured decision/intents payload and service code performs validated mutations/launches.

Acceptance criteria:

- CEO prompt no longer needs to directly call every Kanban mutation tool for common actions.
- Decision executor validates candidate IDs, dependencies, capacity, branch conflicts, and current facts before applying.
- Rejected decisions produce actionable feedback for the agent and a durable audit record.
- Existing CEO cycle workflow remains operational during migration.

### 4. Re-entrant Discovery and Freshness Signals

Discovery becomes an anytime lane driven by staleness, low confidence, upstream changes, failed work, or human/agent requests.

Acceptance criteria:

- Upstream merge/change events can create `reanalyze_upstream_change` or `discover_unknowns` intents.
- Failed implementation or QA rejection can lower confidence and create targeted discovery/refinement intents.
- Discovery findings update facts and can invalidate specs/work items without globally stopping unrelated work.

### 5. Workflow/Prompt/Tool Contract Compiler

Add validation that catches orchestration contract drift before seed workflows run.

Acceptance criteria:

- Prompt-referenced tools are allowed by workflow/job/profile permissions or explicitly marked optional.
- Prompt tool-call examples validate against current Zod schemas.
- `output_contract.required` keys are mentioned in prompt instructions and negative/no-op paths.
- Event workflows declare explicit concurrency or a documented dedupe strategy.
- Event producers/consumers can be enumerated and dead event triggers are flagged.
- Kanban MCP seed manifest matches registered tool providers or documents intentional exceptions.

### 6. Durable Event Delivery and Replay

Add reliable event delivery semantics for lifecycle-critical orchestration events.

Acceptance criteria:

- Kanban lifecycle event publication is fail-visible or outbox-backed.
- Operators can see pending/failed/delivered event status.
- Safe replay by event ID/dedupe key is possible.
- Missed `kanban.work_item.status_changed.v1` and `ProjectOrchestrationCycleRequestedEvent` cases are recoverable.

### 7. Simulation and Evaluation Harness

Add scenario tests for concurrent/re-entrant orchestration.

Acceptance criteria:

- Scenarios can run without real long-running agents by stubbing workflow outputs.
- Coverage includes imported repo bootstrap, re-discovery after upstream change, parallel discovery + implementation, QA rejection causing refinement/discovery, stale run-link recovery, duplicate wakeup, merge conflict, and event delivery failure.
- Harness asserts intents, facts, launched workflows, no-launch reasons, and final projections.

### 8. Control Plane Observability UI/API

Expose active lanes, intents, facts, conflicts, launches, no-launch reasons, and stale links.

Acceptance criteria:

- Users can answer why a workflow did or did not run.
- Users can see active/suppressed queued intents by lane.
- Users can inspect fact provenance and freshness.
- Users can trigger safe replay/reconciliation actions where authorized.

## Backlog

- [ ] E197-001 Define orchestration lane, intent, fact, and scheduler outcome contracts.
- [ ] E197-002 Add persistence entities/repositories for intents and facts in the Kanban-owned orchestration domain.
- [ ] E197-003 Add read APIs/tools for lanes, intents, facts, and no-launch reasons.
- [ ] E197-004 Implement conflict-key generation for work item, branch, file/module, and workflow-run resources.
- [ ] E197-005 Implement initial policy scheduler with dry-run/preview mode.
- [ ] E197-006 Add `kanban.dispatch_preview` and scheduler-backed dispatch intent handling.
- [ ] E197-007 Add CEO structured decision schema and decision executor service.
- [ ] E197-008 Refactor `project_orchestration_cycle_ceo` to emit structured decisions/intents.
- [ ] E197-009 Add re-entrant discovery intents from upstream changes, QA rejection, and low-confidence facts.
- [ ] E197-010 Add fact freshness/confidence model and invalidation propagation.
- [ ] E197-011 Add workflow/prompt/tool contract compiler and seed validation tests.
- [ ] E197-012 Add Kanban MCP manifest/provider consistency tests.
- [ ] E197-013 Add durable Kanban event outbox and delivery status.
- [ ] E197-014 Add safe event replay/recovery tooling.
- [ ] E197-015 Add terminal-run reconciliation intent and repair flow.
- [ ] E197-016 Add simulation harness for concurrent orchestration scenarios.
- [ ] E197-017 Add control-plane API/UI for lanes, intents, facts, conflicts, and no-launch reasons.
- [ ] E197-018 Migrate existing discovery/spec/work-item/dispatch workflows onto intent/scheduler contracts incrementally.

## Acceptance Criteria

- A project can run discovery, work-item generation, implementation, QA, and repair workflows concurrently when conflict policy allows.
- Discovery can be re-triggered after initial work starts without stopping unrelated lanes.
- CEO cycle output can create multiple typed intents instead of relying on direct board mutation in prompts.
- Scheduler records durable reasons for every skipped/suppressed/queued launch.
- Workflow launches are auditable from originating fact/intent to run ID and terminal result.
- Lifecycle-critical events are durable or fail-visible and replayable.
- Prompt/tool/schema drift is caught by automated validation before runtime.
- Existing Kanban status workflows continue to work during migration.
- API/core remains Kanban-neutral; Kanban-owned lifecycle and MCP behavior stays in Kanban modules/packages.

## Open Questions

- Should intents live entirely in `apps/kanban` persistence, or should a generic API/core intent envelope exist with Kanban-owned projections?
- Which conflict dimensions should be enforced in the first scheduler slice: work item, target branch, files/modules, or workflow type?
- Should CEO structured decisions be stored as facts, intents, or both?
- How should confidence/freshness be scored initially: agent-provided scores, deterministic TTLs, event invalidation, or a hybrid?
- What is the minimum useful control-plane UI for operators: timeline first, lane board first, or intent graph first?

## References

- `docs/orchestration/README.md`
- `docs/orchestration/workflow-catalog.md`
- `docs/orchestration/agent-tool-skill-catalog.md`
- `docs/analysis/ANALYSIS-2026-05-18-orchestration-process-gaps.md`
