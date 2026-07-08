# EPIC-168: Reusable Project Orchestration Advisor and Skill Discovery

Status: In Progress
Priority: P0
Created: 2026-05-11
Last Updated: 2026-05-13
Owner: Kanban + Workflow Platform
Depends On: EPIC-166, EPIC-167
Related Analysis: `docs/analysis/2026-05-11-orchestration-logic-analysis.md`
Related Design: `docs/plans/2026-05-11-advisor-startup-orchestration-design.md`
Related Plan: `docs/plans/2026-05-11-advisor-startup-orchestration-implementation-plan.md`

---

## 2026-05-13 Supersession Note

EPIC-170 (`docs/epics/EPIC-170-agent-driven-orchestration-and-event-wakeups.md`) is the current source of truth for mutating orchestration authority. `project_orchestration_cycle_ceo` is the canonical mutating orchestration authority; the Advisor remains read-only. Kanban services emit facts, store state, and enforce mutation safety, including known-status validation, but they do not own project strategy, source-to-target status transition graphs, dispatcher strategy, or continuation decisions.

## 1. Why This Epic Exists

Startup orchestration currently depends on hardcoded TypeScript routing logic. `StartupRouteRouterService` evaluates compiled predicates, assigns route names, and passes selected route metadata into project orchestration startup. This makes the application core responsible for process strategy even though the target architecture is workflow-driven, agent-assisted, skill-aware, and evidence-backed.

The original EPIC-168 design proposed a startup-specific Advisor that could choose and launch the next workflow. That shape created a second orchestration authority beside `project_orchestration_cycle_ceo`.

The revised design keeps one authority: `project_orchestration_cycle_ceo`. It adds a reusable, read-only `project_orchestration_advisor` workflow that can be consulted by orchestrator agents or humans throughout a project lifecycle. The Advisor gathers evidence and returns a Markdown recommendation memo. It does not mutate state, launch workflows, record advice, or execute its own recommendation.

---

## 2. Desired Outcomes

1. Startup orchestration no longer depends on a hardcoded route matcher table.
2. `StartupRouteRouterService` is deleted rather than retained as fallback authority.
3. `OrchestrationService.start()` launches `project_orchestration_cycle_ceo` as the neutral orchestration entrypoint.
4. A seeded `project_orchestration_advisor` workflow provides reusable read-only advice.
5. Advisor can inspect project state, orchestration timeline, memory, workflows, skills, and playbooks through evidence-gathering tools.
6. Advisor returns Markdown advice with explanations and evidence.
7. Advisor is never invoked automatically by services.
8. Advisor output is never automatically executed.
9. `kanban.project_state` provides observed project facts, memory counts, and recent activity summaries.
10. The skill system uses category/tag discovery plus search/read tools instead of prompt-stuffed skill lists.

### 2026-05-11 Implementation Status

The startup authority cutover is implemented: `OrchestrationService.start()` now launches `project_orchestration_cycle_ceo`, startup route metadata is stripped from persisted orchestration metadata, and the former startup router service/types/rule-loader artifacts have been deleted.

The reusable `project_orchestration_advisor` workflow is seeded as a read-only advisory workflow, and `kanban.project_state` now returns observed memory and recent-activity summaries. Remaining `project_discovery_ceo` branches that inspect `trigger.selectedRoute` / `trigger.selectedRuleId` are legacy workflow-internal compatibility only; startup no longer supplies those fields as authoritative route decisions.

Advisor discovery tool names are now registered as read-only internal tools so the seeded Advisor workflow has concrete runtime capabilities. Workflow discovery delegates to the existing workflow metadata tools; skill/playbook discovery currently returns explicit empty/deferred evidence responses. Full indexed skill/playbook discovery remains tracked in `docs/plans/2026-05-11-advisor-discovery-tools-implementation-plan.md`.

---

## 3. Scope

### In Scope

1. `apps/kanban/src/orchestration/orchestration.service.ts` startup path.
2. Deletion of startup route router service/types/loader artifacts after cutover.
3. `project_orchestration_advisor` workflow seed and prompt.
4. Advisor workflow permissions restricted to read-only/evidence-gathering tools.
5. Enrichment of `kanban.project_state` with memory counts and recent activity summaries.
6. Prompt guidance for `project_orchestration_cycle_ceo` to consult Advisor and memory tools when useful.
7. Seed contract tests proving Advisor workflow, read-only permission boundary, and CEO guidance.
8. Unit tests proving enriched project state remains factual and recommendation-free.
9. Service tests proving startup enters the orchestration cycle without route selection.
10. Skill discovery tools (`search_skills`, `read_skill_manifest`) and category/tag-based metadata.
11. Updated agent prompt injection to use dynamic skill discovery instead of hardcoded lists.

### Out of Scope

1. Rule Registry or generic policy engine.
2. Typed `StartupRouteDecision` replacement objects.
3. Automatic Advisor invocation.
4. Automatic execution of Advisor output.
5. Generic `launch_workflow` tool for EPIC-168.
6. `record_advice` tool.
7. `collect_signals` or `collect_project_context` tool.
8. Rewriting all project discovery workflow internals.
9. Standardizing Markdown-formatted tool responses globally.

---

## 4. Non-Goals

1. Do not make LLM agents responsible for enforcing safety invariants.
2. Do not introduce another centralized routing enum under a different name.
3. Do not keep `StartupRouteRouterService` as a long-term fallback authority.
4. Do not let Advisor become a second orchestrator.
5. Do not let Advisor mutate project, orchestration, memory, or work-item state.
6. Do not make startup orchestration dependent on hidden prompt-only behavior.

---

## 5. Target Architecture

### 5.1 Startup Flow

Current:

```text
OrchestrationService.start()
  -> resolveRoutingInput()
  -> StartupRouteRouterService.selectRoute()
  -> selectedRoute / selectedRuleId
  -> workflow chosen by route metadata
```

Target:

```text
OrchestrationService.start()
  -> launch project_orchestration_cycle_ceo
  -> cycle CEO reads project state / timeline / memory
  -> cycle CEO may consult project_orchestration_advisor
  -> cycle CEO decides and performs authorized orchestration actions
```

### 5.2 Responsibility Split

Cycle CEO owns:

1. Choosing the next orchestration action.
2. Recording decisions through existing mechanisms.
3. Invoking workflows through existing authorized tools.
4. Dispatching work through lifecycle-safe tools.
5. Completing or pausing orchestration cycles.

Advisor owns:

1. Gathering evidence through read-only tools.
2. Summarizing project state and recent activity.
3. Suggesting candidate workflows, skills, playbooks, and next steps.
4. Explaining risks, unknowns, and evidence in Markdown.

Engine and services own:

1. Tool input schema validation.
2. Runtime permissions.
3. Idempotency.
4. Known status value validation and mutation safety. Superseded: source-to-target status transition legality is no longer a service-owned transition graph.
5. Persistence and event/audit ledger writes.
6. Destructive-action approval.

---

## 6. Workstreams

### WS-1: Read-Only Advisor Workflow Bootstrap (P0)

Goal:

Create a seeded Advisor workflow that can be manually launched or invoked by orchestrator agents for lifecycle-wide advice.

Deliverables:

1. Remove obsolete startup-specific Advisor seed artifacts.
2. Add `project_orchestration_advisor` seed workflow.
3. Add prompt requiring project state, timeline, memory, workflow, skill, and playbook evidence as needed.
4. Add output contract requiring `adviceMarkdown`.
5. Restrict permissions to read-only/evidence-gathering tools plus `set_job_output`.

Acceptance:

1. Seed contract tests validate the Advisor workflow exists.
2. Advisor workflow exposes required evidence tools.
3. Advisor workflow does not expose mutation tools such as workflow launch, advice recording, memory writes, dispatch, or orchestration completion.
4. Advisor prompt requires Markdown sections for snapshot, recent activity, recommendation, candidates, risks, and evidence.

### WS-2: Project State Observed Context (P0)

Goal:

Make `kanban.project_state` the shared lifecycle-neutral factual snapshot.

Deliverables:

1. Add memory count summary for `kanban.project` memory segments by type.
2. Add recent orchestration activity summary from decisions and action requests.
3. Keep existing project/work-item/goals/orchestration payloads.
4. Do not include readiness flags, route decisions, selected workflows, or recommendations.

Acceptance:

1. `kanban.project_state` returns `memorySummary` and `recentActivity`.
2. Tests prove forbidden recommendation/route/readiness fields are absent.
3. Memory contents remain available through `query_memory`, not duplicated in project state.

### WS-3: Cycle CEO Consultation Guidance (P0)

Goal:

Guide the orchestration CEO to consult Advisor and memory tools when useful while preserving CEO authority.

Deliverables:

1. Update `project_orchestration_cycle_ceo` prompt with optional Advisor consultation guidance.
2. State Advisor output is advice only.
3. State Advisor recommendations must not be executed automatically.
4. Encourage direct `query_memory` use when preferences/history matter.

Acceptance:

1. Seed contract tests prove the prompt mentions `project_orchestration_advisor` and `invoke_agent_workflow`.
2. Tests prove the prompt states Advisor output is advice only.
3. Prompt preserves existing lifecycle and dispatch guardrails.

### WS-4: Startup Cutover To Cycle CEO (P0)

Goal:

Make startup enter the normal orchestration cycle instead of selecting a startup route.

Deliverables:

1. Add failing tests proving startup launches `project_orchestration_cycle_ceo`.
2. Remove router selection from startup path.
3. Stop persisting `selectedRoute` / `selectedRuleId` as startup authority.
4. Preserve observed startup context and diagnostic metadata.

Acceptance:

1. Startup begins with `project_orchestration_cycle_ceo`.
2. Startup does not invoke Advisor automatically.
3. Startup does not call `StartupRouteRouterService`.
4. Existing lifecycle invariants remain enforced by existing services/tools.

### WS-5: Startup Router Deletion (P1)

Goal:

Delete obsolete startup routing artifacts after the cycle-entrypoint cutover.

Deliverables:

1. Inventory remaining references to startup route types, route config, selected route metadata, and matcher IDs.
2. Remove or rewrite route-specific tests against cycle-entrypoint behavior.
3. Delete `StartupRouteRouterService`, route types, route loader, and route-rule config.
4. Document any remaining `project_discovery_ceo` route branches as legacy workflow-internal compatibility.

Acceptance:

1. No production startup code depends on hardcoded route matcher logic.
2. No long-term dual authority remains between router and cycle CEO.
3. Contract tests validate workflow/advisor/project-state seams instead of route enum behavior.

### WS-6: Skill Discovery Implementation (P0)

Goal:

Implement functional skill and playbook discovery to move away from prompt-stuffed skill lists.

Deliverables:

1. Create `search_skills`, `read_skill_manifest`, `search_playbooks`, and `read_playbook` internal tools.
2. Enrich seeded skills with `category` and `tags` metadata.
3. Grant `search_skills` to all active seeded agents.
4. Update prompt injection to guide agents to use discovery tools instead of hardcoded lists.

Acceptance:

1. Advisor can search and read candidate skills and playbooks.
2. Agents discover skills dynamically by category/tag.
3. System prompts no longer contain hardcoded lists of every assigned skill.

---

## 7. Implementation Phases

### Phase 1: Replace Stale Advisor Contracts

1. Update seed tests from `orchestration_advisor_startup` to `project_orchestration_advisor`.
2. Delete obsolete `StartupSignalProbeService` red test.
3. Add read-only permission boundary assertions.

### Phase 2: Seed Advisor Workflow

1. Add `project-orchestration-advisor.workflow.yaml`.
2. Delete `orchestration-advisor-startup.workflow.yaml`.
3. Verify workflow parser and seed contracts.

### Phase 3: Enrich Project State

1. Add project-state summary tests.
2. Implement memory counts and recent activity.
3. Update MCP wiring/tests.

### Phase 4: Guide Cycle CEO

1. Add prompt contract tests.
2. Update `project-orchestration-cycle-ceo` prompt.
3. Verify seed contracts.

### Phase 5: Cut Startup Over

1. Rewrite startup service tests around `project_orchestration_cycle_ceo`.
2. Remove router from startup implementation.
3. Verify Kanban orchestration tests.

### Phase 6: Delete Router

1. Remove route artifacts and imports.
2. Verify no production references remain.
3. Document legacy workflow-internal route branches if any remain.

---

## 8. Testing Strategy

Focused tests:

1. `apps/api/src/database/seeds/workflows.seed.contract.spec.ts`
2. `apps/kanban/src/seeds/workflows.seed.contract.spec.ts`
3. `apps/kanban/src/mcp/tools/read/project-state.tool.spec.ts`
4. `apps/kanban/src/mcp/kanban-mcp.service.spec.ts`
5. `apps/kanban/src/orchestration/orchestration.service.spec.ts`

Required assertions:

1. `project_orchestration_advisor` workflow exists.
2. Advisor workflow is read-only.
3. Advisor returns Markdown advice through `adviceMarkdown`.
4. `kanban.project_state` returns observed memory and recent-activity summaries.
5. `kanban.project_state` omits readiness flags, route fields, and recommendations.
6. Cycle CEO prompt suggests optional Advisor consultation.
7. Cycle CEO prompt states Advisor advice is not automatic authority.
8. Startup launches `project_orchestration_cycle_ceo`.
9. Startup router artifacts are deleted.

Expected verification commands:

```bash
npm run test --workspace=apps/api -- workflows.seed.contract
npm run test --workspace=apps/kanban -- workflows.seed.contract project-state.tool.spec.ts kanban-mcp.service.spec.ts orchestration.service.spec.ts
npm run validate:seed-data
npm run build --workspace=packages/core
npm run build --workspace=apps/api
npm run build --workspace=apps/kanban
docker compose up -d --build --force-recreate
```

---

## 9. Risks and Mitigations

### Risk: Advisor becomes a second orchestrator

Mitigation: Make Advisor read-only, deny mutation tools, return Markdown advice only, and prompt callers that Advisor output is non-authoritative.

### Risk: Startup loses route-specific behavior abruptly

Mitigation: Startup enters `project_orchestration_cycle_ceo`, which already owns lifecycle decisions. Keep route branches inside `project_discovery_ceo` as legacy workflow-internal compatibility unless removing them is safe in this slice.

### Risk: Project state becomes a recommendation engine

Mitigation: Restrict enrichment to observed counts and summaries. Tests forbid readiness flags, selected workflows, route fields, and recommendations.

### Risk: Skill/playbook search is incomplete

Mitigation: Keep Advisor prompt and permissions ready for read/search tools while deferring the full discovery overhaul.

---

## 10. Acceptance Criteria

This epic is complete when:

1. Startup orchestration launches `project_orchestration_cycle_ceo` without route selection.
2. `StartupRouteRouterService` and related route artifacts are deleted or have a documented short-term blocker.
3. `project_orchestration_advisor` exists as a reusable read-only workflow.
4. Advisor returns Markdown advice and cannot mutate state through its workflow permissions.
5. `kanban.project_state` includes compact memory and recent-activity facts.
6. Cycle CEO prompt suggests Advisor/memory consultation when useful and preserves CEO authority.
7. Tests cover workflow contracts, project state summaries, startup cutover, and router deletion.
8. EPIC-168 and design/plan docs reflect the reusable Advisor architecture.
