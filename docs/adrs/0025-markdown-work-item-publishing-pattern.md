# ADR-0025: Markdown Work Item Publishing Pattern

## Status
Accepted

## Context
We have a split-brain problem in the work item lifecycle:
1. Work item definitions live as markdown files in `docs/work-items/` (canonical source)
2. Work item runtime state lives in the database (kanban board)

When agents write markdown specs, the database isn't automatically updated. This causes dispatch failures when agents try to start work items that exist as files but not yet as database records.

## Decision

Agents must explicitly call `kanban.publish_specs` to hydrate/reconcile database records from markdown files.

This is a **deliberate two-phase process**:
- **Phase 1 (Agent):** Write markdown files, call `kanban.publish_specs`
- **Phase 2 (Kanban):** Reconcile database projection from canonical markdown

## Consequences

### Positive
- Clear separation between definition authoring and database projection
- Markdown files remain the canonical source of truth
- Reviewable, version-controlled work item definitions
- Idempotent hydration (can run multiple times safely)

### Negative
- Agents must remember to call `kanban.publish_specs` before dispatching new items
- Additional Kanban MCP call in the workflow
- Potential confusion about when items are "live" in the kanban

## When to Use `kanban.publish_specs`

**ALWAYS call `kanban.publish_specs` when:**
1. You've written new markdown spec files that need to be dispatched
2. You've updated existing markdown specs that need database sync
3. You're about to dispatch newly-authored work items and aren't sure if items are published

**DON'T NEED to call `kanban.publish_specs` when:**
- The work item already exists in the kanban board (it's already published)
- You're working within an existing work item's lifecycle

## Related
- [Work Item Markdown Canonical Contract](../architecture/work-item-markdown-canonical-contract.md)
- Kanban-owned MCP publishing and dispatch tools
