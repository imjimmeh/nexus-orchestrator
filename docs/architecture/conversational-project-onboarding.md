# Conversational Project Onboarding & Charter (EPIC-203)

## Overview

Adds a reusable conversational mode where the CEO agent guides users through capturing a Project Charter. The charter produces:
- Structured project goals (`KanbanProjectGoalEntity` via `kanban.goal_*` MCP tools)
- Granular project memories (`MemorySegment` via `kanban.record_project_memory` with `category`)

`CHARTER.md` is auto-generated from the database on every write and is always current — it is never written directly by an agent.

Discovery (`project-discovery-ceo`) reads `CHARTER.md` as an always-current ground truth, eliminating duplicate elicitation.

## Flow

```
User creates project with startOnboarding: true
  │
  └─► POST /projects → ProjectService.create()
        └─► project_charter_ceo workflow (mode: greenfield)
              │
              ├─► route_branch job → branch: greenfield
              ├─► capture_charter job (CEO agent)
              │     ├─► ask_user_questions (one at a time)
              │     ├─► kanban.goal_create / kanban.goal_update      (goals store)
              │     ├─► kanban.record_project_memory (category=...)  (memory store)
              │     │     categories: vision, requirement, constraint,
              │     │                 do_dont, non_goal, success_criteria,
              │     │                 decision, preference, glossary,
              │     │                 stakeholder, open_question
              │     └─► delegate_design_ingestion (optional, DESIGN_INGESTION_WORKFLOWS_ENABLED)
              └─► set_job_output { charter_complete: true }
              [charter-regen queue fires automatically after each write → CHARTER.md]

User refines charter mid-project
  │
  └─► POST /projects/:id/charter/launch { mode: 'refine' }
        └─► project_charter_ceo workflow (mode: refine)
              └─► refine_charter job (CEO agent)
                    ├─► query_memory + read CHARTER.md (always current)
                    ├─► one change at a time (goal_* or record_project_memory)
                    └─► set_job_output { charter_updated: true }

Discovery cycle starts
  │
  └─► project-discovery-ceo workflow
        └─► discovery.md KNOWLEDGE BASE
              1. Read CHARTER.md (always-current ground truth)
              2. query_memory entity_type=project
              3. Read docs/project-context/*.md files
              4. Read OPEN_QUESTIONS.md
```

## Storage Layout

| Data | Storage | Tool |
|------|---------|------|
| Goals | `KanbanProjectGoalEntity` | `kanban.goal_create/update/update_status/add_note` |
| Vision, requirements, constraints, decisions, etc. | `MemorySegment` (`entity_type=project`, with `category`) | `kanban.record_project_memory` |
| Charter document | `docs/project-context/CHARTER.md` | Auto-generated via `charter-regen` queue |
| Ingestion delegation | `design_ingestion_new_project` workflow | `delegate_design_ingestion` |

`CHARTER.md` is the rendered export of the above two stores. It is written by `CharterRegenProcessor` via `CoreWorkflowClientService.writeRepoFile` after every change and should be treated as read-only by agents.

## Tool Permissions

All capture tools (`kanban.goal_*`, `kanban.record_project_memory`) are allowed in the CEO agent profile (`seed/agents/ceo-agent/agent.json`) and in the `project_charter_ceo` workflow tool policy. The `project-orchestration-cycle-ceo` workflow also grants them for mid-cycle charter capture.

## Related

- EPIC-131: Design Ingestion (soft dependency, feature-flagged)
- EPIC-202: Memory Injection (soft dependency)
- `seed/workflows/project-charter-ceo.workflow.yaml`
- `seed/workflows/prompts/project-charter-ceo/`
- `packages/kanban-contracts/src/project-charter.schema.ts`
