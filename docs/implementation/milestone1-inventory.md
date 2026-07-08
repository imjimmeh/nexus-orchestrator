# Milestone 1: Inventory of Existing Code

**Work Item:** Wire CEO cycle decisions into the learning candidate pipeline  
**Work Item ID:** 884a2230-bec1-45e1-8727-96583401cb20  
**Milestone:** 1-inventory-existing-code

## Overview

This document inventories the existing code patterns for connecting the `kanban.complete_orchestration_cycle_decision` tool to the learning candidate pipeline. It identifies all relevant files, event patterns, and integration points.

---

## Task 1.1: Cycle Decision Tool Implementation

### File Path

```
apps/kanban/src/mcp/tools/mutation/complete-orchestration-cycle-decision.tool.ts
```

### Tool Definition

```typescript
getName(): string {
    return "kanban.complete_orchestration_cycle_decision";
}

getDefinition() {
    return {
        name: "kanban.complete_orchestration_cycle_decision",
        description: "Record the final orchestration cycle decision and mirror it into workflow job output for the current execution.",
        inputSchema: CompleteOrchestrationCycleDecisionSchema,
        tierRestriction: 2,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
    };
}
```

### Function Signature

```typescript
async execute(
    context: InternalToolExecutionContext,
    params: CompleteOrchestrationCycleDecisionParams,
): Promise<unknown>
```

### Input Schema

Located at `apps/kanban/src/mcp/tools/shared/schemas.ts`:

```typescript
export const CompleteOrchestrationCycleDecisionSchema =
  OrchestrationRecordCycleDecisionSchema;
```

### What It Currently Does with the Decision

1. **Records the decision** via `OrchestrationRecordCycleDecisionTool.execute()`
2. **Writes workflow job output**: Sets `{ decision, decision_reason }` via `coreWorkflowClient.setWorkflowJobOutput()`
3. **Creates board state snapshot**: Stores snapshot before decision via `boardStateService.createBoardStateSnapshot()`
4. **Detects board mutation**: Checks if board state changed since last decision
5. **Emits `kanban.retrospective_cycle_decision_recorded.v1`** for substantive decisions (blocked, complete, or repeat with board mutation)
6. **Emits `learning.candidate.proposed.v1`** for substantive decisions
7. **Calls `stepComplete`**: Signals workflow completion

### Key Implementation Details

The tool already emits learning candidate events! Key method:

```typescript
private async emitLearningCandidateProposed(params: {
    projectId: string;
    decision: string;
    reason: string;
    workflowRunId: string;
    jobId: string;
    idempotencyKey?: string;
    workItemCountsSnapshot: { total: number; byStatus: Record<string, number> } | null;
}): Promise<void>
```

---

## Task 1.2: Existing Event Patterns

### Event Definition File

```
apps/kanban/src/core/events/domain-events.ts
```

### Event Constants

```typescript
// Emitted when a substantive cycle decision is recorded
export const RETROSPECTIVE_CYCLE_DECISION_RECORDED_EVENT =
  "kanban.retrospective_cycle_decision_recorded.v1";

// Event emitted when a cycle decision is recorded (all decisions including trivial repeats)
export const CYCLE_DECISION_RECORDED_EVENT =
  "kanban.cycle_decision_recorded.v1";

// Event emitted when a learning candidate is proposed
export const LEARNING_CANDIDATE_PROPOSED_EVENT =
  "learning.candidate.proposed.v1";
```

### Event Emission Pattern

Events are emitted via `CoreWorkflowClientService`:

```typescript
// Non-throwing variant (logs warnings on failure)
async emitDomainEvent(params: {
    eventName: string;
    eventId?: string;
    payload: Record<string, unknown>;
}): Promise<void>

// Throwing variant (propagates errors)
async emitDomainEventOrThrow(params: {
    eventName: string;
    eventId?: string;
    payload: Record<string, unknown>;
}): Promise<void>
```

### Event Publisher Implementation

```
apps/kanban/src/core/kanban-domain-event-publisher.service.ts
```

```typescript
async emitDomainEvent(params: {
    eventName: string;
    eventId?: string;
    payload: Record<string, unknown>;
}): Promise<void> {
    await this.httpClient.postJson<Record<string, unknown>>(
        "/internal/kanban/events",
        params,
        "domain event emission",
    );
}
```

### Event Schema Pattern

**`learning.candidate.proposed.v1` Payload Structure:**

```typescript
{
    event_name: "learning.candidate.proposed.v1",
    source_service: "kanban",
    scope_type: "kanban_project",
    scope_id: "project-123",
    lesson: "Kanban project X completed an orchestration cycle with N done items...",
    evidence: [
        {
            kind: "kanban_retrospective_delta",
            id: "cycle-decision-workflowRunId-timestamp",
            summary: "Human-readable summary",
            data: { /* structured data */ }
        }
    ],
    confidence: 0.6,
    tags: ["kanban", "retrospective", "orchestration-cycle"],
    provenance: {
        project_id: "...",
        workflow_run_id: "...",
        job_id: "...",
        idempotency_key: "...",
        decision_source: "orchestration_cycle",
        cycle_decision: "complete|blocked|repeat"
    }
}
```

---

## Task 1.3: Retrospective Service

### File Path

```
apps/kanban/src/retrospectives/kanban-retrospective.service.ts
```

### Purpose

Runs retrospective analysis on kanban projects to generate learning candidates when cycle decisions complete.

### Key Methods

#### `runForCompletion()`

```typescript
async runForCompletion(
    trigger: KanbanRetrospectiveCompletionTrigger,
): Promise<KanbanRetrospectiveRunResult>
```

- Triggered by completion events
- Creates idempotency key: `kanban-retrospective:completion_event:project_id:trigger_revision_marker`
- Runs cooldown check (15 minutes)
- Collects project evidence
- Emits `learning.candidate.proposed.v1` event

#### `runManualReplay()`

```typescript
async runManualReplay(
    dto: RunRetrospectiveDto,
): Promise<KanbanRetrospectiveRunResult>
```

- Allows manual triggering of retrospective analysis
- Supports replay of previous runs

### How It Consumes Events

The evidence service (`kanban-retrospective-evidence.service.ts`) queries `KanbanEventDeliveryProjectionRepository` to fetch stored cycle decision events:

```typescript
private async getCycleDecisionEvents(
    projectId: string,
): Promise<CycleDecisionEventEvidence[]> {
    const events = await this.eventProjections.listByProject(projectId);
    return events
        .filter((event) => this.isCycleDecisionEvent(event))
        .map((event) => this.extractCycleDecisionEvidence(event));
}
```

### Event Consumption Files

| File                                                                      | Purpose                                     |
| ------------------------------------------------------------------------- | ------------------------------------------- |
| `apps/kanban/src/retrospectives/kanban-retrospective-evidence.service.ts` | Collects evidence from event projections    |
| `apps/kanban/src/retrospectives/retrospectives.controller.ts`             | HTTP endpoints for retrospective operations |
| `apps/kanban/src/retrospectives/events/cycle-decision.recorded.event.ts`  | Event definition for cycle decisions        |

---

## Task 1.4: Learning API / Record Learning

### File Path

```
apps/api/src/memory/learning/record-learning.service.ts
```

### Service Signature

```typescript
async recordLearning(
    context: InternalToolExecutionContext,
    params: RecordLearningParams,
): Promise<RecordLearningResult>
```

### RecordLearningParams

```typescript
type RecordLearningParams = {
  scope_type: string;
  scope_id: string;
  lesson: string;
  evidence: Array<{ kind: string; id: string; summary: string }>;
  tags: string[];
  confidence: number;
  provenance?: Record<string, unknown>;
};
```

### RecordLearningResult

```typescript
interface RecordLearningResult extends Record<string, unknown> {
  status: string;
  candidate_id: string;
  created: boolean;
  fingerprint: string;
}
```

### How Learning Candidates Are Created

1. **Normalization**: Scope type, scope ID, tags, evidence, and lesson are normalized
2. **Fingerprinting**: Creates SHA-256 fingerprint from normalized data to detect duplicates
3. **Duplicate Check**: Queries `LearningCandidateRepository.findByFingerprint()`
4. **Creation**: If no duplicate, creates `LearningCandidate` entity with:
   - `scope_type`, `scope_id`
   - `title` (derived from lesson, max 220 chars)
   - `summary` (full lesson text)
   - `fingerprint` (for deduplication)
   - `signals_json` (includes lesson, evidence, tags, confidence, provenance)
   - `score`, `confidence`
   - `status: 'pending'`

### Event Listener for Learning Candidate Proposals

```
apps/api/src/memory/learning/learning-candidate-proposal.listener.ts
```

```typescript
@OnEvent(LEARNING_CANDIDATE_PROPOSED_EVENT)
async handleLearningCandidateProposed(payload: unknown): Promise<void> {
    await this.recordLearningService.recordLearning(
        {},
        {
            scope_type: payload.scope_type,
            scope_id: payload.scope_id,
            lesson: payload.lesson,
            evidence: payload.evidence,
            confidence: payload.confidence,
            tags: payload.tags,
            provenance: { /* ... */ },
        },
    );
}
```

---

## Task 1.5: Board State Access

### File Path

```
apps/kanban/src/services/board-state.service.ts
```

### Current Implementation (Stubs)

```typescript
@Injectable()
export class BoardStateService {
  private snapshots: Map<string, BoardStateSnapshot> = new Map();

  getBoardStateSummary(projectId: string): BoardStateSummary {
    /* TODO */
  }
  detectBoardMutation(projectId: string, idempotencyKey?: string): boolean {
    /* TODO */
  }
  createBoardStateSnapshot(projectId: string): BoardStateSnapshot {
    /* TODO */
  }
  storeBoardStateSnapshot(
    projectId: string,
    idempotencyKey: string,
    snapshot: BoardStateSnapshot,
  ): void {
    /* TODO */
  }
}
```

### Board State Summary Interface

```typescript
export interface BoardStateSummary {
  projectId: string;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
  lastActivityAt: Date | null;
  column_counts?: Record<string, number>;
  work_item_counts?: {
    total: number;
    byStatus: Record<string, number>;
    activeCount: number;
    doneCount: number;
  };
  goal_coverage?: {
    total: number;
    active: number;
    completed: number;
    coveragePercentage: number;
  };
}
```

> **Status (post-M7, 2026-06-23):** The four `?`-marked fields are still
> optional on the type for backward compatibility with hand-constructed
> summaries (test fixtures, snapshot readers), but
> `BoardStateService.getBoardStateSummary` always populates them at runtime.
> Locked semantics: terminal work-item statuses are `['done', 'completed']`
> (`doneCount` aggregates both; `activeCount` excludes both);
> `goal_coverage.coveragePercentage` is `0` (not `NaN`) when `total === 0`;
> archived goals are excluded via
> `KanbanProjectGoalRepository.findByproject_id(projectId, /* includeArchived */ false)`.

### Evidence Service Board State Access

The `KanbanRetrospectiveEvidenceService` accesses board state through repositories:

```typescript
async collectProjectEvidence(projectId: string): Promise<KanbanRetrospectiveEvidence> {
    const project = await this.projects.findById(projectId);
    const orchestration = await this.orchestrations.findByproject_id(projectId);
    const workItems = await this.workItems.findByproject_id(projectId);
    // ... builds delta snapshot
}
```

### Repositories for Board State

| Repository                                | Purpose                              |
| ----------------------------------------- | ------------------------------------ |
| `KanbanProjectRepository`                 | Project metadata                     |
| `KanbanOrchestrationRepository`           | Orchestration state and decision log |
| `KanbanWorkItemRepository`                | Work items with status               |
| `KanbanEventDeliveryProjectionRepository` | Stored domain events                 |
| `LearningCandidateRepository`             | Learning candidates (API side)       |

---

## Summary: Key Integration Points

### Current Flow (Already Implemented!)

The `kanban.complete_orchestration_cycle_decision` tool **already emits** `learning.candidate.proposed.v1` events for substantive decisions. The flow is:

```
1. CEO makes cycle decision (blocked | complete | repeat)
          ↓
2. kanban.complete_orchestration_cycle_decision.execute() called
          ↓
3. Decision recorded via OrchestrationRecordCycleDecisionTool
          ↓
4. Board state snapshot created + mutation detection
          ↓
5. If substantive decision:
   ├─ Emit kanban.retrospective_cycle_decision_recorded.v1
   └─ Emit learning.candidate.proposed.v1  ← Learning pipeline entry point
          ↓
6. Event listener (LearningCandidateProposalListener) receives event
          ↓
7. RecordLearningService creates/retrieves learning candidate
          ↓
8. Candidate stored with fingerprint for deduplication
```

### Substantive Decision Logic

A decision is "substantive" if:

- `decision === "blocked"` → Always substantive
- `decision === "complete"` → Always substantive
- `decision === "repeat"` → Only substantive if board mutation detected

### Event Flow to Learning

| Step | Component        | Event                            |
| ---- | ---------------- | -------------------------------- |
| 1    | Tool execution   | Internal                         |
| 2    | Tool → Publisher | `emitDomainEvent()`              |
| 3    | HTTP             | POST `/internal/kanban/events`   |
| 4    | Event Bus        | `learning.candidate.proposed.v1` |
| 5    | Listener         | `@OnEvent()`                     |
| 6    | Service          | `recordLearning()`               |
| 7    | Database         | `learning_candidates` table      |

---

## File Index

| Category                    | File Path                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------- |
| **Cycle Decision Tool**     | `apps/kanban/src/mcp/tools/mutation/complete-orchestration-cycle-decision.tool.ts` |
| **Tool Input Schema**       | `apps/kanban/src/mcp/tools/shared/schemas.ts`                                      |
| **Event Constants**         | `apps/kanban/src/core/events/domain-events.ts`                                     |
| **Event Publisher**         | `apps/kanban/src/core/kanban-domain-event-publisher.service.ts`                    |
| **Workflow Client**         | `apps/kanban/src/core/core-workflow-client.service.ts`                             |
| **Retrospective Service**   | `apps/kanban/src/retrospectives/kanban-retrospective.service.ts`                   |
| **Evidence Service**        | `apps/kanban/src/retrospectives/kanban-retrospective-evidence.service.ts`          |
| **Retrospective Types**     | `apps/kanban/src/retrospectives/retrospective.types.ts`                            |
| **Board State Service**     | `apps/kanban/src/services/board-state.service.ts`                                  |
| **Record Learning Service** | `apps/api/src/memory/learning/record-learning.service.ts`                          |
| **Learning Event Listener** | `apps/api/src/memory/learning/learning-candidate-proposal.listener.ts`             |

---

## Next Steps

Based on this inventory, the integration is **already wired** in the code. Next steps for milestone 2 would be:

1. Verify the event listener registration in the API module
2. Add integration tests for end-to-end flow
3. Test board mutation detection implementation
4. Verify duplicate detection with fingerprinting

---

_Document generated: 2026-06-01_
