# EPIC-027: Remove Inception Flow — "Everything Is A Work Item"

## Problem Statement

The inception flow is a parallel system that duplicates the kanban + workflow engine. It has its own controller, service, agent service, git service, frontend wizard, and event chain. This creates:

- **Fragility**: A 6-service chain where any failure breaks the entire flow
- **Duplication**: Inception manages containers, git, agents, and work items independently from the kanban system that does the exact same things
- **Bottleneck**: Work items can ONLY be created through inception approval — there's no direct creation path
- **Maintenance burden**: ~8 inception-specific files that must be maintained alongside the kanban equivalents

## Solution

Collapse inception into the kanban board. PRD generation, SDD generation, spec decomposition, and implementation are all just work items with different agent profiles.

### Architecture Change

```
BEFORE:                                          AFTER:
─────────────────────                            ─────────────────────
Inception Wizard (special path)                  Kanban Board (unified path)
  ├─ InceptionController                           ├─ WorkItemController
  ├─ InceptionService                              │   ├─ POST /work-items (NEW)
  ├─ InceptionArchitectAgentService                │   ├─ PATCH /work-items/:id (NEW)
  ├─ GitSpecCommitService                          │   ├─ DELETE /work-items/:id (NEW)
  ├─ SpecParserService                             │   └─ ... existing endpoints
  └─ InceptionSpecsMergedEvent                     │
       ↓                                           ├─ Workflow Engine (existing)
  Kanban Board (normal path)                       │   ├─ Container provisioning
  ├─ WorkItemController                            │   ├─ Git worktree management
  ├─ StatusObserverService                         │   ├─ Agent execution
  ├─ Workflow Engine                               │   └─ QA / merge automation
  └─ Container Orchestrator                        │
                                                   └─ Agent Profiles
                                                       ├─ product-manager (NEW)
                                                       ├─ architect-agent (KEEP)
                                                       ├─ spec-generator (NEW)
                                                       └─ ... existing profiles
```

## Tasks

### Phase 1: Foundation — Direct Work Item CRUD
- [x] **TASK-027-01**: Add `POST /projects/:projectId/work-items` create endpoint
- [x] **TASK-027-02**: Add `POST /projects/:projectId/work-items/bulk` bulk create endpoint
- [x] **TASK-027-03**: Add `DELETE /projects/:projectId/work-items/:id` delete endpoint
- [x] **TASK-027-04**: Add `PATCH /projects/:projectId/work-items/:id` update endpoint
- [x] **TASK-027-05**: Unit tests for all new CRUD endpoints (controller + service)

### Phase 2: Agent Tool — `create_work_items`
- [x] **TASK-027-06**: Add `create_work_items` action to `nexus_orchestrator` tool
- [x] **TASK-027-07**: Add validation for `create_work_items` payload
- [x] **TASK-027-08**: Unit tests for the new tool action

### Phase 3: New Agent Profiles
- [x] **TASK-027-09**: Add `product-manager` agent profile seed
- [x] **TASK-027-10**: Add `spec-generator` agent profile seed
- [x] **TASK-027-11**: Update `architect-agent` prompt (remove inception references)
- [x] **TASK-027-12**: Unit tests for new profile seeds

### Phase 4: Frontend — Kanban Board Enhancements
- [x] **TASK-027-13**: Add `createWorkItem` and `createWorkItemsBulk` API client methods
- [x] **TASK-027-14**: Add `deleteWorkItem` and `updateWorkItem` API client methods
- [x] **TASK-027-15**: Create `CreateWorkItemModal` component
- [x] **TASK-027-16**: Add "+ Add Item" button to kanban board
- [x] **TASK-027-17**: Simplify project creation (skip inception wizard)
- [x] **TASK-027-18**: React hooks for new work item operations

### Phase 5: Cleanup — Remove Inception Code
- [x] **TASK-027-19**: Delete inception controller, service, agent service, git spec commit service, spec parser service
- [x] **TASK-027-20**: Delete inception DTOs and events
- [x] **TASK-027-21**: Remove inception from ProjectModule wiring
- [x] **TASK-027-22**: Delete frontend inception page and hooks
- [x] **TASK-027-23**: Remove inception API client methods
- [x] **TASK-027-24**: Verify full test suite passes

### Phase 6: Documentation
- [x] **TASK-027-25**: Update developer documentation

## Success Criteria

- Users can create work items directly on the kanban board
- Agents can create work items via the `create_work_items` tool action
- PRD generation works as a normal work item with `product-manager` agent
- SDD generation works as a normal work item with `architect-agent`
- Spec decomposition works as a normal work item with `spec-generator` agent
- All inception-specific code is deleted
- Full test suite passes
- Existing kanban automation (QA, merge, etc.) continues to work
