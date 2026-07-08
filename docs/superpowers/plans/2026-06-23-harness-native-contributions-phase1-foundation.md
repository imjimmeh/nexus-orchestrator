# Harness-Native Contributions — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the harness-neutral contribution model's foundation — canonical contracts, capability flags, the materializer SPI + capability-gated dispatch, kernel wiring, and the API resolver — with zero behavior change until an authoring surface (Phase 4) populates contributions.

**Architecture:** Author-facing contribution types live in `@nexus/core`. Each engine optionally implements three per-feature materializer interfaces from `@nexus/harness-runtime`, gated by new `HarnessCapabilities` flags. A resolver in `apps/api` merges contributions by precedence and validates them against the resolved harness's capabilities, attaching the result to `HarnessRuntimeConfig.contributions`. The kernel hands the bundle to the engine via `HarnessSessionContext` and invokes the admitted materializers.

**Tech Stack:** TypeScript (strict), Zod, Vitest. Monorepo workspaces: `packages/core`, `packages/harness-runtime`, `apps/api`.

**Spec:** `docs/superpowers/specs/2026-06-23-harness-native-contributions-design.md` · **Epic:** `docs/epics/EPIC-210-harness-native-contributions.md`

## Global Constraints

- Build `packages/core` before consumers: `npm run build --workspace=packages/core`.
- Strict lint policy: never use `eslint-disable`, `@ts-ignore`, `@ts-nocheck`. Fix in code.
- New capability fields are **optional** (`?:`) so existing `harness_definition` rows and custom harnesses stay valid; absent means `false` / `[]`.
- Phase 1 is behavior-preserving: with no authoring surface yet, every run ships `EMPTY_HARNESS_CONTRIBUTIONS` and all materializers no-op.
- Engines contain native-format knowledge; `apps/api` only ever handles the neutral `HarnessContributions` bundle.
- Each `*.types.ts` is re-exported through its barrel (`interfaces/index.ts`, `engine/*.ts`); each schema through `schemas/ai-config/index.ts`.
- Test commands: `npm run test --workspace=packages/core -- <pattern>`, `npm run test --workspace=packages/harness-runtime -- <pattern>`, `npm run test:api -- <pattern>` (Vitest filter by filename substring).

---

### Task 1: Canonical contribution contracts (`@nexus/core`)

**Files:**

- Create: `packages/core/src/interfaces/harness-contributions.types.ts`
- Create: `packages/core/src/schemas/ai-config/harness-contributions.schema.ts`
- Create (test): `packages/core/src/schemas/ai-config/harness-contributions.schema.spec.ts`
- Modify: `packages/core/src/interfaces/index.ts` (barrel export)
- Modify: `packages/core/src/schemas/ai-config/index.ts` (barrel export)

**Interfaces:**

- Produces: `HarnessHookEvent`, `HarnessHookContribution`, `HarnessExtensionContribution`, `HarnessExtensionTransport`, `HarnessSettingsContribution`, `HarnessContributions`, `EMPTY_HARNESS_CONTRIBUTIONS` (from the `.types.ts`); `HarnessContributionsSchema`, `HarnessHookContributionSchema`, `HarnessExtensionContributionSchema`, `HarnessSettingsContributionSchema` (from the `.schema.ts`).

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/schemas/ai-config/harness-contributions.schema.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  HarnessContributionsSchema,
  HarnessHookContributionSchema,
} from "./harness-contributions.schema";
import { EMPTY_HARNESS_CONTRIBUTIONS } from "../../interfaces/harness-contributions.types";

describe("HarnessContributionsSchema", () => {
  it("accepts the empty bundle", () => {
    expect(() =>
      HarnessContributionsSchema.parse(EMPTY_HARNESS_CONTRIBUTIONS),
    ).not.toThrow();
  });

  it("accepts a full valid bundle", () => {
    const bundle = {
      hooks: [
        {
          event: "pre_tool_use",
          matcher: "bash",
          command: "echo hi",
          timeoutMs: 5000,
        },
      ],
      extensions: [
        {
          name: "fs",
          transport: "stdio",
          command: "mcp-fs",
          args: ["--root", "/w"],
        },
        { name: "remote", transport: "http", url: "https://example/mcp" },
      ],
      settings: {
        env: { FOO: "bar" },
        permissions: { allow: ["Read"] },
        outputStyle: "concise",
      },
    };
    expect(() => HarnessContributionsSchema.parse(bundle)).not.toThrow();
  });

  it("rejects an unknown hook event", () => {
    expect(() =>
      HarnessHookContributionSchema.parse({ event: "nope", command: "x" }),
    ).toThrow();
  });

  it("rejects an extension with an unknown transport", () => {
    expect(() =>
      HarnessContributionsSchema.parse({
        hooks: [],
        extensions: [{ name: "x", transport: "carrier-pigeon" }],
        settings: {},
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- harness-contributions`
Expected: FAIL — cannot resolve `./harness-contributions.schema` / `harness-contributions.types`.

- [ ] **Step 3: Write the types**

Create `packages/core/src/interfaces/harness-contributions.types.ts`:

```ts
/** Neutral lifecycle events; mapped to each harness's native event names. */
export type HarnessHookEvent =
  | "session_start"
  | "session_end"
  | "pre_tool_use"
  | "post_tool_use"
  | "user_prompt_submit";

export interface HarnessHookContribution {
  event: HarnessHookEvent;
  /** Optional tool-name / glob matcher (e.g. pre_tool_use on "bash"). */
  matcher?: string;
  /** Shell command the native harness runs when the event fires. */
  command: string;
  /** Hard ceiling in ms; engines clamp to their own max. */
  timeoutMs?: number;
}

export type HarnessExtensionTransport = "stdio" | "http";

/** An MCP server the harness should register for the session. */
export interface HarnessExtensionContribution {
  name: string;
  transport: HarnessExtensionTransport;
  command?: string;
  args?: string[];
  url?: string;
  /** Env for a stdio server; values may be secret_store refs. */
  env?: Record<string, string>;
  /** Headers for an http server; values may be secret_store refs. */
  headers?: Record<string, string>;
}

/** Allowlisted settings only — NOT an arbitrary passthrough. */
export interface HarnessSettingsContribution {
  env?: Record<string, string>;
  permissions?: { allow?: string[]; deny?: string[] };
  outputStyle?: string;
}

/** The resolved, capability-validated bundle handed to the kernel. */
export interface HarnessContributions {
  hooks: HarnessHookContribution[];
  extensions: HarnessExtensionContribution[];
  settings: HarnessSettingsContribution;
}

export const EMPTY_HARNESS_CONTRIBUTIONS: HarnessContributions = {
  hooks: [],
  extensions: [],
  settings: {},
};
```

Create `packages/core/src/schemas/ai-config/harness-contributions.schema.ts`:

```ts
import { z } from "zod";

export const HarnessHookEventSchema = z.enum([
  "session_start",
  "session_end",
  "pre_tool_use",
  "post_tool_use",
  "user_prompt_submit",
]);

export const HarnessHookContributionSchema = z.object({
  event: HarnessHookEventSchema,
  matcher: z.string().min(1).max(256).optional(),
  command: z.string().min(1).max(4096),
  timeoutMs: z.number().int().positive().max(600000).optional(),
});

export const HarnessExtensionContributionSchema = z.object({
  name: z.string().min(1).max(128),
  transport: z.enum(["stdio", "http"]),
  command: z.string().min(1).max(1024).optional(),
  args: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  env: z.record(z.string(), z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export const HarnessSettingsContributionSchema = z.object({
  env: z.record(z.string(), z.string()).optional(),
  permissions: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
    })
    .optional(),
  outputStyle: z.string().min(1).max(128).optional(),
});

export const HarnessContributionsSchema = z.object({
  hooks: z.array(HarnessHookContributionSchema),
  extensions: z.array(HarnessExtensionContributionSchema),
  settings: HarnessSettingsContributionSchema,
});
```

- [ ] **Step 4: Wire the barrels**

In `packages/core/src/interfaces/index.ts`, add after the harness runtime config exports (around line 73):

```ts
// harness contributions
export type {
  HarnessHookEvent,
  HarnessHookContribution,
  HarnessExtensionTransport,
  HarnessExtensionContribution,
  HarnessSettingsContribution,
  HarnessContributions,
} from "./harness-contributions.types";
export { EMPTY_HARNESS_CONTRIBUTIONS } from "./harness-contributions.types";
```

In `packages/core/src/schemas/ai-config/index.ts`, add:

```ts
export * from "./harness-contributions.schema";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- harness-contributions`
Expected: PASS (4 tests).

- [ ] **Step 6: Build core**

Run: `npm run build --workspace=packages/core`
Expected: builds clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/interfaces/harness-contributions.types.ts \
        packages/core/src/schemas/ai-config/harness-contributions.schema.ts \
        packages/core/src/schemas/ai-config/harness-contributions.schema.spec.ts \
        packages/core/src/interfaces/index.ts \
        packages/core/src/schemas/ai-config/index.ts
git commit -m "feat(core): add harness contribution canonical contracts + zod schema"
```

---

### Task 2: Capability flags + honest built-in values (`@nexus/core`)

**Files:**

- Modify: `packages/core/src/interfaces/harness.types.ts:17-43`
- Modify: `packages/core/src/interfaces/harness-capabilities.ts`
- Modify (test): `packages/core/src/interfaces/harness-capabilities.spec.ts`

**Interfaces:**

- Consumes: `HarnessHookEvent` (Task 1).
- Produces: `HarnessCapabilities.supportsHooks?`, `.supportsExtensions?`, `.supportsSettings?`, `.supportedHookEvents?`; updated `CLAUDE_CODE_CAPABILITIES` (all three true) and `PI_CAPABILITIES` (all three false pending Phase 2 spike).

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/interfaces/harness-capabilities.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  PI_CAPABILITIES,
  CLAUDE_CODE_CAPABILITIES,
} from "./harness-capabilities";

describe("contribution capability flags", () => {
  it("claude-code supports all three contribution types", () => {
    expect(CLAUDE_CODE_CAPABILITIES.supportsHooks).toBe(true);
    expect(CLAUDE_CODE_CAPABILITIES.supportsExtensions).toBe(true);
    expect(CLAUDE_CODE_CAPABILITIES.supportsSettings).toBe(true);
    expect(CLAUDE_CODE_CAPABILITIES.supportedHookEvents).toContain(
      "pre_tool_use",
    );
  });

  it("pi declares no native contribution support until the Phase 2 spike", () => {
    expect(PI_CAPABILITIES.supportsHooks ?? false).toBe(false);
    expect(PI_CAPABILITIES.supportsExtensions ?? false).toBe(false);
    expect(PI_CAPABILITIES.supportsSettings ?? false).toBe(false);
  });
});
```

(If a `describe`-less file, keep imports de-duplicated with any existing imports.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- harness-capabilities`
Expected: FAIL — `supportsHooks` is `undefined`, not `true`.

- [ ] **Step 3: Add the optional fields to the interface**

In `packages/core/src/interfaces/harness.types.ts`, inside `HarnessCapabilities` (after `skillsContainerPath?`):

```ts
  /** Whether the harness natively runs lifecycle hooks. */
  supportsHooks?: boolean;
  /** Whether the harness can register MCP-server extensions. */
  supportsExtensions?: boolean;
  /** Whether the harness accepts a native settings bag. */
  supportsSettings?: boolean;
  /** Hook events this harness can natively fire. */
  supportedHookEvents?: HarnessHookEvent[];
```

Add the import at the top of `harness.types.ts`:

```ts
import type { HarnessHookEvent } from "./harness-contributions.types";
```

- [ ] **Step 4: Set honest values on the built-ins**

In `packages/core/src/interfaces/harness-capabilities.ts`, add to `CLAUDE_CODE_CAPABILITIES` (before `compatibleProviderIds`):

```ts
  supportsHooks: true,
  supportsExtensions: true,
  supportsSettings: true,
  supportedHookEvents: [
    "session_start",
    "session_end",
    "pre_tool_use",
    "post_tool_use",
    "user_prompt_submit",
  ],
```

Add to `PI_CAPABILITIES` (before `skillsContainerPath`):

```ts
  // PI native contribution support is unproven; flags stay false until the
  // Phase 2 spike maps PI's config/lifecycle surface. The resolver therefore
  // drops contributions for PI with diagnostics rather than emulating silently.
  supportsHooks: false,
  supportsExtensions: false,
  supportsSettings: false,
  supportedHookEvents: [],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- harness-capabilities`
Expected: PASS.

- [ ] **Step 6: Build core**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/interfaces/harness.types.ts \
        packages/core/src/interfaces/harness-capabilities.ts \
        packages/core/src/interfaces/harness-capabilities.spec.ts
git commit -m "feat(core): declare harness contribution capability flags"
```

---

### Task 3: `contributions` on `HarnessRuntimeConfig` (`@nexus/core`)

**Files:**

- Modify: `packages/core/src/interfaces/harness-runtime-config.types.ts:36-43`
- Modify (test): `packages/core/src/interfaces/harness.types.spec.ts` (or a new `harness-runtime-config.types.spec.ts`)

**Interfaces:**

- Consumes: `HarnessContributions` (Task 1).
- Produces: `HarnessRuntimeConfig.contributions?: HarnessContributions`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/interfaces/harness-runtime-config.types.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HarnessRuntimeConfig } from "./harness-runtime-config.types";
import { EMPTY_HARNESS_CONTRIBUTIONS } from "./harness-contributions.types";

describe("HarnessRuntimeConfig.contributions", () => {
  it("accepts a contributions bundle", () => {
    const cfg: HarnessRuntimeConfig = {
      harnessId: "pi",
      model: {
        provider: "p",
        model: "m",
        auth: { type: "api_key", apiKey: "k" } as never,
      },
      prompt: { systemPrompt: "s" },
      contributions: EMPTY_HARNESS_CONTRIBUTIONS,
    };
    expect(cfg.contributions).toEqual(EMPTY_HARNESS_CONTRIBUTIONS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- harness-runtime-config`
Expected: FAIL — `contributions` is not a known property (TS2353).

- [ ] **Step 3: Add the field**

In `packages/core/src/interfaces/harness-runtime-config.types.ts`, add the import and field:

```ts
import type { HarnessContributions } from "./harness-contributions.types";
```

Inside `HarnessRuntimeConfig` (after `harnessOptions?`):

```ts
  /** Resolved, capability-validated author contributions for this session. */
  contributions?: HarnessContributions;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- harness-runtime-config`
Expected: PASS.

- [ ] **Step 5: Build core**

Run: `npm run build --workspace=packages/core`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/interfaces/harness-runtime-config.types.ts \
        packages/core/src/interfaces/harness-runtime-config.types.spec.ts
git commit -m "feat(core): carry contributions on HarnessRuntimeConfig"
```

---

### Task 4: Materializer SPI + type guards (`@nexus/harness-runtime`)

**Files:**

- Create: `packages/harness-runtime/src/engine/contribution-materializers.ts`
- Create (test): `packages/harness-runtime/test/engine/contribution-materializers.test.ts`
- Modify: `packages/harness-runtime/src/index.ts` (export SPI)

**Interfaces:**

- Consumes: `HarnessHookContribution`, `HarnessExtensionContribution`, `HarnessSettingsContribution` (Task 1); `HarnessSessionContext` (existing).
- Produces: `HookMaterializer`, `ExtensionMaterializer`, `SettingsMaterializer`, `isHookMaterializer`, `isExtensionMaterializer`, `isSettingsMaterializer`.

- [ ] **Step 1: Write the failing test**

Create `packages/harness-runtime/test/engine/contribution-materializers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isHookMaterializer,
  isExtensionMaterializer,
  isSettingsMaterializer,
  type HookMaterializer,
} from "../../src/engine/contribution-materializers.js";

describe("materializer type guards", () => {
  it("detects a hook materializer", () => {
    const e: HookMaterializer = { async materializeHooks() {} };
    expect(isHookMaterializer(e)).toBe(true);
    expect(isExtensionMaterializer(e)).toBe(false);
    expect(isSettingsMaterializer(e)).toBe(false);
  });

  it("returns false for a plain object", () => {
    expect(isHookMaterializer({})).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/harness-runtime -- contribution-materializers`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the SPI**

Create `packages/harness-runtime/src/engine/contribution-materializers.ts`:

```ts
import type {
  HarnessHookContribution,
  HarnessExtensionContribution,
  HarnessSettingsContribution,
} from "@nexus/core";
import type { HarnessSessionContext } from "./session-context.js";

export interface HookMaterializer {
  materializeHooks(
    hooks: HarnessHookContribution[],
    ctx: HarnessSessionContext,
  ): Promise<void>;
}

export interface ExtensionMaterializer {
  materializeExtensions(
    extensions: HarnessExtensionContribution[],
    ctx: HarnessSessionContext,
  ): Promise<void>;
}

export interface SettingsMaterializer {
  materializeSettings(
    settings: HarnessSettingsContribution,
    ctx: HarnessSessionContext,
  ): Promise<void>;
}

export function isHookMaterializer(e: object): e is HookMaterializer {
  return (
    typeof (e as Partial<HookMaterializer>).materializeHooks === "function"
  );
}

export function isExtensionMaterializer(e: object): e is ExtensionMaterializer {
  return (
    typeof (e as Partial<ExtensionMaterializer>).materializeExtensions ===
    "function"
  );
}

export function isSettingsMaterializer(e: object): e is SettingsMaterializer {
  return (
    typeof (e as Partial<SettingsMaterializer>).materializeSettings ===
    "function"
  );
}
```

- [ ] **Step 4: Export from the package barrel**

In `packages/harness-runtime/src/index.ts`, add after the `HarnessSessionContext` type exports (around line 14):

```ts
export type {
  HookMaterializer,
  ExtensionMaterializer,
  SettingsMaterializer,
} from "./engine/contribution-materializers.js";
export {
  isHookMaterializer,
  isExtensionMaterializer,
  isSettingsMaterializer,
} from "./engine/contribution-materializers.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=packages/harness-runtime -- contribution-materializers`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/harness-runtime/src/engine/contribution-materializers.ts \
        packages/harness-runtime/test/engine/contribution-materializers.test.ts \
        packages/harness-runtime/src/index.ts
git commit -m "feat(harness-runtime): add contribution materializer SPI + guards"
```

---

### Task 5: `contributions` on `HarnessSessionContext` (`@nexus/harness-runtime`)

**Files:**

- Modify: `packages/harness-runtime/src/engine/session-context.types.ts:49-60`
- Modify (test): existing `spi-contract.test.ts` is updated in Task 6; here just compile-check via a focused test.
- Create (test): `packages/harness-runtime/test/engine/session-context-contributions.test.ts`

**Interfaces:**

- Consumes: `HarnessContributions` (Task 1).
- Produces: `HarnessSessionContext.contributions: HarnessContributions`.

- [ ] **Step 1: Write the failing test**

Create `packages/harness-runtime/test/engine/session-context-contributions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { HarnessSessionContext } from "../../src/engine/session-context.js";
import { EMPTY_HARNESS_CONTRIBUTIONS } from "@nexus/core";

describe("HarnessSessionContext.contributions", () => {
  it("carries the contributions bundle", () => {
    const ctx = {
      governedTools: [],
      toolCatalog: [],
      checkPermission: async () => ({ status: "allowed" as const }),
      workspacePath: "/w",
      agentDir: "/a",
      extensionsPath: "/e",
      sessionPath: "/s",
      contributions: EMPTY_HARNESS_CONTRIBUTIONS,
    } satisfies HarnessSessionContext;
    expect(ctx.contributions.hooks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/harness-runtime -- session-context-contributions`
Expected: FAIL — `contributions` missing from `HarnessSessionContext` (TS2353 on `satisfies`).

- [ ] **Step 3: Add the field**

In `packages/harness-runtime/src/engine/session-context.types.ts`, add the import at the top:

```ts
import type { HarnessContributions } from "@nexus/core";
```

Add to `HarnessSessionContext` (after `sessionPath: string;`):

```ts
/** Resolved author contributions for this session (empty when none). */
contributions: HarnessContributions;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/harness-runtime -- session-context-contributions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/harness-runtime/src/engine/session-context.types.ts \
        packages/harness-runtime/test/engine/session-context-contributions.test.ts
git commit -m "feat(harness-runtime): expose contributions on HarnessSessionContext"
```

---

### Task 6: `applyContributions` dispatch + SPI conformance (`@nexus/harness-runtime`)

**Files:**

- Create: `packages/harness-runtime/src/engine/apply-contributions.ts`
- Create (test): `packages/harness-runtime/test/engine/apply-contributions.test.ts`
- Modify: `packages/harness-runtime/src/index.ts` (export `applyContributions`)
- Modify (test): `packages/harness-runtime/test/engine/spi-contract.test.ts`

**Interfaces:**

- Consumes: `HarnessEngine` (existing), `HarnessSessionContext.contributions` (Task 5), the three type guards (Task 4), capability flags (Task 2).
- Produces: `applyContributions(engine: HarnessEngine, ctx: HarnessSessionContext): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `packages/harness-runtime/test/engine/apply-contributions.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { applyContributions } from "../../src/engine/apply-contributions.js";
import type { HarnessEngine } from "../../src/engine/harness-engine.js";
import type { HarnessSessionContext } from "../../src/engine/session-context.js";
import type { HarnessCapabilities } from "@nexus/core";

const baseCtx = (
  overrides: Partial<HarnessSessionContext> = {},
): HarnessSessionContext => ({
  governedTools: [],
  toolCatalog: [],
  checkPermission: async () => ({ status: "allowed" }),
  workspacePath: "/w",
  agentDir: "/a",
  extensionsPath: "/e",
  sessionPath: "/s",
  contributions: { hooks: [], extensions: [], settings: {} },
  ...overrides,
});

const caps = (o: Partial<HarnessCapabilities>): HarnessCapabilities =>
  ({
    executionModes: ["agent_turn"],
    toolModel: "execute_wrapped",
    supportsSubagents: false,
    supportsWarRoom: false,
    supportsBranching: false,
    supportsResume: false,
    resumeMechanism: "file_injection",
    supportsThinkingLevels: false,
    supportedAuthTypes: ["api_key"],
    telemetryContractVersion: "v1",
    ...o,
  }) as HarnessCapabilities;

describe("applyContributions", () => {
  it("calls materializeHooks when supported, implemented, and hooks present", async () => {
    const materializeHooks = vi.fn(async () => {});
    const engine = {
      id: "pi",
      capabilities: caps({
        supportsHooks: true,
        supportedHookEvents: ["session_start"],
      }),
      validate: () => ({ ok: true }),
      createSession: async () => ({}) as never,
      materializeHooks,
    } as unknown as HarnessEngine;
    const ctx = baseCtx({
      contributions: {
        hooks: [{ event: "session_start", command: "echo hi" }],
        extensions: [],
        settings: {},
      },
    });
    await applyContributions(engine, ctx);
    expect(materializeHooks).toHaveBeenCalledOnce();
  });

  it("no-ops when the capability flag is false even if implemented", async () => {
    const materializeHooks = vi.fn(async () => {});
    const engine = {
      id: "pi",
      capabilities: caps({ supportsHooks: false }),
      validate: () => ({ ok: true }),
      createSession: async () => ({}) as never,
      materializeHooks,
    } as unknown as HarnessEngine;
    const ctx = baseCtx({
      contributions: {
        hooks: [{ event: "session_start", command: "echo hi" }],
        extensions: [],
        settings: {},
      },
    });
    await applyContributions(engine, ctx);
    expect(materializeHooks).not.toHaveBeenCalled();
  });

  it("no-ops when no contributions are present", async () => {
    const materializeSettings = vi.fn(async () => {});
    const engine = {
      id: "claude-code",
      capabilities: caps({ supportsSettings: true }),
      validate: () => ({ ok: true }),
      createSession: async () => ({}) as never,
      materializeSettings,
    } as unknown as HarnessEngine;
    await applyContributions(engine, baseCtx());
    expect(materializeSettings).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/harness-runtime -- apply-contributions`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dispatcher**

Create `packages/harness-runtime/src/engine/apply-contributions.ts`:

```ts
import type { HarnessSettingsContribution } from "@nexus/core";
import type { HarnessEngine } from "./harness-engine.js";
import type { HarnessSessionContext } from "./session-context.js";
import {
  isHookMaterializer,
  isExtensionMaterializer,
  isSettingsMaterializer,
} from "./contribution-materializers.js";

function hasSettings(s: HarnessSettingsContribution): boolean {
  return (
    (s.env !== undefined && Object.keys(s.env).length > 0) ||
    s.permissions !== undefined ||
    s.outputStyle !== undefined
  );
}

/**
 * Materialize the session's contributions through whichever engine materializers
 * the engine implements AND its capabilities admit. A capability/implementation
 * mismatch is a no-op, never a crash. Runs once at kernel bootstrap, before the
 * first prompt.
 */
export async function applyContributions(
  engine: HarnessEngine,
  ctx: HarnessSessionContext,
): Promise<void> {
  const caps = engine.capabilities;
  const c = ctx.contributions;

  if (caps.supportsHooks && c.hooks.length > 0 && isHookMaterializer(engine)) {
    await engine.materializeHooks(c.hooks, ctx);
  }
  if (
    caps.supportsExtensions &&
    c.extensions.length > 0 &&
    isExtensionMaterializer(engine)
  ) {
    await engine.materializeExtensions(c.extensions, ctx);
  }
  if (
    caps.supportsSettings &&
    hasSettings(c.settings) &&
    isSettingsMaterializer(engine)
  ) {
    await engine.materializeSettings(c.settings, ctx);
  }
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/harness-runtime/src/index.ts`, add:

```ts
export { applyContributions } from "./engine/apply-contributions.js";
```

- [ ] **Step 5: Extend the SPI conformance test**

Append to `packages/harness-runtime/test/engine/spi-contract.test.ts`:

```ts
import {
  isHookMaterializer,
  isExtensionMaterializer,
  isSettingsMaterializer,
} from "../../src/engine/contribution-materializers.js";
import { CLAUDE_CODE_CAPABILITIES } from "@nexus/core";

describe("contribution SPI conformance", () => {
  // A real engine is loaded by its package; here we assert the contract rule:
  // if an engine declares a supports* flag, it MUST implement the matching
  // materializer. This guards against capability/implementation drift.
  it("a declared capability requires the matching materializer (rule shape)", () => {
    const engineDeclaringHooks = {
      capabilities: CLAUDE_CODE_CAPABILITIES,
      async materializeHooks() {},
      async materializeExtensions() {},
      async materializeSettings() {},
    };
    if (engineDeclaringHooks.capabilities.supportsHooks) {
      expect(isHookMaterializer(engineDeclaringHooks)).toBe(true);
    }
    if (engineDeclaringHooks.capabilities.supportsExtensions) {
      expect(isExtensionMaterializer(engineDeclaringHooks)).toBe(true);
    }
    if (engineDeclaringHooks.capabilities.supportsSettings) {
      expect(isSettingsMaterializer(engineDeclaringHooks)).toBe(true);
    }
  });
});
```

> Note for Phases 2–3: when each engine package gains real materializers, add a package-local conformance test that imports the actual engine and asserts the same rule against its live instance.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test --workspace=packages/harness-runtime -- apply-contributions spi-contract`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/harness-runtime/src/engine/apply-contributions.ts \
        packages/harness-runtime/test/engine/apply-contributions.test.ts \
        packages/harness-runtime/test/engine/spi-contract.test.ts \
        packages/harness-runtime/src/index.ts
git commit -m "feat(harness-runtime): capability-gated applyContributions dispatch"
```

---

### Task 7: Kernel wiring (`@nexus/harness-runtime`)

**Files:**

- Modify: `packages/harness-runtime/src/kernel.ts:139-162`
- Create (test): `packages/harness-runtime/test/kernel/apply-contributions-wiring.test.ts`

**Interfaces:**

- Consumes: `applyContributions` (Task 6), `EMPTY_HARNESS_CONTRIBUTIONS` (Task 1), `runtimeConfig.contributions` (Task 3).
- Produces: kernel populates `ctx.contributions` and calls `applyContributions(engine, ctx)` after building `ctx`, before `startServer`.

> The kernel's `startKernel` is integration-heavy (real sockets). Extract the small wiring into a pure, unit-testable helper rather than testing `startKernel` end to end.

- [ ] **Step 1: Write the failing test**

Create `packages/harness-runtime/test/kernel/apply-contributions-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveSessionContributions } from "../../src/kernel.js";
import { EMPTY_HARNESS_CONTRIBUTIONS } from "@nexus/core";

describe("resolveSessionContributions", () => {
  it("returns the config bundle when present", () => {
    const bundle = {
      hooks: [],
      extensions: [],
      settings: { outputStyle: "concise" },
    };
    expect(
      resolveSessionContributions({ contributions: bundle } as never),
    ).toBe(bundle);
  });

  it("falls back to the empty bundle when absent", () => {
    expect(resolveSessionContributions({} as never)).toEqual(
      EMPTY_HARNESS_CONTRIBUTIONS,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/harness-runtime -- apply-contributions-wiring`
Expected: FAIL — `resolveSessionContributions` not exported.

- [ ] **Step 3: Add the helper + wire it in**

In `packages/harness-runtime/src/kernel.ts`, add imports:

```ts
import {
  EMPTY_HARNESS_CONTRIBUTIONS,
  type HarnessRuntimeConfig,
} from "@nexus/core";
import { applyContributions } from "./engine/apply-contributions.js";
```

(Adjust the existing `@nexus/core` import to include `EMPTY_HARNESS_CONTRIBUTIONS` and `HarnessRuntimeConfig` rather than adding a duplicate import line.)

Add the pure helper near the top-level exports:

```ts
/** Resolve the session's contributions, defaulting to the empty bundle. */
export function resolveSessionContributions(config: HarnessRuntimeConfig) {
  return config.contributions ?? EMPTY_HARNESS_CONTRIBUTIONS;
}
```

In `startKernel`, set the field when building `ctx` (step 6):

```ts
const ctx: HarnessSessionContext = {
  governedTools,
  toolCatalog: buildToolCatalog(rawTools),
  checkPermission,
  workspacePath: envConfig.workspacePath,
  agentDir: DEFAULT_AGENT_DIR,
  extensionsPath: envConfig.extensionsPath,
  sessionPath: envConfig.sessionPath,
  contributions: resolveSessionContributions(runtimeConfig),
};

// Materialize author contributions natively (no-op for engines/capabilities
// that don't admit them) before the server arms the first prompt.
await applyContributions(engine, ctx);
```

(Insert the `applyContributions` call between building `ctx` and the telemetry/`startServer` block at lines 154-161.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/harness-runtime -- apply-contributions-wiring`
Expected: PASS.

- [ ] **Step 5: Build the package**

Run: `npm run build --workspace=packages/harness-runtime`
Expected: clean (confirms `ctx` satisfies the new required `contributions` field everywhere).

- [ ] **Step 6: Commit**

```bash
git add packages/harness-runtime/src/kernel.ts \
        packages/harness-runtime/test/kernel/apply-contributions-wiring.test.ts
git commit -m "feat(harness-runtime): wire contributions into kernel session context"
```

---

### Task 8: Contribution resolver + diagnostics (`apps/api`)

**Files:**

- Create: `apps/api/src/harness/harness-contribution-resolver.types.ts`
- Create: `apps/api/src/harness/harness-contribution-resolver.ts`
- Create (test): `apps/api/src/harness/harness-contribution-resolver.spec.ts`

**Interfaces:**

- Consumes: `HarnessCapabilities`, `HarnessContributions`, `HarnessHookContribution`, `HarnessExtensionContribution`, `HarnessSettingsContribution`, `EMPTY_HARNESS_CONTRIBUTIONS`, `HarnessId` (all `@nexus/core`).
- Produces: `ContributionOrigin`, `ContributionSource`, `ResolveContributionsParams`, `resolveHarnessContributions(params): HarnessContributions`. Drops emit best-effort `harness_contribution_dropped` ledger events.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/harness/harness-contribution-resolver.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { HarnessCapabilities } from "@nexus/core";
import {
  resolveHarnessContributions,
  type ContributionSource,
} from "./harness-contribution-resolver";

const fullCaps: HarnessCapabilities = {
  executionModes: ["agent_turn"],
  toolModel: "permission_callback",
  supportsSubagents: true,
  supportsWarRoom: true,
  supportsBranching: false,
  supportsResume: true,
  resumeMechanism: "config_ref",
  supportsThinkingLevels: false,
  supportedAuthTypes: ["api_key"],
  telemetryContractVersion: "v1",
  supportsHooks: true,
  supportsExtensions: true,
  supportsSettings: true,
  supportedHookEvents: ["session_start", "pre_tool_use"],
};

const noHookCaps: HarnessCapabilities = {
  ...fullCaps,
  supportsHooks: false,
  supportedHookEvents: [],
};

describe("resolveHarnessContributions", () => {
  it("merges hooks/extensions and lets higher precedence win settings keys", () => {
    const sources: ContributionSource[] = [
      {
        origin: "step",
        contributions: { settings: { outputStyle: "concise" } },
      },
      {
        origin: "profile",
        contributions: {
          hooks: [{ event: "session_start", command: "echo profile" }],
          settings: { outputStyle: "verbose", env: { A: "1" } },
        },
      },
      {
        origin: "skill",
        contributions: {
          extensions: [{ name: "fs", transport: "stdio", command: "mcp-fs" }],
        },
      },
    ];
    const out = resolveHarnessContributions({
      harnessId: "claude-code",
      capabilities: fullCaps,
      sources,
    });
    expect(out.hooks).toHaveLength(1);
    expect(out.extensions).toHaveLength(1);
    expect(out.settings.outputStyle).toBe("concise"); // step beats profile
    expect(out.settings.env).toEqual({ A: "1" });
  });

  it("drops unsupported hook events with a ledger diagnostic", () => {
    const emitBestEffort = vi.fn();
    const out = resolveHarnessContributions({
      harnessId: "claude-code",
      capabilities: fullCaps,
      sources: [
        {
          origin: "profile",
          contributions: {
            hooks: [
              { event: "session_start", command: "ok" },
              { event: "post_tool_use", command: "dropped" }, // not in supportedHookEvents
            ],
          },
        },
      ],
      ledger: { emitBestEffort },
    });
    expect(out.hooks).toHaveLength(1);
    expect(out.hooks[0].command).toBe("ok");
    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ type: "harness_contribution_dropped" }),
    );
  });

  it("drops all hooks when the harness does not support hooks", () => {
    const emitBestEffort = vi.fn();
    const out = resolveHarnessContributions({
      harnessId: "pi",
      capabilities: noHookCaps,
      sources: [
        {
          origin: "profile",
          contributions: { hooks: [{ event: "session_start", command: "x" }] },
        },
      ],
      ledger: { emitBestEffort },
    });
    expect(out.hooks).toEqual([]);
    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "harness_contribution_dropped",
        reason: "hooks_unsupported",
      }),
    );
  });

  it("returns the empty bundle for no sources", () => {
    const out = resolveHarnessContributions({
      harnessId: "pi",
      capabilities: noHookCaps,
      sources: [],
    });
    expect(out).toEqual({ hooks: [], extensions: [], settings: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- harness-contribution-resolver`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the types**

Create `apps/api/src/harness/harness-contribution-resolver.types.ts`:

```ts
import type {
  HarnessContributions,
  HarnessId,
  HarnessCapabilities,
} from "@nexus/core";

export type ContributionOrigin = "step" | "profile" | "skill" | "platform";

export interface ContributionSource {
  origin: ContributionOrigin;
  /** Any subset of the bundle; missing arrays/objects are treated as empty. */
  contributions: Partial<HarnessContributions>;
}

export interface ContributionLedger {
  emitBestEffort: (payload: unknown) => unknown;
}

export interface ResolveContributionsParams {
  harnessId: HarnessId;
  capabilities: HarnessCapabilities;
  /** Highest precedence first (step, then profile, then skill, then platform). */
  sources: ContributionSource[];
  ledger?: ContributionLedger;
}
```

- [ ] **Step 4: Implement the resolver**

Create `apps/api/src/harness/harness-contribution-resolver.ts`:

```ts
import {
  EMPTY_HARNESS_CONTRIBUTIONS,
  type HarnessContributions,
  type HarnessHookContribution,
  type HarnessExtensionContribution,
  type HarnessSettingsContribution,
} from "@nexus/core";
import type {
  ContributionOrigin,
  ContributionSource,
  ContributionLedger,
  ResolveContributionsParams,
} from "./harness-contribution-resolver.types";

// Re-export the public surface so consumers import from one module.
export type {
  ContributionOrigin,
  ContributionSource,
  ContributionLedger,
  ResolveContributionsParams,
} from "./harness-contribution-resolver.types";

const CONTRIBUTION_DROPPED_EVENT = "harness_contribution_dropped" as const;

function emitDropped(
  ledger: ContributionLedger | undefined,
  harnessId: string,
  type: "hook" | "extension" | "settings",
  reason: string,
  origin: ContributionOrigin,
): void {
  ledger?.emitBestEffort({
    type: CONTRIBUTION_DROPPED_EVENT,
    harnessId,
    contributionType: type,
    reason,
    origin,
  });
}

function hookKey(h: HarnessHookContribution): string {
  return `${h.event}::${h.matcher ?? ""}::${h.command}`;
}

/**
 * Merge author contributions by precedence (sources are highest-first), validate
 * each against the resolved harness's capabilities, and drop unsupported items
 * with best-effort ledger diagnostics — never a hard failure, never silent.
 *
 * Hooks/extensions concatenate (de-duplicated); settings deep-merge with higher
 * precedence winning per key.
 */
export function resolveHarnessContributions(
  params: ResolveContributionsParams,
): HarnessContributions {
  const { capabilities: caps, harnessId, ledger } = params;
  const supportedEvents = new Set(caps.supportedHookEvents ?? []);

  const hooks: HarnessHookContribution[] = [];
  const seenHooks = new Set<string>();
  const extensions: HarnessExtensionContribution[] = [];
  const seenExt = new Set<string>();
  let settings: HarnessSettingsContribution = {};

  // Process low → high so higher precedence settings keys overwrite.
  const ordered = [...params.sources].reverse();

  for (const source of ordered) {
    const c = source.contributions;

    for (const hook of c.hooks ?? []) {
      if (!caps.supportsHooks) {
        emitDropped(
          ledger,
          harnessId,
          "hook",
          "hooks_unsupported",
          source.origin,
        );
        continue;
      }
      if (!supportedEvents.has(hook.event)) {
        emitDropped(
          ledger,
          harnessId,
          "hook",
          `event_unsupported:${hook.event}`,
          source.origin,
        );
        continue;
      }
      const key = hookKey(hook);
      if (seenHooks.has(key)) continue;
      seenHooks.add(key);
      hooks.push(hook);
    }

    for (const ext of c.extensions ?? []) {
      if (!caps.supportsExtensions) {
        emitDropped(
          ledger,
          harnessId,
          "extension",
          "extensions_unsupported",
          source.origin,
        );
        continue;
      }
      if (seenExt.has(ext.name)) continue;
      seenExt.add(ext.name);
      extensions.push(ext);
    }

    if (c.settings && Object.keys(c.settings).length > 0) {
      if (!caps.supportsSettings) {
        emitDropped(
          ledger,
          harnessId,
          "settings",
          "settings_unsupported",
          source.origin,
        );
      } else {
        settings = mergeSettings(settings, c.settings);
      }
    }
  }

  if (
    hooks.length === 0 &&
    extensions.length === 0 &&
    Object.keys(settings).length === 0
  ) {
    return EMPTY_HARNESS_CONTRIBUTIONS;
  }
  return { hooks, extensions, settings };
}

function mergeSettings(
  lower: HarnessSettingsContribution,
  higher: HarnessSettingsContribution,
): HarnessSettingsContribution {
  return {
    env: { ...(lower.env ?? {}), ...(higher.env ?? {}) },
    permissions:
      (higher.permissions ?? lower.permissions)
        ? {
            allow: higher.permissions?.allow ?? lower.permissions?.allow,
            deny: higher.permissions?.deny ?? lower.permissions?.deny,
          }
        : undefined,
    outputStyle: higher.outputStyle ?? lower.outputStyle,
  };
}
```

> Note: `mergeSettings` produces an `env: {}` for sources that set no env. If the
> "no settings" detection in the final guard needs to ignore an empty `env`,
> tighten it — but the test above sets `env: { A: "1" }`, so an empty-env edge
> case is only relevant once settings exist. Keep the guard as written; it returns
> the empty bundle only when hooks, extensions, AND settings are all empty.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:api -- harness-contribution-resolver`
Expected: PASS (4 tests).

- [ ] **Step 6: Lint the new files**

Run: `npm run lint:api`
Expected: no errors in the new files.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/harness/harness-contribution-resolver.ts \
        apps/api/src/harness/harness-contribution-resolver.types.ts \
        apps/api/src/harness/harness-contribution-resolver.spec.ts
git commit -m "feat(api): add harness contribution resolver with capability diagnostics"
```

---

## Phase 1 Completion Check

- [ ] `npm run build --workspace=packages/core` — clean
- [ ] `npm run build --workspace=packages/harness-runtime` — clean
- [ ] `npm run test --workspace=packages/core` — green
- [ ] `npm run test --workspace=packages/harness-runtime` — green
- [ ] `npm run test:api -- harness-contribution-resolver` — green
- [ ] `npm run lint:api` — clean

At this point the foundation exists end to end: contracts → capabilities → SPI → kernel dispatch → resolver. No runtime behavior changes because nothing populates contributions yet — that arrives with the authoring surfaces in Phase 4. The resolver is built but **not yet called** from the step/subagent config assembly; wiring the resolver into `HarnessRuntimeConfig` assembly happens in Phase 4 alongside the authoring surfaces (it has no inputs to resolve until then).

## Out of Scope (subsequent plans)

- **Phase 2 — PI materializers/parity** (spike-led; sets PI capability flags from findings).
- **Phase 3 — Claude Code materializers** (`.claude/settings.json`, hooks mapping, MCP config + governance handoff for extension tools).
- **Phase 4 — Authoring surfaces** (agent-profile jsonb column + migration, `steps[].inputs.harness_contributions`, skill-manifest `contributions`), resolver call-site wiring, web UI, docs.

Each gets its own plan once Phase 1's concrete interfaces land.

```

```
