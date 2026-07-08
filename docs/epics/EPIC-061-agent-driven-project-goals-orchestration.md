# EPIC-061: Agent-Driven Project Goals Orchestration

> Status: Planned  
> Priority: High  
> Estimate: 3-4 weeks  
> Created: 2026-04-17  
> Last Updated: 2026-04-17  
> Owner: TBD  
> Related: EPIC-059 (Project Goals as First-Class Product)

---

## 1. Epic Summary

Project goals (EPIC-059) are fully modeled as first-class domain objects with REST APIs, database persistence, and UI controls. However, the **orchestrator agent has zero capacity to update project goals programmatically**. Goals remain isolated from the agent orchestration layer — agents cannot create, modify, archive, or transition goals as part of an orchestration cycle.

This epic bridges that gap by:

1. Exposing project goal CRUD operations as agent-callable tools.
2. Adding these tools to the orchestration runtime capability manifest.
3. Creating skills and instructions for agents to make goal updates safely and idiomatically.
4. Supporting goal updates as first-class orchestration actions (like `update_project_strategy`).
5. Implementing comprehensive audit/telemetry for goal mutations driven by agents.

---

## 2. Problem Statement and Current-State Gaps

### 2.1 Current behavior

1. **REST APIs exist** — `PATCH /projects/:projectId/goals/:goalId`, `POST .../goals/:goalId/status`, etc. in `project-goals.controller.ts`
2. **Service layer is complete** — `ProjectGoalsService` has full CRUD, status transitions, archival, reordering, and worklog operations
3. **Only human-driven** — Users update goals via `/projects/:projectId/workspace?tab=goals` web UI
4. **Agents cannot access** — Orchestrator agent has no tool for goal mutations; delegating to specialist agents (e.g., `invoke_agent_workflow`) is the only workaround

### 2.2 Operational and capability gaps

1. **Orchestration cycles cannot refine goals** — If discovery reveals new requirements, the orchestrator cannot update the project goals. It can only invoke a specialist (indirect and verbose).
2. **Goal completion is manual** — Agents complete work items but cannot mark corresponding goals as done.
3. **No goal-based context injection** — Workflows cannot read canonical project goals and mutate them based on execution outcomes.
4. **Audit trail incomplete** — Goal mutations lack agent attribution; no event records show which orchestration run updated which goals.
5. **Capability inconsistency** — Agents can `update_project_strategy`, `kanban.dispatch_selected_work_items`, and `invoke_agent_workflow`, but not manage goals directly.

### 2.3 Use cases blocked

1. **Orchestration refinement** — "During discovery, the product-manager agent drafts goals. The orchestrator reviews and updates them in-place based on feasibility analysis."
2. **Work-item-to-goal completion** — "When all work items linked to a goal are completed, automatically mark the goal as completed."
3. **Dynamic scope adjustment** — "If a feature's complexity changes during implementation, the orchestrator adjusts goal priority and metadata."
4. **Multi-phase goal management** — "Phase 1 marks initial goals as in-progress; Phase 2 adds new stretch goals; Phase 3 archives completed goals."

---

## 3. Scope and Non-Goals

### 3.1 In scope

1. **Goal CRUD tools** — Agent-callable tools for:
   - `create_project_goal` — New goal creation
   - `update_project_goal` — Modify title, description, metadata, priority, MoSCoW
   - `update_project_goal_status` — Transition goal status (todo → in-progress → completed/cancelled)
   - `reorder_project_goals` — Reorder active goals
   - `archive_project_goal` — Archive a goal
   - `unarchive_project_goal` — Restore archived goal

2. **Capability manifest integration** —
   - Add tool definitions to `capability-manifest.runtime.orchestration.entries.ts`
   - Set `tierRestriction: 2` (approval-gated for safety)
   - Add `policyTags: ['mutating', 'approval_gated']`

3. **Orchestration mutating action support** —
   - Register each tool as a `mutatingAction` in `ProjectOrchestrationRuntimeActionsService`
   - Route API callbacks via `WorkflowRuntimeToolsController`
   - Execute via `ProjectOrchestrationActionExecutionService`

4. **Agent instructions & prompts** —
   - Create skill documentation: `.agents/skills/project-goals-orchestration/SKILL.md`
   - Document tool contracts, validation rules, idempotency patterns
   - Provide workflow prompt guidance for orchestrator/product-manager agents

5. **Event ledger & telemetry** —
   - Emit `ProjectGoalUpdated` domain event with agent attribution
   - Log orchestration decision rationale in `project_orchestration_decision_log`
   - Include goal mutations in `workflow_run_todo` lineage tracking

6. **Test coverage** —
   - Unit tests for service mutations via orchestration paths
   - Integration tests for orchestration action execution
   - E2E tests for orchestration cycle with goal updates
   - Deterministic test workflows using goal updates

7. **Documentation** —
   - Architecture doc: `docs/architecture/agent-driven-goal-orchestration.md`
   - Update EPIC-059 completion notes
   - Update workflow design guide with goal mutation patterns

### 3.2 Out of scope

1. Bulk goal mutations (phase 2).
2. Automated goal completion based on work item status (future automation layer).
3. Goal conflict/dependency resolution (phase 2).
4. Goal forecasting or predictive completion (analytics layer).
5. External stakeholder notifications on goal changes (integration layer).
6. New role-based permissions for goal mutations (beyond existing Admin/Developer/Agent).

---

## 4. Request Coverage Mapping

This epic directly enables:

- ✅ **Orchestration agents can now update project goals** — Full CRUD exposed via tools
- ✅ **Skill documentation** — Agent instructions for safe, idiomatic goal mutations
- ✅ **Tool registration** — Each operation is a discrete tool in the capability manifest
- ✅ **Integration with orchestration** — Mutating actions route through approval gates
- ✅ **Audit trail** — Domain events and workflow logs track all agent-driven mutations

---

## 5. Architecture & Design

### 5.1 Tool catalog and capability manifest

Six new runtime orchestration tools, mirroring existing REST API operations:

```typescript
// capability-manifest.runtime.orchestration.entries.ts

const GOAL_MUTATION_DEFINITIONS: ReadonlyArray<RuntimeCapabilityDefinition> = [
  {
    name: 'create_project_goal',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'approval_gated'],
    description: 'Create a new project goal. Provide a clear title and optional description.',
    mutatingAction: 'create_project_goal',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/orchestration/goals',
      bodyMapping: {
        project_id: 'project_id',
        title: 'title',
        description: 'description',
        moscow: 'moscow',
        priority: 'priority',
      },
    },
    inputSchema: createProjectGoalSchema,
  },
  // ... update_project_goal, update_project_goal_status, etc.
];
```

### 5.2 Execution routing

```
WorkflowRuntimeToolsController
  @Post('/orchestration/goals')
  async createProjectGoal(@Body() body: CreateProjectGoalRequestBody)
    → ProjectOrchestrationRuntimeActionsService.createProjectGoal()
      → ProjectOrchestrationActionExecutionService.executeMutatingAction()
        → ProjectGoalsService.createGoal()
        → EventEmitter.emit('ProjectGoalCreated')
        → ProjectOrchestrationDecisionLogService.recordAction()
```

### 5.3 Validation and safety

1. **Input validation** — Zod schemas for all goal mutations (title length, priority enum, status transitions)
2. **Project existence** — Enforce `projectId` exists before allowing goal mutations
3. **Status transition rules** — Enforce valid state machine (todo → in-progress → completed | cancelled)
4. **Archive safety** — Cannot directly archive active goals; must transition status first
5. **Idempotency** — Goal creation with duplicate title handled gracefully (409 or upsert semantics defined per tool)

### 5.4 Event-driven audit trail

Each goal mutation emits a domain event:

```typescript
// Domain events
interface ProjectGoalCreatedEvent {
  goalId: string;
  projectId: string;
  title: string;
  createdBy: string; // agent profile or user
  workflowRunId?: string;
  correlationId?: string;
}

interface ProjectGoalStatusChangedEvent {
  goalId: string;
  projectId: string;
  oldStatus: string;
  newStatus: string;
  changedBy: string;
  reasoning?: string; // from agent decision log
}
```

Subscribe in:
- `ProjectOrchestrationEventsService` — Record in orchestration timeline
- `WorkflowEventLogService` — Per-run audit trail
- `EventLedger` — Central immutable log

---

## 6. Detailed Task List

### Task 1: Extend Capability Manifest with Goal Tools

**Files:**
- `apps/api/src/tool/capability-manifest.runtime.orchestration.entries.ts`
- `apps/api/src/workflow/workflow-runtime-orchestration-actions.service.types.ts`

**Work:**
1. Define 6 new `RuntimeCapabilityDefinition` entries (create, update, update_status, reorder, archive, unarchive)
2. Set `tierRestriction: 2` and `policyTags: ['mutating', 'approval_gated']`
3. Create corresponding Zod schemas: `createProjectGoalSchema`, `updateProjectGoalSchema`, etc. in `@nexus/core`
4. Validate schema against existing DTO constraints

**Acceptance:**
- [ ] `npm run lint` passes on capability manifest file
- [ ] ESLint enforces type safety on schema definitions
- [ ] All 6 tools appear in `getCapabilities` output for orchestration runs
- [ ] Schemas properly reject invalid inputs (e.g., empty title, invalid status)

---

### Task 2: Implement Orchestration Action Handlers

**Files:**
- `apps/api/src/project/project-orchestration-mutating-action.execution.ts`
- `apps/api/src/workflow/workflow-runtime-orchestration-actions.service.ts`

**Work:**
1. Add goal-mutation executors in `project-orchestration-mutating-action.execution.ts`:
   ```typescript
   async function executeCreateProjectGoal(
     projectId: string,
     payload: Record<string, unknown>,
     dependencies: { projectGoalsService: ProjectGoalsService }
   ): Promise<MutatingActionResult>
   ```
2. Register handlers in `WorkflowRuntimeOrchestrationActionsService`:
   ```typescript
   async createProjectGoal(params: CreateProjectGoalParams): Promise<Record<string, unknown>>
   async updateProjectGoal(params: UpdateProjectGoalParams): Promise<Record<string, unknown>>
   // etc.
   ```
3. Call `ProjectGoalsService` methods; emit events; record decision log

**Acceptance:**
- [ ] All 6 action types can be invoked and routed to corresponding service methods
- [ ] Service results are properly serialized in action response
- [ ] Errors (project not found, invalid status) are caught and returned with diagnostic detail

---

### Task 3: Add Controller Endpoints

**Files:**
- `apps/api/src/workflow/workflow-runtime-tools.controller.ts`

**Work:**
1. Add 6 POST/PATCH endpoints for goal operations:
   ```typescript
   @Post('orchestration/goals')
   async createProjectGoal(@Body() body: OrchestrationCreateProjectGoalBody)
   
   @Patch('orchestration/goals/:goalId')
   async updateProjectGoal(...)
   
   @Patch('orchestration/goals/:goalId/status')
   async updateProjectGoalStatus(...)
   
   // etc.
   ```
2. All endpoints require `@Roles('Admin', 'Developer', 'Agent')`
3. Route to `WorkflowRuntimeOrchestrationActionsService`

**Acceptance:**
- [ ] All endpoints listed in Swagger API docs
- [ ] Endpoints return consistent `{ success: true, data: ... }` response shape
- [ ] Validation errors return 400 with detailed messages
- [ ] Auth guards prevent unauthorized access

---

### Task 4: Update Event & Decision Log Integration

**Files:**
- `apps/api/src/database/entities/event-ledger.entity.ts`
- `apps/api/src/project/project-orchestration-events.service.ts`
- `apps/api/src/project/project-orchestration-decision-log.service.ts`

**Work:**
1. Emit domain events for each goal mutation (already modeled in step 2, now wire into event ledger):
   ```typescript
   this.eventEmitter.emit('ProjectGoalCreated', { goalId, projectId, ... })
   this.eventEmitter.emit('ProjectGoalStatusChanged', { goalId, oldStatus, newStatus, ... })
   ```
2. Record in `project_orchestration_decision_log`:
   - Decision type: `'goal_created'`, `'goal_updated'`, etc.
   - Payload includes goal ID, changes, reasoning from agent decision context
3. Include `correlationId` and `workflowRunId` to link back to orchestration context

**Acceptance:**
- [ ] `event_ledger` table has rows for goal mutations with correct domain/event_name
- [ ] `project_orchestration_decision_log` captures goal action type and reasoning
- [ ] Events are queryable by `projectId` and `goalId`

---

### Task 5: Create Agent Skill & Instructions

**Files:**
- Create: `.agents/skills/project-goals-orchestration/SKILL.md`
- Create: `.agents/skills/project-goals-orchestration/examples.md`
- Create: `.agents/skills/project-goals-orchestration/.prompt.md`

**Content:**
1. **SKILL.md** —
   - When to use goal mutation tools (during discovery, after scope analysis, on completion)
   - Idempotency & idempotent keys
   - Validation rules & rejection patterns
   - Goal status state machine
   - Best practices: atomic updates, descriptive reasoning, approval gates
   - Examples: create goal during discovery, update priority during planning, mark complete after implementation

2. **examples.md** —
   - Use case: Product manager creates initial goals during discovery
   - Use case: Orchestrator refines goal priority after feasibility analysis
   - Use case: Implementation agent marks goal complete after all work items shipped
   - Use case: Multi-phase goal management (initial, stretch, cleanup)

3. **.prompt.md** —
   - Guidance for orchestrator/product-manager agents on when to invoke goal tools
   - Example: "If you discover new requirements during discovery, create a new goal via create_project_goal"
   - Example: "After implementation review, mark goals completed via update_project_goal_status"

**Acceptance:**
- [ ] Skill document passes markdownlint
- [ ] Skill references actual tool names and parameters
- [ ] Examples are realistic and instructive

---

### Task 6: Update Orchestration Workflow Templates

**Files:**
- `apps/api/src/database/seeds/workflows/project-orchestration-cycle-ceo.workflow.yaml` (or equivalent)
- `apps/api/src/database/seeds/workflows/project-discovery-ceo.workflow.yaml`

**Work:**
1. Update step prompts to mention goal tools:
   ```yaml
   - id: discovery
     type: execution
     inputs:
       system_prompt: |
         During discovery:
         - Use create_project_goal to add new goals discovered from stakeholders.
         - Use update_project_goal to refine goal descriptions based on feedback.
         - Call get_capabilities to list available goal tools.
   ```
2. Add explicit example in comments showing goal creation/update patterns
3. No functional changes to workflow DAG (tools already available if in capability manifest)

**Acceptance:**
- [ ] Workflow YAML parses correctly
- [ ] Step prompts are clear about when to use goal tools
- [ ] Tool usage examples match the SKILL.md documentation

---

### Task 7: Unit & Integration Tests

**Files:**
- `apps/api/src/project-goals/project-goals.service.spec.ts` (add orchestration paths)
- `apps/api/src/project/project-orchestration-action-execution.service.spec.ts` (add goal mutation tests)
- `apps/api/src/workflow/workflow-runtime-tools.controller.spec.ts` (add goal endpoint tests)
- Create: `apps/api/src/project/orchestration-goal-mutations.integration.spec.ts`

**Work:**
1. **Unit tests** —
   - Service methods accept valid goal mutations
   - Validation rejects invalid input (empty title, bad status, non-existent project)
   - Events are emitted correctly
   - Errors are propagated

2. **Integration tests** —
   - Orchestration action invokes service correctly
   - Decision log records action with reasoning
   - Event ledger has corresponding domain events
   - Subsequent queries reflect mutations

3. **E2E scenario** —
   - Workflow runs, invokes goal tools, mutations persist, queryable

**Acceptance:**
- [ ] All tests pass: `npm run test:api`
- [ ] Coverage for goal mutation paths is ≥ 80%
- [ ] No lint warnings in test files

---

### Task 8: E2E Orchestration Test Workflow

**Files:**
- `packages/e2e-tests/tests/orchestration-with-goal-updates.spec.ts` (or similar)
- `apps/api/src/database/seeds/workflows/goal-update-test.workflow.yaml`

**Work:**
1. Define a simple test workflow that:
   - Creates a project with initial goals
   - Runs an orchestration cycle that:
     - Creates a new goal
     - Updates an existing goal's description
     - Marks a goal as in-progress
     - Completes a goal
2. Assert final state matches expectations

**Acceptance:**
- [ ] E2E test passes deterministically: `npm run test:e2e:orchestration` (new task)
- [ ] Test covers happy path; document future edge cases for phase 2

---

### Task 9: Documentation Updates

**Files:**
- Create: `docs/architecture/agent-driven-goal-orchestration.md`
- Update: `docs/epics/EPIC-059-project-goals-first-class-management.md` (completion notes)
- Update: `docs/architecture/agent-capability-orchestration.md` (reference new tools)
- Update: `README.md` (capability summary)

**Content:**
1. **Agent-driven-goal-orchestration.md** —
   - Architecture diagram: request flow from agent tool call to goal service to event ledger
   - Tool catalog with parameters and examples
   - Execution routing through orchestration action layer
   - Event model and audit trail
   - Safety & validation rules

2. **EPIC-059 completion notes** —
   - Add section: "Phase 2: Agent Orchestration (EPIC-061 implementation)"
   - Link to new skill and architecture docs

3. **agent-capability-orchestration.md** —
   - Add goal tools to the runtime orchestration tools section

**Acceptance:**
- [ ] Documentation builds without errors: `npm run docs:build` (if applicable)
- [ ] Diagrams are clear and match code implementation
- [ ] All file links are valid

---

## 7. Acceptance Criteria

### Epic-level AC

1. **All 6 goal mutation tools are callable by agents** — Verified via `getCapabilities` and Swagger
2. **Tools route through orchestration action execution** — Verified via integration tests
3. **All mutations are audited** — Events in ledger, decisions in log, with agent attribution
4. **Agent instructions exist** — Skill doc and workflow prompt guidance provided
5. **Tests pass across all layers** — Unit, integration, E2E all green
6. **Documentation is complete** — Architecture doc, README updates, EPIC-059 links
7. **Lint-clean** — ESLint, TypeScript, Markdownlint all pass

### Per-task AC

See "Acceptance" bullets in Task List above.

---

## 8. Risk & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Goal mutations conflict with concurrent UI changes | Medium | High | Implement optimistic locking (version field on goal entity); test concurrent mutation scenarios |
| Agent creates/updates invalid goal states | Medium | Medium | Strict validation in controller; reject before service; clear error messages in tool schema |
| Audit trail is incomplete or loses context | Low | High | Use correlation IDs; emit domain events before DB commit; test event ledger queries |
| Performance: bulk goal updates slow down orchestration | Low | Medium | Limit batch goal operations in phase 1; use indexed queries on project_id |
| Skill documentation is unclear; agents misuse tools | Medium | Low | Review skill doc with product team; test agent prompts in deterministic test workflow |
| Backward compatibility: old workflows using goal strings | Low | Low | Dual-model support: old `goals` string field remains on project_orchestrations; new tools operate on goal entities |

---

## 9. Dependencies & Blockers

1. **EPIC-059 (Project Goals)** must be complete ✅ (already shipped)
2. **Capability manifest system** ✅ (EPIC-017, already in place)
3. **Orchestration action execution layer** ✅ (already mature)
4. **Event ledger** ✅ (already in use)

**No external blockers.**

---

## 10. Success Metrics

- [ ] Orchestrator agent successfully creates/updates project goals in a deterministic test workflow
- [ ] All goal mutations are recorded in event ledger with agent attribution
- [ ] Skill documentation is adopted by agent prompts in seed workflows
- [ ] E2E test passes consistently (deterministic mode)
- [ ] Zero regressions in existing project-goals or orchestration tests
- [ ] New tool usage appears in deployed orchestration runs (observability metric)

---

## 11. Timeline & Milestones

| Phase | Tasks | Est. Time |
|-------|-------|-----------|
| **Phase 1: Foundation** | Tasks 1-3 (tools, execution, endpoints) | 1 week |
| **Phase 2: Integration** | Tasks 4-6 (events, skills, workflows) | 1 week |
| **Phase 3: Quality & Docs** | Tasks 7-9 (tests, E2E, documentation) | 1-2 weeks |

**Total: 3-4 weeks**

---

## 12. References

- **EPIC-059:** [Project Goals as First-Class Product](./EPIC-059-project-goals-first-class-management.md)
- **EPIC-017:** [Agent Capability Orchestration](./EPIC-017-agent-capability-orchestration.md)
- **Architecture:** [Agent Capability Orchestration](../architecture/agent-capability-orchestration.md)
- **SDD:** [Flat Work Items & Orchestrated Execution](../specs/SDD-flat-work-items-and-orchestrated-execution.md)
- **REST API:** [Project Goals Controller](../../apps/api/src/project-goals/project-goals.controller.ts)
