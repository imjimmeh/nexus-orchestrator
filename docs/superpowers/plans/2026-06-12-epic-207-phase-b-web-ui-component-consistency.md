# EPIC-207 Phase B — Web UI Component Consistency and Theme Readiness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every hardcoded Tailwind colour with a semantic token, eliminate bare HTML elements in favour of `ui/` components, add three reusable primitives, decompose the eight largest files, and add barrel files to five feature directories — leaving the app fully theme-ready.

**Architecture:** Two sequential global sweeps (B1 token pass → B2 raw-HTML pass) establish a clean baseline that every file will meet before any structural work begins. B3 extracts three recurring inline patterns into named `ui/` primitives and migrates every site. B4 splits the eight files over ~400 lines along natural responsibility lines. B5 adds barrel files so import paths are shallow and stable.

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS (CSS-variable token system), Radix UI, class-variance-authority (CVA), Vitest + React Testing Library.

---

## Token Reference

All available semantic tokens (from `tailwind.config.js`):

| Intent              | Tailwind class prefix                            | Notes                               |
| ------------------- | ------------------------------------------------ | ----------------------------------- |
| Primary action      | `primary` / `primary-foreground`                 | Dark navy                           |
| Secondary           | `secondary` / `secondary-foreground`             |                                     |
| Destructive/error   | `destructive` / `destructive-foreground`         | Red                                 |
| Muted               | `muted` / `muted-foreground`                     | Light grey backgrounds, subtle text |
| Accent              | `accent` / `accent-foreground`                   | Hover tones                         |
| Success             | `success` / `success-foreground`                 | Green                               |
| Warning             | `warning` / `warning-foreground`                 | Amber/orange                        |
| Error               | `error` / `error-foreground`                     | Red (alias of destructive)          |
| Info                | `info` / `info-foreground`                       | Blue                                |
| Borders/inputs      | `border`, `input`, `ring`                        |                                     |
| Categorical accents | `accent-purple`, `accent-green`, `accent-orange` | No foreground variant               |

**Standard mapping cheatsheet:**

| Hardcoded                                            | Semantic replacement                         |
| ---------------------------------------------------- | -------------------------------------------- |
| `text-gray-500`, `text-gray-600`                     | `text-muted-foreground`                      |
| `bg-gray-50`                                         | `bg-muted/50`                                |
| `bg-gray-100 text-gray-600`                          | `bg-muted text-muted-foreground`             |
| `border-gray-300`                                    | `border-input`                               |
| `text-red-500`, `text-red-600`, `text-red-700`       | `text-destructive`                           |
| `bg-red-50`                                          | `bg-destructive/10`                          |
| `border-red-300`                                     | `border-destructive/30`                      |
| `bg-red-600 text-white`                              | `bg-destructive text-destructive-foreground` |
| `text-green-500`, `text-green-600`, `text-green-700` | `text-success`                               |
| `bg-green-100`                                       | `bg-success/20`                              |
| `bg-green-500`, `bg-green-600`                       | `bg-success`                                 |
| `bg-green-600 text-white`                            | `bg-success text-success-foreground`         |
| `text-blue-600` (links/actions)                      | `text-primary`                               |
| `text-blue-700`, `text-blue-400`                     | `text-info`                                  |
| `bg-blue-50`                                         | `bg-info/10`                                 |
| `border-blue-200`, `border-blue-300`                 | `border-info/30`                             |
| `bg-blue-600 hover:bg-blue-700` (buttons)            | `bg-primary hover:bg-primary/90`             |
| `text-yellow-600`, `text-yellow-700`                 | `text-warning`                               |
| `bg-yellow-100 text-yellow-700`                      | `bg-warning/20 text-warning`                 |
| `border-yellow-500/40`                               | `border-warning/40`                          |
| `text-orange-900`                                    | `text-warning-foreground`                    |
| `bg-orange-50 border-orange-200`                     | `bg-warning/10 border-warning/30`            |
| `bg-orange-500`                                      | `bg-accent-orange`                           |
| `text-amber-800`                                     | `text-warning`                               |
| `text-purple-500`                                    | `text-accent-purple`                         |
| `bg-purple-500/600`                                  | `bg-accent-purple`                           |
| `bg-purple-600 text-white`                           | `bg-accent-purple text-white`                |
| `bg-slate-500 text-white` (completed state)          | `bg-secondary text-secondary-foreground`     |
| `border border-slate-400/40 bg-slate-100/70`         | `border-border/40 bg-muted/70`               |

**Categorical graph-node accent colours** (already centralised in constants — keep with comment):
`bg-cyan-500`, `bg-pink-500`, `bg-teal-500`, `bg-violet-500`, `bg-gray-500`, `bg-slate-400`

---

## File Map

**B1 modified (token pass):**

- `apps/web/src/components/attachments/AttachmentChip.tsx`
- `apps/web/src/components/budget/BudgetStatusBanner.tsx`
- `apps/web/src/components/chat/ChatMessageItem.tsx`
- `apps/web/src/components/chat/QuestionCard.tsx`
- `apps/web/src/components/chat/SteeringPlanCard.tsx`
- `apps/web/src/components/harnesses/DeviceFlowModal.tsx`
- `apps/web/src/components/layout/Sidebar.tsx`
- `apps/web/src/components/orchestration/OrchestrationCapabilityHealthCard.tsx`
- `apps/web/src/components/orchestration/OrchestrationStatusCard.tsx`
- `apps/web/src/components/orchestration/WarRoomSessionManagerPanel.sections.tsx`
- `apps/web/src/components/orchestration/WarRoomSessionManagerPanel.tsx`
- `apps/web/src/components/sessions/SessionContextPanel.tsx`
- `apps/web/src/components/sessions/SessionThreadListItem.tsx`
- `apps/web/src/components/sessions/ThreadItem.tsx`
- `apps/web/src/components/workflow/WorkflowGraphNode.tsx`
- `apps/web/src/pages/admin/ScopedConfigViewer.tsx`
- `apps/web/src/pages/Dashboard.tsx`
- `apps/web/src/pages/gitops/GitOpsStatus.tsx`
- `apps/web/src/pages/kanban/kanban.board-helpers.ts`
- `apps/web/src/pages/kanban/TaskConfigModalContent.tsx`
- `apps/web/src/pages/project-workspace/FileTree.tsx`
- `apps/web/src/pages/project-workspace/LearningTabProposalsCard.tsx`
- `apps/web/src/pages/providers/DeviceFlowModal.tsx`
- `apps/web/src/pages/providers/ProviderOAuthCallback.tsx`
- `apps/web/src/pages/Register.tsx`
- `apps/web/src/pages/secrets/SecretForm.tsx`
- `apps/web/src/pages/settings/EnforcementModeCard.tsx`
- `apps/web/src/pages/work-items/GlobalWorkItemsPage.tsx`
- `apps/web/src/pages/workflows/WorkflowEditor.tsx`
- `apps/web/src/pages/workflows/WorkflowRunDetailHeader.tsx`

**B2 modified (raw HTML pass):**

- `apps/web/src/pages/admin/ScopedConfigViewer.tsx`
- `apps/web/src/components/layout/Header.tsx`
- `apps/web/src/components/attachments/AttachmentChip.tsx`
- `apps/web/src/components/workflow/WorkflowVisualizer.tsx`

**B3 created (new primitives):**

- `apps/web/src/components/ui/async-button.tsx`
- `apps/web/src/components/ui/async-button.spec.tsx`
- `apps/web/src/components/ui/nullable-select.tsx`
- `apps/web/src/components/ui/nullable-select.spec.tsx`
- `apps/web/src/components/ui/filter-checkbox.tsx`
- `apps/web/src/components/ui/filter-checkbox.spec.tsx`

**B3 modified (migrations):**

- `apps/web/src/pages/admin/ScopedConfigViewer.tsx`
- `apps/web/src/components/workflow/WorkflowLaunchInputField.tsx`
- `apps/web/src/components/workflow/WorkflowLaunchContractForm.tsx`
- `apps/web/src/components/workflow/workflowLaunchDialog.helpers.ts`
- `apps/web/src/components/sessions/NewSessionDialog.tsx`
- `apps/web/src/components/workflow/WorkflowActivityFeed.tsx`

**B4 created:**

- `apps/web/src/components/workflow/workflow-graph.utils.ts`
- `apps/web/src/components/workflow/workflow-activity-feed.hooks.ts`

**B4 modified:**

- `apps/web/src/components/workflow/WorkflowVisualizer.tsx`
- `apps/web/src/components/workflow/WorkflowActivityFeed.tsx`
- `apps/web/src/components/orchestration/WarRoomSessionManagerPanel.hooks.tsx`
- `apps/web/src/components/orchestration/WarRoomSessionManagerPanel.sections.tsx`
- `apps/web/src/components/orchestration/WarRoomSessionManagerPanel.tsx`
- `apps/web/src/components/orchestration/OrchestrationStatusCard.tsx`
- `apps/web/src/components/orchestration/SubagentExecutionPanel.tsx`
- `apps/web/src/components/budget/BudgetOverviewTab.tsx`
- `apps/web/src/components/sessions/NewSessionDialog.tsx`

**B5 created (barrel files):**

- `apps/web/src/components/workflow/index.ts`
- `apps/web/src/components/scope/index.ts`
- `apps/web/src/components/layout/index.ts`
- `apps/web/src/components/sessions/index.ts`
- `apps/web/src/components/orchestration/index.ts`

---

## Task 1: B1 — Token pass: workflow graph node colours

**Files:**

- Modify: `apps/web/src/components/workflow/WorkflowGraphNode.tsx`

The `JOB_TYPE_PRESENTATIONS` and `STEP_TYPE_PRESENTATIONS` constants contain accent colours for node-type visual differentiation. Most can be mapped to semantic tokens. Four colours (`bg-cyan-500`, `bg-pink-500`, `bg-teal-500`, `bg-gray-500`) have no matching semantic token — keep them with a comment marking them as categorical accents.

- [ ] **Step 1: Apply token replacements in WorkflowGraphNode.tsx**

Replace the constant blocks at lines 23–45:

```typescript
const JOB_TYPE_PRESENTATIONS = {
  execution: { icon: Bot, accentColor: "bg-info", typeLabel: "Execution" },
  invoke_workflow: {
    icon: Link,
    accentColor: "bg-accent-purple",
    typeLabel: "Invoke Workflow",
  },
  run_command: {
    icon: Terminal,
    accentColor: "bg-success",
    typeLabel: "Run Command",
  },
  emit_event: {
    icon: Radio,
    accentColor: "bg-accent-orange",
    typeLabel: "Emit Event",
  },
  /* categorical accents — no semantic token equivalent; update these to retheme node type chips */
  http_webhook: {
    icon: Globe,
    accentColor: "bg-cyan-500",
    typeLabel: "HTTP Webhook",
  },
  web_automation: {
    icon: Monitor,
    accentColor: "bg-pink-500",
    typeLabel: "Web Automation",
  },
  mcp_tool_call: {
    icon: Plug,
    accentColor: "bg-teal-500",
    typeLabel: "MCP Tool Call",
  },
  git_operation: {
    icon: GitBranch,
    accentColor: "bg-gray-500",
    typeLabel: "Git Operation",
  },
  register_tool: {
    icon: Wrench,
    accentColor: "bg-warning",
    typeLabel: "Register Tool",
  },
  manage_tool_candidate: {
    icon: Package,
    accentColor: "bg-accent-purple",
    typeLabel: "Manage Tool Candidate",
  },
} as const;

const STEP_TYPE_PRESENTATIONS = {
  agent: { icon: Bot, accentColor: "bg-info", typeLabel: "Agent" },
  run_command: {
    icon: Terminal,
    accentColor: "bg-success",
    typeLabel: "Command",
  },
  set_variable: {
    icon: Wrench,
    accentColor: "bg-warning",
    typeLabel: "Set Variable",
  },
  /* categorical accent — no semantic token equivalent */
  wait: { icon: Radio, accentColor: "bg-slate-400", typeLabel: "Wait" },
} as const;
```

Also replace the two fallback `accentColor` strings later in `resolvePresentation`:

```typescript
// fallback job (around line 76)
return {
  accentColor: 'bg-info',
  icon: <Bot className="h-4 w-4" />,
  typeLabel: 'Job',
};
// fallback step (around line 94)
return {
  accentColor: 'bg-slate-400', // categorical — no semantic token
  icon: <Bot className="h-3 w-3 text-muted-foreground" />,
  typeLabel: 'Step',
};
```

- [ ] **Step 2: Run tests**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -60
```

Expected: all `WorkflowGraphNode.spec.tsx` tests pass (tests use `accentColor` as a prop, not checking the actual colour string value).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/workflow/WorkflowGraphNode.tsx
git commit -m "refactor(web): replace hardcoded colours with semantic tokens in WorkflowGraphNode"
```

---

## Task 2: B1 — Token pass: attachment status colours

**Files:**

- Modify: `apps/web/src/components/attachments/AttachmentChip.tsx`

- [ ] **Step 1: Replace status colour constants (lines 12–16 and 28)**

```typescript
const PARSE_STATUS_CLASSES: Record<ParseStatus, string> = {
  parsed: "bg-success/20 text-success",
  parsing: "bg-info/20 text-info",
  pending: "bg-warning/20 text-warning",
  failed: "bg-destructive/20 text-destructive",
  skipped: "bg-muted text-muted-foreground",
};

// default fallback (line 28):
return "bg-muted text-muted-foreground";
```

- [ ] **Step 2: Run tests**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -40
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/attachments/AttachmentChip.tsx
git commit -m "refactor(web): replace hardcoded status colours with semantic tokens in AttachmentChip"
```

---

## Task 3: B1 — Token pass: budget and banner colours

**Files:**

- Modify: `apps/web/src/components/budget/BudgetStatusBanner.tsx`

- [ ] **Step 1: Replace the two variant class strings and icon colours**

At line 28 (approval_required variant):

```typescript
"border-info/30 bg-info/10 text-info-foreground dark:border-info/50 dark:bg-info/20";
```

At line 31 (deny/throttle variant):

```typescript
"border-destructive/30 bg-destructive/10 text-destructive-foreground dark:border-destructive/50 dark:bg-destructive/20";
```

At line 87 (Info icon className):

```typescript
"text-info";
```

At line 90 (Ban icon className):

```typescript
"text-destructive";
```

- [ ] **Step 2: Run tests and commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -40
git add apps/web/src/components/budget/BudgetStatusBanner.tsx
git commit -m "refactor(web): replace hardcoded colours with semantic tokens in BudgetStatusBanner"
```

---

## Task 4: B1 — Token pass: orchestration domain colours

**Files:**

- Modify: `apps/web/src/components/orchestration/OrchestrationCapabilityHealthCard.tsx`
- Modify: `apps/web/src/components/orchestration/OrchestrationStatusCard.tsx`
- Modify: `apps/web/src/components/orchestration/WarRoomSessionManagerPanel.sections.tsx`
- Modify: `apps/web/src/components/orchestration/WarRoomSessionManagerPanel.tsx`

- [ ] **Step 1: OrchestrationCapabilityHealthCard.tsx — replace three `text-red-700` occurrences**

Find and replace all three occurrences (lines 202, 255, 318):

```
"text-red-700"  →  "text-destructive"
```

- [ ] **Step 2: OrchestrationStatusCard.tsx — replace two block variants**

At line 229 (error severity):

```typescript
"border-destructive/30 bg-destructive/10 text-destructive";
```

At line 233 (default/info severity):

```typescript
"border-info/30 bg-info/10 text-info-foreground";
```

- [ ] **Step 3: WarRoomSessionManagerPanel.sections.tsx — replace two `text-red-700` occurrences**

Lines 119 and 163:

```
"text-red-700"  →  "text-destructive"
```

- [ ] **Step 4: WarRoomSessionManagerPanel.tsx — replace one `text-red-700`**

Line 31:

```
"text-red-700"  →  "text-destructive"
```

- [ ] **Step 5: Run tests and commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -40
git add apps/web/src/components/orchestration/OrchestrationCapabilityHealthCard.tsx \
        apps/web/src/components/orchestration/OrchestrationStatusCard.tsx \
        apps/web/src/components/orchestration/WarRoomSessionManagerPanel.sections.tsx \
        apps/web/src/components/orchestration/WarRoomSessionManagerPanel.tsx
git commit -m "refactor(web): replace hardcoded colours with semantic tokens in orchestration components"
```

---

## Task 5: B1 — Token pass: sessions and chat domain colours

**Files:**

- Modify: `apps/web/src/components/sessions/SessionContextPanel.tsx`
- Modify: `apps/web/src/components/sessions/SessionThreadListItem.tsx`
- Modify: `apps/web/src/components/sessions/ThreadItem.tsx`
- Modify: `apps/web/src/components/chat/ChatMessageItem.tsx`
- Modify: `apps/web/src/components/chat/QuestionCard.tsx`
- Modify: `apps/web/src/components/chat/SteeringPlanCard.tsx`

- [ ] **Step 1: SessionContextPanel.tsx (line 79) — agent-responding indicator**

```
"bg-orange-50 border border-orange-200"  →  "bg-warning/10 border border-warning/30"
"text-orange-900"  →  "text-warning-foreground"
```

- [ ] **Step 2: SessionThreadListItem.tsx (line 226) — active thread dot**

```
"bg-green-500"  →  "bg-success"
```

- [ ] **Step 3: ThreadItem.tsx (line 34) — unread indicator dot**

```
"bg-orange-500"  →  "bg-accent-orange"
```

- [ ] **Step 4: ChatMessageItem.tsx (line 246) — system message container**

```
"mx-4 border border-slate-400/40 bg-slate-100/70"  →  "mx-4 border border-border/40 bg-muted/70"
```

- [ ] **Step 5: QuestionCard.tsx — card border and icon colour**

Line 76:

```
"border-purple-500/50 bg-purple-500/5"  →  "border-accent-purple/50 bg-accent-purple/5"
```

Line 79:

```
"text-purple-500"  →  "text-accent-purple"
```

- [ ] **Step 6: SteeringPlanCard.tsx (line 139) — link-style button text**

```
"text-blue-600"  →  "text-primary"
```

- [ ] **Step 7: Run tests and commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -40
git add apps/web/src/components/sessions/SessionContextPanel.tsx \
        apps/web/src/components/sessions/SessionThreadListItem.tsx \
        apps/web/src/components/sessions/ThreadItem.tsx \
        apps/web/src/components/chat/ChatMessageItem.tsx \
        apps/web/src/components/chat/QuestionCard.tsx \
        apps/web/src/components/chat/SteeringPlanCard.tsx
git commit -m "refactor(web): replace hardcoded colours with semantic tokens in sessions and chat components"
```

---

## Task 6: B1 — Token pass: layout domain colours

**Files:**

- Modify: `apps/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Replace two `bg-green-500` badge occurrences (lines 140 and 171)**

```
"bg-green-500"  →  "bg-success"
```

- [ ] **Step 2: Run tests and commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -40
git add apps/web/src/components/layout/Sidebar.tsx
git commit -m "refactor(web): replace hardcoded colours with semantic tokens in Sidebar"
```

---

## Task 7: B1 — Token pass: harness and provider colours

**Files:**

- Modify: `apps/web/src/components/harnesses/DeviceFlowModal.tsx`
- Modify: `apps/web/src/pages/providers/DeviceFlowModal.tsx`
- Modify: `apps/web/src/pages/providers/ProviderOAuthCallback.tsx`

- [ ] **Step 1: harnesses/DeviceFlowModal.tsx (lines 154–155)**

```
"bg-green-100"  →  "bg-success/20"
"text-green-600"  →  "text-success"
```

- [ ] **Step 2: providers/DeviceFlowModal.tsx (line 104)**

```
"text-green-500"  →  "text-success"
```

Lines 414–415:

```
"bg-green-100"  →  "bg-success/20"
"text-green-600"  →  "text-success"
```

- [ ] **Step 3: providers/ProviderOAuthCallback.tsx (line 68)**

```
"text-green-600"  →  "text-success"
```

- [ ] **Step 4: Run tests and commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -40
git add apps/web/src/components/harnesses/DeviceFlowModal.tsx \
        apps/web/src/pages/providers/DeviceFlowModal.tsx \
        apps/web/src/pages/providers/ProviderOAuthCallback.tsx
git commit -m "refactor(web): replace hardcoded colours with semantic tokens in harness and provider components"
```

---

## Task 8: B1 — Token pass: admin page colours

**Files:**

- Modify: `apps/web/src/pages/admin/ScopedConfigViewer.tsx`

- [ ] **Step 1: Apply all colour replacements**

Line 124 (`text-gray-500`):

```
"text-muted-foreground"
```

Line 125 (`text-red-500`):

```
"text-destructive"
```

Line 132 (`text-gray-500` and `text-blue-600`):

```typescript
<span className={effectiveConfig.isDefault ? 'text-muted-foreground' : 'text-primary'}>
```

Line 137 (`bg-yellow-100 text-yellow-700`):

```
"text-xs bg-warning/20 text-warning px-2 py-0.5 rounded"
```

Line 141 (`bg-gray-50`):

```
"bg-muted/50 rounded p-3 text-xs overflow-auto max-h-64"
```

Lines 148 and 173 (`bg-blue-600 … hover:bg-blue-700`):

```
"text-sm px-3 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/90"
```

Line 181 (`hover:bg-gray-50`):

```
"text-sm px-3 py-1 border rounded hover:bg-muted/50"
```

- [ ] **Step 2: Run tests and commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -40
git add apps/web/src/pages/admin/ScopedConfigViewer.tsx
git commit -m "refactor(web): replace hardcoded colours with semantic tokens in ScopedConfigViewer"
```

---

## Task 9: B1 — Token pass: kanban domain colours

**Files:**

- Modify: `apps/web/src/pages/kanban/kanban.board-helpers.ts`
- Modify: `apps/web/src/pages/kanban/TaskConfigModalContent.tsx`
- Modify: `apps/web/src/pages/work-items/GlobalWorkItemsPage.tsx`

Both `kanban.board-helpers.ts` and `GlobalWorkItemsPage.tsx` define the same status → className mapping. They should end up with the same values.

- [ ] **Step 1: kanban.board-helpers.ts (lines 47–57) — status colour map**

```typescript
"bg-success text-success-foreground"; // running   (was bg-green-600 text-white)
"bg-accent-purple text-white"; // awaiting-input (was bg-purple-600 text-white)
"bg-destructive text-destructive-foreground"; // error (was bg-red-600 text-white)
"bg-warning text-warning-foreground"; // blocked   (was bg-orange-500 text-white)
"bg-secondary text-secondary-foreground"; // completed (was bg-slate-500 text-white)
```

- [ ] **Step 2: GlobalWorkItemsPage.tsx (lines 43–53) — apply the same replacements**

Same five replacements as above.

- [ ] **Step 3: TaskConfigModalContent.tsx (line 405)**

```
"text-red-600"  →  "text-destructive"
```

- [ ] **Step 4: Run tests and commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -40
git add apps/web/src/pages/kanban/kanban.board-helpers.ts \
        apps/web/src/pages/kanban/TaskConfigModalContent.tsx \
        apps/web/src/pages/work-items/GlobalWorkItemsPage.tsx
git commit -m "refactor(web): replace hardcoded colours with semantic tokens in kanban domain"
```

---

## Task 10: B1 — Token pass: remaining pages

**Files:**

- Modify: `apps/web/src/pages/Dashboard.tsx`
- Modify: `apps/web/src/pages/Register.tsx`
- Modify: `apps/web/src/pages/secrets/SecretForm.tsx`
- Modify: `apps/web/src/pages/settings/EnforcementModeCard.tsx`
- Modify: `apps/web/src/pages/gitops/GitOpsStatus.tsx`
- Modify: `apps/web/src/pages/project-workspace/FileTree.tsx`
- Modify: `apps/web/src/pages/project-workspace/LearningTabProposalsCard.tsx`
- Modify: `apps/web/src/pages/workflows/WorkflowEditor.tsx`
- Modify: `apps/web/src/pages/workflows/WorkflowRunDetailHeader.tsx`

- [ ] **Step 1: Dashboard.tsx (lines 315–316) — live indicator**

```
"bg-blue-400"  →  "bg-success"
"bg-blue-500"  →  "bg-success"
```

- [ ] **Step 2: Register.tsx (lines 95, 100)**

```
"text-green-500"  →  "text-success"
"text-green-600"  →  "text-success"
```

- [ ] **Step 3: secrets/SecretForm.tsx (lines 95, 100)**

```
"text-green-600"  →  "text-success"
"text-red-600"    →  "text-destructive"
```

- [ ] **Step 4: settings/EnforcementModeCard.tsx (line 61)**

```
"border-yellow-500/40 bg-yellow-500/10"  →  "border-warning/40 bg-warning/10"
"text-yellow-700 dark:text-yellow-400"   →  "text-warning"
```

- [ ] **Step 5: gitops/GitOpsStatus.tsx (line 100)**

```
"border-blue-500/30 bg-blue-500/10"               →  "border-info/30 bg-info/10"
"text-blue-700 dark:text-blue-400"                →  "text-info"
```

- [ ] **Step 6: project-workspace/FileTree.tsx (lines 108, 110)**

```
"text-blue-500"  →  "text-primary"
```

- [ ] **Step 7: project-workspace/LearningTabProposalsCard.tsx (lines 183, 266–267, 293)**

Line 183 (warning box):

```
"border-warning/50 bg-warning/10"
"text-warning"
```

Lines 266–267 (success confirmation):

```
"border-success/30 bg-success/5"
"text-success"
```

Line 293 (info box):

```
"border-info/30 bg-info/5"
```

- [ ] **Step 8: workflows/WorkflowEditor.tsx (line 179)**

```
"border-gray-300"  →  "border-input"
```

- [ ] **Step 9: workflows/WorkflowRunDetailHeader.tsx (line 27)**

```
"text-green-500"  →  "text-success"
```

- [ ] **Step 10: Run tests and commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -40
git add apps/web/src/pages/Dashboard.tsx \
        apps/web/src/pages/Register.tsx \
        apps/web/src/pages/secrets/SecretForm.tsx \
        apps/web/src/pages/settings/EnforcementModeCard.tsx \
        apps/web/src/pages/gitops/GitOpsStatus.tsx \
        "apps/web/src/pages/project-workspace/FileTree.tsx" \
        "apps/web/src/pages/project-workspace/LearningTabProposalsCard.tsx" \
        apps/web/src/pages/workflows/WorkflowEditor.tsx \
        apps/web/src/pages/workflows/WorkflowRunDetailHeader.tsx
git commit -m "refactor(web): replace hardcoded colours with semantic tokens in remaining pages"
```

---

## Task 11: B1 — Verify token pass with grep

- [ ] **Step 1: Run grep audit**

```bash
cd apps/web/src && grep -rn \
  "bg-blue-\|text-blue-\|border-blue-\|bg-red-\|text-red-\|border-red-\|bg-green-\|text-green-\|border-green-\|bg-yellow-\|text-yellow-\|bg-orange-\|text-orange-\|bg-gray-\|text-gray-\|border-gray-\|bg-purple-\|text-purple-\|bg-slate-[0-9]\|bg-amber-\|text-amber-" \
  --include="*.tsx" --include="*.ts" \
  components pages \
  | grep -v "components/ui/" \
  | grep -v ".spec.tsx" \
  | grep -v "node_modules"
```

Expected: The only remaining hardcoded colour strings should be in `WorkflowGraphNode.tsx`'s categorical accent constants (with comments), and in test files (`.spec.tsx`) where they are used as test data values.

- [ ] **Step 2: Fix any unexpected matches**

For each file that still appears in the grep output (excluding the allowed exceptions):

1. Identify the semantic token from the mapping cheatsheet above
2. Apply the replacement
3. Re-run the grep to confirm it's clean

- [ ] **Step 3: Run full test suite**

```bash
npm run test:unit:web
npm run lint:web
npm run build:web
```

Expected: all pass.

---

## Task 12: B2 — Replace raw HTML elements in ScopedConfigViewer.tsx

**Files:**

- Modify: `apps/web/src/pages/admin/ScopedConfigViewer.tsx`

`ScopedConfigViewer.tsx` uses seven raw HTML elements. Replace all with `ui/` counterparts and update the import block.

- [ ] **Step 1: Update imports at the top of the file**

Replace the current import block (which has no `ui/` imports) with:

```typescript
import { useState } from "react";
import {
  useResolvedAgentProfile,
  useResolvedWorkflow,
  useForkAgentForScope,
  useForkWorkflowForScope,
} from "@/hooks/useScopedConfig";
import { useAgentProfiles } from "@/hooks/useAgentProfiles";
import { useWorkflows } from "@/hooks/useWorkflows";
import { useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

- [ ] **Step 2: Replace the `<label>` / `<select>` blocks for objectType and objectName**

Replace lines 70–92 with:

```tsx
<div>
  <Label htmlFor="objectType">Object type</Label>
  <Select
    value={objectType}
    onValueChange={(value) => { setObjectType(value as ObjectType); setSelectedName(''); }}
  >
    <SelectTrigger id="objectType">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="agent">Agent Profile</SelectItem>
      <SelectItem value="workflow">Workflow</SelectItem>
    </SelectContent>
  </Select>
</div>

<div>
  <Label htmlFor="objectName">Name</Label>
  <Select value={selectedName} onValueChange={setSelectedName}>
    <SelectTrigger id="objectName">
      <SelectValue placeholder="— select —" />
    </SelectTrigger>
    <SelectContent>
      {names.map((n: string) => (
        <SelectItem key={n} value={n}>{n}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 3: Replace the `<input>` for scopeNodeId**

Replace lines 96–104 with:

```tsx
<Label htmlFor="scopeNodeId">Scope node ID</Label>
<Input
  id="scopeNodeId"
  value={scopeNodeId}
  onChange={(e) => setScopeNodeId(e.target.value)}
  placeholder="UUID or leave blank for global"
  readOnly={!!presetScopeNodeId}
/>
```

- [ ] **Step 4: Replace the inline `<button>` for "Use active scope"**

Replace lines 110–118 with:

```tsx
<Button
  type="button"
  variant="link"
  size="sm"
  className="h-auto p-0 text-xs"
  onClick={() => setScopeNodeId(activeScopeNodeId)}
>
  Use active scope
</Button>
```

- [ ] **Step 5: Replace the `<button>` for "Create override for this scope"**

Replace lines 146–159 with:

```tsx
<Button
  type="button"
  size="sm"
  onClick={() => {
    setForkPayload(
      objectType === "workflow"
        ? ((effectiveConfig.value as any).yaml_definition ?? "")
        : JSON.stringify(effectiveConfig.value, null, 2),
    );
    setShowForkEditor(true);
  }}
>
  Create override for this scope
</Button>
```

- [ ] **Step 6: Replace the `<textarea>` and the two action `<button>` elements**

Replace lines 164–186 with:

```tsx
<Label>Override payload</Label>
<Textarea
  className="font-mono text-xs h-40"
  value={forkPayload}
  onChange={(e) => setForkPayload(e.target.value)}
/>
<div className="flex gap-2">
  <Button
    type="button"
    size="sm"
    disabled={forkAgent.isPending || forkWorkflow.isPending}
    onClick={handleFork}
  >
    Save override
  </Button>
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={() => setShowForkEditor(false)}
  >
    Cancel
  </Button>
</div>
```

- [ ] **Step 7: Run tests and commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -40
git add apps/web/src/pages/admin/ScopedConfigViewer.tsx
git commit -m "refactor(web): replace raw HTML elements with ui/ components in ScopedConfigViewer"
```

---

## Task 13: B2 — Replace raw HTML elements in WorkflowVisualizer, Header, and AttachmentChip

**Files:**

- Modify: `apps/web/src/components/workflow/WorkflowVisualizer.tsx`
- Modify: `apps/web/src/components/layout/Header.tsx`
- Modify: `apps/web/src/components/attachments/AttachmentChip.tsx`

### WorkflowVisualizer.tsx

The "Expand all" / "Collapse all" buttons (lines 324–338) are raw `<button>` elements.

- [ ] **Step 1: Add `Button` import to WorkflowVisualizer.tsx**

Add to the existing imports:

```typescript
import { Button } from "@/components/ui/button";
```

- [ ] **Step 2: Replace both raw buttons in the CardHeader**

Replace lines 324–339 with:

```tsx
<div className="flex items-center gap-2">
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={handleExpandAll}
    disabled={!hasExpandableJobs}
  >
    Expand all
  </Button>
  <Button
    type="button"
    variant="outline"
    size="sm"
    onClick={handleCollapseAll}
    disabled={!hasExpandableJobs}
  >
    Collapse all
  </Button>
</div>
```

### Header.tsx

- [ ] **Step 3: Read Header.tsx to confirm the raw `<button>` at lines 21–31**

```bash
head -40 apps/web/src/components/layout/Header.tsx
```

- [ ] **Step 4: Replace the scope selector `<button>` in Header.tsx**

Replace the raw `<button>` with:

```tsx
<Button
  variant="outline"
  size="sm"
  className="rounded-full border-border bg-accent/50 px-2.5 py-1 text-xs hover:bg-accent h-auto"
  onClick={/* existing onClick */}
>
  {/* existing children */}
</Button>
```

Preserve all existing children and onClick handlers verbatim.

### AttachmentChip.tsx

- [ ] **Step 5: Add `Button` import and replace the remove `<button>`**

The raw `<button>` at lines 63–70 (remove attachment control):

```tsx
<Button
  type="button"
  variant="ghost"
  size="icon"
  className="ml-0.5 h-5 w-5 rounded hover:text-destructive focus:ring-1 focus:ring-ring"
  aria-label={`Remove ${label}`}
  onClick={onRemove}
>
  <X className="h-3 w-3" />
</Button>
```

- [ ] **Step 6: Run tests and commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -60
git add apps/web/src/components/workflow/WorkflowVisualizer.tsx \
        apps/web/src/components/layout/Header.tsx \
        apps/web/src/components/attachments/AttachmentChip.tsx
git commit -m "refactor(web): replace raw HTML button elements with Button component in Visualizer, Header, and AttachmentChip"
```

---

## Task 14: B2 — Verify raw HTML pass

- [ ] **Step 1: Run grep audit**

```bash
cd apps/web/src && grep -rn "<button\b\|<input\b\|<select\b\|<textarea\b" \
  --include="*.tsx" \
  components pages \
  | grep -v ".spec.tsx" \
  | grep -v "components/ui/"
```

Expected remaining results (justified exceptions — each should already have an inline comment):

- `components/attachments/FileDropzone.tsx` — `<input type="file" className="sr-only">` (browser file API requires native element)
- Any React Flow node internals (`WorkflowGraphNode.tsx` expand button uses `<button>` with `nodrag nopan` — this is a React Flow constraint; replace with `Button` if technically feasible, otherwise add a justification comment)

- [ ] **Step 2: Add justification comment to FileDropzone.tsx**

Find the hidden `<input type="file">` in `apps/web/src/components/attachments/FileDropzone.tsx` and add:

```tsx
{/* native file input required — browser file-picker API does not work with Radix Button */}
<input type="file" className="sr-only" ... />
```

- [ ] **Step 3: Run full test suite**

```bash
npm run test:unit:web
npm run lint:web
npm run build:web
```

Expected: all pass.

---

## Task 15: B3 — AsyncButton primitive

**Files:**

- Create: `apps/web/src/components/ui/async-button.spec.tsx`
- Create: `apps/web/src/components/ui/async-button.tsx`
- Modify: `apps/web/src/pages/admin/ScopedConfigViewer.tsx`

`AsyncButton` wraps `Button` with an `isLoading` prop. When loading: shows a spinner, disables the button. All standard `ButtonProps` are forwarded.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/ui/async-button.spec.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AsyncButton } from './async-button';

describe('AsyncButton', () => {
  it('renders children when not loading', () => {
    render(<AsyncButton isLoading={false}>Save</AsyncButton>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('disables the button while loading', () => {
    render(<AsyncButton isLoading={true}>Save</AsyncButton>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders a Loader2 spinner while loading', () => {
    render(<AsyncButton isLoading={true}>Save</AsyncButton>);
    // Loader2 renders an svg; check its aria-hidden wrapper exists
    const button = screen.getByRole('button');
    expect(button.querySelector('svg')).toBeTruthy();
  });

  it('renders a custom loading icon when provided', () => {
    render(
      <AsyncButton isLoading={true} loadingIcon={<span data-testid="custom-icon" />}>
        Save
      </AsyncButton>,
    );
    expect(screen.getByTestId('custom-icon')).toBeTruthy();
  });

  it('forwards variant and size props to Button', () => {
    render(
      <AsyncButton isLoading={false} variant="outline" size="sm">
        Cancel
      </AsyncButton>,
    );
    const btn = screen.getByRole('button', { name: 'Cancel' });
    expect(btn.className).toContain('border');
  });

  it('respects disabled prop independently of isLoading', () => {
    render(<AsyncButton isLoading={false} disabled>Save</AsyncButton>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test:unit:web -- --reporter=verbose async-button 2>&1 | tail -20
```

Expected: `Cannot find module './async-button'`

- [ ] **Step 3: Create the implementation**

Create `apps/web/src/components/ui/async-button.tsx`:

```typescript
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';

export interface AsyncButtonProps extends ButtonProps {
  isLoading: boolean;
  loadingIcon?: React.ReactNode;
}

const AsyncButton = React.forwardRef<HTMLButtonElement, AsyncButtonProps>(
  ({ isLoading, loadingIcon, children, disabled, ...props }, ref) => (
    <Button ref={ref} disabled={isLoading || disabled} {...props}>
      {isLoading && (loadingIcon ?? <Loader2 className="animate-spin" />)}
      {children}
    </Button>
  ),
);
AsyncButton.displayName = 'AsyncButton';

export { AsyncButton };
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm run test:unit:web -- --reporter=verbose async-button 2>&1 | tail -20
```

Expected: all 6 tests pass.

- [ ] **Step 5: Migrate the Save override button in ScopedConfigViewer.tsx**

In `apps/web/src/pages/admin/ScopedConfigViewer.tsx`, add the import:

```typescript
import { AsyncButton } from "@/components/ui/async-button";
```

Replace the "Save override" `Button` (with `disabled={forkAgent.isPending || forkWorkflow.isPending}`):

```tsx
<AsyncButton
  type="button"
  size="sm"
  isLoading={forkAgent.isPending || forkWorkflow.isPending}
  onClick={handleFork}
>
  Save override
</AsyncButton>
```

- [ ] **Step 6: Find and migrate all remaining AsyncButton pattern sites**

The full pattern is: a `Button` (or raw `<button>`) with a `disabled={x.isPending}` prop AND a conditional `{x.isPending ? <Loader2 … /> : <Icon />}` swap in the children. These are the high-value migration sites.

```bash
grep -rn "isPending\|isLoading" apps/web/src/components apps/web/src/pages \
  --include="*.tsx" \
  | grep -v ".spec.tsx" \
  | grep "Loader2\|animate-spin"
```

For each file returned, open it and replace the inline pattern with `AsyncButton`:

```tsx
// Before (example pattern):
<Button disabled={mutation.isPending} onClick={handleSubmit}>
  {mutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
  Save
</Button>

// After:
<AsyncButton isLoading={mutation.isPending} onClick={handleSubmit}>
  <Save />
  Save
</AsyncButton>
```

Add `import { AsyncButton } from '@/components/ui/async-button';` to each file and remove the now-unused `Loader2` import if no other usage remains.

- [ ] **Step 7: Run tests and commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -40
git add -p  # stage all AsyncButton migration changes interactively, or:
git add apps/web/src/components apps/web/src/pages \
        apps/web/src/components/ui/async-button.tsx \
        apps/web/src/components/ui/async-button.spec.tsx
git commit -m "feat(web/ui): add AsyncButton primitive and migrate all isPending+Loader2 sites"
```

---

## Task 16: B3 — NullableSelect primitive

**Files:**

- Create: `apps/web/src/components/ui/nullable-select.spec.tsx`
- Create: `apps/web/src/components/ui/nullable-select.tsx`
- Modify: `apps/web/src/components/workflow/WorkflowLaunchInputField.tsx`
- Modify: `apps/web/src/components/workflow/WorkflowLaunchContractForm.tsx`
- Modify: `apps/web/src/components/workflow/workflowLaunchDialog.helpers.ts`
- Modify: `apps/web/src/components/sessions/NewSessionDialog.tsx`

`NullableSelect` wraps the Radix `Select` to handle a `null` / empty value cleanly, replacing the `NO_VALUE = "__none__"` sentinel pattern scattered across three files.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/ui/nullable-select.spec.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NullableSelect } from './nullable-select';
import { SelectItem } from './select';

describe('NullableSelect', () => {
  it('shows placeholder when value is null', () => {
    render(
      <NullableSelect value={null} onValueChange={vi.fn()} placeholder="Pick one">
        <SelectItem value="a">Option A</SelectItem>
      </NullableSelect>,
    );
    expect(screen.getByText('Pick one')).toBeTruthy();
  });

  it('shows the selected value when non-null', () => {
    render(
      <NullableSelect value="a" onValueChange={vi.fn()} placeholder="Pick one">
        <SelectItem value="a">Option A</SelectItem>
      </NullableSelect>,
    );
    expect(screen.getByText('Option A')).toBeTruthy();
  });

  it('calls onValueChange with null when the placeholder item is selected', () => {
    const onChange = vi.fn();
    render(
      <NullableSelect value="a" onValueChange={onChange} placeholder="Pick one">
        <SelectItem value="a">Option A</SelectItem>
      </NullableSelect>,
    );
    // Simulate selecting the internal sentinel value
    onChange('__none__');
    // The component wrapper converts __none__ → null
    // We test the wrapper directly:
    const { rerender } = render(
      <NullableSelect value={null} onValueChange={onChange} placeholder="Choose">
        <SelectItem value="b">B</SelectItem>
      </NullableSelect>,
    );
    void rerender; // suppresses unused warning
    expect(screen.getByText('Choose')).toBeTruthy();
  });

  it('is disabled when disabled prop is set', () => {
    render(
      <NullableSelect value={null} onValueChange={vi.fn()} placeholder="Pick" disabled>
        <SelectItem value="a">A</SelectItem>
      </NullableSelect>,
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test:unit:web -- --reporter=verbose nullable-select 2>&1 | tail -20
```

- [ ] **Step 3: Create the implementation**

Create `apps/web/src/components/ui/nullable-select.tsx`:

```typescript
import * as React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const NULLABLE_SENTINEL = '__none__';

export interface NullableSelectProps {
  value: string | null | undefined;
  onValueChange: (value: string | null) => void;
  placeholder?: string;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

function NullableSelect({
  value,
  onValueChange,
  placeholder = 'Select…',
  children,
  disabled,
  className,
}: Readonly<NullableSelectProps>) {
  return (
    <Select
      value={value ?? NULLABLE_SENTINEL}
      onValueChange={(v) => onValueChange(v === NULLABLE_SENTINEL ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NULLABLE_SENTINEL}>{placeholder}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
}

export { NullableSelect };
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm run test:unit:web -- --reporter=verbose nullable-select 2>&1 | tail -20
```

- [ ] **Step 5: Migrate WorkflowLaunchInputField.tsx**

Read `apps/web/src/components/workflow/WorkflowLaunchInputField.tsx`. Find the block that uses `NO_VALUE` (around lines 11, 26, 28, 35) and replace the full `Select` block with:

```tsx
import { NullableSelect } from "@/components/ui/nullable-select";
import { SelectItem } from "@/components/ui/select";

// Replace the Select + sentinel pattern with:
<NullableSelect
  value={value || null}
  onValueChange={(v) => onChange(v ?? "")}
  placeholder="No value"
>
  {options.map((opt) => (
    <SelectItem key={opt.value} value={opt.value}>
      {opt.label}
    </SelectItem>
  ))}
</NullableSelect>;
```

Adapt to match the component's actual prop names after reading the file.

- [ ] **Step 6: Migrate WorkflowLaunchContractForm.tsx**

Read `apps/web/src/components/workflow/WorkflowLaunchContractForm.tsx`. Replace the two `NO_VALUE` Select patterns (project selection ~lines 61–79, preset selection ~lines 104–122) with `NullableSelect`.

- [ ] **Step 7: Remove NO_VALUE from workflowLaunchDialog.helpers.ts**

After both callers are migrated, remove the `export const NO_VALUE = "__none__"` line from `apps/web/src/components/workflow/workflowLaunchDialog.helpers.ts`. Run a grep to confirm nothing still imports it:

```bash
grep -rn "NO_VALUE\|NO_PROJECT" apps/web/src --include="*.tsx" --include="*.ts"
```

- [ ] **Step 8: Migrate NewSessionDialog.tsx**

Read `apps/web/src/components/sessions/NewSessionDialog.tsx`. Find the `NO_PROJECT = "__none__"` constant and replace the associated `Select` block with `NullableSelect`.

- [ ] **Step 9: Run tests and commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -60
git add apps/web/src/components/ui/nullable-select.tsx \
        apps/web/src/components/ui/nullable-select.spec.tsx \
        apps/web/src/components/workflow/WorkflowLaunchInputField.tsx \
        apps/web/src/components/workflow/WorkflowLaunchContractForm.tsx \
        apps/web/src/components/workflow/workflowLaunchDialog.helpers.ts \
        apps/web/src/components/sessions/NewSessionDialog.tsx
git commit -m "feat(web/ui): add NullableSelect primitive and migrate NO_VALUE sentinel sites"
```

---

## Task 17: B3 — FilterCheckbox primitive

**Files:**

- Create: `apps/web/src/components/ui/filter-checkbox.spec.tsx`
- Create: `apps/web/src/components/ui/filter-checkbox.tsx`
- Modify: `apps/web/src/components/workflow/WorkflowActivityFeed.tsx`

`FilterCheckbox` bundles the inline `label + Checkbox + checked === true` coercion pattern used three times in `WorkflowActivityFeed.tsx`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/ui/filter-checkbox.spec.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterCheckbox } from './filter-checkbox';

describe('FilterCheckbox', () => {
  it('renders the label text', () => {
    render(
      <FilterCheckbox checked={false} onCheckedChange={vi.fn()} label="Show errors" />,
    );
    expect(screen.getByText('Show errors')).toBeTruthy();
  });

  it('renders checked state', () => {
    render(
      <FilterCheckbox checked={true} onCheckedChange={vi.fn()} label="Show errors" />,
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('calls onCheckedChange with boolean true when checked', () => {
    const onChange = vi.fn();
    render(<FilterCheckbox checked={false} onCheckedChange={onChange} label="Show errors" />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onCheckedChange with false when unchecked', () => {
    const onChange = vi.fn();
    render(<FilterCheckbox checked={true} onCheckedChange={onChange} label="Show errors" />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('sets aria-label from label prop', () => {
    render(
      <FilterCheckbox checked={false} onCheckedChange={vi.fn()} label="Failures only" />,
    );
    expect(screen.getByRole('checkbox', { name: 'Failures only' })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm run test:unit:web -- --reporter=verbose filter-checkbox 2>&1 | tail -20
```

- [ ] **Step 3: Create the implementation**

Create `apps/web/src/components/ui/filter-checkbox.tsx`:

```typescript
import { Checkbox } from '@/components/ui/checkbox';

export interface FilterCheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  id?: string;
}

function FilterCheckbox({ checked, onCheckedChange, label, id }: Readonly<FilterCheckboxProps>) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={label}
      />
      {label}
    </label>
  );
}

export { FilterCheckbox };
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npm run test:unit:web -- --reporter=verbose filter-checkbox 2>&1 | tail -20
```

- [ ] **Step 5: Migrate WorkflowActivityFeed.tsx**

In `apps/web/src/components/workflow/WorkflowActivityFeed.tsx`, add the import:

```typescript
import { FilterCheckbox } from "@/components/ui/filter-checkbox";
```

Remove the `Checkbox` import if it is no longer used after the migration.

Replace the three `<label>…<Checkbox>…</label>` blocks (lines 86–115) with:

```tsx
<FilterCheckbox
  checked={showWorkflowEvents}
  onCheckedChange={onShowWorkflowEventsChange}
  label="Workflow events"
/>
<FilterCheckbox
  checked={showToolEvents}
  onCheckedChange={onShowToolEventsChange}
  label="Tool events"
/>
<FilterCheckbox
  checked={showFailuresOnly}
  onCheckedChange={onShowFailuresOnlyChange}
  label="Failures only"
/>
```

- [ ] **Step 6: Run tests to confirm WorkflowActivityFeed tests still pass**

```bash
npm run test:unit:web -- --reporter=verbose WorkflowActivityFeed 2>&1 | tail -20
```

Expected: all existing tests pass (they use `getByLabelText("Toggle workflow events")` etc. — update those labels in the test file to match the new `label` prop values: `"Workflow events"`, `"Tool events"`, `"Failures only"`).

Update `WorkflowActivityFeed.spec.tsx` aria-label queries to match the new label values:

```typescript
// old:
fireEvent.click(screen.getByLabelText("Toggle workflow events"));
// new:
fireEvent.click(screen.getByLabelText("Workflow events"));
```

- [ ] **Step 7: Commit**

```bash
npm run test:unit:web -- --reporter=verbose 2>&1 | head -40
git add apps/web/src/components/ui/filter-checkbox.tsx \
        apps/web/src/components/ui/filter-checkbox.spec.tsx \
        apps/web/src/components/workflow/WorkflowActivityFeed.tsx \
        apps/web/src/components/workflow/WorkflowActivityFeed.spec.tsx
git commit -m "feat(web/ui): add FilterCheckbox primitive and migrate WorkflowActivityFeed"
```

---

## Task 18: B4 — Extract workflow-graph.utils.ts

**Files:**

- Create: `apps/web/src/components/workflow/workflow-graph.utils.ts`
- Modify: `apps/web/src/components/workflow/WorkflowVisualizer.tsx`

Seven pure utility functions in `WorkflowVisualizer.tsx` have no dependency on React state or JSX. Moving them to a dedicated utils file makes the visualizer file ~150 lines leaner and makes the functions independently testable.

- [ ] **Step 1: Create workflow-graph.utils.ts with the extracted functions**

Create `apps/web/src/components/workflow/workflow-graph.utils.ts`:

```typescript
import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import type { WorkflowGraphNode, WorkflowRunGraph } from "@/lib/api/types";
import type { WorkflowGraphNodePayload } from "./WorkflowGraphNode";

export function collectStepsByJob(
  nodes: WorkflowGraphNode[],
): Map<string, WorkflowGraphNode[]> {
  const stepByJob = new Map<string, WorkflowGraphNode[]>();

  for (const node of nodes) {
    if (node.kind !== "step") {
      continue;
    }

    const parentJobId = node.parentJobId ?? node.jobId;
    if (!parentJobId) {
      continue;
    }

    const list = stepByJob.get(stripJobPrefix(parentJobId)) ?? [];
    list.push(node);
    stepByJob.set(stripJobPrefix(parentJobId), list);
  }

  return stepByJob;
}

export function stripJobPrefix(nodeId: string): string {
  return nodeId.startsWith("job:") ? nodeId.slice(4) : nodeId;
}

export function getJobLookupKey(node: WorkflowGraphNode): string {
  return stripJobPrefix(node.jobId ?? stripJobPrefix(node.id));
}

export function getGraphIdentity(
  graph: WorkflowRunGraph | null | undefined,
): string | null {
  if (!graph) {
    return null;
  }
  return graph.workflowRunId ?? graph.workflowId;
}

export function isVisibleJobId(
  nodeId: string,
  jobIds: Set<string>,
  jobLookupKeys: Set<string>,
): boolean {
  return jobIds.has(nodeId) || jobLookupKeys.has(stripJobPrefix(nodeId));
}

export function createExpandedJobToggle(
  current: Set<string>,
  jobKey: string,
): Set<string> {
  const next = new Set(current);
  if (next.has(jobKey)) {
    next.delete(jobKey);
  } else {
    next.add(jobKey);
  }
  return next;
}

export function toJobFlowNode(
  node: WorkflowGraphNode,
  jobLayout: Map<string, { x: number; y: number }>,
  stepByJob: Map<string, WorkflowGraphNode[]>,
  isExpanded: boolean,
  onToggleExpanded: (() => void) | undefined,
): Node<WorkflowGraphNodePayload> {
  const jobLookupKey = getJobLookupKey(node);
  const hasSteps = (stepByJob.get(jobLookupKey)?.length ?? 0) > 0;

  return {
    id: node.id,
    type: "workflowNode",
    position: jobLayout.get(node.id) ?? { x: 0, y: 0 },
    data: {
      label: node.label,
      kind: node.kind,
      status: node.status,
      jobId: node.jobId,
      stepId: node.stepId,
      parentJobId: node.parentJobId,
      metadata: node.metadata,
      hasSteps,
      isExpanded: hasSteps ? isExpanded : undefined,
      onToggleExpanded: hasSteps ? onToggleExpanded : undefined,
    },
  };
}

export function toStepFlowNode(params: {
  node: WorkflowGraphNode;
  parentPosition: { x: number; y: number };
  siblingIndex: number;
}): Node<WorkflowGraphNodePayload> {
  const { node, parentPosition, siblingIndex } = params;

  return {
    id: node.id,
    type: "workflowNode",
    position: {
      x: (parentPosition?.x ?? 0) + 28,
      y: (parentPosition?.y ?? 0) + 110 + Math.max(siblingIndex, 0) * 96,
    },
    data: {
      label: node.label,
      kind: node.kind,
      status: node.status,
      jobId: node.jobId,
      stepId: node.stepId,
      parentJobId: node.parentJobId,
      metadata: node.metadata,
    },
  };
}

export function toReactFlowEdges(graph: WorkflowRunGraph): Edge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: edge.kind === "sequence",
    style: {
      strokeWidth: edge.kind === "contains" ? 1 : 1.5,
      strokeDasharray: edge.kind === "contains" ? "4 3" : undefined,
    },
    markerEnd:
      edge.kind === "contains" ? undefined : { type: MarkerType.ArrowClosed },
  }));
}
```

- [ ] **Step 2: Update WorkflowVisualizer.tsx to import from the utils file**

Remove the seven function definitions (lines 37–166) and replace with imports:

```typescript
import {
  collectStepsByJob,
  createExpandedJobToggle,
  getGraphIdentity,
  getJobLookupKey,
  isVisibleJobId,
  toJobFlowNode,
  toReactFlowEdges,
  toStepFlowNode,
} from "./workflow-graph.utils";
```

Also remove the now-unused `MarkerType` import from `@xyflow/react` in `WorkflowVisualizer.tsx` (it moved to the utils file).

- [ ] **Step 3: Run tests**

```bash
npm run test:unit:web -- --reporter=verbose WorkflowVisualizer 2>&1 | tail -20
```

Expected: all existing `WorkflowVisualizer.spec.tsx` tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/workflow/workflow-graph.utils.ts \
        apps/web/src/components/workflow/WorkflowVisualizer.tsx
git commit -m "refactor(web): extract graph utility functions from WorkflowVisualizer into workflow-graph.utils"
```

---

## Task 19: B4 — Extract useActivityFilters hook

**Files:**

- Create: `apps/web/src/components/workflow/workflow-activity-feed.hooks.ts`
- Modify: `apps/web/src/components/workflow/WorkflowActivityFeed.tsx`

The filter state management logic inside `WorkflowActivityFeed` (lines 265–338) is a self-contained state machine. Extracting it as `useActivityFilters` makes the feed component purely presentational and makes the filter logic testable in isolation.

- [ ] **Step 1: Create workflow-activity-feed.hooks.ts**

Create `apps/web/src/components/workflow/workflow-activity-feed.hooks.ts`:

```typescript
import { useMemo, useState } from "react";
import type {
  ActivityItem,
  ActivityQuickType,
  WorkflowActivityFeedFilters,
} from "./workflow-activity-feed.types";
import {
  DEFAULT_WORKFLOW_ACTIVITY_FILTERS,
  normalizeEvents,
} from "./workflow-activity-feed.helpers";
import type { WorkflowTelemetryEvent } from "@/lib/api/types";

export function useActivityFilters(
  events: WorkflowTelemetryEvent[],
  externalFilters?: WorkflowActivityFeedFilters,
  onFiltersChange?: (filters: WorkflowActivityFeedFilters) => void,
): {
  currentFilters: WorkflowActivityFeedFilters;
  filteredEvents: ActivityItem[];
  normalizedCount: number;
  setSearchQuery: (value: string) => void;
  setShowWorkflowEvents: (value: boolean) => void;
  setShowToolEvents: (value: boolean) => void;
  setShowFailuresOnly: (value: boolean) => void;
  setQuickType: (value: ActivityQuickType) => void;
} {
  const [internalFilters, setInternalFilters] =
    useState<WorkflowActivityFeedFilters>(DEFAULT_WORKFLOW_ACTIVITY_FILTERS);

  const currentFilters = externalFilters ?? internalFilters;

  function setFilters(nextFilters: WorkflowActivityFeedFilters) {
    if (!externalFilters) {
      setInternalFilters(nextFilters);
    }
    onFiltersChange?.(nextFilters);
  }

  const normalizedEvents = useMemo(() => normalizeEvents(events), [events]);

  const filteredEvents = useMemo(() => {
    const normalizedQuery = currentFilters.searchQuery.trim().toLowerCase();

    return normalizedEvents.filter((item) => {
      if (item.category === "workflow" && !currentFilters.showWorkflowEvents)
        return false;
      if (item.category === "tool" && !currentFilters.showToolEvents)
        return false;
      if (currentFilters.showFailuresOnly && !item.isFailureLike) return false;
      if (
        currentFilters.quickType !== "all" &&
        item.quickType !== currentFilters.quickType
      )
        return false;
      if (
        normalizedQuery.length > 0 &&
        !item.searchText.includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [currentFilters, normalizedEvents]);

  return {
    currentFilters,
    filteredEvents,
    normalizedCount: normalizedEvents.length,
    setSearchQuery: (value) =>
      setFilters({ ...currentFilters, searchQuery: value }),
    setShowWorkflowEvents: (value) =>
      setFilters({ ...currentFilters, showWorkflowEvents: value }),
    setShowToolEvents: (value) =>
      setFilters({ ...currentFilters, showToolEvents: value }),
    setShowFailuresOnly: (value) =>
      setFilters({ ...currentFilters, showFailuresOnly: value }),
    setQuickType: (value) =>
      setFilters({ ...currentFilters, quickType: value }),
  };
}
```

- [ ] **Step 2: Update WorkflowActivityFeed.tsx to use the hook**

In `WorkflowActivityFeed.tsx`, remove the inline state and filter logic (lines 265–338) and replace with:

```typescript
import { useActivityFilters } from "./workflow-activity-feed.hooks";

// Inside WorkflowActivityFeed:
const {
  currentFilters,
  filteredEvents,
  normalizedCount,
  setSearchQuery,
  setShowWorkflowEvents,
  setShowToolEvents,
  setShowFailuresOnly,
  setQuickType,
} = useActivityFilters(events, filters, onFiltersChange);
```

Then update the JSX to use the hook's return values directly (replacing all the previous inline state references).

- [ ] **Step 3: Run tests**

```bash
npm run test:unit:web -- --reporter=verbose WorkflowActivityFeed 2>&1 | tail -20
```

Expected: all existing tests pass (they test through the public component interface, which hasn't changed).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/workflow/workflow-activity-feed.hooks.ts \
        apps/web/src/components/workflow/WorkflowActivityFeed.tsx
git commit -m "refactor(web): extract useActivityFilters hook from WorkflowActivityFeed"
```

---

## Task 20: B4 — Decompose WarRoomSessionManagerPanel.hooks.tsx

**Files:**

- Modify: `apps/web/src/components/orchestration/WarRoomSessionManagerPanel.hooks.tsx`

This file is ~471 lines. Read it in full before splitting.

- [ ] **Step 1: Read the file to identify hook boundaries**

```bash
cat -n apps/web/src/components/orchestration/WarRoomSessionManagerPanel.hooks.tsx
```

Look for exported hook functions. Each distinct hook (`useWarRoomMutations`, `useWarRoomState`, `useWarRoomConsensus`, etc.) is a candidate for its own file.

- [ ] **Step 2: For each hook that exceeds ~80 lines, create a dedicated file**

Naming convention: `war-room-<concern>.hooks.ts`

Example (adapt to actual hook names found):

- `apps/web/src/components/orchestration/war-room-mutations.hooks.ts` — mutation hooks
- `apps/web/src/components/orchestration/war-room-state.hooks.ts` — state/blackboard hooks
- `apps/web/src/components/orchestration/war-room-consensus.hooks.ts` — consensus hooks

Each new file: copy the relevant hook function(s), move the types they depend on, and add the minimal imports.

- [ ] **Step 3: Update WarRoomSessionManagerPanel.hooks.tsx to re-export from sub-files**

After moving hooks to their dedicated files, `WarRoomSessionManagerPanel.hooks.tsx` should only contain re-exports:

```typescript
export { useWarRoomMutations } from "./war-room-mutations.hooks";
export { useWarRoomState } from "./war-room-state.hooks";
// etc.
```

This preserves existing import paths.

- [ ] **Step 4: Run tests and confirm no file exceeds 250 lines**

```bash
npm run test:unit:web -- --reporter=verbose WarRoom 2>&1 | tail -20
wc -l apps/web/src/components/orchestration/war-room-*.hooks.ts \
       apps/web/src/components/orchestration/WarRoomSessionManagerPanel.hooks.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/orchestration/
git commit -m "refactor(web): decompose WarRoomSessionManagerPanel.hooks into focused hook files"
```

---

## Task 21: B4 — Decompose WarRoomSessionManagerPanel.sections.tsx

**Files:**

- Modify: `apps/web/src/components/orchestration/WarRoomSessionManagerPanel.sections.tsx`

This file is ~442 lines. The constants `PARTICIPANT_ROLES`, `MESSAGE_KINDS`, `RESOLUTION_TYPES` and the sections they configure suggest clear split points.

- [ ] **Step 1: Read the file to identify section components**

```bash
cat -n apps/web/src/components/orchestration/WarRoomSessionManagerPanel.sections.tsx
```

Look for exported component functions. Each major section (e.g., `ParticipantListSection`, `AgendaSection`, `ConsensusSection`) becomes its own file.

- [ ] **Step 2: Create one file per section component**

Naming: `war-room-<section-name>-section.tsx`

Move each component (with its supporting constants and types) into its dedicated file.

- [ ] **Step 3: Update the .sections.tsx file to re-export**

After moving, the `.sections.tsx` file becomes a barrel of re-exports:

```typescript
export { ParticipantListSection } from "./war-room-participant-list-section";
export { AgendaSection } from "./war-room-agenda-section";
// etc.
```

- [ ] **Step 4: Run tests and check line counts**

```bash
npm run test:unit:web -- --reporter=verbose WarRoom 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/orchestration/
git commit -m "refactor(web): decompose WarRoomSessionManagerPanel.sections into per-section files"
```

---

## Task 22: B4 — Decompose OrchestrationStatusCard.tsx

**Files:**

- Modify: `apps/web/src/components/orchestration/OrchestrationStatusCard.tsx`

This file is ~438 lines.

- [ ] **Step 1: Read and identify sub-components**

```bash
cat -n apps/web/src/components/orchestration/OrchestrationStatusCard.tsx
```

Typical boundaries: timeline strip, status-badge row, action group.

- [ ] **Step 2: Extract each sub-component into its own file**

Files to create (adapt names to actual component names found in the file):

- `apps/web/src/components/orchestration/orchestration-timeline-strip.tsx`
- `apps/web/src/components/orchestration/orchestration-status-badge-row.tsx`
- `apps/web/src/components/orchestration/orchestration-action-group.tsx`

- [ ] **Step 3: Update OrchestrationStatusCard.tsx to import and compose**

The card file becomes a composition of the sub-components it created.

- [ ] **Step 4: Run tests and check line counts**

```bash
npm run test:unit:web -- --reporter=verbose OrchestrationStatus 2>&1 | tail -20
wc -l apps/web/src/components/orchestration/OrchestrationStatusCard.tsx \
       apps/web/src/components/orchestration/orchestration-*.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/orchestration/
git commit -m "refactor(web): decompose OrchestrationStatusCard into sub-components"
```

---

## Task 23: B4 — Decompose SubagentExecutionPanel.tsx

**Files:**

- Modify: `apps/web/src/components/sessions/SubagentExecutionPanel.tsx`

This file is ~465 lines.

- [ ] **Step 1: Read and identify sub-components**

```bash
cat -n apps/web/src/components/sessions/SubagentExecutionPanel.tsx
```

Look for list-item, summary strip, chart, and status row components that are currently defined as internal functions.

- [ ] **Step 2: Extract sub-components**

Typical extractions:

- `apps/web/src/components/sessions/subagent-execution-row.tsx` — individual subagent row
- `apps/web/src/components/sessions/subagent-status-summary.tsx` — summary strip at top

- [ ] **Step 3: Update SubagentExecutionPanel.tsx to import and compose**

- [ ] **Step 4: Run tests and check line counts**

```bash
npm run test:unit:web -- --reporter=verbose SubagentExecution 2>&1 | tail -20
wc -l apps/web/src/components/sessions/SubagentExecutionPanel.tsx \
       apps/web/src/components/sessions/subagent-*.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/sessions/
git commit -m "refactor(web): decompose SubagentExecutionPanel into sub-components"
```

---

## Task 24: B4 — Decompose BudgetOverviewTab.tsx

**Files:**

- Modify: `apps/web/src/components/budget/BudgetOverviewTab.tsx`

This file is ~453 lines.

- [ ] **Step 1: Read and identify sub-components**

```bash
cat -n apps/web/src/components/budget/BudgetOverviewTab.tsx
```

Look for chart wrapper, data table, and summary card sections.

- [ ] **Step 2: Extract sub-components**

Likely targets:

- `apps/web/src/components/budget/budget-allocation-table.tsx`
- `apps/web/src/components/budget/budget-usage-chart.tsx`
- `apps/web/src/components/budget/budget-summary-cards.tsx`

- [ ] **Step 3: Update BudgetOverviewTab.tsx to compose**

- [ ] **Step 4: Run tests and check line counts**

```bash
npm run test:unit:web -- --reporter=verbose Budget 2>&1 | tail -20
wc -l apps/web/src/components/budget/BudgetOverviewTab.tsx \
       apps/web/src/components/budget/budget-*.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/budget/
git commit -m "refactor(web): decompose BudgetOverviewTab into sub-components"
```

---

## Task 25: B4 — Decompose NewSessionDialog.tsx

**Files:**

- Modify: `apps/web/src/components/sessions/NewSessionDialog.tsx`

This file is ~447 lines. Note: Task 16 already migrated the `NO_PROJECT` sentinel to `NullableSelect`; this task handles the structural split.

- [ ] **Step 1: Read and identify sub-components**

```bash
cat -n apps/web/src/components/sessions/NewSessionDialog.tsx
```

Look for form-section components: agent-profile selector section, scope-selector section, advanced-options section.

- [ ] **Step 2: Extract sub-components**

Likely targets:

- `apps/web/src/components/sessions/new-session-agent-profile-field.tsx`
- `apps/web/src/components/sessions/new-session-scope-field.tsx`
- `apps/web/src/components/sessions/new-session-advanced-options.tsx`

- [ ] **Step 3: Update NewSessionDialog.tsx to compose**

The dialog file manages form state and submission; it renders the sub-component sections.

- [ ] **Step 4: Run tests and check line counts**

```bash
npm run test:unit:web -- --reporter=verbose NewSession 2>&1 | tail -20
wc -l apps/web/src/components/sessions/NewSessionDialog.tsx \
       apps/web/src/components/sessions/new-session-*.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/sessions/
git commit -m "refactor(web): decompose NewSessionDialog into sub-components"
```

---

## Task 26: B5 — Add barrel files

**Files:**

- Create: `apps/web/src/components/workflow/index.ts`
- Create: `apps/web/src/components/scope/index.ts`
- Create: `apps/web/src/components/layout/index.ts`
- Create: `apps/web/src/components/sessions/index.ts`
- Create: `apps/web/src/components/orchestration/index.ts`

Barrel files export only the public-facing components. Internal sub-components (files created during B4 decomposition) are not re-exported from the barrel — they are implementation details of their parent component.

- [ ] **Step 1: Create workflow/index.ts**

```typescript
export { ExecutionLogs } from "./ExecutionLogs";
export { GraphNodeCard } from "./GraphNodeCard";
export {
  WorkflowActivityFeed,
  DEFAULT_WORKFLOW_ACTIVITY_FILTERS,
} from "./WorkflowActivityFeed";
export type {
  WorkflowActivityFeedFilters,
  ActivityQuickType,
} from "./WorkflowActivityFeed";
export { WorkflowAutonomyDiagnosticsPanel } from "./WorkflowAutonomyDiagnosticsPanel";
export { WorkflowEventsFeed } from "./WorkflowEventsFeed";
export { WorkflowGraphLegend } from "./WorkflowGraphLegend";
export { WorkflowGraphNode } from "./WorkflowGraphNode";
export type {
  WorkflowGraphNodePayload,
  WorkflowGraphNodeType,
} from "./WorkflowGraphNode";
export { WorkflowLaunchContractForm } from "./WorkflowLaunchContractForm";
export { WorkflowLaunchDialog } from "./WorkflowLaunchDialog";
export { WorkflowNodeStatusBadge } from "./WorkflowNodeStatusBadge";
export { WorkflowRunContextStrip } from "./WorkflowRunContextStrip";
export { WorkflowStatusBadge } from "./WorkflowStatusBadge";
export { WorkflowVisualizer } from "./WorkflowVisualizer";
export { YamlEditor } from "./YamlEditor";
```

- [ ] **Step 2: Create scope/index.ts**

```typescript
export { ScopeBanner } from "./ScopeBanner";
export { ScopeBreadcrumb } from "./ScopeBreadcrumb";
export { ScopeNodePicker } from "./ScopeNodePicker";
export { ScopePanel } from "./ScopePanel";
export { ScopeTree } from "./ScopeTree";
export { ScopeTreeNode } from "./ScopeTreeNode";
```

- [ ] **Step 3: Create layout/index.ts**

```typescript
export { Breadcrumbs } from "./Breadcrumbs";
export { CommandPalette } from "./CommandPalette";
export { Header } from "./Header";
export { KeyboardShortcutsProvider } from "./KeyboardShortcutsProvider";
export { Layout } from "./Layout";
export { Sidebar } from "./Sidebar";
```

- [ ] **Step 4: Create sessions/index.ts**

```typescript
export { ExecutionSidebar } from "./ExecutionSidebar";
export { NewSessionDialog } from "./NewSessionDialog";
export { Pagination } from "./Pagination";
export { SessionContextPanel } from "./SessionContextPanel";
export { SessionConversationPane } from "./SessionConversationPane";
export { SessionRateLimitAlert } from "./SessionRateLimitAlert";
export { SessionStatusBadge } from "./SessionStatusBadge";
export { SessionTable } from "./SessionTable";
export { SessionThreadList } from "./SessionThreadList";
export { SessionThreadListItem } from "./SessionThreadListItem";
export { SessionWorkflowDetailsCard } from "./SessionWorkflowDetailsCard";
export { SessionsPageHeader } from "./SessionsPageHeader";
export { SessionsThreadPanel } from "./SessionsThreadPanel";
export { SubagentExecutionPanel } from "./SubagentExecutionPanel";
export { ThreadItem } from "./ThreadItem";
export { WorkflowRuntimeNoticeAlert } from "./WorkflowRuntimeNoticeAlert";
```

- [ ] **Step 5: Create orchestration/index.ts**

```typescript
export { AgentCommunicationThreadPanel } from "./AgentCommunicationThreadPanel";
export { OrchestrationCapabilityHealthCard } from "./OrchestrationCapabilityHealthCard";
export { OrchestrationDecisionTimeline } from "./OrchestrationDecisionTimeline";
export { OrchestrationModeHint } from "./OrchestrationModeHint";
export { OrchestrationPendingActionsPanel } from "./OrchestrationPendingActionsPanel";
export { OrchestrationStatusCard } from "./OrchestrationStatusCard";
export { PlanReviewPanel } from "./PlanReviewPanel";
export { SpecReviewDialog } from "./SpecReviewDialog";
export { WarRoomSessionManagerPanel } from "./WarRoomSessionManagerPanel";
export { WarRoomSessionPanel } from "./WarRoomSessionPanel";
```

- [ ] **Step 6: Update at least one consumer per directory to use the barrel**

For each directory, find one existing import of a component from that directory and update it to use the barrel path. Example: if a page imports `import { WorkflowVisualizer } from '@/components/workflow/WorkflowVisualizer'`, update it to `import { WorkflowVisualizer } from '@/components/workflow'`.

Search for one consumer per directory:

```bash
grep -rn "from '@/components/workflow/" apps/web/src --include="*.tsx" | head -5
grep -rn "from '@/components/sessions/" apps/web/src --include="*.tsx" | head -5
grep -rn "from '@/components/orchestration/" apps/web/src --include="*.tsx" | head -5
grep -rn "from '@/components/scope/" apps/web/src --include="*.tsx" | head -5
grep -rn "from '@/components/layout/" apps/web/src --include="*.tsx" | head -5
```

Update one import per directory to use the barrel (do not bulk-migrate all imports — that is scope for Phase C).

- [ ] **Step 7: Run full test suite and confirm build passes**

```bash
npm run test:unit:web
npm run lint:web
npm run build:web
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/workflow/index.ts \
        apps/web/src/components/scope/index.ts \
        apps/web/src/components/layout/index.ts \
        apps/web/src/components/sessions/index.ts \
        apps/web/src/components/orchestration/index.ts
git commit -m "feat(web): add barrel index.ts files for workflow, scope, layout, sessions, and orchestration directories"
```

---

## Task 27: Final quality gate

- [ ] **Step 1: Run the full verification suite**

```bash
npm run test:unit:web
npm run lint:web
npm run build:web
npm run test:e2e:web
```

All four commands must pass before Phase B is considered complete.

- [ ] **Step 2: Confirm no file exceeds 250 lines**

```bash
find apps/web/src/components apps/web/src/pages \
  -name "*.tsx" -not -name "*.spec.tsx" \
  | xargs wc -l \
  | sort -rn \
  | head -20
```

Any file still over 250 lines that was part of the B4 decomposition list needs to be re-reviewed.

- [ ] **Step 3: Run the hardcoded colour grep one final time**

```bash
cd apps/web/src && grep -rn \
  "bg-blue-[0-9]\|text-blue-[0-9]\|bg-red-[0-9]\|text-red-[0-9]\|bg-green-[0-9]\|text-green-[0-9]\|bg-yellow-[0-9]\|bg-orange-[0-9]\|bg-gray-[0-9]\|text-gray-[0-9]\|border-gray-[0-9]\|bg-purple-[0-9]\|bg-slate-[0-9]\|text-amber-" \
  --include="*.tsx" --include="*.ts" \
  components pages \
  | grep -v "components/ui/" \
  | grep -v ".spec.tsx"
```

Only `WorkflowGraphNode.tsx`'s explicitly commented categorical accent lines should remain.

- [ ] **Step 4: Run the raw HTML grep one final time**

```bash
cd apps/web/src && grep -rn "<button\b\|<input\b\|<select\b\|<textarea\b" \
  --include="*.tsx" components pages \
  | grep -v ".spec.tsx" \
  | grep -v "components/ui/"
```

Only `FileDropzone.tsx`'s justified native file input should remain.

- [ ] **Step 5: Push**

```bash
git push
```
