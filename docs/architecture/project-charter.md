# Project Charter Architecture

## Overview

The project charter is a living document that captures the foundational context of a project. It is populated incrementally during conversational onboarding and refined over the project lifetime.

The **database is the single source of truth**. `CHARTER.md` is an auto-generated export that is always fresh — it is never edited directly and is regenerated on every write via the `charter-regen` BullMQ queue.

---

## Charter Sections

The canonical set of eleven sections, in display order:

1. **Vision** — The problem being solved and the desired outcome.
2. **Goals** — Measurable objectives the project must achieve.
3. **Requirements** — Functional and non-functional requirements.
4. **Constraints** — Boundaries the solution must not violate (budget, timeline, technology).
5. **Dos & Don'ts** — Explicit behavioural guidelines for the team and agents.
6. **Non-Goals** — Items explicitly out of scope to prevent scope creep.
7. **Success Criteria** — How success will be measured at the end of the project.
8. **Decisions** — Architectural or product decisions already made.
9. **Glossary** — Shared vocabulary and domain-specific terminology.
10. **Stakeholders** — People, teams, or systems with an interest in the project.
11. **Open Questions** — Unresolved questions that need answers before or during execution.

These values are the `CHARTER_SECTIONS` tuple exported from `project-charter.schema.ts`.

---

## Memory Category Taxonomy

Every piece of information extracted from an onboarding or refinement conversation is tagged with one of eleven categories:

| Category           | Charter Section    | Description                                                  |
|--------------------|--------------------|--------------------------------------------------------------|
| `vision`           | Vision             | The problem being solved and the desired outcome.            |
| `requirement`      | Requirements       | A functional or non-functional requirement.                  |
| `constraint`       | Constraints        | A hard boundary (budget, time, regulatory, technology).      |
| `do_dont`          | Dos & Don'ts       | An explicit behavioural rule — something to do or avoid.     |
| `non_goal`         | Non-Goals          | Something explicitly out of scope.                           |
| `success_criteria` | Success Criteria   | A measurable definition of project success.                  |
| `decision`         | Decisions          | An architectural or product decision already made.           |
| `preference`       | *(inline)*         | A soft preference with no hard enforcement.                  |
| `glossary`         | Glossary           | A domain term and its definition.                            |
| `stakeholder`      | Stakeholders       | A person, team, or system with a stake in the project.       |
| `open_question`    | Open Questions     | An unresolved question requiring a future answer.            |

These values are the `PROJECT_MEMORY_CATEGORIES` tuple exported from `project-charter.schema.ts`.

The `CHARTER_SECTION_TO_CATEGORY` map (also in `project-charter.schema.ts`) is the **single source of truth** for which category populates which charter section. `CharterDocRenderService` uses this map when rendering the document.

---

## Provenance Convention

Every memory segment carries a `ProjectMemoryProvenance` record in its metadata:

```typescript
{
  category: ProjectMemoryCategory;   // one of the eleven categories above
  source: 'onboarding_chat' | 'refine_chat' | string;
  captured_by?: string;              // agent profile ID that extracted the item
  confidence?: number;               // 0–1 score assigned by the extraction agent
}
```

- `source` is `'onboarding_chat'` when captured during initial project setup and `'refine_chat'` when captured during a later refinement conversation. Custom sources are allowed via the `string` union.
- `captured_by` is the agent profile ID responsible for extraction (optional for user-authored entries).
- `confidence` allows the extraction agent to signal uncertainty; downstream consumers may surface low-confidence items for human review.

---

## Storage Locations

| Artefact                        | Storage location                                                                     |
|---------------------------------|--------------------------------------------------------------------------------------|
| Project vision (board-level)    | `memory_segments` table with `category = 'vision'`                                   |
| Project goals                   | `kanban_project_goals` table (managed by the Goals domain)                           |
| Requirements, constraints, etc. | `memory_segments` table with `entity_type = 'project'` and provenance metadata       |
| Charter markdown document       | `docs/project-context/CHARTER.md` within the project's repository (auto-generated)  |

---

## CHARTER.md Generation

`CHARTER.md` is **never written directly by an agent**. It is regenerated automatically whenever project data changes:

1. A write to `kanban_project_goals` or a relevant `memory_segments` row enqueues a job on the `charter-regen` BullMQ queue.
2. `CharterRegenProcessor` dequeues the job, calls `CharterDocRenderService.render(projectId)` to build the markdown, then writes and commits the file via `CoreWorkflowClientService.writeRepoFile`.
3. `CharterDocRenderService` queries the database for goals and categorized memory segments and renders them into the `CHARTER_SECTIONS` order using `CHARTER_SECTION_TO_CATEGORY`.

This means `CHARTER.md` always reflects the current DB state and can be treated as an always-current ground truth by agents and the web UI.

---

## Charter API Endpoint

`GET /projects/:id/charter` returns a structured aggregate:

```typescript
{
  vision: string | null;       // from memory_segments category='vision'
  goals: ProjectGoal[];        // from kanban_project_goals
  sections: Record<CharterSection, MemorySegment[]>;  // categorized memories
}
```

---

## Agent Interaction Pattern

Agents **do not** call an `update_charter` tool. Instead:

- Goals are written via `kanban.goal_create`, `kanban.goal_update`, `kanban.goal_update_status`, `kanban.goal_add_note`.
- All other charter content (vision, requirements, constraints, etc.) is written via `kanban.record_project_memory` with the appropriate `category` field.

Every write triggers automatic `CHARTER.md` regeneration via the `charter-regen` queue.

---

## Web UI

The charter is rendered as a single scrolling document ordered by `CHARTER_SECTIONS`. Sections are populated live from the `GET /projects/:id/charter` aggregate endpoint.
