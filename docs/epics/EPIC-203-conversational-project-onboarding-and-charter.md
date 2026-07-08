# EPIC-203: Conversational Project Onboarding & Charter

**Epic ID:** EPIC-203
**Status:** Implemented
**Priority:** P1
**Theme:** Conversational Intent Capture, Project Charter, Onboarding & Steering
**Created:** 2026-06-08
**Completed:** 2026-06-09
**Depends On:** EPIC-128 (Steering Foundation), EPIC-059 / EPIC-061 (Project Goals First-Class & Agent-Driven), EPIC-154 (Kanban MCP Tools)
**Soft Depends On:** EPIC-129 / EPIC-130 / EPIC-131 (Design Ingestion — for `delegate_design_ingestion`), EPIC-202 (Self-Improvement Loop — so recorded memories reach agent prompts)

---

## 1. Context

The orchestrator/CEO chat exists but is thin. A user can steer the CEO agent, but the agent is **read-only on project intent**: its prompt says *"You are read-only for repository content"* and its tool policy grants **no goal-write tool and no memory-write tool**. It can ask questions (`ask_user_questions`) and delegate (`delegate_*`), but it cannot *capture* what it learns into durable, structured state.

Meanwhile, the **discovery phase** of an orchestration cycle bootstraps almost entirely from `goals` — a single free-text **string** passed in at orchestration start (`StartOrchestrationInputSchema.goals`). The greenfield `kickoff-clarification` route does ask 1–3 questions, but its outputs (`kickoff_summary`, `clarified_goals`, `open_questions`) are transient workflow outputs, not persisted structured intent that later cycles or chats can read back.

This epic adds a **reusable conversational "Project Charter" mode**: a CEO-driven chat, equipped with a new suite of *capture tools*, that elicits project intent and persists it as durable structured state — usable at kickoff (greenfield **and** brownfield) and re-runnable mid-project to refine. The discovery phase then reads this rich charter instead of a thin string.

### What already exists (we build on it, not around it)

- **Structured goals:** `KanbanProjectGoalEntity` (+ `KanbanProjectGoalWorklogEntity` for timestamped notes) with full CRUD in `ProjectGoalsService`. **Gap:** only a read tool (`kanban.goals`) is exposed to agents — no write tool.
- **Generic memory:** `MemorySegment` (`entity_type` / `entity_id` / `memory_type` ∈ `preference|fact|history` + `metadata` JSONB), `MemoryManagerService.createMemorySegment(...)`, and the read-side `query_memory` tool. **Gap:** no agent-facing memory-*write* tool scoped to a project.
- **Discovery already reads `docs/project-context/`:** the `project-discovery-ceo` prompt reads `ARCHITECTURE.md`, `CAPABILITY_MAP.md`, `CODEBASE_HEALTH.md`, `OPEN_QUESTIONS.md` and treats them as ground truth. A `CHARTER.md` placed there is consumed automatically once the prompt is taught to read it.
- **Chat-driven workflow invocation:** EPIC-128 steering foundation; the CEO chat runs containerized agents via `ChatExecutionService`.

### How this differs from the ingestion epics (EPIC-129–131)

| | Trigger | Input | Output |
|---|---|---|---|
| **EPIC-129–131 (ingestion)** | Upload artifacts | Designs / docs / Figma | PRD / SDD / work items |
| **Current discovery** | Start orchestration | `goals` string | `specs_ready` decision |
| **EPIC-203 (this)** | Conversation | Dialogue | **Structured, persisted project intent** (goals, requirements, dos/donts, non-goals, decisions, charter doc, memories) |

These are **complementary**. Per the agreed design (Option 1, see §7), the onboarding conversation keeps its own entry point **and** can *trigger* the ingestion pipeline ("you mentioned Figma mockups — drop them in and I'll run analysis") via a new `delegate_design_ingestion` tool. The direct artifact-upload path from EPIC-131 is **unchanged**.

**Target State:**
- A `project_charter_ceo` conversational workflow (greenfield + brownfield branches) the CEO drives to elicit and persist intent.
- Re-runnable mid-project as a "refine charter" mode — a structured, better-tooled successor to today's ad-hoc steering chat.
- A capture tool suite: goal write tools, project-memory write tool, charter-doc write tool, and an ingestion delegation tool.
- A canonical `docs/project-context/CHARTER.md` plus category-tagged project memories, consumed by the discovery phase.

---

## 2. Persistence Model (Hybrid — agreed)

No new database tables. Each kind of captured intent goes to the store that already fits it:

| Captured intent | Store | Mechanism |
|---|---|---|
| Goals | `kanban_project_goals` (+ worklogs) | **NEW** agent write tools wrapping `ProjectGoalsService` |
| Requirements, constraints, dos/donts, non-goals, decisions, preferences, glossary, stakeholders | `memory_segments`, `entity_type='project'`, `entity_id=<scope_id>` | **NEW** `record_project_memory` tool wrapping `MemoryManagerService.createMemorySegment`, tagged `metadata.category` |
| Human-readable canonical charter | `docs/project-context/CHARTER.md` | **NEW** `update_charter` tool (scoped write; CEO stays read-only on *code*) |
| Notes / decision log per goal | `kanban_project_goal_worklogs` | **NEW** `kanban.goal_add_note` tool wrapping `createWorklog` |

`memory_type` stays `preference|fact|history`; the finer taxonomy lives in `metadata.category`. Because intent is stored as project-scoped `fact`/`preference` memory, EPIC-202's memory-injection work makes it reach agent prompts on later runs automatically (soft dependency — the charter doc works regardless).

---

## 3. References

**Implementation Files:**
- `seed/agents/ceo-agent/agent.json`, `seed/agents/ceo-agent/PROMPT.md` — agent profile & persona
- `seed/workflows/` — workflow definitions; `seed/workflows/prompts/project-discovery-ceo/discovery.md` — discovery prompt (integration point)
- `apps/kanban/src/mcp/tools/mutation/` — existing kanban write-tool pattern (e.g. `work-item-create.tool.ts`)
- `apps/kanban/src/mcp/tools/read/goals.tool.ts` — read-tool pattern to mirror
- `apps/kanban/src/goals/project-goals.service.ts` — goal CRUD to wrap
- `apps/api/src/workflow/workflow-internal-tools/tools/memory/` — internal-tool pattern (e.g. `record-learning.tool.ts`, `query-memory.tool.ts`)
- `apps/api/src/memory/memory-manager.service.ts` — `createMemorySegment(entityType, entityId, content, memoryType?, metadata?)`
- `apps/api/src/workflow/workflow-delegation-tools/workflow-delegation-tool-projection.service.ts` — projected delegation tool wiring (for `delegate_design_ingestion`)
- `apps/api/src/database/seeds/ceo-authority-contract.test-helper.ts` — CEO tool/authority contract test

**Related Epics:** EPIC-128, EPIC-059, EPIC-061, EPIC-065 (import-aware onboarding), EPIC-129/130/131, EPIC-154, EPIC-202.

---

## 4. PR-Ready Tasks

### Task 1: Charter Conventions & Memory Category Taxonomy

**Scope:** Establish the shared vocabulary every other task depends on.

**Files:**
- Create: `packages/kanban-contracts/src/project-charter.schema.ts` (or nearest shared contracts package) — `ProjectMemoryCategory` enum + `CHARTER.md` section constants
- Create: `docs/architecture/project-charter.md` — convention doc (charter sections, category taxonomy, provenance)

**Acceptance Criteria:**
- `ProjectMemoryCategory` defined: `requirement | constraint | do_dont | non_goal | decision | preference | glossary | stakeholder | open_question`
- Canonical `CHARTER.md` section list defined: Vision, Goals, Requirements, Constraints, Dos & Don'ts, Non-Goals, Success Criteria, Glossary, Stakeholders, Open Questions
- Provenance convention defined: memory `metadata` carries `{ category, source: 'onboarding_chat', captured_by, confidence }`
- Exported and importable by both `apps/api` and `apps/kanban`

---

### Task 2: Project Goal Write Tools (Kanban MCP)

**Scope:** Expose `ProjectGoalsService` mutations to agents.

**Files:**
- Create: `apps/kanban/src/mcp/tools/mutation/goal-create.tool.ts` (`kanban.goal_create`)
- Create: `apps/kanban/src/mcp/tools/mutation/goal-update.tool.ts` (`kanban.goal_update`)
- Create: `apps/kanban/src/mcp/tools/mutation/goal-update-status.tool.ts` (`kanban.goal_update_status`)
- Create: `apps/kanban/src/mcp/tools/mutation/goal-add-note.tool.ts` (`kanban.goal_add_note` → `createWorklog`)
- Modify: kanban MCP tool registration module + `kanban-mcp.service.spec.ts`

**Acceptance Criteria:**
- Each tool implements `IInternalToolHandler`, mirrors `goals.tool.ts` (tierRestriction 2, `transport: 'runner_local'`, `runtimeOwner: 'runner'`), validates input with a Zod schema, and delegates to `ProjectGoalsService`
- `author_type: 'agent'` defaulted on worklog/status writes
- Tools registered and discoverable via `get_capabilities`

**Definition of Done:** Unit tests pass (>80% coverage); MCP service spec asserts new tool names; lint passes.

---

### Task 3: `record_project_memory` Tool

**Scope:** Agent-facing tool to persist categorized project intent as memory.

**Files:**
- Create: `apps/api/src/workflow/workflow-internal-tools/tools/memory/record-project-memory.tool.ts`
- Create: matching `.spec.ts`
- Modify: memory tools handler + internal-tool registration

**Acceptance Criteria:**
- Params: `{ scope_id, category: ProjectMemoryCategory, content, memory_type?, confidence? }`
- Calls `MemoryManagerService.createMemorySegment('project', scope_id, content, memory_type ?? 'fact', { category, source: 'onboarding_chat', confidence })`
- Returns created segment id + echo of category
- Read-back relies on existing `query_memory` (no duplicate read tool — DRY)

**Definition of Done:** Unit tests pass (>80%); tool registered; lint passes.

---

### Task 4: `update_charter` Tool (Scoped Charter Write)

**Scope:** Let the CEO write the canonical charter **without** granting arbitrary repo write access.

**Files:**
- Create: `apps/api/src/workflow/workflow-internal-tools/tools/charter/update-charter.tool.ts`
- Create: matching `.spec.ts`

**Acceptance Criteria:**
- Params: `{ scope_id, section, content, mode: 'replace' | 'append' }`
- Writes/patches only `docs/project-context/CHARTER.md` within the project workspace; path is validated and constrained (no traversal, no other files)
- Creates the file with the Task 1 section skeleton if absent; idempotent per section
- Rejects unknown section names

**Definition of Done:** Unit tests cover create/replace/append/unknown-section/path-escape rejection (>80%); lint passes.

---

### Task 5: `delegate_design_ingestion` Projected Delegation Tool

**Scope:** Bridge from conversation to the EPIC-131 ingestion pipeline (Option 1: conversation can trigger ingestion).

**Files:**
- Modify: `apps/api/src/workflow/workflow-delegation-tools/workflow-delegation-tool-projection.service.ts`
- Modify: delegation contracts + tests

**Acceptance Criteria:**
- New projected delegation tool `delegate_design_ingestion` mirroring existing `delegate_*` wiring (it launches a workflow but does not constitute Kanban dispatch)
- Launches `design_ingestion_new_project` or `design_ingestion_existing_project` based on whether the project already has artifacts/PRD
- **Feature-flagged** behind `design_ingestion_workflows_enabled`; absent/disabled → tool is not projected (no hard dependency on EPIC-131 landing first)

**Definition of Done:** Projection unit tests pass; flag-off path verified; lint passes.

---

### Task 6: CEO Agent Profile & Persona Updates

**Scope:** Grant the capture tools and teach the persona to capture intent.

**Files:**
- Modify: `seed/agents/ceo-agent/agent.json` (add Task 2–5 tools to `tool_policy.rules`)
- Modify: `seed/agents/ceo-agent/PROMPT.md`
- Modify: `apps/api/src/database/seeds/ceo-authority-contract.test-helper.ts`

**Acceptance Criteria:**
- `agent.json` allows: `kanban.goal_create`, `kanban.goal_update`, `kanban.goal_update_status`, `kanban.goal_add_note`, `record_project_memory`, `update_charter`, `delegate_design_ingestion`
- `PROMPT.md` clarifies the nuance: **read-only for repository *code*, but expected to write structured project intent** via the capture tools; describes the charter-capture loop (elicit → confirm → persist via goals/memory/charter) and one-question-at-a-time elicitation
- Authority-contract test updated to expect the new allowed tools and still deny `invoke_agent_workflow`

**Definition of Done:** Seed contract & authority tests pass; `npm run validate:seed-data` passes.

---

### Task 7: `project_charter_ceo` Onboarding Workflow

**Scope:** The conversational workflow that drives onboarding for greenfield and brownfield.

**Files:**
- Create: `seed/workflows/project-charter-ceo.workflow.yaml`
- Create: `seed/workflows/prompts/project-charter-ceo/onboard.md` (greenfield)
- Create: `seed/workflows/prompts/project-charter-ceo/brownfield-onboard.md`
- Modify: `apps/api/src/database/seeds/workflow/workflows.seed.contract.spec.ts`

**Acceptance Criteria:**
- Multi-turn, interactive (uses `ask_user_questions`), driving the capture tools
- **Greenfield branch:** elicit vision → goals → requirements → constraints/dos-donts → non-goals → success criteria; persist each as it is confirmed; write `CHARTER.md`
- **Brownfield branch:** optionally first `delegate_imported_repo_discovery` (reuse existing investigation), discuss findings, then elicit + capture intent on top of discovered reality
- Branch selected from project `source_type` / startup route (consistent with existing discovery routing)
- Completes with a charter summary; sets job output noting what was captured

**Definition of Done:** Seed contract test asserts workflow + jobs; `validate:seed-data` passes; can be triggered manually.

---

### Task 8: Reusable Mid-Project "Refine Charter" Mode

**Scope:** Re-run onboarding against an existing charter to revise intent mid-project (the better steering chat).

**Files:**
- Create: `seed/workflows/prompts/project-charter-ceo/refine.md`
- Modify: `seed/workflows/project-charter-ceo.workflow.yaml` (a `refresh`/`isRestart` mode)

**Acceptance Criteria:**
- On refine, the agent first reads existing `CHARTER.md` + project memories (`query_memory`) and presents current intent before asking what to change
- Updates are diff-style: new/changed goals and memories only; charter sections patched via `update_charter` append/replace
- Decisions captured as `category: 'decision'` memories with rationale

**Definition of Done:** Refine path exercised in a workflow test; no duplicate goals/memories created on re-run.

---

### Task 9: Discovery Phase Integration

**Scope:** Make discovery consume the charter so it stops bootstrapping from a thin string.

**Files:**
- Modify: `seed/workflows/prompts/project-discovery-ceo/discovery.md`
- Modify: `seed/workflows/prompts/project-discovery-ceo/kickoff.md` (if present)

**Acceptance Criteria:**
- Discovery KNOWLEDGE BASE section reads `docs/project-context/CHARTER.md` (in addition to the existing four files) and treats it as ground truth
- Discovery reads project-scoped memories (via `query_memory`, `entity_type='project'`) for requirements/constraints/non-goals before asking the user anything
- When a charter exists, kickoff-clarification skips questions already answered there
- No behavioral regression when no charter exists (graceful fallback to today's `goals` string)

**Definition of Done:** Prompt updates reviewed; discovery seed contract still passes; a charter-present scenario demonstrably reduces redundant questioning.

---

### Task 10: Entry Points

**Scope:** Let users actually launch onboarding — at creation and anytime.

**Files:**
- Modify: project creation flow (`apps/api`/`apps/kanban` project service) to optionally launch `project_charter_ceo` for greenfield
- Modify: chat actions to expose a "Define / Refine project charter" action that launches the workflow for an existing project
- Modify: `apps/web` — surface the onboarding entry point (create-project + project menu)

**Acceptance Criteria:**
- Greenfield project creation can launch onboarding (opt-in), returning the workflow run id
- An existing project can launch the refine mode from chat at any time
- Direct artifact-upload ingestion path (EPIC-131) remains a separate, untouched entry point

**Definition of Done:** Unit tests for the launch paths pass; web entry points wired behind the feature flag.

---

### Task 11: Feature Flag, Docs & Final Validation

**Files:**
- Modify: feature flag registry (if one exists) — `conversational_onboarding_enabled` (default false)
- Create: `docs/architecture/conversational-project-onboarding.md` (flow + sequence diagram)
- Modify: `docs/architecture/project-charter.md` (cross-links)

**Acceptance Criteria:**
- All new tools/workflows gated behind `conversational_onboarding_enabled`
- Full test suites pass (`apps/api`, `apps/kanban`); `validate:seed-data` passes; builds succeed
- Documentation covers the charter convention, tool suite, workflow branches, and discovery integration

---

## 5. Definition of Done (Epic Level)

- [x] Charter conventions + memory category taxonomy defined and shared
- [x] Goal write tools (`kanban.goal_create/update/update_status/add_note`) implemented + tested
- [x] `record_project_memory` and `update_charter` tools implemented + tested
- [x] `delegate_design_ingestion` projected (feature-flagged)
- [x] CEO profile/persona updated; authority contract updated
- [x] `project_charter_ceo` workflow (greenfield + brownfield) seeded
- [x] Reusable mid-project refine mode works without duplicating state
- [x] Discovery reads CHARTER.md + project memories
- [x] Entry points wired (creation + mid-project), direct ingestion path untouched
- [x] All tests pass (`npm run test`); lint passes; `validate:seed-data` passes; builds succeed
- [x] Feature flag removed — conversational onboarding is always on
- [x] Documentation updated
- [x] `ProjectIntentTab` added to project workspace web UI (charter categories + goals two-column view)

---

## 6. Dependencies

- **EPIC-128 (Steering Foundation):** chat-driven workflow invocation underpins the conversation.
- **EPIC-059 / EPIC-061 (Project Goals):** the goal entity and agent-driven goal orchestration this epic exposes write tools for.
- **EPIC-154 (Kanban MCP Tools):** the MCP tool transport the goal-write tools register on.
- **EPIC-129/130/131 (Ingestion) — soft:** required only for `delegate_design_ingestion`; gated by `design_ingestion_workflows_enabled`, so this epic ships independently.
- **EPIC-202 (Self-Improvement Loop) — soft:** makes recorded project memories inject into agent prompts; the charter doc path works regardless.

---

## 7. Design Decisions

- **Two entry points, shared persistence (Option 1).** The conversation can trigger ingestion via `delegate_design_ingestion`, but the EPIC-131 direct-upload path stays. Rejected "single front door" (Option 2) — it buys little technically and forces every user through a chat.
- **Hybrid persistence, no new tables.** Goals → existing entity; everything else → project-scoped memory + a charter markdown. Rejected a first-class `ProjectCharter` schema (duplicates goals, heavy migrations, no EPIC-202 injection synergy) and charter-doc-only (not queryable, no board goals).
- **CEO stays read-only on code.** Charter writes go through a constrained `update_charter` tool, not a blanket `write` grant — preserving the existing safety posture.
- **Reuse the CEO persona, don't fork it.** Onboarding is the same strategic agent with capture tools added, not a new profile (KISS).

---

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Duplicate goals/memories on re-run (refine mode) | Refine reads existing state first; diff-style updates; dedupe on normalized content |
| `update_charter` path-escape / arbitrary writes | Strict path constraint to `docs/project-context/CHARTER.md`; unit-tested traversal rejection |
| Hard coupling to ingestion epics | `delegate_design_ingestion` feature-flagged; absent → not projected |
| Memories captured but never used | Discovery integration (Task 9) consumes them now; EPIC-202 closes the prompt-injection loop |
| Charter drift vs board goals | Charter "Goals" section links to board goals; goals remain the source of truth for status |
