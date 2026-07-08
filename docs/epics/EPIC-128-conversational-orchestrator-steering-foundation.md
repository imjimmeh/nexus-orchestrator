# EPIC-128: Conversational Orchestrator Steering Foundation

**Epic ID:** EPIC-128  
**Status:** Implemented  
**Priority:** P0 - Critical  
**Theme:** Natural Language Project Control, Dynamic Workflow Orchestration, CEO Agent Enhancement  
**Created:** 2026-04-19  
**Depends On:** EPIC-046 (Autonomous Project Orchestrator), EPIC-092 (Chat Service Bootstrap)

---

## 1. Context

Users need the ability to conversationally steer the project at any point. A user should be able to open a chat with the orchestrator (CEO agent) and say things like "the login flow needs to support OAuth" or "add a payment feature" or "refactor the auth module into a separate service" — and the orchestrator will understand the intent, research the current state, determine what needs to change, and use workflows/subagents/tools to generate or modify specs, work items, and plans.

**Current State:**

- CEO orchestrator exists (EPIC-046) but primarily drives dispatch and cycle management
- Chat sessions exist (EPIC-092) but are isolated from project orchestration
- Users can chat with agents, but agents cannot dynamically invoke workflows or modify project structure
- No natural language intent parsing for project changes
- **V2 Transition:** Recent refactors (EPIC-120/121) move toward generic domain primitives (`amend_entity`, `git_operation`, Kanban-owned `kanban.publish_specs`) and state-driven workflow completion. Steering must leverage these rather than building bespoke "V1-style" tools.

**Target State:**

- User can chat with CEO agent at any time to steer the project
- CEO parses natural language intent into actionable plans
- CEO researches current project state (reads PRD, SDD, work items, git)
- **CEO selects and invokes appropriate workflows dynamically to apply changes**
- CEO spawns subagents for specific tasks (update spec, create work item, analyze impact)
- Results presented back to user for approval or refinement
- All changes tracked in git and visible in the project via canonical markdown sources

---

## 2. References

**Architecture:**

- `docs/architecture/chat-sessions.md`
- `docs/epics/EPIC-046-autonomous-project-orchestrator.md`
- `docs/epics/EPIC-092-chat-service-bootstrap-telegram-ingress-and-session-persistence.md`
- `docs/epics/EPIC-120-output-tool-and-job-output-contract-evolution.md`
- `docs/epics/EPIC-121-deferred-special-step-migration-to-domain-state-workflow-v2.md`

**Implementation Files:**

- `apps/api/src/project/project-orchestration.service.ts` — CEO orchestration
- `apps/api/src/workflow/step-amend-entity-special-step.handler.ts` — Generic mutation handler
- `kanban.publish_specs` — Kanban-owned canonical spec publishing tool. The former API runtime publish-specs service is removed and must not be treated as active steering infrastructure.
- `apps/api/src/tool/capability-manifest.runtime.orchestration.entries.ts` — Orchestration tools

---

## 3. PR-Ready Tasks

### Task 1: Create `steer_project` Tool (Analysis Phase)

**Scope:** Tool that allows the CEO agent to parse user intent and generate a structured "Steering Plan". This tool is **read-only** and does not apply changes.

**Files:**

- Create: `apps/api/src/tool/handlers/steer-project.tool.ts`
- Create: `apps/api/src/tool/handlers/steer-project.tool.spec.ts`
- Modify: `apps/api/src/tool/tool-registry.service.ts`

**Acceptance Criteria:**

- Input: `{ user_request: string, project_id: string, current_context: object }`
- Parses user intent into structured plan:
  ```json
  {
    "intent": "add_feature|modify_feature|refactor|investigate|create_spec",
    "target_area": "auth|payments|ui|api|database",
    "description": "user-friendly summary",
    "proposed_changes": [
      {
        "type": "update_artifact",
        "path": "docs/specs/auth.md",
        "change": "..."
      },
      {
        "type": "amend_entity",
        "entity_type": "work_item",
        "action": "update",
        "updates": { "priority": "p0" }
      },
      { "type": "invoke_workflow", "workflow_name": "..." }
    ],
    "confidence": 0.85,
    "questions_for_user": ["..."]
  }
  ```
- Reads current PRD/SDD from project repo for context
- Reads existing work items for context
- Returns confidence score and any clarifying questions
- **Validation:** Ensures proposed changes align with V2 generic primitives (no bespoke mutation calls).

**Definition of Done:**

- [ ] Tool parses intent correctly
- [ ] Context loaded from project
- [ ] Structured plan generated
- [ ] Unit tests pass (>80% coverage)

---

### Task 2: Expose `amend_entity` as Chat Tool

**Scope:** Expose the generic `amend_entity` logic (from EPIC-120/121) as an agent-callable tool for direct state steering.

**Files:**

- Create: `apps/api/src/tool/handlers/amend-entity.tool.ts` (wrapper around existing handler logic)
- Modify: `apps/api/src/tool/tool-registry.service.ts`

**Acceptance Criteria:**

- CEO can directly update work item status, metadata, or execution config from chat.
- Supports all entity types: `work_item`, `project`, `execution`, `container`.
- Enforces the same validation rules as the special step handler.
- Returns structured results (e.g., `{ id, status: 'updated' }`).

**Definition of Done:**

- [ ] Tool successfully wraps existing handler logic
- [ ] CEO can perform ad-hoc updates from chat
- [ ] Unit tests pass

---

### Task 3: Use `kanban.project_state` For Project Reads

**Scope:** Kanban-owned tool for agents to query current project state (Artifacts, Work Items, Git).

**Files:**

- Use: `kanban.project_state`
- Do not create an API-owned query-project-state runtime tool.

**Acceptance Criteria:**

- Input: `{ project_id: string, query_type: string, filters: object }`
- Query types:
  - `work_items` — List work items by status, type, assignee
  - `artifacts` — List/Read PRD, SDD, analysis documents
  - `git_history` — Recent commits, branches, changes
  - `dependencies` — Work item dependency graph
- Returns structured JSON
- Supports filtering and pagination

**Definition of Done:**

- [ ] All query types work
- [ ] Unit tests pass (>80% coverage)

---

### Task 4: Enhance CEO Agent Profile for Steering

**Scope:** Update CEO agent to support conversational steering using V2 primitives.

**Files:**

- Modify: `seed/agent-profiles/ceo.profile.yaml`
- Modify: `apps/api/src/database/seeds/agent-profiles/ceo.seed.ts`
- Create: `seed/skills/orchestrator-steering/SKILL.md`

**Acceptance Criteria:**

- System prompt updated to:
  - Use `steer_project` to parse intent.
  - **Always present plans for approval before execution.**
  - **Use `invoke_agent_workflow` or `kanban.publish_specs` for execution**, rather than raw mutation tools.
  - Handle "Artifact" changes by writing markdown files in a worktree and calling `kanban.publish_specs`.
- Allowed tools: `steer_project`, `kanban.project_state`, `amend_entity`, `kanban.publish_specs`, `invoke_agent_workflow`, `bash`.

**Definition of Done:**

- [ ] Profile updated and validated
- [ ] Skill created with "V2-Native" steering guidelines
- [ ] Agent can parse steering requests and propose V2-compliant plans

---

### Task 5: Create Steering Session Type

**Scope:** Dedicated chat session type for orchestrator steering.

**Files:**

- Create: `seed/workflows/session-templates/steering-session.yaml`
- Modify: `apps/api/src/session/session.service.ts`

**Acceptance Criteria:**

- Session type: `steering`.
- CEO maintains context across turns: approved plans, rejected changes, pending questions.
- Session is linked to a `project_id`.
- Session has permission to trigger workflows.

**Definition of Done:**

- [ ] Session type functional
- [ ] CEO agent participates and maintains context

---

### Task 6: Implement Plan Presentation and Approval (Steering UI)

**Scope:** CEO presents plans to user before execution.

**Files:**

- Create: `apps/api/src/project/project-steering.service.ts`
- Modify: `apps/web/src/components/chat/message-renderer.tsx`

**Acceptance Criteria:**

- CEO generates plan and presents as structured message.
- User Actions: [Approve], [Modify], [Reject], [Clarify].
- **Approval Logic:** Approval triggers a "Steering Execution Workflow" or a series of orchestrated tool calls (e.g., `git_operation` -> `write` -> `kanban.publish_specs`).

**Definition of Done:**

- [ ] Plans presented clearly in UI
- [ ] Approval triggers orchestrated execution

---

### Task 7: Dynamic Workflow Invocation from Steering

**Scope:** CEO can invoke specialized workflows (e.g., "Refinement", "Hotfix", "Spec Revision") based on steering intent.

**Files:**

- Modify: `apps/api/src/project/project-steering.service.ts`

**Acceptance Criteria:**

- CEO maps intent parameters to workflow `trigger_data`.
- Workflow run is linked to the steering session.
- Progress and completion results are reported back to chat.

**Definition of Done:**

- [ ] Workflows invoked successfully from chat context
- [ ] Result summary returned to user

---

### Task 8: Steering Artifact Management (V2 Flow)

**Scope:** CEO manages PRD/SDD changes via the canonical V2 flow (Worktree -> Edit -> Publish).

**Files:**

- Create: `seed/workflows/conversational-artifact-steering.workflow.yaml`

**Acceptance Criteria:**

- New workflow for applying artifact changes:
  1. Job `provision_worktree` (type: `git_operation`, action: `create_worktree`).
  2. Job `apply_changes` (type: `execution`, agent: `software-engineer-assistant`).
  3. Job `publish` (type: `execution`, tool: `kanban.publish_specs`).
- CEO invokes this workflow when a user approves a "modify artifact" plan.

**Definition of Done:**

- [ ] Steering workflow implemented and tested
- [ ] CEO uses this workflow for artifact updates

---

## 4. Definition of Done (Epic Level)

- [ ] V2-compliant Steering tools implemented (`steer_project`, `amend_entity`, `kanban.project_state`).
- [ ] CEO agent updated to use Workflow Orchestration for execution.
- [ ] Steering session type functional.
- [ ] UI supports Plan Approval flow.
- [ ] Artifact changes follow the `kanban.publish_specs` canonical path.
- [ ] Unit tests for all components pass.
- [ ] Documentation reflects the V2 Steering architecture.

---

## 5. Dependencies

- **EPIC-120/121:** Generic primitives and output contracts (Foundation).
- **EPIC-046:** CEO agent foundation.
- **EPIC-092:** Chat session infrastructure.

---

## 6. Risks

| Risk                             | Mitigation                                                                  |
| -------------------------------- | --------------------------------------------------------------------------- |
| Divergence from V2 primitives    | Strict validator rules for the `steer_project` tool output.                 |
| Chat-to-Workflow race conditions | Sessions link to specific projects; lock project steering during execution. |
| User confusion with "Plan" UI    | Clear impact summaries and "Reasoning" fields in presented plans.           |

## 7. Implementation Status

| Task                                              | Status      | Key Files                                                                                                           |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| Task 1: Create `steer_project` Tool               | ✅ Complete | `steer-project.service.ts`, `steer-project.controller.ts`                                                           |
| Task 2: Expose `amend_entity` as Chat Tool        | ✅ Complete | `amend-entity.service.ts`, `amend-entity.controller.ts`                                                             |
| Task 3: Use `kanban.project_state` for project reads | ✅ Complete | Kanban-owned project state tooling                                                                                  |
| Task 4: Enhance CEO Agent Profile for Steering    | ✅ Complete | `seed/agents/ceo-agent/agent.json`, `seed/agents/ceo-agent/PROMPT.md`, `seed/skills/orchestrator-steering/SKILL.md` |
| Task 5: Create Steering Session Type              | ✅ Complete | `chat-session.entity.ts` (session_type column), `steering-context.provider.ts`                                      |
| Task 6: Implement Plan Presentation and Approval  | ✅ Complete | `project-steering.service.ts`, `SteeringPlanCard.tsx`, `SteeringChatPanel.tsx`                                      |
| Task 7: Dynamic Workflow Invocation from Steering | ✅ Complete | `project-steering.service.ts` (executePlan routing)                                                                 |
| Task 8: Steering Artifact Management (V2 Flow)    | ✅ Complete | `seed/workflows/conversational-artifact-steering.workflow.yaml`                                                     |
