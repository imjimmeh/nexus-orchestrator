# 40 - Conversational Project Onboarding & Charter

The Project Charter system provides a CEO-driven conversational workflow that elicits project intent and persists it as durable structured state — usable at kickoff (greenfield and brownfield) and re-runnable mid-project as a "refine charter" session.

---

## Overview

| Concern                                               | Mechanism                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Elicitation                                           | `project_charter_ceo` workflow, interactive multi-turn via `ask_user_questions`      |
| Goals                                                 | `kanban_project_goals` table via Kanban MCP write tools                              |
| Requirements, constraints, decisions, non-goals, etc. | `memory_segments` (entity_type=`project`) via `record_project_memory` tool           |
| Human-readable charter doc                            | `docs/project-context/CHARTER.md` in the project workspace via `update_charter` tool |
| Decision notes per goal                               | `kanban_project_goal_worklogs` via `kanban.goal_add_note`                            |
| Discovery integration                                 | `project-discovery-ceo` prompt reads CHARTER.md and project memories automatically   |
| Web UI                                                | `ProjectIntentTab` — two-column goals + charter accordion                            |

No new database tables. Each captured intent goes to the store that already fits it.

---

## Persistence Model

```
User dialogue
      │
      ▼
CEO agent (project_charter_ceo workflow)
      │
      ├─ kanban.goal_create/update/update_status ──► kanban_project_goals
      │
      ├─ record_project_memory ────────────────────► memory_segments
      │         (entity_type='project',              (entity_id=scope_id,
      │          metadata.category=<category>)        metadata.source='onboarding_chat')
      │
      ├─ update_charter ───────────────────────────► docs/project-context/CHARTER.md
      │
      └─ delegate_design_ingestion (optional) ─────► design ingestion workflow
```

### Memory Category Taxonomy

The `ProjectMemoryCategory` enum (in `packages/kanban-contracts/src/project-charter.schema.ts`) defines the finer taxonomy within `memory_type = 'fact' | 'preference'`:

| Category        | Use                                               |
| --------------- | ------------------------------------------------- |
| `requirement`   | Functional or non-functional requirements         |
| `constraint`    | Budget, timeline, technology constraints          |
| `do_dont`       | Explicit dos and don'ts                           |
| `non_goal`      | Explicitly out of scope                           |
| `decision`      | Architectural or product decisions with rationale |
| `preference`    | User/stakeholder style or process preferences     |
| `glossary`      | Domain term definitions                           |
| `stakeholder`   | Named stakeholders and their interests            |
| `open_question` | Unresolved questions to revisit                   |

Memory provenance metadata: `{ category, source: 'onboarding_chat', captured_by, confidence }`.

### Charter Sections

The canonical `CHARTER.md` sections (enforced by `update_charter`):

Vision · Goals · Requirements · Constraints · Dos & Don'ts · Non-Goals · Success Criteria · Glossary · Stakeholders · Open Questions

`update_charter` rejects unknown section names and any path outside `docs/project-context/CHARTER.md`.

---

## Tool Suite

### Kanban MCP Tools (`apps/kanban/src/mcp/tools/mutation/`)

| Tool                        | Operation                                             |
| --------------------------- | ----------------------------------------------------- |
| `kanban.goal_create`        | Create a project goal                                 |
| `kanban.goal_update`        | Update goal title or description                      |
| `kanban.goal_update_status` | Update goal status                                    |
| `kanban.goal_add_note`      | Add a worklog note to a goal (`author_type: 'agent'`) |

All goal tools delegate to `ProjectGoalsService`. They mirror the existing `goals.tool.ts` pattern (tierRestriction 2, `transport: 'runner_local'`, `runtimeOwner: 'runner'`).

### Internal Workflow Tools

**`record_project_memory`** (`apps/api/src/workflow/workflow-internal-tools/tools/memory/record-project-memory.tool.ts`)

Params: `{ scope_id, category: ProjectMemoryCategory, content, memory_type?, confidence? }`

Calls `MemoryManagerService.createMemorySegment('project', scope_id, content, memoryType ?? 'fact', { category, source: 'onboarding_chat', confidence })`. Returns the created segment id and echoed category. Read-back uses existing `query_memory` — no separate read tool.

**`update_charter`** (`apps/api/src/workflow/workflow-internal-tools/tools/charter/update-charter.tool.ts`)

Params: `{ scope_id, section, content, mode: 'replace' | 'append' }`

Writes or patches `docs/project-context/CHARTER.md` within the project workspace. Creates the file with the section skeleton if absent (idempotent per section). Rejects unknown section names and path traversal.

**`delegate_design_ingestion`** (feature-flagged)

Projected delegation tool that launches `design_ingestion_new_project` or `design_ingestion_existing_project` based on whether the project already has artifacts/PRD. Only projected when `design_ingestion_workflows_enabled` is true (requires EPIC-129–131 to be deployed).

### CEO Agent Policy

`seed/agents/ceo-agent/agent.json` allows all capture tools:

```
kanban.goal_create, kanban.goal_update, kanban.goal_update_status,
kanban.goal_add_note, record_project_memory, update_charter,
delegate_design_ingestion
```

The CEO persona is **read-only for repository code** but expected to write structured project intent via these capture tools. The `update_charter` tool's path constraint enforces this boundary without granting blanket write access.

---

## Workflows

All workflow definitions live in `seed/workflows/project-charter-ceo.workflow.yaml` with prompts in `seed/workflows/prompts/project-charter-ceo/`.

### Greenfield Onboarding (`onboard.md`)

Elicits in order: Vision → Goals → Requirements → Constraints/Dos-Don'ts → Non-Goals → Success Criteria. Each item is confirmed with the user before being persisted (goal write or `record_project_memory`). Writes CHARTER.md progressively. Completes with a charter summary and job output noting what was captured.

### Brownfield Onboarding (`brownfield-onboard.md`)

Optionally first calls `delegate_imported_repo_discovery` to investigate the existing repository, then discusses findings, then elicits and captures intent on top of discovered reality. Branch is selected from `project.source_type` at workflow start.

### Refine Mode (`refine.md`)

Re-reads existing `CHARTER.md` and project memories (`query_memory`, `entity_type='project'`) first, presents current intent, then asks what to change. Updates are diff-style: new or changed goals and memories only; charter sections patched via `update_charter` append or replace. Decisions are captured as `category: 'decision'` memories with rationale. Does not duplicate existing state on re-run.

---

## Discovery Integration

`seed/workflows/prompts/project-discovery-ceo/discovery.md` reads `docs/project-context/CHARTER.md` as ground truth alongside ARCHITECTURE.md, CAPABILITY_MAP.md, CODEBASE_HEALTH.md, and OPEN_QUESTIONS.md.

Before asking the user anything, discovery queries `query_memory` with `entity_type='project'` to pull requirements, constraints, and non-goals from stored project memories.

When a charter exists, kickoff-clarification skips questions already answered there. If no charter exists, discovery falls back gracefully to the `goals` string passed at orchestration start — no behavioral regression.

---

## Entry Points

### Project Creation (Greenfield)

`POST /projects` can launch `project_charter_ceo` at creation time. Returns the workflow run id alongside the created project. The onboarding conversation starts immediately in the Sessions tab.

### Mid-Project Refine

From the project chat or workspace, a "Define / Refine project charter" action launches the refine mode for an existing project. This is the structured successor to ad-hoc steering chat — the CEO has capture tools and persistent state instead of just reading.

### Direct Artifact Upload

The EPIC-131 direct-upload ingestion path remains a separate, untouched entry point. `delegate_design_ingestion` can bridge from conversation to that path when `design_ingestion_workflows_enabled` is enabled, but the two paths are independent.

---

## Web UI

`ProjectIntentTab` (`apps/web/src/pages/project-workspace/ProjectIntentTab.tsx`) is wired into the project workspace. Layout:

```
┌──────────────────────────────┬────────────────────────┐
│  Goals                       │  Charter               │
│  (GoalsTab)                  │  (CharterColumn)       │
│                              │                        │
│  • Goal A                    │  ▸ requirement (3)     │
│  • Goal B                    │  ▸ constraint (1)      │
│  • ...                       │  ▸ decision (2)        │
│                              │  ▸ ...                 │
│                              │                        │
│                              │  [Refine Charter]      │
└──────────────────────────────┴────────────────────────┘
```

`CharterColumn` renders charter memories grouped by `ProjectMemoryCategory` using `CharterCategorySection` accordion components. The "Refine Charter" button calls `onLaunchRefine`, which navigates to the Sessions tab and launches the refine workflow.

Data is fetched via `useCharterMemories` React Query hook, which calls charter memory CRUD endpoints on `ProjectController`.

---

## Key Files

| Path                                                                                             | Purpose                                                  |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `packages/kanban-contracts/src/project-charter.schema.ts`                                        | `ProjectMemoryCategory` enum + charter section constants |
| `apps/kanban/src/mcp/tools/mutation/goal-*.tool.ts`                                              | Goal write MCP tools                                     |
| `apps/kanban/src/goals/project-goals.service.ts`                                                 | Goal CRUD (underlying service)                           |
| `apps/api/src/workflow/workflow-internal-tools/tools/memory/record-project-memory.tool.ts`       | Project memory write tool                                |
| `apps/api/src/workflow/workflow-internal-tools/tools/charter/update-charter.tool.ts`             | Charter doc write tool                                   |
| `apps/api/src/workflow/workflow-delegation-tools/workflow-delegation-tool-projection.service.ts` | `delegate_design_ingestion` wiring                       |
| `seed/agents/ceo-agent/agent.json` + `PROMPT.md`                                                 | CEO tool policy and persona                              |
| `seed/workflows/project-charter-ceo.workflow.yaml`                                               | Onboarding workflow                                      |
| `seed/workflows/prompts/project-charter-ceo/`                                                    | Workflow prompts (onboard, brownfield-onboard, refine)   |
| `seed/workflows/prompts/project-discovery-ceo/discovery.md`                                      | Discovery prompt (reads CHARTER.md)                      |
| `apps/web/src/pages/project-workspace/ProjectIntentTab.tsx`                                      | Web UI entry point                                       |
| `apps/web/src/pages/project-workspace/CharterColumn.tsx`                                         | Charter accordion column                                 |
| `apps/web/src/pages/project-workspace/CharterCategorySection.tsx`                                | Per-category accordion section                           |

---

## Cross-References

- [35 — Memory & Learning](35-memory-learning.md) — `MemoryManagerService`, memory segment lifecycle, `query_memory`
- [23 — Kanban Orchestration](23-kanban-orchestration.md) — Discovery cycle that reads the charter
- [11 — Workflow Catalog](11-workflow-catalog.md) — `project_charter_ceo` workflow reference
- [12 — AI Config](12-ai-config.md) — CEO agent profile and skill resolution
- [34 — Glossary](34-glossary.md) — Domain term definitions
