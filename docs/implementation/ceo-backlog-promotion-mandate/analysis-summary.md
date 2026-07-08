# CEO Backlog Promotion Mandate - Analysis Summary

**Work Item:** 0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2  
**Milestone:** Analyze existing CEO cycle prompt and workflow  
**Date:** 2026-05-31

---

## Executive Summary

The CEO cycle prompt (`decide.md`) already contains comprehensive backlog promotion mandate language, including the four mandatory outcomes (a-d), rejection language for bare `repeat`, and structured output schemas. This analysis examines the current state and identifies what reinforcement is still needed to prevent recurrence of the 2026-05-15 protocol violation.

---

## 1. Current Prompt Analysis

### 1.1 Existing Mandatory Language

The prompt already contains strong, explicit language around zero-todo backlog promotion:

| Section | Current Language | Status |
|---------|-----------------|--------|
| **AUTONOMOUS ZERO-TODO BOARD RULE** | "When ALL conditions true, promotion is MANDATORY... This is not optional guidance—it is a hard protocol requirement." | ✅ Present |
| **CEO MUST Choose Exactly One** | Four outcomes (a-d) defined with trigger conditions and CEO actions | ✅ Present |
| **Rejection Language** | "A bare `repeat` with no mutation and no `blockedItems` array is NOT permitted" | ✅ Present |
| **CRITICAL INCIDENT REFERENCE** | References 2026-05-15 violation explicitly | ✅ Present |
| **Decision Rules Table** | Explicit forbidden scenarios and required outcomes | ✅ Present |
| **PROTOCOL VIOLATION** | "If you do nothing when todo_count == 0 and backlog_count > 0 → VIOLATION" | ✅ Present |

### 1.2 Current Decision Tree Structure

The prompt implements a 5-branch decision tree:

1. **Branch 1: Mixed Scenarios** - Some unblocked, some blocked → promote safe, patch fixable, document unresolvable
2. **Branch 2: All Items Unblocked** → Promote or Create
3. **Branch 3: All Items Blocked** → Classify blocker type, then patch or structured no-action
4. **Branch 4: No Suitable Backlog Items** → Create missing work item
5. **Branch 5: Capacity Constraints** → Promote priority item, document rest

### 1.3 Existing Structured Output Schemas

The prompt already defines:

**Outcome (d) - Structured No-Action with blockedItems:**
```
decision: repeat
reason: "Zero todo items and <N> backlog items exist, but all candidates blocked by unresolvable issues. blockedItems: [{workItemId: '<uuid>', workItemTitle: '<title>', blockedReason: '<specific per-item explanation>'}]. Manual intervention required."
```

**Outcome (b) - Patched Config:**
```
decision: repeat
reason: "Patched execution_config on [backlog-uuid] to fix missing environment variable. Promoted to todo and dispatched. Item is now safe."
```

**Outcome (c) - Created Work Item:**
```
decision: repeat
reason: "No suitable backlog item existed. Created new work item [generated-uuid] via delegate_work_item_generation, promoted to todo, and dispatched. Scope: [scoped description]."
```

---

## 2. Protocol Violation Evidence (ANALYSIS-2026-05-15)

### 2.1 Incident Summary

| Field | Value |
|-------|-------|
| Project | b50c5173-43d9-4935-83cf-46d9c63b7daf |
| Workflow Run | 93afe391-297c-4df9-8250-5f84d538808f |
| Date | 2026-05-15 |
| Board State | 0 todo, 33 backlog, 3 blocked human-decision |
| Decision Recorded | `repeat` with "No board action available" |

### 2.2 Root Cause Identified

The analysis identified **three compounding factors**:

1. **Prompt allowed "may promote" instead of "must promote"** - The CEO treated backlog promotion as discretionary
2. **Blocked human-decision items were misread as board-wide blockers** - Model concluded `ask_when_uncertain` policy applied to all 33 backlog items
3. **No runtime guard** - `kanban.orchestration_record_cycle_decision` accepted bare `repeat` without validation

### 2.3 Why Bare `repeat` Was Rejected

The recorded reason was:
> "No change from prior cycle: 0 dispatchable todo items, 3 blocked human-decision items awaiting human feedback. Stale reconciler waking to check for manual resolution. No board action available to this cycle."

**Problems:**
- Ignored 33 unblocked backlog items
- Treated human-decision probe findings as board-wide blockers
- Concluded "no board action" when actionable backlog existed
- No per-item `blockedReason` evidence

---

## 3. Key Sections Requiring Modification

Based on the analysis documents, the following areas should be examined for reinforcement:

### 3.1 Section: "AUTONOMOUS ZERO-TODO BOARD RULE"

**Current strength:** High - explicit MANDATORY language  
**Potential reinforcement:** Consider adding explicit enumeration of what "safe/unblocked" means to prevent misclassification

### 3.2 Section: "The CEO MUST Choose Exactly One of Four Mandatory Outcomes"

**Current strength:** Good - table format with conditions and actions  
**Potential reinforcement:** Add explicit "human-decision items do not block unrelated backlog" guidance

### 3.3 Section: "Decision Tree Logic"

**Current strength:** Comprehensive 5-branch tree  
**Potential reinforcement:** Explicit Branch 0 to clarify human-decision blockers don't apply to unblocked backlog

### 3.4 Section: "Explicitly Rejected: Bare `repeat` with No Mutation"

**Current strength:** Extensive invalid examples  
**Potential reinforcement:** Already strong; add the specific 2026-05-15 scenario as a concrete example

---

## 4. Required Output Format for Four Mandated Outcomes

### 4.1 Outcome (a) - Promote Unblocked Backlog

```
decision: promote
reason: "Promoted <N> safe unblocked backlog item(s) to todo: [<item-uuids>]. Board has dispatchable work for current sprint. <Optional: remaining unblocked candidates>"
```

**Required actions:**
1. `kanban.patch_work_item_status` to transition to `todo`
2. `kanban.dispatch_selected_work_items` with promoted items
3. Record `promote` decision (not `repeat`)

### 4.2 Outcome (b) - Patch Config & Promote

```
decision: patch
reason: "Patched execution_config on [<item-uuid>] to fix [<specific issue>]. Promoted to todo and dispatched. Item is now safe."
```

**Required actions:**
1. `kanban.work_item_patch_execution_config` to fix blocker
2. `kanban.patch_work_item_status` to transition to `todo`
3. `kanban.dispatch_selected_work_items`
4. Record `patch` decision

### 4.3 Outcome (c) - Create Missing Work Item & Promote

```
decision: create
reason: "No suitable backlog item existed. Created new work item [<generated-uuid>] via delegate_work_item_generation, promoted to todo, and dispatched. Scope: [<scoped description>]."
```

**Required actions:**
1. `delegate_work_item_generation` to create missing item
2. Re-read `kanban.project_state` to get new UUID
3. `kanban.patch_work_item_status` to transition to `todo`
4. `kanban.dispatch_selected_work_items`
5. Record `create` decision

### 4.4 Outcome (d) - Structured No-Action (All Blocked)

```
decision: repeat
reason: "Zero todo items and <N> backlog items exist, but all candidates blocked by unresolvable issues. blockedItems: [{workItemId: '<uuid>', workItemTitle: '<title>', blockedReason: '<specific per-item explanation>'}]. Manual intervention required."
```

**blockedItems schema requirements:**
| Field | Required | Notes |
|-------|----------|-------|
| `workItemId` | Yes | Actual Kanban UUID, no placeholders |
| `workItemTitle` | Yes | Must match current Kanban title |
| `blockedReason` | Yes | Specific, actionable, no generic terms |

**Permitted blockedReason patterns:**
- "Requires upstream API credentials that are not yet provisioned and no workaround exists"
- "Blocked by [<WORK_ITEM_ID>] which cannot be dispatched due to [<specific reason>]"
- "Missing prerequisite: [<spec/dependency>] not yet approved"
- "External dependency [<name>] is offline and no fallback exists"
- "Capacity limit reached: [<specific constraint>]"

**NOT permitted:**
- "blocked" or "cannot proceed"
- "waiting on upstream"
- "will monitor"
- "issues exist"

---

## 5. Workflow Permission Audit

**File:** `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`

| Tool | Purpose | Status in YAML |
|------|---------|----------------|
| `kanban.patch_work_item_status` | Promote backlog to todo | ✅ Allowed |
| `kanban.dispatch_selected_work_items` | Dispatch promoted work | ✅ Allowed |
| `kanban.work_item_patch_execution_config` | Fix blocking config | ✅ Allowed |
| `delegate_work_item_generation` | Create missing work item | ✅ Allowed |
| `kanban.complete_orchestration_cycle_decision` | Record final decision | ✅ Allowed |
| `kanban.project_state` | Read board state | ✅ Allowed |

**Note:** P0-5 from ANALYSIS-2026-05-18 identified this as a prior issue. Current YAML shows `kanban.dispatch_selected_work_items` IS present in `allow_tools`, suggesting this was already fixed.

---

## 6. Findings and Recommendations

### 6.1 What Already Exists ✅

1. **Strong MANDATORY promotion language** - The prompt explicitly states promotion is not optional
2. **Four mandated outcomes defined** - Clear table with trigger conditions and required actions
3. **Explicit rejection of bare `repeat`** - Multiple sections prohibit no-mutation repeat when backlog exists
4. **Structured output schemas** - blockedItems array schema with field requirements
5. **Decision tree with 5 branches** - Covers mixed, all-unblocked, all-blocked, no-suitable, capacity scenarios
6. **Protocol violation definition** - Explicit statement that doing nothing is a violation
7. **CRITICAL INCIDENT REFERENCE** - 2026-05-15 violation cited as prevention example
8. **Dispatch tools in workflow** - Permission audit shows all required tools are allowed

### 6.2 Potential Reinforcement Opportunities

1. **Add explicit human-decision non-contagion rule** - Clarify that `human_decision` blocked probes don't apply to unrelated backlog items

2. **Add concrete 2026-05-15 scenario to invalid examples** - The current invalid examples are good, but showing the exact violation would be educational

3. **Add "safe/unblocked" definition section** - Explicit criteria for what makes a backlog item a valid promotion candidate

4. **Consider runtime contract test** - As mentioned in work item requirements, add a test that validates:
   - CEO cannot record bare `repeat` when todo_count==0 and backlog_count>0
   - Decision must include promotion action OR blockedItems array

### 6.3 Recommended Next Steps for Implementation

1. **Review current prompt language** for any gaps vs. this analysis
2. **Add explicit human-decision non-contagion guidance** to Branch 0 of decision tree
3. **Add concrete 2026-05-15 example** to the "INVALID Examples" section
4. **Create runtime contract test** per work item requirements
5. **Stage and document changes**

---

## 7. Evidence Files Referenced

| File | Key Evidence |
|------|-------------|
| `docs/analysis/ANALYSIS-2026-05-15-orchestration-post-fix-runtime.md` | Exact protocol violation: CEO concluded "no board action" with 33 backlog items, 0 todo |
| `docs/analysis/ANALYSIS-2026-05-18-orchestration-process-gaps.md` | P0-5 identified missing dispatch tool (subsequently fixed); overall orchestration gap analysis |

---

## 8. Source Files Analyzed

| File | Purpose |
|------|---------|
| `seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md` | CEO decision prompt with backlog promotion mandate |
| `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml` | CEO workflow definition with tool permissions |

---

*Analysis completed for work item 0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2 - CEO cycle backlog promotion mandate*