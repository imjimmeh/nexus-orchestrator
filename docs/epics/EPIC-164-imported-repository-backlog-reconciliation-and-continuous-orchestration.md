# EPIC-164: Imported Repository Backlog Reconciliation and Continuous Orchestration

Status: Completed
Priority: P0
Depends On: EPIC-138, EPIC-162, EPIC-163
Related: docs/plans/2026-05-09-imported-repo-orchestration-contract-hardening.md
Last Updated: 2026-05-09

---

## 1. Summary

Replace the current imported-repository hydration behavior with a real repository backlog reconciliation process.

Imported repository discovery must not collapse probe findings and user goals into one generic bootstrap ticket. It must reconcile repository reality into the kanban board by creating or updating:

1. `done` work items for capabilities already implemented in the imported repository.
2. `todo` or `backlog` work items for new work required by the project goals.
3. `blocked` work items for missing context, contradictory evidence, or work that requires explicit human input.
4. durable orchestration metadata that causes autonomous projects to keep cycling until a CEO/orchestrator decision explicitly pauses, blocks, or completes the project.

This epic deepens the imported-repository synthesis seam from `probe artifacts + goals -> one bootstrap spec` into `probe artifacts + goals + existing board -> reconciliation plan`.

---

## 2. Context and Background

### 2.1 Incident That Exposed the Problem

Project `dad09d35-4e5a-47fa-9dc0-ffa3b8960af4` was created from the imported GitHub repository `https://github.com/imjimmeh/nexus-orchestator`.

The initial discovery path ran several workflows successfully:

1. `Project Discovery (CEO)` completed.
2. `Project Codebase Deep Investigation` completed.
3. `Project Spec Revision (CEO)` completed.
4. `Imported Repository Synthesis and Hydration` completed or later completed after manual recovery.

Despite these successful workflow statuses, the project appeared to stop. The original failure had two layers:

1. The probe artifact producer wrote `## Narrative Summary` sections, while the synthesis consumer expected a literal `narrative_summary:` field. This caused hydration to block on `invalid_probe_results` without failing the workflow run.
2. After the artifact contract was fixed and manual hydration succeeded, hydration created only one generic work item: `a041368c-b00f-4dcc-b0e2-e675bfa71248`, titled `Bootstrap imported repository execution plan`.

That work item was not a meaningful backlog. It persisted a generic plan derived from goals; it did not represent what the repository already contains, and it did not create actionable tickets for the specific gaps discovered by the probe process.

### 2.2 What the Hardening Plan Fixed

`docs/plans/2026-05-09-imported-repo-orchestration-contract-hardening.md` addressed the first layer:

1. It introduced a canonical `ProbeResultArtifact` parser and validator.
2. It made `## Narrative Summary` the canonical narrative source.
3. It moved synthesis validation onto the artifact contract.
4. It surfaced blocked hydration through orchestration diagnostics.
5. It added blocked and clear metadata paths for imported hydration.
6. It made hydration avoid interactive user questions for trigger values.

That work unblocked the pipeline, but it intentionally did not solve richer imported-repository backlog generation. The plan explicitly identified that synthesis still writes one generic bootstrap spec and that richer synthesis from probe findings is follow-up work.

### 2.3 Relationship to Existing Epics

EPIC-138 introduced the concept of imported repository reality mapping and completed work hydration. It correctly identified that imported repositories need evidence-based completion mapping. However, the current implementation still does not create a useful board from repository reality.

EPIC-162 hardened routing, discovery, and hydration reliability. It explicitly did not rewrite the imported-repository synthesis bridge.

EPIC-163 proposes deterministic imported-repository orchestration E2E coverage. This epic should extend that E2E plan with scenarios proving meaningful backlog reconciliation and continuous orchestration.

This epic is therefore the missing domain work after EPIC-138/162/163: make the imported repository board reflect reality, and make autonomous orchestration continue by policy rather than by fragile one-shot event chains.

---

## 3. Problem Statement

Imported repositories begin with a non-empty codebase. Treating them like a blank project is wrong.

The current imported-repository hydration path has several process and architecture problems:

1. Discovery findings do not become meaningful work items.
2. Existing implemented repository capabilities are not represented as `done` work items.
3. New required work from user goals is not decomposed into actionable `todo` or `backlog` work items.
4. Critical discovered gaps, such as repair-agent bugs, missing war-room tests, operations-doctor stubs, auth rate limiting, and agent-local races, remain documentation notes rather than executable backlog.
5. The generic bootstrap ticket is not useful for dispatch because it does not encode concrete acceptance criteria, dependencies, evidence, or target files.
6. Implementation agents should not be given broad authority to create arbitrary work items or goals, but the current planning path does not provide a strong alternative owner for backlog creation.
7. Manual recovery can run a child hydration workflow successfully without triggering the parent orchestration continuation path.
8. The project orchestration loop stops unless an event chain happens to emit the next cycle request.
9. There is no durable autonomous-project policy that says: repeat orchestration until the CEO/orchestrator explicitly pauses, blocks, or completes the project.

The result is a board that can look superficially hydrated while still failing to drive work.

---

## 4. Goals

1. Replace one-ticket imported-repo synthesis with evidence-based backlog reconciliation.
2. Create or update `done` work items for capabilities already implemented in the repository.
3. Create or update `todo` and `backlog` work items for new work, bugs, test gaps, docs gaps, and architecture gaps discovered from probe artifacts and project goals.
4. Create `blocked` work items for unresolved contradictions, missing context, or required human decisions.
5. Make work-item publication idempotent using stable source IDs and source hashes.
6. Give discovery/planning workflows a narrow, explicit backlog publication tool contract.
7. Prevent implementation agents from arbitrarily creating goals or broad new work items.
8. Allow implementation agents to propose follow-up work through a governed proposal path.
9. Make project orchestration cyclic by default for autonomous projects.
10. Persist cycle decisions as `repeat`, `pause`, `complete`, or `blocked`.
11. Ensure manual recovery and normal workflow execution use the same continuation path.
12. Add deterministic tests proving imported repositories produce a meaningful board and continue orchestration.

---

## 5. Non-Goals

1. Replacing the entire workflow engine.
2. Introducing a new workflow run status such as `BLOCKED` as part of this epic.
3. Giving implementation agents broad `create_work_item` or `create_goal` permissions.
4. Building a perfect semantic code understanding engine.
5. Automatically marking ambiguous or weakly evidenced work as definitively complete.
6. Rewriting every existing kanban workflow.
7. Building a full UI redesign for imported repository dashboards.
8. Deleting the existing probe artifact contract hardening work.

---

## 6. Target Architecture

### 6.1 Deep Module: `ImportedRepositoryBacklogReconciler`

Add a deep module that owns imported-repository backlog reconciliation.

Interface:

```ts
interface ImportedRepositoryBacklogReconcilerInput {
  projectId: string;
  projectGoals: ProjectGoalSnapshot[];
  probeResults: ProbeResultArtifact[];
  existingWorkItems: WorkItemSnapshot[];
  existingOrchestrationMetadata: Record<string, unknown>;
  repositoryContext?: RepositoryContextSnapshot;
}

interface ImportedRepositoryBacklogReconciliationPlan {
  projectId: string;
  generatedAt: string;
  sourceArtifactCount: number;
  confidenceSummary: ReconciliationConfidenceSummary;
  workItemSpecs: RepositoryWorkItemSpec[];
  goalUpdates: RepositoryGoalUpdateProposal[];
  openQuestions: ReconciliationOpenQuestion[];
  cycleRecommendation: OrchestrationCycleDecision;
  diagnostics: ReconciliationDiagnostic[];
}
```

The module should not directly call LLMs. It should consume structured probe artifacts and deterministic inputs, then return a typed plan.

Workflows and MCP tools are adapters around this module:

1. Workflow YAML invokes the tool.
2. MCP tool loads probe artifacts and project state.
3. Reconciler returns a typed plan.
4. Publisher applies the plan idempotently to kanban work items.
5. Orchestration continuation consumes the cycle decision.

### 6.2 Repository Work Item Spec

Define a typed `RepositoryWorkItemSpec` contract:

```ts
interface RepositoryWorkItemSpec {
  sourceId: string;
  title: string;
  description: string;
  status: "done" | "todo" | "backlog" | "blocked";
  priority: "p0" | "p1" | "p2" | "p3";
  scope: "small" | "medium" | "large";
  workType:
    | "existing_capability"
    | "new_feature"
    | "bug"
    | "test_gap"
    | "docs_gap"
    | "architecture_gap"
    | "investigation"
    | "human_decision";
  capabilityId?: string;
  reason: string;
  evidenceRefs: string[];
  sourcePaths: string[];
  acceptanceCriteria: string[];
  dependencies: string[];
  confidenceScore: number;
  metadata: {
    reconciliationSource: "imported_repository_probe";
    probeScopeIds: string[];
    importedRepositoryUrl?: string;
    repositoryBasePath?: string;
    existingCapability?: boolean;
    pendingReview?: boolean;
  };
}
```

`sourceId` must be stable across runs. Suggested format:

```text
imported-repo:<projectId>:<workType>:<capabilityId-or-normalized-title>
```

The publisher must upsert by `sourceId`, not blindly create duplicates.

### 6.3 Status Assignment Rules

Use confidence and work type to assign statuses:

1. `done`: high-confidence existing capabilities already implemented in code and supported by evidence.
2. `todo`: high-confidence gaps, bugs, missing tests, missing docs, or new features that are ready to execute.
3. `backlog`: valid work that exists but is not ready for immediate dispatch or needs refinement.
4. `blocked`: work that cannot proceed without missing context, contradictory evidence resolution, or explicit user/CEO decision.

EPIC-138 suggested `in_review` with `pending_review` for completed work. This epic refines that model for imported repositories:

1. `done` is allowed when evidence is strong and the item represents repository reality, not a new delivery workflow.
2. `pendingReview: true` can still be stored in metadata when evidence is medium confidence.
3. Medium-confidence completed work may use `done` with `pendingReview` metadata or a review-specific status if product policy requires it, but the board must clearly distinguish existing imported work from new executable work.

The core requirement is that imported repository reality is represented. It must not remain invisible because the system is afraid to create `done` items.

### 6.4 Evidence Model

Every reconciled work item must preserve why it exists.

Required evidence:

1. probe artifact path;
2. probe scope id;
3. `evidence_refs` from the probe artifact;
4. source paths from the repository;
5. confidence score;
6. reason for status assignment;
7. source hash for idempotency.

For example, a done item might be:

```text
Title: Existing capability: Workflow Runtime Actions
Status: done
Work type: existing_capability
Reason: Probe workflow-runtime found implemented runtime actions and evidence in apps/api/src/workflow/workflow-runtime.
Evidence refs:
- apps/api/src/workflow/workflow-runtime/workflow-runtime.module.ts
- apps/api/src/workflow/workflow-runtime/actions/*.ts
```

A new work item might be:

```text
Title: Fix repair-agent telemetry initialization
Status: todo
Work type: bug
Reason: Repair-agent probe found TelemetryClient.connect() is never called and RepairJob.getTracker() throws.
Acceptance criteria:
- Repair-agent initializes telemetry before use.
- RepairJob.getTracker() returns a valid tracker or structured error.
- Regression tests cover failed and successful repair tracking.
```

---

## 7. Backlog Ownership and Permissions

### 7.1 Planner-Owned Work Creation

Backlog creation must be owned by discovery/planning/orchestration workflows, not by arbitrary implementation agents.

Planner-owned workflows may receive narrow tools such as:

1. `kanban.reconcile_imported_repository_backlog`
2. `kanban.publish_reconciled_work_items`
3. `kanban.propose_goal_updates`
4. `kanban.record_cycle_decision`

These tools must validate typed specs and enforce idempotency.

### 7.2 Implementation-Agent Restrictions

Implementation agents should not receive broad permissions to create arbitrary work items or goals.

They may receive a narrow proposal mechanism:

```ts
interface ProposedFollowUpWorkEvent {
  projectId: string;
  sourceWorkItemId: string;
  title: string;
  reason: string;
  evidenceRefs: string[];
  proposedWorkType:
    | "bug"
    | "test_gap"
    | "docs_gap"
    | "new_feature"
    | "architecture_gap";
  urgency: "p0" | "p1" | "p2" | "p3";
}
```

The CEO/planner reviews proposals and decides whether to publish them as real work items.

### 7.3 Goal Updates

Goals are project intent, not implementation scratch space.

Only planner-owned workflows should create or update goals. Implementation agents may propose goal changes, but cannot directly mutate project goals.

---

## 8. Continuous Orchestration Policy

### 8.1 Cycle Decision Contract

Add a typed cycle decision:

```ts
type OrchestrationCycleDecision = "repeat" | "pause" | "complete" | "blocked";

interface CycleDecisionRecord {
  projectId: string;
  decision: OrchestrationCycleDecision;
  reason: string;
  decidedBy: "ceo_agent" | "orchestrator" | "system_policy" | "user";
  nextCycleAfter?: string;
  blockedReason?: string;
  evidenceRefs: string[];
}
```

Rules:

1. `repeat`: schedule or emit the next orchestration cycle.
2. `pause`: stop until user or policy resumes.
3. `complete`: stop because no further work is required.
4. `blocked`: stop until the blocker is resolved.

For autonomous projects, default to `repeat` unless the CEO/orchestrator explicitly records `pause`, `complete`, or `blocked`.

### 8.2 Repeat Until Stopped

The orchestration loop should not depend on one parent workflow event path only.

After any relevant terminal domain event, the system should evaluate continuation:

1. hydration completed;
2. work item completed;
3. work item blocked;
4. review accepted/rejected;
5. no dispatchable work remains;
6. planner published new work;
7. manual recovery completed.

The continuation service should then either:

1. emit `ProjectOrchestrationCycleRequestedEvent`, or
2. record a `pause`, `complete`, or `blocked` cycle decision.

### 8.3 Manual Recovery Must Use the Same Continuation Path

Manual recovery currently can run `imported_repo_synthesis_and_hydration` successfully without requesting an orchestration cycle.

That must not be possible after this epic.

Manual recovery should call the same service path as normal workflow completion:

```text
hydration completed -> update orchestration metadata -> evaluate continuation -> request next cycle or record stop decision
```

---

## 9. Proposed Workflow Changes

### 9.1 Replace Generic Imported Hydration Synthesis

Current problematic behavior:

```text
synthesize_discovery_work_item_specs -> docs/work-items/imported-repo-bootstrap.md -> one generic todo item
```

Target behavior:

```text
reconcile_imported_repository_backlog -> reconciliation plan -> publish many typed work items idempotently
```

### 9.2 Discovery Workflow

`project_discovery_ceo` should:

1. invoke deep investigation when probe artifacts are stale or missing;
2. invoke repository backlog reconciliation after probe results exist;
3. publish reconciled work items;
4. record reconciliation summary in orchestration metadata;
5. evaluate the cycle decision;
6. emit the next cycle request when decision is `repeat`.

### 9.3 Hydration/Reconciliation Workflow

The current `imported_repo_synthesis_and_hydration` workflow should be replaced or reworked into `imported_repo_backlog_reconciliation`.

Required outputs:

```ts
interface ImportedRepoBacklogReconciliationOutput {
  existingWorkItemCount: number;
  createdCount: number;
  updatedCount: number;
  doneCount: number;
  todoCount: number;
  backlogCount: number;
  blockedCount: number;
  skippedCount: number;
  reconciliationSummary: ImportedRepositoryBacklogReconciliationPlan;
  cycleDecision: OrchestrationCycleDecision;
  readyForCycle: boolean;
}
```

### 9.4 Orchestration Cycle Workflow

`project_orchestration_cycle_ceo` should not treat zero ready work as terminal by default.

If there are goals but no ready `todo` items:

1. if reconciliation has not run or is stale, run reconciliation;
2. if reconciliation produced blocked items, record `blocked` or route to clarification;
3. if reconciliation produced no work and goals are satisfied, record `complete`;
4. otherwise record `repeat` with a planned next action.

---

## 10. Proposed Service and Tool Changes

### 10.1 New Reconciliation Service

Add a kanban service module around the deep module:

```text
apps/kanban/src/orchestration/imported-repository-backlog-reconciler.ts
apps/kanban/src/orchestration/imported-repository-backlog-reconciler.spec.ts
```

Responsibilities:

1. load and classify `ProbeResultArtifact` records;
2. map `implemented` probes to `done` existing-capability work specs;
3. map `partial` probes to gap, bug, docs, test, or architecture work specs;
4. map `missing` probes and unmet goals to new-feature or investigation specs;
5. preserve open questions as blocked work or planner questions;
6. generate stable source IDs;
7. produce a typed reconciliation plan.

### 10.2 Reconciled Work Publisher

Add or deepen a publisher module:

```text
apps/kanban/src/orchestration/reconciled-work-item-publisher.ts
apps/kanban/src/orchestration/reconciled-work-item-publisher.spec.ts
```

Responsibilities:

1. validate `RepositoryWorkItemSpec` objects;
2. upsert by `metadata.sourceId`;
3. create `done` items without firing implementation workflows;
4. create `todo` items eligible for dispatch;
5. create `backlog` and `blocked` items without accidental dispatch;
6. preserve evidence metadata;
7. produce publish counts and diagnostics.

### 10.3 MCP Tool Adapter

Add a narrow MCP tool:

```text
kanban.reconcile_imported_repository_backlog
```

Inputs:

```ts
interface ReconcileImportedRepositoryBacklogInput {
  project_id: string;
  workspace_root: string;
  goals?: string[];
  probe_artifact_directory?: string;
  dry_run?: boolean;
}
```

Output:

```ts
interface ReconcileImportedRepositoryBacklogResult {
  ok: boolean;
  status: "completed" | "blocked" | "failed";
  plan: ImportedRepositoryBacklogReconciliationPlan;
  publish_summary?: ReconciledWorkItemPublishSummary;
}
```

This replaces or supersedes `synthesize_discovery_work_item_specs` for imported-repository projects.

### 10.4 Continuation Service

Add or deepen a continuation module:

```text
apps/kanban/src/orchestration/orchestration-continuation.service.ts
```

Responsibilities:

1. consume terminal domain outcomes;
2. evaluate autonomous project policy;
3. record cycle decisions;
4. emit `ProjectOrchestrationCycleRequestedEvent` when decision is `repeat`;
5. prevent duplicate cycle emissions through idempotency keys or active-run checks;
6. expose diagnostics for why the project is repeating, paused, blocked, or complete.

---

## 11. Data and Metadata Model

### 11.1 Work Item Metadata

Every reconciled imported-repository work item must include:

```json
{
  "source": "imported_repository_reconciliation",
  "sourceId": "imported-repo:<project>:<work-type>:<capability>",
  "sourceHash": "<hash-of-relevant-inputs>",
  "workType": "existing_capability | bug | test_gap | ...",
  "evidenceRefs": ["..."],
  "sourcePaths": ["..."],
  "probeScopeIds": ["..."],
  "confidenceScore": 0.92,
  "existingCapability": true,
  "pendingReview": false
}
```

### 11.2 Orchestration Metadata

Project orchestration metadata should include:

```json
{
  "last_reconciliation_run_id": "<workflow-run-id>",
  "last_reconciliation_at": "<iso-date>",
  "last_reconciliation_summary": {
    "created_count": 12,
    "updated_count": 3,
    "done_count": 24,
    "todo_count": 8,
    "backlog_count": 4,
    "blocked_count": 2
  },
  "cycle_decision": "repeat",
  "cycle_decision_reason": "Ready todo work remains",
  "autonomous_repeat_enabled": true
}
```

---

## 12. Examples From the Nexus Import Incident

The original imported repository investigation discovered several examples that should have become concrete work items.

### 12.1 Existing Capabilities as `done`

Examples of likely `done` imported-repository items:

1. Existing capability: Workflow Runtime Module
2. Existing capability: Workflow Special Steps Module
3. Existing capability: Workflow Step Execution Module
4. Existing capability: Kanban Project Work Items
5. Existing capability: Web Automation Module
6. Existing capability: War Room Module, if evidence supports implemented core behavior

Each should link to probe artifacts and source paths.

### 12.2 New Work as `todo`

Examples of likely new/gap work items:

1. Fix repair-agent telemetry initialization.
2. Fix `RepairJob.getTracker()` throwing behavior.
3. Add war-room unit and integration coverage.
4. Replace operations-doctor stubs with real diagnostics or mark scope explicitly unsupported.
5. Add auth rate limiting.
6. Add agent-local race-condition tests.
7. Split monolithic E2E tests into deterministic orchestration E2E coverage.

### 12.3 Blocked Work

Examples of blocked items:

1. Clarify whether EPIC-145 should remain complete while repair-agent defects exist.
2. Resolve ambiguous ownership between architecture docs and current implementation if evidence conflicts.
3. Ask for product priority when goals imply unbounded autonomous development.

---

## 13. Testing Strategy

### 13.1 Unit Tests

Add focused tests for:

1. `ImportedRepositoryBacklogReconciler` maps `implemented` probes to `done` specs.
2. `partial` probes with health findings become gap/bug/test/docs specs.
3. `missing` probes and unmatched goals become new-feature or investigation specs.
4. open questions become blocked specs or planner questions.
5. stable `sourceId` generation is deterministic.
6. existing board items are updated, not duplicated.
7. done-item publication does not trigger implementation workflows.
8. todo-item publication is dispatchable.
9. implementation-agent proposals cannot directly mutate board state.
10. cycle decision logic repeats by default for autonomous projects.

### 13.2 Seed Workflow Contract Tests

Add or update seed tests proving:

1. imported discovery invokes backlog reconciliation;
2. generic bootstrap one-ticket synthesis is no longer the imported-repo happy path;
3. continuation events are emitted through the standard continuation service;
4. manual recovery uses the same continuation path;
5. `repeat`, `pause`, `complete`, and `blocked` decisions are valid and visible.

### 13.3 Deterministic E2E Tests

Extend EPIC-163 with scenarios:

1. Imported repository with implemented code produces multiple `done` items.
2. Imported repository with known gaps produces multiple `todo` items.
3. Re-running reconciliation is idempotent.
4. Manual hydration/reconciliation recovery triggers the same continuation behavior as normal discovery.
5. Autonomous project repeats orchestration when todo work remains.
6. Autonomous project pauses only after explicit `pause`, `complete`, or `blocked` decision.

---

## 14. Implementation Phases

### Phase 1: Contracts and Reconciler Skeleton

1. Define `RepositoryWorkItemSpec` and reconciliation plan types.
2. Add fixtures representing implemented, partial, missing, and blocked probe artifacts.
3. Write failing reconciler tests.
4. Implement deterministic classification for the first small set of probe outcomes.

### Phase 2: Work Item Publisher

1. Add publisher tests for `done`, `todo`, `backlog`, and `blocked` specs.
2. Implement idempotent upsert by stable `sourceId`.
3. Ensure done-item publication bypasses automation triggers.
4. Preserve evidence metadata.

### Phase 3: MCP Tool and Workflow Wiring

1. Add `kanban.reconcile_imported_repository_backlog` tool.
2. Register the tool in the kanban MCP mutation exports and tool manifests.
3. Update imported repository discovery/hydration workflows to use reconciliation.
4. Keep old `synthesize_discovery_work_item_specs` only as a legacy adapter or remove it if no callers remain.

### Phase 4: Continuous Orchestration

1. Add cycle decision contract and persistence.
2. Add continuation service.
3. Route hydration/reconciliation success into continuation.
4. Route work-item terminal states into continuation.
5. Default autonomous projects to `repeat`.
6. Add duplicate-cycle protection.

### Phase 5: Proposal Path for Implementation Agents

1. Add `ProposedFollowUpWorkEvent` contract.
2. Allow implementation workflows to emit proposals.
3. Add planner workflow to review and publish proposals.
4. Ensure implementation agents still cannot directly create arbitrary goals/work items.

### Phase 6: Deterministic E2E and Recovery

1. Extend EPIC-163 test suite.
2. Add imported-repo meaningful-board happy path.
3. Add manual recovery continuation test.
4. Add repeat-until-explicit-stop test.
5. Re-run the original project recovery path and verify the board becomes useful.

---

## 15. Actionable Tasks

- [ ] E164-001 Define `RepositoryWorkItemSpec`, reconciliation plan, and cycle decision contracts.
- [ ] E164-002 Add probe-artifact fixtures for implemented, partial, missing, and blocked imported-repo findings.
- [ ] E164-003 Implement `ImportedRepositoryBacklogReconciler` with tests for existing capabilities as `done`.
- [ ] E164-004 Extend reconciler to produce `todo`, `backlog`, and `blocked` specs from health findings, open questions, missing capabilities, and goals.
- [ ] E164-005 Add deterministic stable `sourceId` and `sourceHash` generation.
- [ ] E164-006 Implement idempotent reconciled work-item publisher.
- [ ] E164-007 Ensure publisher can create `done` imported-reality items without firing implementation workflows.
- [ ] E164-008 Add `kanban.reconcile_imported_repository_backlog` MCP tool and schema.
- [ ] E164-009 Register the new tool in kanban MCP exports and tool manifests.
- [ ] E164-010 Replace imported-repo one-ticket synthesis workflow path with backlog reconciliation.
- [ ] E164-011 Preserve or migrate existing `synthesize_discovery_work_item_specs` callers.
- [ ] E164-012 Add orchestration cycle decision persistence.
- [ ] E164-013 Add continuation service for repeat/pause/complete/blocked decisions.
- [ ] E164-014 Route manual recovery through the same continuation service as normal workflow completion.
- [ ] E164-015 Add duplicate-cycle protection for repeated autonomous orchestration.
- [ ] E164-016 Add governed follow-up proposal event for implementation agents.
- [ ] E164-017 Add planner review/publish workflow for proposed follow-up work.
- [ ] E164-018 Extend seed workflow contract tests for reconciliation and continuous orchestration.
- [ ] E164-019 Extend deterministic orchestration E2E tests from EPIC-163.
- [ ] E164-020 Re-run recovery for project `dad09d35-4e5a-47fa-9dc0-ffa3b8960af4` and verify meaningful done/todo/backlog/blocked board state.

---

## 16. Acceptance Criteria

1. A fresh imported repository with implemented capabilities produces multiple `done` work items linked to evidence.
2. A fresh imported repository with discovered gaps produces concrete `todo` or `backlog` work items with acceptance criteria.
3. Ambiguous findings produce visible `blocked` items or planner questions, not silent no-ops.
4. The generic `Bootstrap imported repository execution plan` item is no longer the primary imported-repo hydration output.
5. Re-running reconciliation updates existing items by `sourceId` rather than duplicating them.
6. Implementation agents cannot directly create arbitrary work items or goals.
7. Implementation agents can propose follow-up work through a governed proposal path.
8. Planner/CEO workflows can validate and publish proposed work.
9. Autonomous projects repeat orchestration by default while actionable work or planning work remains.
10. Orchestration stops only when a persisted cycle decision is `pause`, `complete`, or `blocked`.
11. Manual recovery and normal discovery use the same continuation path.
12. The original project `dad09d35-4e5a-47fa-9dc0-ffa3b8960af4` can be reconciled into a useful board that includes already-done repository capabilities and new executable work.
13. Deterministic E2E coverage proves meaningful imported-repo board creation and repeat orchestration without live LLM credentials.

---

## 17. Quality Gates

Run before this epic is considered complete:

1. `npm run test --workspace=apps/kanban -- src/orchestration/imported-repository-backlog-reconciler.spec.ts`
2. `npm run test --workspace=apps/kanban -- src/orchestration/reconciled-work-item-publisher.spec.ts`
3. `npm run test --workspace=apps/kanban -- src/orchestration/orchestration.service.spec.ts`
4. `npm run test --workspace=apps/kanban -- src/seeds/workflows.seed.contract.spec.ts`
5. `npm run test --workspace=apps/api -- src/workflow/validation/work-item-publication-prompts.boundary.spec.ts`
6. `npm run validate:seed-data`
7. `npm run test:kanban`
8. `npm run build:kanban`
9. `npm run test:e2e:orchestration` after EPIC-163 exists.

---

## 18. Risks and Mitigations

1. Risk: Reconciler creates too many work items from noisy probe output.
   Mitigation: require evidence refs, confidence thresholds, source IDs, and typed work types; cap low-confidence output into blocked/planner questions.

2. Risk: `done` imported-reality items trigger automation intended for newly implemented work.
   Mitigation: publisher must bypass status-change automation for imported-reality creation or use a dedicated creation path that records ledger events without launching implementation workflows.

3. Risk: Marking imported capabilities as `done` overstates correctness.
   Mitigation: require high-confidence evidence for `done`; use `pendingReview` metadata or blocked/planner questions for medium or contradictory evidence.

4. Risk: Continuous repeat creates runaway orchestration loops.
   Mitigation: record cycle decisions, add duplicate-cycle protection, use active-run checks, and require explicit reason/evidence for repeats.

5. Risk: Planner-owned creation becomes too powerful.
   Mitigation: expose narrow typed tools, validate specs, prohibit arbitrary untyped mutations, and audit every publish action.

6. Risk: Implementation agents still need to surface discovered follow-up work.
   Mitigation: provide `ProposedFollowUpWorkEvent` instead of broad mutation rights.

7. Risk: Existing EPIC-138 expectations conflict with direct `done` hydration.
   Mitigation: refine EPIC-138 policy by distinguishing imported repository reality items from new delivery workflow items; use `pendingReview` metadata when confidence is not high.

8. Risk: Manual recovery remains special-case behavior.
   Mitigation: route manual recovery through the same continuation service used by normal workflow completion.

---

## 19. Open Questions

1. Should medium-confidence existing capabilities be created as `done` with `pendingReview:true`, or `in-review` with special automation suppression?
2. Should imported-reality `done` items appear in the main kanban board by default, or behind an imported baseline filter?
3. What is the maximum number of imported-reality `done` items to create in one reconciliation run before batching is required?
4. Should goal updates be applied automatically by the CEO/planner, or only proposed for user approval?
5. What default repeat cadence should autonomous projects use when no dispatchable work remains but goals are not complete?
6. How should cycle decisions be surfaced in the web UI and event ledger?
7. Should the old generic bootstrap ticket be deleted during migration, marked done, or converted into a reconciliation summary artifact?

---

## 20. Migration Notes for Existing Project `dad09d35-4e5a-47fa-9dc0-ffa3b8960af4`

After this epic is implemented, run repository backlog reconciliation against the existing workspace:

```text
Project ID: dad09d35-4e5a-47fa-9dc0-ffa3b8960af4
Repository: https://github.com/imjimmeh/nexus-orchestator
Workspace: /data/nexus-workspaces/clones/dad09d35-4e5a-47fa-9dc0-ffa3b8960af4
Existing generic item: a041368c-b00f-4dcc-b0e2-e675bfa71248
```

Expected migration behavior:

1. Preserve or archive the generic bootstrap item for audit.
2. Create imported-reality `done` items for implemented capabilities found by the probe artifacts.
3. Create actionable `todo` items for known bugs and gaps.
4. Create `blocked` items for unresolved decisions.
5. Record a `repeat` cycle decision if todo/backlog work remains.
6. Emit or schedule the next orchestration cycle through the standard continuation service.
