# EPIC-209 Phase 1 — Integration Strategy Foundation (TDD Implementation Plan)

**Date:** 2026-06-22
**Epic:** EPIC-209 (PR-based integration strategy)
**Design spec:** `docs/superpowers/specs/2026-06-22-pr-based-integration-strategy-design.md` (Section 10 is the canonical interface contract — all signatures below are copied verbatim from it).
**Phase:** 1 of 6.

---

## Goal

Lay the **type + resolver foundation** for a per-repository integration strategy without changing any
runtime behaviour. After this phase:

- The API-side `MergeProvider` interface, `MERGE_PROVIDER` token, and supporting VCS-domain types
  **exist and compile** (no implementation — Phase 2 implements `GitHubMergeProvider`).
- The API-side `IntegrationStrategyResolver` reads four neutral, possibly-undefined step inputs
  (`integration_strategy`, `integration_merge_method`, `integration_auto_merge`,
  `integration_preflight_gate`), validates them, and **defaults to `direct-push` / `merge` / `false` /
  `true`**. It **never throws** on absent or unknown input.
- `packages/kanban-contracts` carries an optional `integration` sub-object on
  `RepositoryWorkflowSettings` plus a `resolveRepositoryIntegrationSettings` helper returning a
  fully-defaulted config.
- The kanban-side status-changed publisher forwards the resolved integration settings as the four
  neutral flat keys onto the `ready-to-merge` trigger payload.

**Net behaviour change: ZERO.** Nothing branches on the strategy yet; `direct-push` remains
byte-for-byte unchanged. The strategy is merely _selectable_ and _forwarded_.

---

## Architecture

```
        KANBAN-SIDE (lifecycle + config storage)            API-SIDE (VCS/provider mechanics)

repository_workflow_settings.integration                    MERGE_PROVIDER token + MergeProvider iface
  { strategy, mergeMethod, autoMerge, preflightGate }       (declared only; impl = Phase 2)
            │  resolveRepositoryIntegrationSettings
            ▼  (fully-defaulted)
  transitionWorkItemStatus resolves project settings
            │
            ▼  emitStatusChanged({ ..., integration })
  status_changed.v1 trigger payload gains 4 flat keys:
    integration_strategy, integration_merge_method,         IntegrationStrategyResolver.resolve(inputs)
    integration_auto_merge, integration_preflight_gate ───► (reads exactly those 4 keys; never throws;
                                                              defaults to direct-push). NOT WIRED into any
                                                              git_operation handler this phase.
```

**Boundary rule (CLAUDE.md → Core/Kanban Boundary):** strategy enum values (`direct-push` /
`pull-request`), `MergeMethod`, and `MergeProvider` are **VCS-domain, boundary-legal API-side**. Config
_storage_ (`RepositoryWorkflowSettings.integration`) and lifecycle stay **kanban-side**. The four flat
neutral keys are the only crossing. API/core code introduced here contains **no kanban identifiers**
(no `kanban`, `work-item`, `project`-domain terms — only neutral `scopeId`/`contextId`).

---

## Tech Stack

- **Language:** TypeScript (strict). No `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades.
- **Test runner:** Vitest.
  - API: `npm run test --workspace=apps/api`
  - kanban: `npm run test --workspace=apps/kanban`
  - kanban-contracts: `npm run test --workspace=packages/kanban-contracts`
- **Build order:** `packages/core` → `packages/kanban-contracts` → dependents.
- **NestJS apps** build with `nest build` (not `tsc`). `IntegrationStrategyResolver` is a plain class
  (no DI decorators required in Phase 1; it is instantiated directly).

---

## Global Constraints

1. **TDD, strictly Red → Green → Refactor.** Every task: write the failing test, run it and observe the
   exact failure, write the _minimal_ implementation, run it to green, then commit.
2. **Signatures are pinned.** Use spec Section 10.1 / 10.2 / 10.3 / 10.6 verbatim. Do not invent fields.
3. **Zero behaviour change.** No `git_operation` handler, no workflow YAML, no DAG, no migration is
   touched in Phase 1. The resolver is declared and unit-tested but not yet called by any handler.
4. **Boundary:** API/core files contain no kanban-domain identifiers.
5. **Build dependents first:** rebuild `packages/kanban-contracts` (after `packages/core`) before
   running kanban tests that import the new contract symbols.
6. **Atomic commits**, conventional-commit messages, one per task.

---

## File Structure

| File                                                                        | New/Mod                                              | Responsibility                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/common/git/integration/merge-provider.interface.ts`           | **New**                                              | `MERGE_PROVIDER` token + `IntegrationStrategy`, `MergeMethod`, `PullRequestState`, `PullRequestChecksStatus` type unions + `OpenOrUpdatePullRequestArgs`, `PullRequestRef`, `PullRequestStatus`, `MergeProvider` interfaces. Declaration only. |
| `apps/api/src/common/git/integration/merge-provider.interface.spec.ts`      | **New**                                              | Compile-time/structural test pinning the token symbol description and the union literal sets.                                                                                                                                                  |
| `apps/api/src/common/git/integration/integration-strategy.resolver.ts`      | **New**                                              | `ResolvedIntegrationConfig` interface + `IntegrationStrategyResolver` class reading the 4 neutral keys, validating, defaulting to direct-push; never throws.                                                                                   |
| `apps/api/src/common/git/integration/integration-strategy.resolver.spec.ts` | **New**                                              | Unit tests: defaults, valid values, unknown/garbage values, absent input, type coercion of booleans.                                                                                                                                           |
| `apps/api/src/common/git/integration/index.ts`                              | **New**                                              | Barrel re-exporting the interface + resolver.                                                                                                                                                                                                  |
| `apps/api/src/common/git/index.ts`                                          | **Mod**                                              | Add `export * from './integration';`.                                                                                                                                                                                                          |
| `packages/kanban-contracts/src/repository-workflow-settings.types.ts`       | **Mod**                                              | Add `RepositoryIntegrationSettings` interface + optional `integration?` on `RepositoryWorkflowSettings`. Re-declare the two VCS-domain union types locally (kanban-contracts cannot import from `apps/api`).                                   |
| `packages/kanban-contracts/src/repository-workflow-settings.ts`             | **Mod**                                              | Add `resolveRepositoryIntegrationSettings(...)` returning `Required<RepositoryIntegrationSettings>`; wire `integration` through `resolveRepositoryWorkflowSettings`.                                                                           |
| `packages/kanban-contracts/src/repository-workflow-settings.spec.ts`        | **New** (or extend if exists)                        | Tests for `resolveRepositoryIntegrationSettings` defaults + persisted-value passthrough + malformed coercion.                                                                                                                                  |
| `apps/kanban/src/work-item/kanban-lifecycle-event-publisher.ts`             | **Mod**                                              | `emitStatusChanged` accepts optional `integration` param; forwards 4 flat neutral keys onto the payload.                                                                                                                                       |
| `apps/kanban/src/work-item/kanban-lifecycle-event-publisher.spec.ts`        | **Mod**                                              | Test that the 4 flat keys appear on the emitted payload when `integration` is supplied, and are absent (or default-shaped) when not.                                                                                                           |
| `apps/kanban/src/work-item/work-item-transition.helper.ts`                  | **Mod**                                              | Resolve project integration settings and pass them to `emitStatusChanged`.                                                                                                                                                                     |
| `apps/kanban/src/work-item/work-item-transition.helper.spec.ts`             | **New** (or extend nearest existing transition spec) | Test that a transition forwards resolved integration settings into the publisher call.                                                                                                                                                         |

> Note on the boundary + DRY tension: the union literals `IntegrationStrategy` and `MergeMethod` are the
> single source of truth in `merge-provider.interface.ts` (API-side). `packages/kanban-contracts` cannot
> import from `apps/api` (would invert the dependency and is not on its tsconfig paths), so kanban-contracts
> **re-declares the same two string-literal unions locally**. This is an intentional, documented duplication
> of two trivial type aliases (not logic) to keep the boundary clean. A structural test in
> `repository-workflow-settings.spec.ts` pins the literal sets so the two never silently diverge.

---

## Task 1 — Declare `MergeProvider` interface + `MERGE_PROVIDER` token (API-side)

**Files**

- Create: `apps/api/src/common/git/integration/merge-provider.interface.ts`
- Test: `apps/api/src/common/git/integration/merge-provider.interface.spec.ts`

**Interfaces**

- Produces (spec 10.1, verbatim): `MERGE_PROVIDER`, `IntegrationStrategy`, `MergeMethod`,
  `PullRequestState`, `PullRequestChecksStatus`, `OpenOrUpdatePullRequestArgs`, `PullRequestRef`,
  `PullRequestStatus`, `MergeProvider`.
- Consumes: nothing.

### Steps

**1.1 Write the failing test.**

Create `apps/api/src/common/git/integration/merge-provider.interface.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  MERGE_PROVIDER,
  type IntegrationStrategy,
  type MergeMethod,
  type MergeProvider,
  type PullRequestRef,
} from "./merge-provider.interface";

describe("merge-provider contract", () => {
  it("exposes a uniquely-described injection token", () => {
    expect(MERGE_PROVIDER.toString()).toBe("Symbol(MERGE_PROVIDER)");
  });

  it("accepts a conforming implementation (structural type check)", async () => {
    const ref: PullRequestRef = {
      provider: "github",
      owner: "acme",
      repo: "widgets",
      number: 7,
      url: "https://github.com/acme/widgets/pull/7",
    };

    const impl: MergeProvider = {
      providerKey: "github",
      openOrUpdatePullRequest: async () => ref,
      getPullRequestStatus: async (r) => ({
        ref: r,
        state: "open",
        checks: "pending",
        reviewDecision: "none",
        mergeCommitSha: null,
        mergeable: null,
      }),
      mergePullRequest: async () => ({ mergeCommitSha: "abc123" }),
    };

    const strategies: IntegrationStrategy[] = ["direct-push", "pull-request"];
    const methods: MergeMethod[] = ["merge", "squash", "rebase"];

    expect(impl.providerKey).toBe("github");
    expect(await impl.getPullRequestStatus(ref)).toMatchObject({
      state: "open",
    });
    expect(strategies).toHaveLength(2);
    expect(methods).toHaveLength(3);
  });
});
```

**1.2 Run to fail (module does not exist yet).**

```bash
npm run test --workspace=apps/api -- merge-provider.interface
```

Expected: FAIL — `Failed to resolve import "./merge-provider.interface"` / `Cannot find module`.

**1.3 Minimal implementation.**

Create `apps/api/src/common/git/integration/merge-provider.interface.ts` (verbatim from spec 10.1):

```typescript
export const MERGE_PROVIDER = Symbol("MERGE_PROVIDER");

export type IntegrationStrategy = "direct-push" | "pull-request";
export type MergeMethod = "merge" | "squash" | "rebase";
export type PullRequestState = "open" | "merged" | "closed";
export type PullRequestChecksStatus =
  | "pending"
  | "passing"
  | "failing"
  | "unknown";

export interface OpenOrUpdatePullRequestArgs {
  scopeId: string; // neutral project/scope id
  contextId: string; // neutral work-item/context id
  workflowRunId: string;
  repositoryUrl: string; // e.g. https://github.com/owner/repo(.git)
  githubSecretId: string;
  headBranch: string; // feature branch (already pushed)
  baseBranch: string; // target/base branch
  title: string;
  body: string;
}

export interface PullRequestRef {
  provider: string; // 'github' | 'gitlab' | 'bitbucket'
  owner: string;
  repo: string;
  number: number;
  url: string;
}

export interface PullRequestStatus {
  ref: PullRequestRef;
  state: PullRequestState;
  checks: PullRequestChecksStatus;
  reviewDecision: "approved" | "changes_requested" | "review_required" | "none";
  mergeCommitSha: string | null; // populated when state === 'merged'
  mergeable: boolean | null;
}

export interface MergeProvider {
  readonly providerKey: string; // 'github'
  openOrUpdatePullRequest(
    args: OpenOrUpdatePullRequestArgs,
  ): Promise<PullRequestRef>;
  getPullRequestStatus(ref: PullRequestRef): Promise<PullRequestStatus>;
  mergePullRequest(
    ref: PullRequestRef,
    method: MergeMethod,
  ): Promise<{ mergeCommitSha: string }>;
}
```

**1.4 Run to pass.**

```bash
npm run test --workspace=apps/api -- merge-provider.interface
```

Expected: PASS (2 tests).

**1.5 Commit.**

```bash
git add apps/api/src/common/git/integration/merge-provider.interface.ts \
        apps/api/src/common/git/integration/merge-provider.interface.spec.ts
git commit -m "feat(api): declare MergeProvider interface and MERGE_PROVIDER token (EPIC-209 P1)"
```

---

## Task 2 — `IntegrationStrategyResolver` (API-side)

**Files**

- Create: `apps/api/src/common/git/integration/integration-strategy.resolver.ts`
- Test: `apps/api/src/common/git/integration/integration-strategy.resolver.spec.ts`

**Interfaces**

- Consumes: `IntegrationStrategy`, `MergeMethod` from `./merge-provider.interface`.
- Produces (spec 10.2, verbatim):
  ```typescript
  export interface ResolvedIntegrationConfig {
    strategy: IntegrationStrategy; // default 'direct-push'
    mergeMethod: MergeMethod; // default 'merge'
    autoMerge: boolean; // default false
    preflightGate: boolean; // default true
  }
  export class IntegrationStrategyResolver {
    resolve(
      inputs: Record<string, unknown> | undefined,
    ): ResolvedIntegrationConfig;
  }
  ```
- Reads exactly the neutral keys (spec 10.6): `integration_strategy`, `integration_merge_method`,
  `integration_auto_merge`, `integration_preflight_gate`.

### Steps

**2.1 Write the failing test.**

Create `apps/api/src/common/git/integration/integration-strategy.resolver.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { IntegrationStrategyResolver } from "./integration-strategy.resolver";

describe("IntegrationStrategyResolver", () => {
  const resolver = new IntegrationStrategyResolver();

  it("defaults to direct-push when input is undefined", () => {
    expect(resolver.resolve(undefined)).toEqual({
      strategy: "direct-push",
      mergeMethod: "merge",
      autoMerge: false,
      preflightGate: true,
    });
  });

  it("defaults to direct-push when input is an empty object", () => {
    expect(resolver.resolve({})).toEqual({
      strategy: "direct-push",
      mergeMethod: "merge",
      autoMerge: false,
      preflightGate: true,
    });
  });

  it("reads the four neutral keys when valid", () => {
    expect(
      resolver.resolve({
        integration_strategy: "pull-request",
        integration_merge_method: "squash",
        integration_auto_merge: true,
        integration_preflight_gate: false,
      }),
    ).toEqual({
      strategy: "pull-request",
      mergeMethod: "squash",
      autoMerge: true,
      preflightGate: false,
    });
  });

  it("falls back to defaults on unknown enum values without throwing", () => {
    expect(
      resolver.resolve({
        integration_strategy: "rocket-launch",
        integration_merge_method: "cherry-pick",
      }),
    ).toEqual({
      strategy: "direct-push",
      mergeMethod: "merge",
      autoMerge: false,
      preflightGate: true,
    });
  });

  it('coerces string booleans from trigger templating ("true"/"false")', () => {
    expect(
      resolver.resolve({
        integration_auto_merge: "true",
        integration_preflight_gate: "false",
      }),
    ).toMatchObject({ autoMerge: true, preflightGate: false });
  });

  it("never throws on garbage input", () => {
    expect(() =>
      resolver.resolve({
        integration_strategy: 42,
        integration_merge_method: null,
        integration_auto_merge: {},
        integration_preflight_gate: [],
      } as unknown as Record<string, unknown>),
    ).not.toThrow();
    expect(
      resolver.resolve({ integration_strategy: 42 } as unknown as Record<
        string,
        unknown
      >).strategy,
    ).toBe("direct-push");
  });
});
```

**2.2 Run to fail.**

```bash
npm run test --workspace=apps/api -- integration-strategy.resolver
```

Expected: FAIL — `Cannot find module './integration-strategy.resolver'`.

**2.3 Minimal implementation.**

Create `apps/api/src/common/git/integration/integration-strategy.resolver.ts`:

```typescript
import type {
  IntegrationStrategy,
  MergeMethod,
} from "./merge-provider.interface";

const STRATEGY_INPUT_KEY = "integration_strategy";
const MERGE_METHOD_INPUT_KEY = "integration_merge_method";
const AUTO_MERGE_INPUT_KEY = "integration_auto_merge";
const PREFLIGHT_GATE_INPUT_KEY = "integration_preflight_gate";

const DEFAULT_STRATEGY: IntegrationStrategy = "direct-push";
const DEFAULT_MERGE_METHOD: MergeMethod = "merge";
const DEFAULT_AUTO_MERGE = false;
const DEFAULT_PREFLIGHT_GATE = true;

const VALID_STRATEGIES: ReadonlySet<IntegrationStrategy> = new Set([
  "direct-push",
  "pull-request",
]);
const VALID_MERGE_METHODS: ReadonlySet<MergeMethod> = new Set([
  "merge",
  "squash",
  "rebase",
]);

export interface ResolvedIntegrationConfig {
  strategy: IntegrationStrategy; // default 'direct-push'
  mergeMethod: MergeMethod; // default 'merge'
  autoMerge: boolean; // default false
  preflightGate: boolean; // default true
}

/**
 * Reads neutral, possibly-undefined step inputs and resolves a fully-defaulted
 * integration config. Never throws on absent or unknown input; unknown values
 * fall back to the direct-push defaults so an unparseable trigger payload can
 * never break the merge path.
 */
export class IntegrationStrategyResolver {
  resolve(
    inputs: Record<string, unknown> | undefined,
  ): ResolvedIntegrationConfig {
    const source = inputs ?? {};
    return {
      strategy: this.resolveStrategy(source[STRATEGY_INPUT_KEY]),
      mergeMethod: this.resolveMergeMethod(source[MERGE_METHOD_INPUT_KEY]),
      autoMerge: this.resolveBoolean(
        source[AUTO_MERGE_INPUT_KEY],
        DEFAULT_AUTO_MERGE,
      ),
      preflightGate: this.resolveBoolean(
        source[PREFLIGHT_GATE_INPUT_KEY],
        DEFAULT_PREFLIGHT_GATE,
      ),
    };
  }

  private resolveStrategy(value: unknown): IntegrationStrategy {
    return typeof value === "string" &&
      VALID_STRATEGIES.has(value as IntegrationStrategy)
      ? (value as IntegrationStrategy)
      : DEFAULT_STRATEGY;
  }

  private resolveMergeMethod(value: unknown): MergeMethod {
    return typeof value === "string" &&
      VALID_MERGE_METHODS.has(value as MergeMethod)
      ? (value as MergeMethod)
      : DEFAULT_MERGE_METHOD;
  }

  private resolveBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return fallback;
  }
}
```

**2.4 Run to pass.**

```bash
npm run test --workspace=apps/api -- integration-strategy.resolver
```

Expected: PASS (6 tests).

**2.5 Commit.**

```bash
git add apps/api/src/common/git/integration/integration-strategy.resolver.ts \
        apps/api/src/common/git/integration/integration-strategy.resolver.spec.ts
git commit -m "feat(api): add IntegrationStrategyResolver defaulting to direct-push (EPIC-209 P1)"
```

---

## Task 3 — Integration barrel + git index export (API-side)

**Files**

- Create: `apps/api/src/common/git/integration/index.ts`
- Modify: `apps/api/src/common/git/index.ts`
- Test: extend `apps/api/src/common/git/integration/integration-strategy.resolver.spec.ts` with a
  barrel-import assertion (no new file needed).

**Interfaces**

- Produces: re-export surface for `integration/`.

### Steps

**3.1 Write the failing test.** Append to `integration-strategy.resolver.spec.ts`:

```typescript
import * as integrationBarrel from "./index";

describe("integration barrel", () => {
  it("re-exports the resolver and the merge-provider token", () => {
    expect(integrationBarrel.IntegrationStrategyResolver).toBeDefined();
    expect(integrationBarrel.MERGE_PROVIDER.toString()).toBe(
      "Symbol(MERGE_PROVIDER)",
    );
  });
});
```

**3.2 Run to fail.**

```bash
npm run test --workspace=apps/api -- integration-strategy.resolver
```

Expected: FAIL — `Cannot find module './index'` (barrel not created yet).

**3.3 Minimal implementation.**

Create `apps/api/src/common/git/integration/index.ts`:

```typescript
export * from "./merge-provider.interface";
export * from "./integration-strategy.resolver";
```

Modify `apps/api/src/common/git/index.ts` — add the line:

```typescript
export * from "./integration";
```

(Append after the existing `export * from './git-worktree.module';` line.)

**3.4 Run to pass.**

```bash
npm run test --workspace=apps/api -- integration-strategy.resolver
```

Expected: PASS (now 7 tests in the resolver spec).

Then confirm the API build still resolves the new barrel:

```bash
npm run build:api
```

Expected: build succeeds.

**3.5 Commit.**

```bash
git add apps/api/src/common/git/integration/index.ts apps/api/src/common/git/index.ts \
        apps/api/src/common/git/integration/integration-strategy.resolver.spec.ts
git commit -m "chore(api): export git integration module from common/git barrel (EPIC-209 P1)"
```

---

## Task 4 — `RepositoryIntegrationSettings` type + optional sub-object (kanban-contracts)

**Files**

- Modify: `packages/kanban-contracts/src/repository-workflow-settings.types.ts`
- Test: covered by Task 5's resolver spec (the type is exercised structurally there). No standalone
  type-only test file (a pure-type change has nothing to assert at runtime until the resolver consumes it).

**Interfaces**

- Produces (spec 10.3, verbatim shape):
  ```typescript
  export type RepositoryIntegrationStrategy = "direct-push" | "pull-request";
  export type RepositoryMergeMethod = "merge" | "squash" | "rebase";
  export interface RepositoryIntegrationSettings {
    strategy: RepositoryIntegrationStrategy;
    mergeMethod: RepositoryMergeMethod;
    autoMerge: boolean;
    preflightGate: boolean;
  }
  export interface RepositoryWorkflowSettings {
    enabled: boolean;
    overrides: Record<string, RepositoryWorkflowOverride>;
    integration?: RepositoryIntegrationSettings;
  }
  ```

> Boundary note: kanban-contracts cannot import the API-side `IntegrationStrategy` / `MergeMethod`
> unions (no dependency from packages → apps). The two string-literal unions are re-declared here with
> kanban-contracts-local names (`RepositoryIntegrationStrategy`, `RepositoryMergeMethod`). Task 5's
> spec pins the literal sets so they cannot diverge from spec 10.1 unnoticed.

### Steps

**4.1 Write the failing test** is deferred to Task 5 (resolver). This task is a pure type extension that
the Task 5 test imports; performing Red here would require a runtime assertion that does not yet have a
resolver to call. Implement the type change, then Task 5 drives Red→Green. (This keeps each test
runnable; the type change alone has no behaviour.)

**4.2 Minimal implementation.**

Replace the contents of `packages/kanban-contracts/src/repository-workflow-settings.types.ts`:

```typescript
export interface RepositoryWorkflowOverride {
  enabled: boolean;
}

/**
 * VCS-domain integration strategy. Re-declared kanban-contracts-locally (the
 * canonical API-side union lives in apps/api .../merge-provider.interface.ts;
 * packages must not depend on apps). The literal sets are pinned by the resolver
 * spec so the two declarations cannot silently diverge.
 */
export type RepositoryIntegrationStrategy = "direct-push" | "pull-request";
export type RepositoryMergeMethod = "merge" | "squash" | "rebase";

export interface RepositoryIntegrationSettings {
  strategy: RepositoryIntegrationStrategy; // default 'direct-push'
  mergeMethod: RepositoryMergeMethod; // default 'merge'
  autoMerge: boolean; // default false
  preflightGate: boolean; // default true
}

export interface RepositoryWorkflowSettings {
  enabled: boolean;
  overrides: Record<string, RepositoryWorkflowOverride>;
  integration?: RepositoryIntegrationSettings; // absent ⇒ direct-push defaults
}
```

**4.3 Build the package** (catches any consumer type breakage; build `core` first per convention).

```bash
npm run build --workspace=packages/core
npm run build --workspace=packages/kanban-contracts
```

Expected: both builds succeed.

**4.4 Commit.**

```bash
git add packages/kanban-contracts/src/repository-workflow-settings.types.ts
git commit -m "feat(kanban-contracts): add optional RepositoryIntegrationSettings sub-object (EPIC-209 P1)"
```

---

## Task 5 — `resolveRepositoryIntegrationSettings` helper (kanban-contracts)

**Files**

- Modify: `packages/kanban-contracts/src/repository-workflow-settings.ts`
- Test: `packages/kanban-contracts/src/repository-workflow-settings.spec.ts` (create if absent)

**Interfaces**

- Consumes: `RepositoryIntegrationSettings`, `RepositoryWorkflowSettings`,
  `RepositoryIntegrationStrategy`, `RepositoryMergeMethod` from `./repository-workflow-settings.types`.
- Produces (spec 10.3):
  ```typescript
  export function resolveRepositoryIntegrationSettings(
    settings:
      | RepositoryWorkflowSettings
      | Record<string, unknown>
      | null
      | undefined,
  ): Required<RepositoryIntegrationSettings>;
  ```
  And the existing `resolveRepositoryWorkflowSettings` now passes `integration` through when present.

### Steps

**5.1 Write the failing test.**

Create (or extend) `packages/kanban-contracts/src/repository-workflow-settings.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  resolveRepositoryIntegrationSettings,
  resolveRepositoryWorkflowSettings,
} from "./repository-workflow-settings";
import type {
  RepositoryIntegrationStrategy,
  RepositoryMergeMethod,
} from "./repository-workflow-settings.types";

describe("resolveRepositoryIntegrationSettings", () => {
  it("defaults to direct-push when absent", () => {
    expect(resolveRepositoryIntegrationSettings(null)).toEqual({
      strategy: "direct-push",
      mergeMethod: "merge",
      autoMerge: false,
      preflightGate: true,
    });
  });

  it("defaults when the integration sub-object is missing", () => {
    expect(
      resolveRepositoryIntegrationSettings({ enabled: true, overrides: {} }),
    ).toEqual({
      strategy: "direct-push",
      mergeMethod: "merge",
      autoMerge: false,
      preflightGate: true,
    });
  });

  it("passes through persisted values", () => {
    expect(
      resolveRepositoryIntegrationSettings({
        enabled: true,
        overrides: {},
        integration: {
          strategy: "pull-request",
          mergeMethod: "squash",
          autoMerge: true,
          preflightGate: false,
        },
      }),
    ).toEqual({
      strategy: "pull-request",
      mergeMethod: "squash",
      autoMerge: true,
      preflightGate: false,
    });
  });

  it("coerces malformed persisted values back to defaults without throwing", () => {
    expect(
      resolveRepositoryIntegrationSettings({
        enabled: true,
        overrides: {},
        integration: {
          strategy: "nonsense",
          mergeMethod: 7,
          autoMerge: "yes",
          preflightGate: null,
        } as unknown,
      } as Record<string, unknown>),
    ).toEqual({
      strategy: "direct-push",
      mergeMethod: "merge",
      autoMerge: false,
      preflightGate: true,
    });
  });

  it("pins the literal sets matching spec 10.1", () => {
    const strategies: RepositoryIntegrationStrategy[] = [
      "direct-push",
      "pull-request",
    ];
    const methods: RepositoryMergeMethod[] = ["merge", "squash", "rebase"];
    expect(strategies).toEqual(["direct-push", "pull-request"]);
    expect(methods).toEqual(["merge", "squash", "rebase"]);
  });

  it("resolveRepositoryWorkflowSettings forwards a persisted integration sub-object", () => {
    const resolved = resolveRepositoryWorkflowSettings({
      enabled: true,
      overrides: {},
      integration: {
        strategy: "pull-request",
        mergeMethod: "rebase",
        autoMerge: true,
        preflightGate: false,
      },
    });
    expect(resolved.integration).toEqual({
      strategy: "pull-request",
      mergeMethod: "rebase",
      autoMerge: true,
      preflightGate: false,
    });
  });

  it("resolveRepositoryWorkflowSettings omits integration when absent", () => {
    const resolved = resolveRepositoryWorkflowSettings({
      enabled: true,
      overrides: {},
    });
    expect(resolved.integration).toBeUndefined();
  });
});
```

**5.2 Run to fail.**

```bash
npm run build --workspace=packages/core
npm run test --workspace=packages/kanban-contracts -- repository-workflow-settings
```

Expected: FAIL — `resolveRepositoryIntegrationSettings is not a function` / import unresolved.

**5.3 Minimal implementation.**

Edit `packages/kanban-contracts/src/repository-workflow-settings.ts`. Update the import and the
`resolveRepositoryWorkflowSettings` return, then add the new helper:

```typescript
import type {
  RepositoryIntegrationSettings,
  RepositoryIntegrationStrategy,
  RepositoryMergeMethod,
  RepositoryWorkflowOverride,
  RepositoryWorkflowSettings,
} from "./repository-workflow-settings.types";

const DEFAULT_INTEGRATION: Required<RepositoryIntegrationSettings> = {
  strategy: "direct-push",
  mergeMethod: "merge",
  autoMerge: false,
  preflightGate: true,
};

const VALID_STRATEGIES: ReadonlySet<RepositoryIntegrationStrategy> = new Set([
  "direct-push",
  "pull-request",
]);
const VALID_MERGE_METHODS: ReadonlySet<RepositoryMergeMethod> = new Set([
  "merge",
  "squash",
  "rebase",
]);
```

Update `resolveRepositoryWorkflowSettings` to thread `integration` through (only when present so the
"omits integration when absent" test holds):

```typescript
export function resolveRepositoryWorkflowSettings(
  raw: Record<string, unknown> | null | undefined,
): RepositoryWorkflowSettings {
  if (!raw || typeof raw !== "object") {
    return { enabled: true, overrides: {} };
  }

  const base: RepositoryWorkflowSettings = {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    overrides: resolveOverridesMap(raw.overrides),
  };

  if ("integration" in raw && raw.integration != null) {
    base.integration = resolveRepositoryIntegrationSettings(raw);
  }

  return base;
}
```

Add the new helper at the end of the file:

```typescript
/**
 * Normalize a persisted (possibly absent or malformed) integration sub-object
 * into a fully-defaulted {@link RepositoryIntegrationSettings}. Defaults to the
 * direct-push strategy so an absent or unparseable value never changes merge
 * behaviour. Never throws.
 */
export function resolveRepositoryIntegrationSettings(
  settings: Record<string, unknown> | null | undefined,
): Required<RepositoryIntegrationSettings> {
  const raw =
    settings && typeof settings === "object"
      ? (settings.integration as Record<string, unknown> | undefined)
      : undefined;

  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_INTEGRATION };
  }

  return {
    strategy:
      typeof raw.strategy === "string" &&
      VALID_STRATEGIES.has(raw.strategy as RepositoryIntegrationStrategy)
        ? (raw.strategy as RepositoryIntegrationStrategy)
        : DEFAULT_INTEGRATION.strategy,
    mergeMethod:
      typeof raw.mergeMethod === "string" &&
      VALID_MERGE_METHODS.has(raw.mergeMethod as RepositoryMergeMethod)
        ? (raw.mergeMethod as RepositoryMergeMethod)
        : DEFAULT_INTEGRATION.mergeMethod,
    autoMerge:
      typeof raw.autoMerge === "boolean"
        ? raw.autoMerge
        : DEFAULT_INTEGRATION.autoMerge,
    preflightGate:
      typeof raw.preflightGate === "boolean"
        ? raw.preflightGate
        : DEFAULT_INTEGRATION.preflightGate,
  };
}
```

**5.4 Run to pass.**

```bash
npm run test --workspace=packages/kanban-contracts -- repository-workflow-settings
```

Expected: PASS (7 tests). Then rebuild so dependents see the new export:

```bash
npm run build --workspace=packages/kanban-contracts
```

**5.5 Commit.**

```bash
git add packages/kanban-contracts/src/repository-workflow-settings.ts \
        packages/kanban-contracts/src/repository-workflow-settings.spec.ts
git commit -m "feat(kanban-contracts): add resolveRepositoryIntegrationSettings helper (EPIC-209 P1)"
```

---

## Task 6 — Publisher forwards neutral integration keys onto the trigger payload (kanban-side)

**Files**

- Modify: `apps/kanban/src/work-item/kanban-lifecycle-event-publisher.ts`
- Test: `apps/kanban/src/work-item/kanban-lifecycle-event-publisher.spec.ts`

**Interfaces**

- Consumes: `Required<RepositoryIntegrationSettings>` (the resolved config).
- Produces: `emitStatusChanged` gains an optional `integration?: Required<RepositoryIntegrationSettings>`
  param; when present it adds the four flat neutral keys (spec 10.6) to the emitted payload:
  `integration_strategy`, `integration_merge_method`, `integration_auto_merge`,
  `integration_preflight_gate`.

> The four keys are flat and neutral (VCS-domain), satisfying the boundary. When `integration` is
> omitted the payload is byte-for-byte identical to today (no keys added) — preserving every existing
> publisher test.

### Steps

**6.1 Write the failing test.** Add to `kanban-lifecycle-event-publisher.spec.ts`:

```typescript
it("forwards resolved integration settings as flat neutral trigger keys", async () => {
  const coreClient = {
    emitDomainEvent: emitDomainEventMock,
  } as unknown as CoreWorkflowClientService;

  publisher = createPublisher(coreClient);

  await publisher.emitStatusChanged({
    projectId: "project-1",
    workItemId: "work-item-1",
    status: "ready-to-merge",
    previousStatus: "in-review",
    actor: "workflow",
    updatedAt: "2026-05-12T14:00:00.000Z",
    resource: createResource({ status: "ready-to-merge" }),
    integration: {
      strategy: "pull-request",
      mergeMethod: "squash",
      autoMerge: true,
      preflightGate: false,
    },
  });

  const payload = (
    emitDomainEventMock.mock.calls[0][0] as {
      payload: Record<string, unknown>;
    }
  ).payload;

  expect(payload.integration_strategy).toBe("pull-request");
  expect(payload.integration_merge_method).toBe("squash");
  expect(payload.integration_auto_merge).toBe(true);
  expect(payload.integration_preflight_gate).toBe(false);
});

it("omits integration keys when no integration settings supplied", async () => {
  const coreClient = {
    emitDomainEvent: emitDomainEventMock,
  } as unknown as CoreWorkflowClientService;

  publisher = createPublisher(coreClient);

  await publisher.emitStatusChanged({
    projectId: "project-1",
    workItemId: "work-item-1",
    status: "in-progress",
    previousStatus: "todo",
    actor: "workflow",
    updatedAt: "2026-05-12T14:00:00.000Z",
    resource: createResource(),
  });

  const payload = (
    emitDomainEventMock.mock.calls[0][0] as {
      payload: Record<string, unknown>;
    }
  ).payload;

  expect(payload).not.toHaveProperty("integration_strategy");
});
```

**6.2 Run to fail.**

```bash
npm run build --workspace=packages/core
npm run build --workspace=packages/kanban-contracts
npm run test --workspace=apps/kanban -- kanban-lifecycle-event-publisher
```

Expected: FAIL — TS error on the unknown `integration` property, or the assertion
`expected undefined to be "pull-request"`.

**6.3 Minimal implementation.** In `kanban-lifecycle-event-publisher.ts`:

Add the import:

```typescript
import type { RepositoryIntegrationSettings } from "@nexus/kanban-contracts";
```

Extend the `emitStatusChanged` param object with an optional field:

```typescript
  async emitStatusChanged(params: {
    projectId: string;
    workItemId: string;
    status: string;
    previousStatus: string | null;
    actor: string;
    updatedAt: string;
    resource: WorkItemRecord;
    integration?: Required<RepositoryIntegrationSettings>;
  }): Promise<void> {
```

Inside the method, after the existing `const payload = { ... };` block, spread the flat keys in
conditionally. Replace the payload construction:

```typescript
const eventId = this.buildEventId(params);
const payload = {
  event: STATUS_CHANGED_EVENT_NAME,
  scopeId: params.projectId,
  contextId: params.workItemId,
  workItemId: params.workItemId,
  status: params.status,
  previousStatus: params.previousStatus,
  actor: params.actor,
  resource: params.resource,
  ...(params.integration
    ? {
        integration_strategy: params.integration.strategy,
        integration_merge_method: params.integration.mergeMethod,
        integration_auto_merge: params.integration.autoMerge,
        integration_preflight_gate: params.integration.preflightGate,
      }
    : {}),
};
```

**6.4 Run to pass.**

```bash
npm run test --workspace=apps/kanban -- kanban-lifecycle-event-publisher
```

Expected: PASS (all existing tests + 2 new).

**6.5 Commit.**

```bash
git add apps/kanban/src/work-item/kanban-lifecycle-event-publisher.ts \
        apps/kanban/src/work-item/kanban-lifecycle-event-publisher.spec.ts
git commit -m "feat(kanban): forward integration settings as flat neutral trigger keys (EPIC-209 P1)"
```

---

## Task 7 — Transition helper resolves and passes integration settings (kanban-side)

**Files**

- Modify: `apps/kanban/src/work-item/work-item-transition.helper.ts`
- Test: `apps/kanban/src/work-item/work-item-transition.helper.spec.ts` (create if absent)

**Interfaces**

- Consumes: `resolveRepositoryIntegrationSettings` from `@nexus/kanban-contracts`; the project record's
  `repository_workflow_settings`.
- Produces: `transitionWorkItemStatus` passes `integration` into the `emitStatusChanged` call.

> `transitionWorkItemStatus` receives `deps.projects` (`KanbanProjectRepository`). It loads the project,
> resolves the integration settings, and forwards them. The settings are resolved once and passed; when
> the project has no persisted integration sub-object the resolver returns direct-push defaults, so the
> ready-to-merge trigger always carries an explicit, defaulted strategy.

### Steps

**7.1 Write the failing test.**

Create `apps/kanban/src/work-item/work-item-transition.helper.spec.ts` (mirror the dependency-mocking
style already used in `work-item.service.status.spec.ts`):

```typescript
import { describe, expect, it, vi } from "vitest";
import { transitionWorkItemStatus } from "./work-item-transition.helper";
import type { TransitionStatusDeps } from "./work-item-transition.types";

function buildItem() {
  return {
    id: "work-item-1",
    project_id: "project-1",
    title: "Ship feature",
    status: "in-review",
    priority: "medium",
    scope: "standard",
    metadata: null,
    execution_config: {},
    created_at: new Date("2026-05-12T13:00:00.000Z"),
    updated_at: new Date("2026-05-12T14:00:00.000Z"),
  };
}

describe("transitionWorkItemStatus integration forwarding", () => {
  it("forwards resolved integration settings into emitStatusChanged", async () => {
    const item = buildItem();
    const emitStatusChanged = vi.fn().mockResolvedValue(undefined);

    const deps = {
      workItems: {
        // requireWorkItem + save + dependency lookups
        findByProjectAndId: vi.fn().mockResolvedValue(item),
        save: vi.fn().mockResolvedValue({ ...item, status: "ready-to-merge" }),
        listDependencyIds: vi.fn().mockResolvedValue([]),
      },
      projects: {
        findById: vi.fn().mockResolvedValue({
          id: "project-1",
          repository_workflow_settings: {
            enabled: true,
            overrides: {},
            integration: {
              strategy: "pull-request",
              mergeMethod: "merge",
              autoMerge: false,
              preflightGate: true,
            },
          },
        }),
      },
      coreClient: {
        executeLifecycleWorkflows: vi.fn().mockResolvedValue({ results: [] }),
      },
      lifecycleEventPublisher: { emitStatusChanged },
      realtimeGateway: { broadcastWorkItemUpdated: vi.fn() },
      realtimePublisher: { publish: vi.fn().mockResolvedValue(undefined) },
    } as unknown as TransitionStatusDeps;

    await transitionWorkItemStatus(deps, {
      project_id: "project-1",
      workItemId: "work-item-1",
      status: "ready-to-merge",
      actor: "system",
    });

    expect(emitStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        integration: {
          strategy: "pull-request",
          mergeMethod: "merge",
          autoMerge: false,
          preflightGate: true,
        },
      }),
    );
  });
});
```

> Adjust the mocked repository method names (`findByProjectAndId`, `save`, `listDependencyIds`) to match
> the real `requireWorkItem` / `getDependencyIds` helper calls — confirm against
> `work-item-run.helpers.ts` before running, and align the mock to whatever those helpers invoke. The
> assertion target (`integration` forwarded) is the invariant; the mock plumbing is incidental.

**7.2 Run to fail.**

```bash
npm run test --workspace=apps/kanban -- work-item-transition.helper
```

Expected: FAIL — `emitStatusChanged` called without an `integration` property
(`objectContaining` mismatch).

**7.3 Minimal implementation.** In `work-item-transition.helper.ts`:

Add the import:

```typescript
import { resolveRepositoryIntegrationSettings } from "@nexus/kanban-contracts";
```

Before the `emitStatusChanged` call, load the project and resolve settings:

```typescript
const project = await projects.findById(project_id);
const integration = resolveRepositoryIntegrationSettings(
  project?.repository_workflow_settings,
);

await deps.lifecycleEventPublisher
  .emitStatusChanged({
    projectId: project_id,
    workItemId,
    status,
    previousStatus,
    actor: params.actor,
    updatedAt: updated.updated_at.toISOString(),
    resource,
    integration,
  })
  .catch(ignoreFailVisibleLifecycleEventDeliveryError);
```

(`projects` is already destructured from `deps` at the top of the function.)

**7.4 Run to pass.**

```bash
npm run test --workspace=apps/kanban -- work-item-transition.helper
```

Expected: PASS.

Then run the broader transition/service suites to confirm no regression in existing publisher-call
expectations:

```bash
npm run test --workspace=apps/kanban -- work-item.service
```

Expected: PASS (existing assertions that use `objectContaining` / specific keys still hold; the new
`integration` key is additive).

**7.5 Commit.**

```bash
git add apps/kanban/src/work-item/work-item-transition.helper.ts \
        apps/kanban/src/work-item/work-item-transition.helper.spec.ts
git commit -m "feat(kanban): resolve and forward integration settings on status transition (EPIC-209 P1)"
```

---

## Task 8 — Full-suite verification + boundary lint

**Files:** none (verification only).

### Steps

**8.1 Rebuild the dependency chain.**

```bash
npm run build --workspace=packages/core
npm run build --workspace=packages/kanban-contracts
npm run build:api
npm run build:kanban
```

Expected: all succeed.

**8.2 Run the affected unit suites.**

```bash
npm run test --workspace=packages/kanban-contracts
npm run test --workspace=apps/api -- integration
npm run test --workspace=apps/kanban -- work-item
```

Expected: all PASS.

**8.3 Lint — confirm no boundary residue and no suppressions.**

```bash
npm run lint:api
npm run lint:kanban
```

Expected: PASS with **no** `nexus-boundaries/no-core-kanban-residue` violations (the API-side
`integration/` files use only neutral `scopeId`/`contextId` and VCS-domain terms; no `kanban` /
work-item / project-domain identifiers). No `eslint-disable` / `@ts-ignore` introduced.

**8.4 Final commit** (only if lint produced auto-fixes; otherwise skip).

```bash
git add -A
git commit -m "chore(epic-209): phase 1 lint clean-up"
```

---

## Phase boundary — what Phase 2 consumes from Phase 1

Phase 2 (`GitHubMergeProvider` adapter + `github_secret_id` credential resolution + provider factory)
builds directly on these Phase 1 artifacts:

- **`MergeProvider` interface + `MERGE_PROVIDER` token** (`apps/api/.../merge-provider.interface.ts`) —
  Phase 2 implements `GitHubMergeProvider implements MergeProvider` and binds it to the token; it does
  not redefine any signature in Section 10.1.
- **`IntegrationStrategyResolver`** — Phase 3's `merge_integrate` strategy branch calls
  `resolver.resolve(stepInputs)` to decide `direct-push` vs `pull-request`. Phase 1 guarantees it never
  throws and always returns a defaulted config.
- **`RepositoryIntegrationSettings` + `resolveRepositoryIntegrationSettings`** — the kanban-side config
  storage surface that Phase 5 (`auto_merge` / `merge_method` tuning + CEO stalled-PR awareness) reads
  and that the web settings UI will edit.
- **The four neutral trigger keys** (`integration_strategy`, `integration_merge_method`,
  `integration_auto_merge`, `integration_preflight_gate`) are already on the `ready-to-merge` trigger
  payload, so Phase 3's workflow DAG branch can read them via the resolver without any new kanban→API
  plumbing.

Nothing in Phase 1 branches on the strategy; `direct-push` is byte-for-byte unchanged. Phase 3 is the
first phase that introduces an observable behaviour difference (the `pull-request` DAG branch).
