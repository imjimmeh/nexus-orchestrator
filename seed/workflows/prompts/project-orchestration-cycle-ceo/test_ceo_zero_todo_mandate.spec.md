# CEO Zero-Todo Backlog Promotion Mandate Contract Test

## Contract
When `autonomous_mode=true`, `todo_count=0`, and `backlog_count>0`, the CEO MUST NOT produce bare `repeat` with no mutation.

## Protocol Requirements

### MUST Requirements
1. When `todo_count=0` AND `backlog_count>0` AND `autonomous_mode=true`, CEO MUST choose exactly ONE of:
   - (a) `promote` — Promote at least one safe unblocked backlog item to todo
   - (b) `patch` — Fix execution config to make candidate safe, then promote
   - (c) `create` — Generate missing work item, then promote
   - (d) `repeat` with `blockedItems` array — All items blocked by unresolvable issues, per-item `blockedReason` required
   - (e) `blocked` — Systemic ticket-level blocker

2. Outcome (d) MUST include a `blockedItems` array with:
   - `workItemId`: Actual Kanban UUID (not placeholder)
   - `workItemTitle`: Current title in Kanban
   - `blockedReason`: Specific, actionable explanation (NOT generic)

### MUST NOT Requirements (FORBIDDEN PATTERNS)
1. Bare `repeat` with no mutation when unblocked backlog exists
2. Generic "no work to do" when `backlog_count > 0`
3. "Will monitor" as sole action when `todo_count=0` and `backlog_count>0`
4. Ambiguous reason with no per-item detail
5. Human-decision blockers interpreted as board-wide blockers
6. "Idle board" interpretation when unblocked backlog exists
7. Partial explanation without `blockedItems` array

### Non-Contagion Rule
- `human_decision` probe findings apply ONLY to the flagged work item
- 3 human-decision blocked items in 33-item backlog means 30 items are UNBLOCKED
- The existence of human-decision items does NOT mean entire backlog is blocked

## Test Cases

| TC-ID | Scenario | Expected Decision | Valid |
|-------|----------|-------------------|-------|
| TC-001 | `todo_count=0`, `backlog_count>0`, safe unblocked items exist | `promote` | ✅ |
| TC-002 | `todo_count=0`, `backlog_count>0`, fixable config blocker | `patch` | ✅ |
| TC-003 | `todo_count=0`, `backlog_count>0`, no suitable backlog | `create` | ✅ |
| TC-004 | `todo_count=0`, `backlog_count>0`, all items blocked by unresolvable issues | `repeat` with `blockedItems` array | ✅ |
| TC-005 | `todo_count=0`, `backlog_count>0`, systemic ticket-level blocker | `blocked` | ✅ |
| TC-006 | `todo_count=0`, `backlog_count>0`, unblocked backlog | Bare `repeat` | ❌ VIOLATION |
| TC-007 | `todo_count=0`, `backlog_count>0` | `repeat` with generic reason "No board action available" | ❌ VIOLATION |
| TC-008 | `todo_count=0`, `backlog_count>0` | `repeat` with reason "Will monitor" | ❌ VIOLATION |
| TC-009 | `todo_count=0`, `backlog_count>0` | `repeat` with reason "Board is idle" | ❌ VIOLATION |
| TC-010 | 3 `human_decision` items in 33-item backlog | Bare `repeat` claiming "no board action available" | ❌ VIOLATION |
| TC-011 | `repeat` without `blockedItems` array when `backlog_count>0` | `repeat` with generic reason | ❌ VIOLATION |
| TC-012 | `repeat` with placeholder `blockedItems` (no actual UUIDs) | `repeat` with `blockedItems` containing placeholders | ❌ VIOLATION |

## Evidence

**2026-05-15 Incident**: run 93afe391
- Board state: `todo_count=0`, `backlog_count=33`, 3 blocked `human_decision` items
- CEO output: `decision: repeat`, reason: "No board action available. 3 blocked human-decision items awaiting human feedback."
- **VIOLATION**: CEO treated 3 human-decision blockers as board-wide blockers
- **CORRECT**: Should have promoted 30 unblocked backlog items to todo

## Validation Rules

1. When `todo_count=0` AND `backlog_count>0` AND `autonomous_mode=true`:
   - Decision MUST be one of: `promote`, `patch`, `create`, `repeat` (with `blockedItems`), `blocked`
   - Decision MUST NOT be bare `repeat` with no mutation

2. For `decision: repeat` when `backlog_count>0`:
   - `blockedItems` array MUST be present
   - Each `blockedReason` MUST be specific (not generic like "blocked")
   - Each `workItemId` MUST be an actual Kanban UUID (not placeholder)

3. Non-Contagion Rule validation:
   - Human-decision blockers MUST NOT be treated as affecting unrelated backlog items
   - Presence of human-decision items MUST NOT prevent promotion of unblocked items
