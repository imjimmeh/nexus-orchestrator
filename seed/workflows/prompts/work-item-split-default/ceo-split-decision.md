# Oversized Work Item: Decompose or Promote

This work item was flagged as oversized (13 story points, or explicitly CEO-flagged). As the CEO, decide how
to resolve it before it can proceed through refinement as a single unit.

Project ID: {{trigger.scopeId}}
Work Item ID: {{trigger.contextId}}
Title: {{trigger.resource.title}}
Description: {{trigger.resource.description}}
Current type: {{trigger.resource.type}}

Read the full spec at `{{trigger.resource.metadata.workItemMarkdownPath}}` if present for full context
(acceptance criteria, codebase analysis, implementation plan) before deciding.

## Choose exactly one decision

- **`decompose`** - the item keeps its current type (e.g. remains a `story`) and gains child work items that
  cover its scope between them. Children must be a type this item's type is allowed to parent (a `story` can
  parent `task`/`bug`/`spike` children, NOT another `story`). Use this for the common case: a normal story
  that is simply too big to implement as one unit.
- **`promote`** - for genuinely epic-scale work: the item is re-typed to `epic` (detaching any existing
  parent), then decomposed into child `story`/`task`/`bug`/`spike` items. Use this when the item actually
  represents a multi-story initiative rather than one oversized story.

Either way, every child must fully cover the parent's scope - do not drop acceptance criteria or leave gaps.
Each child's `type` must be a type the resolved parent (this item, or the epic it is promoted to) is allowed
to parent.

## Call set_job_output

Call `set_job_output` exactly once with a native object:

```json
{
  "decision": "decompose" | "promote",
  "children": [
    { "title": "...", "type": "task" | "bug" | "spike" | "story", "description": "..." }
  ],
  "rationale": "..."
}
```

- `children` must be a non-empty array covering the full scope of this work item.
- Do not set `story_points` on children here - each child is independently estimated during its own
  refinement pass.
- `rationale` is optional but recommended: a short explanation of why decompose vs. promote was chosen.
