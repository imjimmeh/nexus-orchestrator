# P2: Shared Utilities Consolidation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate 7 duplicate `normalizeOptionalString` copies, 5 duplicate `isTerminalWorkflowRunStatus` copies, 11 inline `sleep` expressions, 5 independent exponential-backoff implementations, and 3 duplicate `getErrorMessage` functions — replacing all with single canonical exports.

**Architecture:** New utility functions go in two locations: (1) `packages/core` for functions needed across app boundaries (normalizeOptionalString, getErrorMessage, isTerminalWorkflowRunStatus), and (2) `apps/api/src/common/utils/async.utils.ts` for API-internal async utilities (sleep, computeExponentialBackoffMs). Each task: add function → test it → delete all duplicates → import from canonical location → test again.

**Tech Stack:** TypeScript, Vitest, `@nexus/core` package

---

## Files

| Action | File |
|---|---|
| Create | `packages/core/src/common/string.utils.ts` |
| Create | `packages/core/src/common/error.utils.ts` |
| Create | `packages/core/src/common/index.ts` |
| Modify | `packages/core/src/index.ts` |
| Modify | `packages/core/src/interfaces/workflow-legacy.types.ts` (move `isTerminalWorkflowRunStatus` here) |
| Create | `apps/api/src/common/utils/async.utils.ts` |
| Create | `packages/core/src/common/string.utils.spec.ts` |
| Create | `packages/core/src/common/error.utils.spec.ts` |
| Create | `apps/api/src/common/utils/async.utils.spec.ts` |
| Modify | 7 files using `normalizeOptionalString` (delete local copy, import from `@nexus/core`) |
| Modify | 5 files using `isTerminalWorkflowRunStatus` (delete local copy, import from `@nexus/core`) |
| Modify | 11 files using inline `sleep` (replace with import from `../common/utils/async.utils`) |
| Modify | 5 files using inline backoff (replace with import from `../common/utils/async.utils`) |
| Modify | 3 files using local `getErrorMessage` (delete local copy, import from `@nexus/core`) |

---

## Task 1: `normalizeOptionalString` in `packages/core`

**Files:**
- Create: `packages/core/src/common/string.utils.ts`
- Create: `packages/core/src/common/string.utils.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/core/src/common/string.utils.spec.ts
import { describe, it, expect } from 'vitest';
import { normalizeOptionalString } from './string.utils';

describe('normalizeOptionalString', () => {
  it('returns null for non-string values', () => {
    expect(normalizeOptionalString(null)).toBeNull();
    expect(normalizeOptionalString(undefined)).toBeNull();
    expect(normalizeOptionalString(42)).toBeNull();
    expect(normalizeOptionalString({})).toBeNull();
  });

  it('returns null for empty or whitespace-only strings', () => {
    expect(normalizeOptionalString('')).toBeNull();
    expect(normalizeOptionalString('   ')).toBeNull();
    expect(normalizeOptionalString('\t\n')).toBeNull();
  });

  it('returns trimmed string for non-empty strings', () => {
    expect(normalizeOptionalString('hello')).toBe('hello');
    expect(normalizeOptionalString('  hello  ')).toBe('hello');
    expect(normalizeOptionalString('  a  ')).toBe('a');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run packages/core/src/common/string.utils.spec.ts
```

Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement the function**

```typescript
// packages/core/src/common/string.utils.ts

/**
 * Trims a value and returns it if it is a non-empty string, otherwise null.
 * Safe to call with any value — non-strings always return null.
 */
export function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run packages/core/src/common/string.utils.spec.ts
```

Expected: All tests pass.

- [ ] **Step 5: Export from packages/core**

Create `packages/core/src/common/index.ts`:
```typescript
export * from './string.utils';
export * from './error.utils'; // will add in Task 2
```

Add to `packages/core/src/index.ts`:
```typescript
export * from './common';
```

- [ ] **Step 6: Delete the 7 duplicate definitions and import the canonical one**

For each file below, remove the private/local `normalizeOptionalString` function body and add the import:

```typescript
import { normalizeOptionalString } from '@nexus/core';
```

Files to update:
1. `apps/api/src/shared/agent-scope.utils.ts:41` — delete the local function, add import
2. `apps/api/src/workflow/workflow-internal-core-runs.service.ts:283` — delete private method, import at top
3. `apps/api/src/workflow/workflow-launch/workflow-launch-contract.service.ts:319` — delete private method, import at top
4. `apps/api/src/workflow/workflow-launch/workflow-launch-orchestration.helpers.ts:10` — delete exported function (it's already exported here; replace with re-export from `@nexus/core` or just delete if only imported via this file)
5. `apps/api/src/workflow/workflow-run-operations/workflow-run-todo.helpers.ts:35` — delete exported function, import from `@nexus/core`
6. `apps/api/src/workflow/workflow-runtime/workflow-runtime-orchestration-actions.service.ts:320` — delete private method, import at top
7. `apps/kanban/src/project/project-agents-file.service.ts:102` — delete private method, import from `@nexus/core`

For files that exported the function and are used by other files (items 4 and 5), check their importers first:
```bash
grep -rn "from.*workflow-launch-orchestration.helpers\|from.*workflow-run-todo.helpers" apps/api/src --include="*.ts" | grep normalizeOptionalString
```
If any importer uses the local export, update those importers to use `@nexus/core` directly.

- [ ] **Step 7: Run the API and kanban test suites**

```bash
npx vitest run apps/api/src/workflow/
npx vitest run apps/kanban/src/project/
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/common/ packages/core/src/index.ts \
        apps/api/src/shared/agent-scope.utils.ts \
        apps/api/src/workflow/ \
        apps/kanban/src/project/project-agents-file.service.ts
git commit -m "refactor: consolidate normalizeOptionalString into packages/core"
```

---

## Task 2: `getErrorMessage` in `packages/core`

**Files:**
- Create: `packages/core/src/common/error.utils.ts`
- Create: `packages/core/src/common/error.utils.spec.ts`

- [ ] **Step 1: Write the test**

```typescript
// packages/core/src/common/error.utils.spec.ts
import { describe, it, expect } from 'vitest';
import { getErrorMessage } from './error.utils';

describe('getErrorMessage', () => {
  it('returns the message for an Error object', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns the string itself for string errors', () => {
    expect(getErrorMessage('something went wrong')).toBe('something went wrong');
  });

  it('returns JSON for plain objects', () => {
    const result = getErrorMessage({ code: 42 });
    expect(result).toContain('42');
  });

  it('returns a fallback string for null/undefined', () => {
    expect(getErrorMessage(null)).toBe('Unknown error');
    expect(getErrorMessage(undefined)).toBe('Unknown error');
  });

  it('never throws', () => {
    expect(() => getErrorMessage(Symbol('x'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run packages/core/src/common/error.utils.spec.ts
```

Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement**

```typescript
// packages/core/src/common/error.utils.ts

/**
 * Safely extracts a human-readable message from any thrown value.
 * Never throws. Works with Error objects, strings, plain objects, or anything else.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run packages/core/src/common/error.utils.spec.ts
```

Expected: All tests pass.

- [ ] **Step 5: Add to common/index.ts** (already created in Task 1 — uncomment the line)

```typescript
// packages/core/src/common/index.ts
export * from './string.utils';
export * from './error.utils';
```

- [ ] **Step 6: Replace the 3 private `getErrorMessage` definitions**

Files to update:
1. `apps/api/src/workflow/workflow-special-steps/special-step-policy.helpers.ts:60` — delete local function, add `import { getErrorMessage } from '@nexus/core';`
2. `apps/api/src/tool/tools/hydrate-discovery-work-items.tool.ts:180` — delete local function, add import
3. `apps/web/src/pages/kanban/WarRoomSessionManagerPanel.hooks.tsx:47` — delete local function, add `import { getErrorMessage } from '@nexus/core';`

Also globally replace unsafe `(error as Error).message` patterns (134 occurrences). This can be done gradually — at minimum update any file you touch in other tasks. Use this pattern:

```typescript
// BEFORE (unsafe)
} catch (error) {
  this.logger.error(`Failed: ${(error as Error).message}`);
}

// AFTER (safe)
import { getErrorMessage } from '@nexus/core';
} catch (error) {
  this.logger.error(`Failed: ${getErrorMessage(error)}`);
}
```

- [ ] **Step 7: Run tests**

```bash
npx vitest run packages/core/src/common/
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/common/ \
        apps/api/src/workflow/workflow-special-steps/special-step-policy.helpers.ts \
        apps/api/src/tool/tools/hydrate-discovery-work-items.tool.ts \
        apps/web/src/pages/kanban/WarRoomSessionManagerPanel.hooks.tsx
git commit -m "refactor: consolidate getErrorMessage into packages/core"
```

---

## Task 3: `isTerminalWorkflowRunStatus` — consolidate into `packages/core`

The canonical definition is already in `apps/api/src/workflow/workflow-runtime/workflow-runtime-tools.service.helpers.ts:229` but it lives in an app-level file, making it unavailable to `apps/kanban`. Move it to `packages/core`.

**Files:**
- Modify: `packages/core/src/interfaces/workflow-legacy.types.ts`
- Modify: `packages/core/src/interfaces/index.ts` (to ensure export)
- Modify: 5 files with duplicate definitions

- [ ] **Step 1: Write a test in packages/core**

Add to `packages/core/src/interfaces/workflow-legacy.types.spec.ts` (create if absent):

```typescript
import { describe, it, expect } from 'vitest';
import { isTerminalWorkflowRunStatus, WorkflowStatus } from './workflow-legacy.types';

describe('isTerminalWorkflowRunStatus', () => {
  it('returns true for COMPLETED, FAILED, CANCELLED', () => {
    expect(isTerminalWorkflowRunStatus(WorkflowStatus.COMPLETED)).toBe(true);
    expect(isTerminalWorkflowRunStatus(WorkflowStatus.FAILED)).toBe(true);
    expect(isTerminalWorkflowRunStatus(WorkflowStatus.CANCELLED)).toBe(true);
  });

  it('returns false for non-terminal statuses', () => {
    expect(isTerminalWorkflowRunStatus(WorkflowStatus.RUNNING)).toBe(false);
    expect(isTerminalWorkflowRunStatus(WorkflowStatus.PENDING)).toBe(false);
  });

  it('returns false for unknown/garbage values', () => {
    expect(isTerminalWorkflowRunStatus('UNKNOWN')).toBe(false);
    expect(isTerminalWorkflowRunStatus(null)).toBe(false);
    expect(isTerminalWorkflowRunStatus(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run packages/core/src/interfaces/workflow-legacy.types.spec.ts
```

Expected: FAIL — function is not exported from this file.

- [ ] **Step 3: Add the function to `workflow-legacy.types.ts`**

Append to `packages/core/src/interfaces/workflow-legacy.types.ts`:

```typescript
/**
 * Returns true if the workflow run status represents a terminal (non-recoverable) state.
 * Use this instead of manual string/enum comparisons spread across services.
 */
export function isTerminalWorkflowRunStatus(status: unknown): boolean {
  return (
    status === WorkflowStatus.CANCELLED ||
    status === WorkflowStatus.COMPLETED ||
    status === WorkflowStatus.FAILED
  );
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run packages/core/src/interfaces/workflow-legacy.types.spec.ts
```

Expected: All tests pass.

- [ ] **Step 5: Delete the 4 duplicate definitions**

For each file, remove the local definition and import from `@nexus/core`:

1. `apps/api/src/workflow/workflow-runtime/workflow-runtime-tools.service.helpers.ts:229` — delete the exported function, it is now in `@nexus/core`
2. `apps/api/src/workflow/workflow-runtime/workflow-runtime-mesh-delegation-tools.service.ts:354` — delete private copy, add `import { isTerminalWorkflowRunStatus } from '@nexus/core';`
3. `apps/api/src/workflow/workflow-runtime/workflow-runtime-subagent-tools.service.ts:242` — delete private copy, add import
4. `apps/api/src/workflow/workflow-lifecycle-execution.service.ts:22` — delete local Set definition, add import and use the function
5. `apps/kanban/src/core-lifecycle-stream.consumer.ts:27–31` — delete string array, add `import { isTerminalWorkflowRunStatus } from '@nexus/core';` and replace the array check with `isTerminalWorkflowRunStatus(status)`

- [ ] **Step 6: Run tests**

```bash
npx vitest run apps/api/src/workflow/workflow-runtime/
npx vitest run apps/kanban/src/
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/interfaces/workflow-legacy.types.ts \
        packages/core/src/interfaces/workflow-legacy.types.spec.ts \
        apps/api/src/workflow/ \
        apps/kanban/src/core-lifecycle-stream.consumer.ts
git commit -m "refactor: move isTerminalWorkflowRunStatus to packages/core, remove 4 duplicate copies"
```

---

## Task 4: `sleep` and `computeExponentialBackoffMs` in `apps/api/src/common/utils/`

**Files:**
- Create: `apps/api/src/common/utils/async.utils.ts`
- Create: `apps/api/src/common/utils/async.utils.spec.ts`

- [ ] **Step 1: Write tests**

```typescript
// apps/api/src/common/utils/async.utils.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sleep, computeExponentialBackoffMs } from './async.utils';

describe('sleep', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves after the specified duration', async () => {
    const p = sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBeUndefined();
  });
});

describe('computeExponentialBackoffMs', () => {
  it('returns base delay on attempt 0', () => {
    expect(computeExponentialBackoffMs(0, { baseMs: 1000, maxMs: 30000 })).toBe(1000);
  });

  it('doubles on each attempt', () => {
    expect(computeExponentialBackoffMs(1, { baseMs: 1000, maxMs: 30000 })).toBe(2000);
    expect(computeExponentialBackoffMs(2, { baseMs: 1000, maxMs: 30000 })).toBe(4000);
  });

  it('clamps at maxMs', () => {
    expect(computeExponentialBackoffMs(10, { baseMs: 1000, maxMs: 30000 })).toBe(30000);
  });

  it('respects optional jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const result = computeExponentialBackoffMs(0, { baseMs: 1000, maxMs: 30000, jitter: true });
    // With random=0.5, jitter adds 0.5 * baseMs = 500ms
    expect(result).toBe(1500);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run apps/api/src/common/utils/async.utils.spec.ts
```

Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/common/utils/async.utils.ts

/** Waits for the specified number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BackoffConfig {
  /** Delay for attempt 0 (ms) */
  baseMs: number;
  /** Maximum delay before clamping (ms) */
  maxMs: number;
  /** Whether to add random jitter up to baseMs */
  jitter?: boolean;
}

/**
 * Computes exponential backoff with optional jitter.
 * delay = min(baseMs * 2^attempt, maxMs) + (jitter ? random * baseMs : 0)
 */
export function computeExponentialBackoffMs(attempt: number, config: BackoffConfig): number {
  const base = Math.min(config.baseMs * Math.pow(2, attempt), config.maxMs);
  const jitter = config.jitter ? Math.random() * config.baseMs : 0;
  return Math.min(base + jitter, config.maxMs);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run apps/api/src/common/utils/async.utils.spec.ts
```

Expected: All tests pass.

- [ ] **Step 5: Replace inline `sleep` expressions in API source**

Search for all occurrences:
```bash
grep -rn "new Promise.*setTimeout\|new Promise.*resolve.*setTimeout" apps/api/src --include="*.ts" -l
```

For each file found, replace the inline expression:
```typescript
// BEFORE
await new Promise((resolve) => setTimeout(resolve, ms));

// AFTER
import { sleep } from '../../common/utils/async.utils'; // adjust path
await sleep(ms);
```

Key files to update (based on analysis):
- `apps/api/src/chat-execution/chat-execution.service.ts:747`
- `apps/api/src/memory/learning/learning.service.ts:142`
- `apps/api/src/workflow/workflow-step-execution/step-support.service.ts:66`
- Any private `async sleep()` methods found in services — delete those and use the import

- [ ] **Step 6: Replace inline backoff implementations**

The 5 files each have their own exponential backoff calculation. Replace the body of each with a call to `computeExponentialBackoffMs`:

```typescript
import { computeExponentialBackoffMs } from '../../common/utils/async.utils'; // adjust path

// Replace inline: Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
// with:
computeExponentialBackoffMs(attempt, { baseMs: baseDelay, maxMs: maxDelay })
```

Files:
- `apps/api/src/chat-execution/chat-session-auto-retry.helpers.ts:181`
- `apps/api/src/plugin-kernel/events/plugin-event-delivery-engine.service.ts:301`
- `apps/api/src/plugin-kernel/events/plugin-event-delivery-worker.service.ts:95`
- `apps/api/src/workflow/workflow-run-auto-retry.helpers.ts:447`
- `apps/api/src/workflow/workflow-step-execution/step-agent-in-session-transient-retry.helpers.ts:82`

Note: Check the specific clamping logic in each file before deleting it. The `BackoffConfig.maxMs` replaces any `Math.min(..., MAX)` cap.

- [ ] **Step 7: Run the full API test suite**

```bash
npx vitest run apps/api/
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/common/utils/async.utils.ts \
        apps/api/src/common/utils/async.utils.spec.ts \
        apps/api/src/chat-execution/ \
        apps/api/src/memory/ \
        apps/api/src/workflow/ \
        apps/api/src/plugin-kernel/
git commit -m "refactor: consolidate sleep and computeExponentialBackoffMs into async.utils"
```
