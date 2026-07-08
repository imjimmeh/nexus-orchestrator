# Milestone 1 Analysis: CEO Prompt and Workflow Files

**Work Item:** 0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2  
**Milestone:** 1 - Analyze CEO Prompt and Workflow Files  
**Date:** 2026-06-01  
**Status:** COMPLETE

---

## Executive Summary

This analysis examined the CEO cycle prompt (`decide.md`) and workflow (`project-orchestration-cycle-ceo.workflow.yaml`) to identify where backlog promotion language exists and what changes are required to enforce mandatory promotion when autonomous boards have zero todo items with available backlog.

**Key Finding:** The prompt already contains comprehensive mandatory promotion language. The primary issue identified in the 2026-05-15 incident was the CEO treating "may promote" as optional discretion rather than a hard requirement.

---

## 1. Files Analyzed

| File | Purpose |
|------|---------|
| `seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md` | CEO decision logic with backlog promotion mandate |
| `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml` | CEO workflow definition with tool permissions |
| `seed/workflows/prompts/project-orchestration-cycle-ceo/cycle.md` | CEO cycle entry point that collects board state |
| `docs/analysis/ANALYSIS-2026-05-15-orchestration-post-fix-runtime.md` | Evidence of the protocol violation |
| `seed/workflows/prompts/project-orchestration-cycle-ceo/test_ceo_zero_todo_mandate.spec.md` | Contract test specification |

---

## 2. Current Promotion Language Locations

### 2.1 Primary Mandate Location (decide.md)

**Section: AUTONOMOUS ZERO-TODO BOARD RULE (lines ~237-255)**

```markdown
When ALL of these conditions are true simultaneously:
- todo_count == 0 (zero todo items on the board)
- backlog_count > 0 (one or more backlog items exist)
- autonomous_mode == true

**You MUST choose exactly one of these outcomes:**
1. (a) Promote to todo
2. (b) Patch exec_config
3. (c) Create & Promote
4. (d) Structured blockedReason

**Bare `repeat` with no mutation and no per-item `blockedReason` is FORBIDDEN**
```

### 2.2 Decision Output Schema (lines ~85-88)

| Decision | When to Use | Required Evidence |
|----------|-------------|-------------------|
| `promote` | Outcome (a): Promoted unblocked backlog to todo | List promoted item UUIDs in reason |
| `patch` | Outcome (b): Fixed execution config, then promoted | List patched item UUID and what was fixed |
| `create` | Outcome (c): Created new work item, then promoted | List generated work item UUID and scope |
| `repeat` | Outcome (d): No mutation possible; must include `blockedItems` array | Per-item `blockedReason` fields required |
| `blocked` | Systemic blocker requires manual intervention | List specific ticket-level blockers |

### 2.3 Decision Tree Logic (lines ~299-360)

Five-branch decision tree covering:
- Branch 1: Mixed scenarios (some unblocked, some blocked)
- Branch 2: All items unblocked
- Branch 3: All items blocked (classify by blocker type)
- Branch 4: No suitable backlog items
- Branch 5: Capacity constraints

### 2.4 Explicitly Rejected Patterns (lines ~188-220)

Multiple invalid examples showing protocol violations:
- Bare `repeat` with "No board action available"
- Generic "no work" when backlog exists
- "Will monitor" as sole action
- Human-decision blockers misread as board-wide

### 2.5 NON-CONTAGION RULE (lines ~279-297)

Explicit rule that human_decision probe findings do NOT apply to unrelated backlog items. 3 human_decision items in 33-item backlog means 30 items are UNBLOCKED.

---

## 3. Required Additions for Mandatory Promotion

### 3.1 Strengthen "May Promote" Language

**Current weakness:** Lines ~225-233 contain strong mandate language, but earlier sections list promotion as one option among many:

```markdown
Before dispatching, decide whether to identify missing-work gaps, 
update stale specs, ..., promote backlog items into `todo`, demote...
```

**Recommended change:** Restructure the opening to make promotion the REQUIRED default path when conditions are met, not just one option among several.

### 3.2 Add Explicit "Safe/Unblocked" Definition

**Section to add:** Definition of what makes a backlog item "safe and eligible for promotion"

Required criteria:
| Criterion | Description |
|-----------|-------------|
| No execution config blockers | No missing environment variables, wrong branch, invalid configuration |
| No prerequisite dependencies | No dependency on other work items not completed or in-progress |
| No systemic blockers | No project-level issues preventing execution |
| Executable in current context | Has valid execution target, sufficient spec/content |
| Probe results not blocking | Not flagged by `human_decision` probe findings |

### 3.3 Structural Output Format Requirements for Repeat Decision

**Required schema for Outcome (d) when todo_count==0 AND backlog_count>0:**

```markdown
decision: repeat
reason: "Zero todo items and <N> backlog items exist, but all candidates 
blocked by unresolvable issues. blockedItems: [
  {
    workItemId: '<actual-Kanban-UUID>',
    workItemTitle: '<current-title>',
    blockedReason: '<specific-explanation>'
  }
]. Manual intervention required."
```

**Field requirements:**
- `workItemId`: Actual Kanban UUID (no placeholders)
- `workItemTitle`: Must match current Kanban title
- `blockedReason`: Specific, actionable (NOT generic "blocked" or "cannot proceed")

---

## 4. Evidence from 2026-05-15 Incident

**Project:** b50c5173-43d9-4935-83cf-46d9c63b7daf  
**Workflow Run:** 93afe391-297c-4df9-8250-5f84d538808f

### Board State at Time of Violation

| Metric | Value |
|--------|-------|
| Total Work Items | 43 |
| Todo Items | 0 |
| Backlog Items | 33 |
| Blocked Human-Decision Items | 3 |
| In-Review Items | 5 |

### CEO Violation Output

```
decision: repeat
reason: "No change from prior cycle: 0 dispatchable todo items, 
3 blocked human-decision items awaiting human feedback. 
Stale reconciler waking to check for manual resolution. 
No board action available to this cycle."
```

### Root Cause Analysis

1. **Prompt language**: "May promote" instead of "must promote" in key sections
2. **Misinterpretation**: Human-decision blockers treated as board-wide blockers
3. **No runtime guard**: `kanban.orchestration_record_cycle_decision` accepted bare `repeat`

### Correct Action (not taken)

Promote 30 unblocked backlog items to todo. Human-decision items remain blocked; they do NOT block unrelated items.

---

## 5. Workflow Permission Audit

**File:** `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`

| Tool | Purpose | Status |
|------|---------|--------|
| `kanban.patch_work_item_status` | Promote backlog to todo | ✅ Allowed |
| `kanban.dispatch_selected_work_items` | Dispatch promoted work | ✅ Allowed |
| `kanban.work_item_patch_execution_config` | Fix blocking config | ✅ Allowed |
| `delegate_work_item_generation` | Create missing work item | ✅ Allowed |
| `kanban.complete_orchestration_cycle_decision` | Record final decision | ✅ Allowed |
| `kanban.project_state` | Read board state | ✅ Allowed |

**Conclusion:** All required tools for promotion outcomes (a), (b), (c) are available in the workflow.

---

## 6. Contract Test Specification

**File:** `seed/workflows/prompts/project-orchestration-cycle-ceo/test_ceo_zero_todo_mandate.spec.md`

The contract test defines validation rules for:

| TC-ID | Scenario | Expected | Valid |
|-------|----------|----------|-------|
| TC-001 | todo_count=0, backlog_count>0, safe unblocked items exist | `promote` | ✅ |
| TC-004 | todo_count=0, backlog_count>0, all items blocked | `repeat` with `blockedItems` | ✅ |
| TC-006 | todo_count=0, backlog_count>0, unblocked backlog | Bare `repeat` | ❌ VIOLATION |
| TC-010 | 3 human_decision items in 33-item backlog | Bare `repeat` | ❌ VIOLATION |

---

## 7. Summary of Changes Required for Milestone 2

### 7.1 Prompt Changes (decide.md)

| Location | Change Type | Description |
|----------|-------------|-------------|
| Opening paragraph (~lines 225-233) | Strengthen | Make promotion the REQUIRED default, not one option among many |
| Add new section | Addition | Explicit "safe/unblocked" definition with criteria table |
| Decision tree | Addition | Add Branch 0 to clarify human-decision non-contagion |
| Invalid examples | Reinforce | Add concrete 2026-05-15 violation as educational example |

### 7.2 Runtime Contract Test

**File to create:** `tests/contracts/kanban/orchestration-cycle-contract.spec.ts`

Validation requirements:
1. CEO cannot record bare `repeat` when todo_count==0 and backlog_count>0
2. Decision must include promotion action (promote/patch/create) OR blockedItems array
3. Human-decision blockers do NOT apply to unrelated backlog items

### 7.3 Runtime Guard (Recommended)

**Location:** `kanban.complete_orchestration_cycle_decision` validation

Guard to reject:
- `decision === 'repeat'` when board has zero todo AND backlog exists
- Unless reason includes either mutation description OR `blockedItems` array with per-item `blockedReason`

---

## 8. Verification Checklist

- [x] Read and analyze `seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md`
- [x] Read and analyze `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`
- [x] Read `docs/analysis/ANALYSIS-2026-05-15-orchestration-post-fix-runtime.md`
- [x] Identify all locations where backlog promotion is mentioned
- [x] Determine what changes are needed
- [x] Document findings in summary to guide Milestone 2 changes

---

## 9. Next Steps

This analysis document serves as the foundation for Milestone 2 implementation. The changes required are:

1. **Strengthen decide.md** - Remove ambiguity in "may promote" language
2. **Add safe/unblocked definition** - Explicit criteria for promotion candidates
3. **Reinforce decision tree** - Add Branch 0 for non-contagion rule
4. **Create contract test** - Validate mandatory promotion behavior
5. **Consider runtime guard** - Reject bare repeat on zero-todo autonomous boards

---

*Analysis completed for work item 0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2*