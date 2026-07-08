# TypeScript Health Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate all 2161 TypeScript type errors in `apps/api` and 260 errors in `apps/kanban` while keeping all 5565 unit tests passing.

**Architecture:** Issues fall into six categories: (1) missing `vitest/globals` types in tsconfigs (~1480 errors systemic), (2) one production-code type error in the step orchestrator, (3) stale `jest.*` references in spec files, (4) test fixtures that were not updated when entities gained new fields from the scope-lifecycle feature, (5) a kanban tsconfig cross-contamination pulling in API source files, and (6) dead e2e test imports pointing to modules that no longer exist.

**Tech Stack:** TypeScript 6, Vitest 4, NestJS 11, npm workspaces/Turborepo.

---

## Health Check Baseline

Run these before starting and after each task to measure progress.

```bash
# From repo root: G:/code/AI/nexus-orchestator
npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "error TS" | wc -l
# Expected at start: 2161

npx tsc --noEmit --project apps/kanban/tsconfig.json 2>&1 | grep "error TS" | wc -l
# Expected at start: 260

npm run test:api 2>&1 | tail -5
# Must remain: Test Files 574 passed | 1 skipped

npm run test:kanban 2>&1 | tail -5
# Must remain: Test Files 130 passed
```

---

## Task 1 — Add `vitest/globals` types to both tsconfigs

**Expected error reduction: ~1480 (API) + ~20 (kanban)**

This single change eliminates essentially all `TS2304 Cannot find name 'describe'`, `TS2593`, and related "test runner globals" errors that flood both apps. The vitest config already sets `globals: true` (makes globals available at runtime), but TypeScript has no knowledge of them.

**Files:**
- Modify: `apps/api/tsconfig.json`
- Modify: `apps/kanban/tsconfig.json`

- [ ] **Step 1.1: Add `vitest/globals` to API tsconfig**

Open `apps/api/tsconfig.json`. Add a `types` array to `compilerOptions`:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "resolvePackageJsonExports": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2023",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "ignoreDeprecations": "6.0",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "strictPropertyInitialization": false,
    "forceConsistentCasingInFileNames": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist", "coverage", "storage", "logs"]
}
```

- [ ] **Step 1.2: Add `vitest/globals` to kanban tsconfig**

Open `apps/kanban/tsconfig.json`. Apply the same `"types": ["vitest/globals"]` addition:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "resolvePackageJsonExports": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2023",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "ignoreDeprecations": "6.0",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "strictPropertyInitialization": false,
    "forceConsistentCasingInFileNames": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist", "coverage", "logs"]
}
```

- [ ] **Step 1.3: Verify error count drops significantly**

```bash
cd G:/code/AI/nexus-orchestator
npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "error TS" | wc -l
# Expected: ~680 (from 2161 — drops by ~1480)

npx tsc --noEmit --project apps/kanban/tsconfig.json 2>&1 | grep "error TS" | wc -l
# Expected: ~240 (from 260)
```

- [ ] **Step 1.4: Verify tests still pass**

```bash
cd G:/code/AI/nexus-orchestator
npm run test:api 2>&1 | tail -5
npm run test:kanban 2>&1 | tail -5
```

- [ ] **Step 1.5: Commit**

```bash
git add apps/api/tsconfig.json apps/kanban/tsconfig.json
git commit -m "fix(tsc): add vitest/globals types to api and kanban tsconfigs"
```

---

## Task 2 — Fix production type error in step-execution-orchestrator

**Expected error reduction: 1 (but it's a production code correctness bug)**

`apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts` contains a method whose return type is declared as `Promise<DispatchJobResult | SkippedJobResult>` but the method body returns a `SpecialStepExecutionResult` at line 190. The `DispatchJobResult | SkippedJobResult` union doesn't include `SpecialStepExecutionResult`, causing a TS2322 type error.

There are two similar `dispatchJob`-like methods in this file. One already has the correct return type (`DispatchJobResult | SkippedJobResult | SpecialStepExecutionResult`); the other does not. This task updates the one that was missed.

**Files:**
- Modify: `apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts`

- [ ] **Step 2.1: Identify the incorrect method signature**

```bash
cd G:/code/AI/nexus-orchestator
grep -n "DispatchJobResult\|SkippedJobResult\|SpecialStepExecutionResult" \
  apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts
```

Look for a method returning `Promise<DispatchJobResult | SkippedJobResult>` (without `SpecialStepExecutionResult`). This is the one to update.

- [ ] **Step 2.2: Verify `SpecialStepExecutionResult` is imported**

```bash
grep -n "SpecialStepExecutionResult\|step-special-step.types" \
  apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts
```

If there is no import for `SpecialStepExecutionResult`, add it to the import block at the top of the file. The type is defined in:

```
apps/api/src/workflow/workflow-special-steps/step-special-step.types.ts
```

Add to the existing imports (example — match the existing import style in the file):

```typescript
import type { SpecialStepExecutionResult } from '../workflow-special-steps/step-special-step.types';
```

- [ ] **Step 2.3: Update the method return type**

Find the method containing line 190 (`return specialResult;`). Change its return type from:

```typescript
): Promise<DispatchJobResult | SkippedJobResult> {
```

to:

```typescript
): Promise<DispatchJobResult | SkippedJobResult | SpecialStepExecutionResult> {
```

- [ ] **Step 2.4: Verify the error is gone**

```bash
cd G:/code/AI/nexus-orchestator
npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "step-execution-orchestrator"
# Expected: no output (error gone)
```

- [ ] **Step 2.5: Run the tests**

```bash
npm run test:api -- --reporter=verbose 2>&1 | grep -E "step-execution|FAIL|PASS" | head -20
```

- [ ] **Step 2.6: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/step-execution-orchestrator.service.ts
git commit -m "fix(workflow): extend dispatchJob return type to include SpecialStepExecutionResult"
```

---

## Task 3 — Update AgentProfile test fixtures for scope-lifecycle fields

**Expected error reduction: ~150 API errors**

The `AgentProfile` entity gained four new non-nullable required fields as part of the scope-lifecycle feature (`phase-b-scope-lifecycle`). The test fixtures in `apps/api/src/ai-config/__tests__/setup/ai-config-test.fixtures.ts` pre-date these additions and use `as AgentProfile` casts that are now rejected by TypeScript because the literal objects are too incomplete.

**New required fields on `AgentProfile`:**
- `source: 'seeded' | 'admin' | 'agent_factory'` — defaults to `'admin'`
- `scope_node_id: string | null` — defaults to `null`
- `locked: boolean` — defaults to `false`
- `overrides: Record<string, unknown> | null` — defaults to `null`
- `base_ref: string | null` — defaults to `null`
- `base_profile_id: string | null` — defaults to `null`

The field `allowed_tools` also appeared in fixtures but no longer exists on the entity (superseded by `tool_policy`).

**Files:**
- Modify: `apps/api/src/ai-config/__tests__/setup/ai-config-test.fixtures.ts`

- [ ] **Step 3.1: Update `createMockAgentProfileFixture`**

Replace the function body so it includes all required fields:

```typescript
export function createMockAgentProfileFixture(): AgentProfile {
  return Object.freeze({
    id: TEST_IDS.AGENT_PROFILE_1,
    name: 'qa_automation',
    model_name: 'profile-model',
    provider_name: 'profile-provider',
    system_prompt: 'profile-prompt',
    tier_preference: 'light',
    source: 'admin',
    scope_node_id: null,
    locked: false,
    overrides: null,
    base_ref: null,
    base_profile_id: null,
    tool_policy: null,
    is_active: true,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as AgentProfile);
}
```

- [ ] **Step 3.2: Update `createMockAgentProfileWithNullFieldsFixture`**

```typescript
export function createMockAgentProfileWithNullFieldsFixture(): AgentProfile {
  return Object.freeze({
    id: TEST_IDS.AGENT_PROFILE_2,
    name: 'minimal-agent',
    model_name: null,
    provider_name: null,
    system_prompt: null,
    tier_preference: null,
    source: 'admin',
    scope_node_id: null,
    locked: false,
    overrides: null,
    base_ref: null,
    base_profile_id: null,
    tool_policy: null,
    is_active: true,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as AgentProfile);
}
```

- [ ] **Step 3.3: Update `createMockLegacyAgentProfileFixture`**

```typescript
export function createMockLegacyAgentProfileFixture(): AgentProfile {
  return Object.freeze({
    id: TEST_IDS.AGENT_PROFILE_LEGACY,
    name: 'testing-agent',
    model_name: 'MiniMaxAI/MiniMax-M2.5-TEE',
    provider_name: 'chutes.ai',
    system_prompt: 'legacy-prompt',
    tier_preference: 'light',
    source: 'seeded',
    scope_node_id: null,
    locked: false,
    overrides: null,
    base_ref: null,
    base_profile_id: null,
    tool_policy: null,
    is_active: true,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as AgentProfile);
}
```

- [ ] **Step 3.4: Update `createMockInactiveAgentProfileFixture`**

```typescript
export function createMockInactiveAgentProfileFixture(): AgentProfile {
  return Object.freeze({
    id: 'agent-profile-inactive',
    name: 'inactive-agent',
    model_name: 'inactive-model',
    provider_name: 'inactive-provider',
    system_prompt: 'inactive-prompt',
    tier_preference: null,
    source: 'admin',
    scope_node_id: null,
    locked: false,
    overrides: null,
    base_ref: null,
    base_profile_id: null,
    tool_policy: null,
    is_active: false,
    created_at: new Date(DEFAULT_TEST_DATE),
    updated_at: new Date(DEFAULT_TEST_DATE),
  } as AgentProfile);
}
```

- [ ] **Step 3.5: Verify error count drops in the fixtures file**

```bash
cd G:/code/AI/nexus-orchestator
npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "ai-config-test.fixtures"
# Expected: no output
```

- [ ] **Step 3.6: Run api tests**

```bash
npm run test:api 2>&1 | tail -5
# Must still show: Test Files 574 passed | 1 skipped
```

- [ ] **Step 3.7: Commit**

```bash
git add apps/api/src/ai-config/__tests__/setup/ai-config-test.fixtures.ts
git commit -m "fix(test): update AgentProfile fixtures for scope-lifecycle fields"
```

---

## Task 4 — Fix `Mock<>` type arguments in vitest 4.x and ACP fixture issues

**Expected error reduction: ~60 API errors**

Vitest 4.x changed `Mock<A, B>` to `Mock<Fn>` (accepts 0–1 type parameters, not 2). The mocks factory `apps/api/src/ai-config/__tests__/setup/ai-config-mocks.factory.ts` uses the old 2-argument form throughout (34 TS2707 errors). Additionally, this file contains ACP-related fixtures with `AcpAwaitPolicy` passed as a raw number (must be the enum) and `AcpServer` objects missing the required `enabled` field.

**Files:**
- Modify: `apps/api/src/ai-config/__tests__/setup/ai-config-mocks.factory.ts`

- [ ] **Step 4.1: Inspect the mocks factory**

```bash
head -120 apps/api/src/ai-config/__tests__/setup/ai-config-mocks.factory.ts
```

Find all uses of `Mock<Something, SomethingElse>` and understand the mock shapes.

- [ ] **Step 4.2: Replace two-argument Mock generics**

In vitest 4.x `Mock<A, B>` is replaced by `Mock<(...args: A) => B>`. The simplest correct pattern when you just want a generic mock function is `Mock<Procedure>` or `Mock` (no args).

For each `Mock<X, Y>` in the file, check what the mock is for and apply:
- If you don't need precise function type: use `Mock` (no type args)
- If you need the return type: use `Mock<() => ReturnType>` or `Mock<(arg: ArgType) => ReturnType>`

Example — replace:
```typescript
// before (vitest 3 style):
doSomething: Mock<[string], void>
// after (vitest 4 style):
doSomething: Mock<(input: string) => void>
```

Run the targeted tsc check to verify:
```bash
cd G:/code/AI/nexus-orchestator
npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "ai-config-mocks.factory" | head -20
```

- [ ] **Step 4.3: Fix `AgentProfile` fixtures in mocks factory**

The mocks factory also builds `AgentProfile` objects. Apply the same field additions from Task 3 to any `AgentProfile` mock shapes in this file (add `source`, `scope_node_id`, `locked`, `overrides`, `base_ref`, `base_profile_id`, `tool_policy`; remove `allowed_tools`).

- [ ] **Step 4.4: Verify file clean**

```bash
npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "ai-config-mocks.factory"
# Expected: no output
```

- [ ] **Step 4.5: Run the relevant test suite**

```bash
cd G:/code/AI/nexus-orchestator && npm run test:api -- src/ai-config 2>&1 | tail -10
```

- [ ] **Step 4.6: Commit**

```bash
git add apps/api/src/ai-config/__tests__/setup/ai-config-mocks.factory.ts
git commit -m "fix(test): update Mock<> generics for vitest 4.x and AgentProfile fields in mocks factory"
```

---

## Task 5 — Migrate `ai-configuration.service.spec.ts` from jest to vitest

**Expected error reduction: ~83 API errors**

The file `apps/api/src/ai-config/ai-configuration.service.spec.ts` still uses the Jest API (`jest.fn()`, `jest.Mock`, `jest.spyOn()`) instead of Vitest equivalents. This project uses Vitest — `jest` is not available in the test environment. These generate 29 TS2694 errors ("Namespace 'global.jest' has no exported member") and 83 TS2708 errors ("Cannot use namespace 'jest' as value").

**Migration mappings:**
| Jest | Vitest |
|------|--------|
| `jest.fn()` | `vi.fn()` |
| `jest.fn().mockResolvedValue(x)` | `vi.fn().mockResolvedValue(x)` |
| `jest.fn().mockReturnValue(x)` | `vi.fn().mockReturnValue(x)` |
| `jest.Mock` | `Mock` (imported from `vitest`) |
| `jest.spyOn(obj, 'method')` | `vi.spyOn(obj, 'method')` |
| `jest.clearAllMocks()` | `vi.clearAllMocks()` |
| `jest.resetAllMocks()` | `vi.resetAllMocks()` |

**Files:**
- Modify: `apps/api/src/ai-config/ai-configuration.service.spec.ts`

- [ ] **Step 5.1: Check what jest APIs are in use**

```bash
cd G:/code/AI/nexus-orchestator
grep -n "jest\." apps/api/src/ai-config/ai-configuration.service.spec.ts | head -40
```

- [ ] **Step 5.2: Add vitest imports if not present**

At the top of `ai-configuration.service.spec.ts`, ensure vitest types are imported. The `vi` global is available from `vitest/globals` (provided by the tsconfig fix in Task 1). For the `Mock` type:

```typescript
import type { Mock } from 'vitest';
```

- [ ] **Step 5.3: Replace all `jest.*` usages**

Apply the migration table above. Replace every occurrence of `jest.fn()` with `vi.fn()`, `jest.Mock` with `Mock`, etc.

After replacing, run:
```bash
grep -n "jest" apps/api/src/ai-config/ai-configuration.service.spec.ts
# Expected: no output (all jest references gone)
```

- [ ] **Step 5.4: Verify clean compile**

```bash
cd G:/code/AI/nexus-orchestator
npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "ai-configuration.service.spec"
# Expected: no output
```

- [ ] **Step 5.5: Run the test file**

```bash
npm run test:api -- src/ai-config/ai-configuration.service.spec.ts 2>&1 | tail -10
```

- [ ] **Step 5.6: Commit**

```bash
git add apps/api/src/ai-config/ai-configuration.service.spec.ts
git commit -m "fix(test): migrate ai-configuration.service.spec to vitest (remove jest references)"
```

---

## Task 6 — Fix remaining API spec fixture type mismatches

**Expected error reduction: ~200+ API errors (spread across many spec files)**

After Tasks 1–5, the remaining errors are fixture/mock shapes that don't match current entity/type definitions. These need to be addressed file by file. The most impactful ones are listed below.

Run this to get the post-Task-5 error list by file:
```bash
cd G:/code/AI/nexus-orchestator
npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "error TS" \
  | sed 's|apps/api/src/||' | sed 's|([0-9]*,[0-9]*).*||' \
  | sort | uniq -c | sort -rn | head -30
```

Work through each file. Common patterns:

### 6a — ACP fixtures (`acp/__tests__/acp.service.spec.ts`, `acp-runtime-manager.service.spec.ts`)

**Issues:**
1. `AcpAwaitPolicy` is a TypeScript enum, but fixtures pass a raw number (e.g. `0`). Use the enum value: `AcpAwaitPolicy.WAIT_FOR_RESULT` (or whatever the 0-value member is).
2. `AcpServer` objects are missing the required `enabled` field. Add `enabled: true` (or `false` as appropriate) to every partial `AcpServer` fixture object.

Find the enum:
```bash
grep -rn "AcpAwaitPolicy" apps/api/src/acp/ | grep -v ".spec.ts" | head -10
```

- [ ] **Step 6a: Fix ACP fixtures**

For each `{ await_policy: 0 }` or similar, replace with the enum value:
```typescript
// Before:
await_policy: 0,
// After (import AcpAwaitPolicy first):
await_policy: AcpAwaitPolicy.WAIT_FOR_RESULT,  // or the correct member
```

For each AcpServer object missing `enabled`, add:
```typescript
enabled: true,
```

Verify:
```bash
npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "acp\." | head -10
```

Commit:
```bash
git add apps/api/src/acp/__tests__/
git commit -m "fix(test): update ACP spec fixtures for AcpAwaitPolicy enum and AcpServer.enabled"
```

### 6b — `ai-config-admin.service.spec.ts` and `ai-config-test.module.ts`

- [ ] **Step 6b: Fix ai-config-admin spec**

```bash
npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "ai-config-admin\|ai-config-test.module"
```

For `openaiPreset` and `anthropicPreset` possibly-undefined errors: add explicit null guards or non-null assertions before accessing properties. For missing `oauth_authorization_url` in a union type, check which union member is expected:

```typescript
// Replace direct property access on the union:
// Before:
anthropicPreset.oauth_authorization_url
// After (narrow type first or use optional chain):
'oauth_authorization_url' in anthropicPreset ? anthropicPreset.oauth_authorization_url : undefined
```

### 6c — Address remaining errors file by file

For each remaining file with errors, follow this process:

```bash
# Get errors for a specific file:
npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "path/to/file.spec.ts"
```

Common patterns and fixes:
- `Property 'X' does not exist on type 'Y'` → the type was refactored; find the current property name with `grep -n "interface Y" apps/api/src/`
- `Type 'A' is not assignable to type 'B'` → the entity field became required; add it to the fixture
- `TS18048: possibly undefined` → add a non-null assertion `!` or optional chain

Commit after each batch:
```bash
git add <changed-files>
git commit -m "fix(test): update [area] spec fixtures for type changes"
```

---

## Task 7 — Fix kanban tsconfig cross-contamination (~220 errors)

**Expected error reduction: ~220 kanban errors**

`npx tsc --project apps/kanban/tsconfig.json` emits ~220 errors stating that files under `apps/api/src/` are "not under rootDir `G:/code/AI/nexus-orchestator/apps/kanban`". This happens because the kanban app imports from a package (likely `@nexus/core` via path alias) that transitively resolves to API source files.

**Investigation first:**

- [ ] **Step 7.1: Find the import chain**

```bash
cd G:/code/AI/nexus-orchestator
npx tsc --noEmit --project apps/kanban/tsconfig.json 2>&1 | grep "apps/api" | head -5
# Note the first file listed after "The file is in the program because:"
```

That "reason" chain tells you which kanban file imported something that pulled in API code. Trace it back to the originating import in the kanban source.

- [ ] **Step 7.2: Choose a fix strategy**

**Option A (preferred):** Fix the import chain. If kanban is importing from a package that re-exports API types, those types should be moved to `@nexus/core` or `@nexus/kanban-contracts` (the proper shared-type packages). This is the correct architectural fix but may require moving types.

**Option B (quick):** Add a `tsconfig.build.json` in `apps/kanban/` that excludes spec files and is used for type-checking non-test code, then add a separate `tsconfig.spec.json` that includes spec files. Add `skipLibCheck: true` to the spec tsconfig. Point the regular tsconfig at only production code.

**Option C (workaround):** Add the offending import path to `paths` in `apps/kanban/tsconfig.json` to redirect it to the proper package export rather than the API source file.

- [ ] **Step 7.3: Implement chosen fix**

After investigation, apply the appropriate fix. Verify:
```bash
npx tsc --noEmit --project apps/kanban/tsconfig.json 2>&1 | grep "apps/api" | wc -l
# Expected: 0
```

- [ ] **Step 7.4: Run kanban tests**

```bash
npm run test:kanban 2>&1 | tail -5
# Must still show: Test Files 130 passed
```

- [ ] **Step 7.5: Commit**

```bash
git add apps/kanban/tsconfig.json  # (and any other changed files)
git commit -m "fix(tsc): resolve kanban tsconfig cross-contamination with api source files"
```

---

## Task 8 — Fix dead e2e test imports

**Expected error reduction: ~23 API errors**

Several files in `apps/api/test/` import modules that no longer exist at those paths (likely moved or deleted in a project restructure):

| E2E spec file | Missing imports |
|---|---|
| `test/projects.e2e-spec.ts` | `src/project/project.controller`, `project.service`, `project.repository`, `project-git-metadata.service`, `project-agents-file.service` |
| `test/project-orchestration-actions.e2e-spec.ts` | `src/project/project-orchestration.controller`, `.service`, `.repository`, `project-orchestration-action-request.repository`, `project-orchestration-mode-policy.service`, `work-item.service`, `work-item.repository` |
| `test/work-item-dispatch-polling-capacity.e2e-spec.ts` | `src/project/work-item-dispatch-polling.*`, `work-item-dispatch.events` |

- [ ] **Step 8.1: Find where modules moved**

```bash
cd G:/code/AI/nexus-orchestator
find apps/api/src -name "project.controller.ts" -o -name "project.service.ts" 2>/dev/null
find apps/api/src -name "work-item.service.ts" 2>/dev/null
find apps/api/src -name "project-orchestration.controller.ts" 2>/dev/null
```

- [ ] **Step 8.2: Update import paths or delete dead tests**

For each missing import, either:

**a) Module was moved:** Update the import path in the e2e spec to point to the new location.
```typescript
// Before:
import { ProjectService } from '../src/project/project.service';
// After (example if moved to kanban module):
import { ProjectService } from '../src/kanban/project/project.service';
```

**b) Module was deleted (functionality removed):** If the module no longer exists anywhere, the e2e test is testing deleted functionality. Either delete the test file entirely or gut it to a placeholder pending future implementation.

- [ ] **Step 8.3: Verify no more TS2307 missing-module errors**

```bash
cd G:/code/AI/nexus-orchestator
npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "error TS2307"
# Expected: no output
```

- [ ] **Step 8.4: Commit**

```bash
git add apps/api/test/
git commit -m "fix(test): update e2e test imports after project module restructure"
```

---

## Task 9 — Fix kanban spec fixture mismatches

**Expected error reduction: ~40 kanban errors (after Task 7 removes cross-contamination)**

After fixing the cross-contamination (Task 7), ~40 genuine kanban spec errors remain. Fix them in order of impact.

**Files to fix:**

### 9a — `apps/kanban/src/core/core-workflow-client.service.spec.ts`

TS2739: Missing `scopeNodeId`, `scopePath` fields in a test fixture object.

- [ ] **Step 9a: Add missing scope fields**

```bash
grep -n "scopeNodeId\|scopePath\|scopeId\|contextId" \
  apps/kanban/src/core/core-workflow-client.service.spec.ts | head -10
```

Find the fixture object at line 68 and add the missing required fields:
```typescript
// Add these to the fixture object:
scopeNodeId: null,
scopePath: null,
```

Verify:
```bash
npx tsc --noEmit --project apps/kanban/tsconfig.json 2>&1 | grep "core-workflow-client"
```

### 9b — `apps/kanban/src/orchestration/orchestration-continuation.integration.spec.ts`

TS2554: Constructor/factory called with 8 args but expects 9.

- [ ] **Step 9b: Fix arg count**

```bash
grep -n "new OrchestrationService\|createOrchestrationService" \
  apps/kanban/src/orchestration/orchestration-continuation.integration.spec.ts | head -10

# Find constructor signature:
grep -n "constructor\|OrchestrationService" \
  apps/kanban/src/orchestration/orchestration.service.ts | head -10
```

The `OrchestrationService` constructor gained a new dependency. At each call site in the spec (lines 133, 261, 356, 494, 577, 636), add the missing 9th argument. Find what it should be from the constructor definition, then pass either a mock or `null as never`.

Example pattern:
```typescript
const orchestrationService = new OrchestrationService(
  mockWorkflowClient,
  mockProjectWorkflowRunRepo,
  requestContext,
  orchestrationRepository.repository as never,
  mockSettingsService,
  workItems as never,
  /* NEW 7th arg */ mockSomeNewDep as never,
  /* NEW 8th arg */ null as never,
  /* NEW 9th arg */ null as never,
);
```

### 9c — `apps/kanban/src/seeds/workflows.seed.contract.spec.ts`

TS2339: `allow_tools`, `deny_tools`, and `tool_policy` no longer exist on `IToolPermissionPolicy`.

- [ ] **Step 9c: Fix seed contract spec**

```bash
grep -n "allow_tools\|deny_tools\|tool_policy" \
  apps/kanban/src/seeds/workflows.seed.contract.spec.ts

# Find current IToolPermissionPolicy interface:
grep -rn "IToolPermissionPolicy" packages/kanban-contracts/src/ packages/core/src/ | head -5
```

Update assertions to use the current property names. If the interface was renamed or restructured, rewrite the assertions to match the current API.

### 9d — `apps/kanban/src/retrospectives/kanban-retrospective.service.spec.ts`

TS2322: `KanbanRetrospectiveDeltaSnapshot` not assignable to `Record<string, unknown>`.

- [ ] **Step 9d: Fix type mismatch**

```bash
grep -n "KanbanRetrospectiveDeltaSnapshot" \
  apps/kanban/src/retrospectives/kanban-retrospective.service.spec.ts | head -5

grep -n "KanbanRetrospectiveDeltaSnapshot" \
  apps/kanban/src/retrospectives/ -r | grep -v ".spec.ts"
```

Either cast the snapshot to the expected type, or (if the snapshot type has been strengthened with new fields) update the test fixture to pass all required fields.

### 9e — `apps/kanban/src/mcp/tools/mutation/hydrate-discovery-work-items.tool.spec.ts`

TS2339: `createWorkItem` not on type `never` (mock is typed as `never`).

- [ ] **Step 9e: Fix mock type**

The mock dependency is being typed as `never`. Find the mock definition in this spec file and ensure it's typed correctly using the service's interface or `vi.mocked()`:

```typescript
// Bad — types as never:
const workItemService = {} as never;

// Good — use the actual interface:
const workItemService = {
  createWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1' }),
} as Partial<WorkItemService> as WorkItemService;
```

### 9f — Remaining kanban errors

- [ ] **Step 9f: Address any remaining kanban errors**

```bash
npx tsc --noEmit --project apps/kanban/tsconfig.json 2>&1 | grep "error TS" | grep -v "apps/api"
```

Work through each remaining error using the patterns from Tasks 6 and 9a–9e.

- [ ] **Step 9g: Final verification**

```bash
cd G:/code/AI/nexus-orchestator
npx tsc --noEmit --project apps/kanban/tsconfig.json 2>&1 | grep "error TS" | wc -l
# Target: 0

npm run test:kanban 2>&1 | tail -5
# Must show: Test Files 130 passed
```

- [ ] **Step 9h: Commit**

```bash
git add apps/kanban/src/
git commit -m "fix(test): update kanban spec fixtures for scope-lifecycle and API changes"
```

---

## Final Verification

- [ ] **Run full baseline check**

```bash
cd G:/code/AI/nexus-orchestator

npx tsc --noEmit --project apps/api/tsconfig.json 2>&1 | grep "error TS" | wc -l
# Target: 0

npx tsc --noEmit --project apps/kanban/tsconfig.json 2>&1 | grep "error TS" | wc -l
# Target: 0

npm run test:api 2>&1 | tail -5
# Must show: Test Files 574 passed | 1 skipped

npm run test:kanban 2>&1 | tail -5
# Must show: Test Files 130 passed

npm run lint:api 2>&1 | tail -3
# Must show exit code 0

npm run lint:kanban 2>&1 | tail -3
# Must show exit code 0
```

- [ ] **Commit if not already done**

```bash
git push
```

---

## Appendix — Error Budget by Task

| Task | Errors Before | Errors After |
|------|-------------|-------------|
| 1 — vitest/globals tsconfig | 2421 total | ~941 |
| 2 — production orchestrator | ~941 | ~940 |
| 3 — AgentProfile fixtures | ~940 | ~790 |
| 4 — Mock<> + ACP fixtures | ~790 | ~730 |
| 5 — jest→vitest migration | ~730 | ~650 |
| 6 — remaining API fixture fixes | ~650 | ~40 |
| 7 — kanban cross-contamination | ~260 kanban | ~40 kanban |
| 8 — dead e2e imports | ~40 | ~17 |
| 9 — kanban spec fixtures | ~40 kanban | 0 |
