# Harness-Native Contributions — Phase 3 (Claude Code Materializers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Claude Code engine materialize authored hooks, extensions (MCP servers), and settings into the SDK's `query({ options })` object — with author-provided MCP tools still gated by the existing governance callback.

**Architecture:** The Claude Agent SDK accepts hooks (`options.hooks`), MCP servers (`options.mcpServers`), and settings (`options.settings` / `options.env`) **programmatically** — no files. Pure converter helpers map the canonical `HarnessContributions` to SDK option fragments. `ClaudeCodeEngine` implements the three materializer interfaces (delegating to the converters) to satisfy the SPI conformance rule, and `createSession` reads `ctx.contributions` and merges the converted fragments into the existing `options` object.

**Tech Stack:** TypeScript (strict), Vitest, `@anthropic-ai/claude-agent-sdk`. Workspace: `packages/harness-engine-claude-code`.

**Spec:** `docs/superpowers/specs/2026-06-23-harness-native-contributions-design.md` · **Depends on:** Phase 1 (foundation) merged.

## Global Constraints

- Strict lint policy: no `eslint-disable`/`@ts-ignore`/`@ts-nocheck`.
- **Governance is non-negotiable:** author MCP tools must pass through the existing `canUseTool` → `ctx.checkPermission` (job ∩ profile). Do not add any tool path that bypasses it.
- **No behavior change when contributions are empty:** with an empty bundle, the merged `options` must be byte-for-byte equivalent to today's (no `hooks`/extra `mcpServers`/`settings` keys added).
- Hook commands are author-provided shell; bound each by its `timeoutMs` (default + hard max) and never log command output that could contain secrets.
- The Claude Code engine is a singleton; `ctx.contributions` is fixed per container, so reading it in `createSession` is correct and avoids singleton mutable state.
- Test command: `npm run test --workspace=packages/harness-engine-claude-code -- <pattern>`.

## SDK delivery facts (from the spike — drive the implementation)

`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:

- `hooks?: Partial<Record<HookEvent, HookCallbackMatcher[]>>` — programmatic callbacks. SDK `HookEvent` names: `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, …
- `mcpServers?: Record<string, McpServerConfig>` where `McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | …` (e.g. `{ type: "stdio", command, args, env }`, `{ type: "http", url, headers }`).
- `settings?: string | Settings` (inline object) and `env?: Record<string,string>` (replaces subprocess env — engine already spreads `process.env`).
- `canUseTool` is invoked by the SDK for **every** tool call, including author MCP tools → this is the governance handoff.

---

### Task 1: Pure SDK contribution converters

**Files:**

- Create: `packages/harness-engine-claude-code/src/contribution-sdk-mappers.ts`
- Create (test): `packages/harness-engine-claude-code/src/contribution-sdk-mappers.spec.ts`

**Interfaces:**

- Consumes: `HarnessContributions`, `HarnessHookEvent`, `HarnessHookContribution`, `HarnessExtensionContribution`, `HarnessSettingsContribution` (`@nexus/core`).
- Produces:
  - `SDK_HOOK_EVENT_BY_NEUTRAL: Record<HarnessHookEvent, string>`
  - `toSdkHooks(hooks: HarnessHookContribution[]): Record<string, unknown> | undefined`
  - `toSdkMcpServers(exts: HarnessExtensionContribution[]): Record<string, unknown> | undefined`
  - `toSdkSettings(s: HarnessSettingsContribution): { settings?: Record<string, unknown>; env?: Record<string, string> }`
  - `runHookCommand(command: string, timeoutMs: number): Promise<void>` (bounded exec helper)
  - `DEFAULT_HOOK_TIMEOUT_MS = 30000`, `MAX_HOOK_TIMEOUT_MS = 600000`

- [ ] **Step 1: Write the failing test**

Create `packages/harness-engine-claude-code/src/contribution-sdk-mappers.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  toSdkHooks,
  toSdkMcpServers,
  toSdkSettings,
  SDK_HOOK_EVENT_BY_NEUTRAL,
} from "./contribution-sdk-mappers.js";

describe("toSdkHooks", () => {
  it("maps neutral events to SDK hook event names and keeps the matcher", () => {
    const out = toSdkHooks([
      { event: "pre_tool_use", matcher: "Bash", command: "echo hi" },
    ]);
    expect(out).toBeDefined();
    expect(Object.keys(out!)).toEqual(["PreToolUse"]);
    const matchers = out!["PreToolUse"] as Array<{
      matcher?: string;
      hooks: unknown[];
    }>;
    expect(matchers[0].matcher).toBe("Bash");
    expect(typeof matchers[0].hooks[0]).toBe("function");
  });

  it("groups multiple hooks under the same SDK event", () => {
    const out = toSdkHooks([
      { event: "session_start", command: "a" },
      { event: "session_start", command: "b" },
    ])!;
    expect((out["SessionStart"] as unknown[]).length).toBe(2);
  });

  it("returns undefined for no hooks", () => {
    expect(toSdkHooks([])).toBeUndefined();
  });

  it("covers every neutral event in the map", () => {
    expect(SDK_HOOK_EVENT_BY_NEUTRAL).toEqual({
      session_start: "SessionStart",
      session_end: "SessionEnd",
      pre_tool_use: "PreToolUse",
      post_tool_use: "PostToolUse",
      user_prompt_submit: "UserPromptSubmit",
    });
  });
});

describe("toSdkMcpServers", () => {
  it("maps stdio and http extensions", () => {
    const out = toSdkMcpServers([
      {
        name: "fs",
        transport: "stdio",
        command: "mcp-fs",
        args: ["--root", "/w"],
        env: { A: "1" },
      },
      {
        name: "remote",
        transport: "http",
        url: "https://x/mcp",
        headers: { Authorization: "Bearer t" },
      },
    ])!;
    expect(out["fs"]).toEqual({
      type: "stdio",
      command: "mcp-fs",
      args: ["--root", "/w"],
      env: { A: "1" },
    });
    expect(out["remote"]).toEqual({
      type: "http",
      url: "https://x/mcp",
      headers: { Authorization: "Bearer t" },
    });
  });

  it("returns undefined for no extensions", () => {
    expect(toSdkMcpServers([])).toBeUndefined();
  });
});

describe("toSdkSettings", () => {
  it("splits permissions/outputStyle into settings and env into env patch", () => {
    const out = toSdkSettings({
      env: { FOO: "bar" },
      permissions: { allow: ["Read"], deny: ["Bash"] },
      outputStyle: "concise",
    });
    expect(out.settings).toEqual({
      permissions: { allow: ["Read"], deny: ["Bash"] },
      outputStyle: "concise",
    });
    expect(out.env).toEqual({ FOO: "bar" });
  });

  it("omits settings when only env is set", () => {
    const out = toSdkSettings({ env: { FOO: "bar" } });
    expect(out.settings).toBeUndefined();
    expect(out.env).toEqual({ FOO: "bar" });
  });

  it("omits env when only settings are set", () => {
    const out = toSdkSettings({ outputStyle: "concise" });
    expect(out.env).toBeUndefined();
    expect(out.settings).toEqual({ outputStyle: "concise" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- contribution-sdk-mappers`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the converters**

Create `packages/harness-engine-claude-code/src/contribution-sdk-mappers.ts`:

```ts
import { execFile } from "node:child_process";
import type {
  HarnessHookEvent,
  HarnessHookContribution,
  HarnessExtensionContribution,
  HarnessSettingsContribution,
} from "@nexus/core";

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;
export const MAX_HOOK_TIMEOUT_MS = 600_000;

/** Neutral hook event → Claude Code SDK HookEvent name. */
export const SDK_HOOK_EVENT_BY_NEUTRAL: Record<HarnessHookEvent, string> = {
  session_start: "SessionStart",
  session_end: "SessionEnd",
  pre_tool_use: "PreToolUse",
  post_tool_use: "PostToolUse",
  user_prompt_submit: "UserPromptSubmit",
};

/**
 * Run an author-provided hook command, bounded by timeout. Output is discarded
 * (never logged) so a hook that echoes a secret cannot leak it into run logs.
 * A non-zero exit / timeout is swallowed: an author hook must not crash the run.
 */
export function runHookCommand(
  command: string,
  timeoutMs: number,
): Promise<void> {
  const bounded = Math.min(Math.max(timeoutMs, 1), MAX_HOOK_TIMEOUT_MS);
  return new Promise((resolve) => {
    execFile(
      process.env["SHELL"] ?? "/bin/sh",
      ["-c", command],
      { timeout: bounded },
      () => resolve(),
    );
  });
}

/** Build the SDK `options.hooks` structure from canonical hook contributions. */
export function toSdkHooks(
  hooks: HarnessHookContribution[],
): Record<string, unknown> | undefined {
  if (hooks.length === 0) return undefined;
  const out: Record<string, Array<{ matcher?: string; hooks: unknown[] }>> = {};
  for (const hook of hooks) {
    const sdkEvent = SDK_HOOK_EVENT_BY_NEUTRAL[hook.event];
    const callback = async () => {
      await runHookCommand(
        hook.command,
        hook.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
      );
      return { continue: true };
    };
    (out[sdkEvent] ??= []).push({
      ...(hook.matcher !== undefined ? { matcher: hook.matcher } : {}),
      hooks: [callback],
    });
  }
  return out;
}

/** Build the SDK `options.mcpServers` record from canonical extensions. */
export function toSdkMcpServers(
  exts: HarnessExtensionContribution[],
): Record<string, unknown> | undefined {
  if (exts.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const ext of exts) {
    out[ext.name] =
      ext.transport === "stdio"
        ? {
            type: "stdio",
            command: ext.command,
            ...(ext.args ? { args: ext.args } : {}),
            ...(ext.env ? { env: ext.env } : {}),
          }
        : {
            type: "http",
            url: ext.url,
            ...(ext.headers ? { headers: ext.headers } : {}),
          };
  }
  return out;
}

/** Split a settings contribution into an inline SDK Settings object + env patch. */
export function toSdkSettings(s: HarnessSettingsContribution): {
  settings?: Record<string, unknown>;
  env?: Record<string, string>;
} {
  const settings: Record<string, unknown> = {};
  if (s.permissions !== undefined) settings.permissions = s.permissions;
  if (s.outputStyle !== undefined) settings.outputStyle = s.outputStyle;
  return {
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
    ...(s.env && Object.keys(s.env).length > 0 ? { env: s.env } : {}),
  };
}
```

> Verification: the converters' STRUCTURE (`Record<HookEvent, matcher[]>`, `{ type, command/url, ... }`, inline `settings`/`env`) is confirmed by `sdk.d.ts`. The hook callback's exact return contract (`{ continue: true }`) should be confirmed against `HookCallbackMatcher` / `HookJSONOutput` in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`; adjust the returned object only if the SDK requires a different success shape — the `runHookCommand` call and event mapping do not change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- contribution-sdk-mappers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/harness-engine-claude-code/src/contribution-sdk-mappers.ts \
        packages/harness-engine-claude-code/src/contribution-sdk-mappers.spec.ts
git commit -m "feat(harness-engine-claude-code): pure SDK contribution converters"
```

---

### Task 2: Merge contributions into the engine's query options + implement materializers

**Files:**

- Modify: `packages/harness-engine-claude-code/src/claude-code-engine.ts` (class body + `createSession` options at lines 177-200)
- Create (test): `packages/harness-engine-claude-code/src/__tests__/claude-code-engine.contributions.spec.ts`

**Interfaces:**

- Consumes: the Task 1 converters; `HarnessContributions` via `ctx.contributions`; the materializer interfaces from `@nexus/harness-runtime`.
- Produces: `ClaudeCodeEngine` implements `HookMaterializer`, `ExtensionMaterializer`, `SettingsMaterializer`; `createSession` adds `hooks` / merges `mcpServers` / adds `settings` / merges `env` only when present.

- [ ] **Step 1: Write the failing test**

Create `packages/harness-engine-claude-code/src/__tests__/claude-code-engine.contributions.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HarnessRuntimeConfig } from "@nexus/core";
import type { HarnessSessionContext } from "@nexus/harness-runtime";

const queryCalls: Array<{
  prompt: unknown;
  options?: Record<string, unknown>;
}> = [];
let sdkMessages: unknown[] = [
  { type: "result", subtype: "success", result: "ok", session_id: "s1" },
];

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (opts: { prompt: unknown; options?: Record<string, unknown> }) => {
    queryCalls.push(opts);
    return (async function* () {
      for (const m of sdkMessages) yield m;
    })();
  },
  createSdkMcpServer: (o: unknown) => o,
  tool: (name: string) => ({ name }),
}));

const { ClaudeCodeEngine } = await import("../claude-code-engine.js");

function cfg(): HarnessRuntimeConfig {
  return {
    harnessId: "claude-code",
    model: {
      provider: "anthropic",
      model: "m",
      auth: { type: "api_key", apiKey: "k" } as never,
    },
    prompt: { systemPrompt: "sys", initialPrompt: "go" },
  };
}

function ctx(
  contributions: HarnessSessionContext["contributions"],
): HarnessSessionContext {
  return {
    governedTools: [],
    toolCatalog: [],
    checkPermission: vi.fn(async () => ({ status: "allowed" as const })),
    workspacePath: "/workspace",
    agentDir: "/agent",
    extensionsPath: "/ext",
    sessionPath: "/session.jsonl",
    contributions,
  };
}

const empty = { hooks: [], extensions: [], settings: {} };

describe("ClaudeCodeEngine contribution merge", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("adds NO contribution keys when the bundle is empty", async () => {
    await new ClaudeCodeEngine().createSession(cfg(), ctx(empty));
    const options = queryCalls[0].options!;
    expect(options.hooks).toBeUndefined();
    expect(options.settings).toBeUndefined();
    // only the kernel MCP server is present
    expect(Object.keys(options.mcpServers as object)).toEqual([
      "nexus-kernel-tools",
    ]);
  });

  it("merges author mcpServers alongside the kernel server", async () => {
    await new ClaudeCodeEngine().createSession(
      cfg(),
      ctx({
        ...empty,
        extensions: [{ name: "fs", transport: "stdio", command: "mcp-fs" }],
      }),
    );
    const servers = queryCalls[0].options!.mcpServers as Record<
      string,
      unknown
    >;
    expect(Object.keys(servers).sort()).toEqual(["fs", "nexus-kernel-tools"]);
  });

  it("adds options.hooks for authored hooks", async () => {
    await new ClaudeCodeEngine().createSession(
      cfg(),
      ctx({
        ...empty,
        hooks: [{ event: "session_start", command: "echo hi" }],
      }),
    );
    expect(queryCalls[0].options!.hooks).toBeDefined();
    expect(Object.keys(queryCalls[0].options!.hooks as object)).toEqual([
      "SessionStart",
    ]);
  });

  it("adds options.settings and patches env for settings contributions", async () => {
    await new ClaudeCodeEngine().createSession(
      cfg(),
      ctx({
        ...empty,
        settings: { outputStyle: "concise", env: { FOO: "bar" } },
      }),
    );
    expect(queryCalls[0].options!.settings).toEqual({ outputStyle: "concise" });
    expect((queryCalls[0].options!.env as Record<string, string>).FOO).toBe(
      "bar",
    );
  });

  it("implements the three materializer interfaces", async () => {
    const e = new ClaudeCodeEngine() as unknown as Record<string, unknown>;
    expect(typeof e.materializeHooks).toBe("function");
    expect(typeof e.materializeExtensions).toBe("function");
    expect(typeof e.materializeSettings).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- claude-code-engine.contributions`
Expected: FAIL — empty-bundle test may pass, but the merge/materializer tests fail (no `hooks`/author `mcpServers`/`settings`, methods absent).

- [ ] **Step 3: Implement the merge + materializer methods**

In `packages/harness-engine-claude-code/src/claude-code-engine.ts`:

Add imports (top of file):

```ts
import type {
  HookMaterializer,
  ExtensionMaterializer,
  SettingsMaterializer,
} from "@nexus/harness-runtime";
import type {
  HarnessHookContribution,
  HarnessExtensionContribution,
  HarnessSettingsContribution,
} from "@nexus/core";
import {
  toSdkHooks,
  toSdkMcpServers,
  toSdkSettings,
} from "./contribution-sdk-mappers.js";
```

Change the class declaration to implement the interfaces:

```ts
export class ClaudeCodeEngine
  implements
    HarnessEngine,
    HookMaterializer,
    ExtensionMaterializer,
    SettingsMaterializer
{
  readonly id = "claude-code" as const;
  readonly capabilities = CLAUDE_CODE_CAPABILITIES;

  // The SPI dispatch path (applyContributions) calls these at kernel bootstrap.
  // createSession also reads ctx.contributions directly, so these are idempotent
  // converters kept to satisfy the SPI conformance rule (a declared capability
  // requires the matching materializer). They store nothing the engine depends
  // on — ctx.contributions is the single source of truth.
  async materializeHooks(_hooks: HarnessHookContribution[]): Promise<void> {}
  async materializeExtensions(_exts: HarnessExtensionContribution[]): Promise<void> {}
  async materializeSettings(_settings: HarnessSettingsContribution): Promise<void> {}
```

> Rationale: `createSession` receives `ctx` (with `ctx.contributions`) on every call and the engine is a singleton, so deriving the SDK fragments inside `createSession` from `ctx.contributions` is simpler and race-free than stashing materializer state. The interface methods are still implemented (required by the conformance rule in Phase 1 Task 6); they are deliberate no-ops because the merge happens in `createSession`.

In `createSession`, just before building the `gen` query (after the `mcp` server is created at line 173), derive the fragments:

```ts
const c = ctx.contributions;
const sdkHooks = toSdkHooks(c.hooks);
const authMcpServers = toSdkMcpServers(c.extensions);
const { settings: sdkSettings, env: sdkEnvPatch } = toSdkSettings(c.settings);
```

Then update the `options` object (lines 177-199) to merge them — preserving every existing key and adding the new keys only when defined:

```ts
        options: {
          cwd: ctx.workspacePath,
          systemPrompt: config.prompt.systemPrompt,
          disallowedTools: ["Task"],
          mcpServers: { [NEXUS_KERNEL_MCP_SERVER]: mcp, ...(authMcpServers ?? {}) },
          pathToClaudeCodeExecutable: process.env["CLAUDE_CODE_BIN"],
          canUseTool,
          env: { ...process.env, ...authEnv, ...(sdkEnvPatch ?? {}) },
          ...(resumeSessionId ? { resume: resumeSessionId } : {}),
          ...(sdkHooks ? { hooks: sdkHooks } : {}),
          ...(sdkSettings ? { settings: sdkSettings } : {}),
          abortController,
        },
```

(Governance note: author MCP tools enter the same `canUseTool` callback the SDK invokes for every tool, so they are gated by `ctx.checkPermission` (job ∩ profile) exactly like kernel tools — no bypass is introduced.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- claude-code-engine.contributions`
Expected: PASS.

- [ ] **Step 5: Run the full package suite to confirm no regression**

Run: `npm run test --workspace=packages/harness-engine-claude-code`
Expected: all existing engine/session/govern/mcp tests still PASS (the empty-bundle path is unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/harness-engine-claude-code/src/claude-code-engine.ts \
        packages/harness-engine-claude-code/src/__tests__/claude-code-engine.contributions.spec.ts
git commit -m "feat(harness-engine-claude-code): materialize contributions into query options"
```

---

### Task 3: Governance passthrough test for author MCP tools

**Files:**

- Modify (test): `packages/harness-engine-claude-code/src/__tests__/claude-code-engine.contributions.spec.ts`

**Interfaces:**

- Consumes: the `canUseTool` callback the engine passes to `sdk.query`.
- Produces: a test proving an author-MCP tool name routes through `ctx.checkPermission`.

- [ ] **Step 1: Write the failing test**

Append to `claude-code-engine.contributions.spec.ts`:

```ts
describe("ClaudeCodeEngine governance over author MCP tools", () => {
  beforeEach(() => {
    queryCalls.length = 0;
  });

  it("routes an author MCP tool call through ctx.checkPermission", async () => {
    const checkPermission = vi.fn(async () => ({
      status: "denied" as const,
      reason: "blocked",
    }));
    const sessionCtx = {
      ...ctx({
        ...empty,
        extensions: [{ name: "fs", transport: "stdio", command: "mcp-fs" }],
      }),
      checkPermission,
    };
    await new ClaudeCodeEngine().createSession(cfg(), sessionCtx);

    const canUseTool = queryCalls[0].options!.canUseTool as (
      name: string,
      input: Record<string, unknown>,
      opts: unknown,
    ) => Promise<{ behavior: string }>;

    const decision = await canUseTool(
      "mcp__fs__read_file",
      { path: "/etc/passwd" },
      {},
    );
    expect(checkPermission).toHaveBeenCalled();
    expect(decision.behavior).toBe("deny");
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- claude-code-engine.contributions`
Expected: PASS. The engine already wires `canUseTool` → `ctx.checkPermission` for all tools; this test locks that author MCP tools are not exempt. (If it fails, the merge introduced a governance bypass — fix the engine, not the test.)

- [ ] **Step 3: Commit**

```bash
git add packages/harness-engine-claude-code/src/__tests__/claude-code-engine.contributions.spec.ts
git commit -m "test(harness-engine-claude-code): assert author MCP tools are governed"
```

---

### Task 4: SPI conformance + docs

**Files:**

- Create (test): `packages/harness-engine-claude-code/src/__tests__/claude-code-engine.spi-conformance.spec.ts`
- Modify: `docs/superpowers/specs/2026-06-23-harness-native-contributions-design.md` (§9 Claude Code paragraph)
- Modify: `docs/guide/41-harness-runtime.md`

**Interfaces:**

- Consumes: `CLAUDE_CODE_CAPABILITIES`, the `is*Materializer` guards.

- [ ] **Step 1: Write the conformance test**

Create `packages/harness-engine-claude-code/src/__tests__/claude-code-engine.spi-conformance.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CLAUDE_CODE_CAPABILITIES } from "@nexus/core";
import {
  isHookMaterializer,
  isExtensionMaterializer,
  isSettingsMaterializer,
} from "@nexus/harness-runtime";
import { ClaudeCodeEngine } from "../claude-code-engine.js";

describe("Claude Code SPI conformance", () => {
  it("implements a materializer for every declared contribution capability", () => {
    const engine = new ClaudeCodeEngine();
    if (CLAUDE_CODE_CAPABILITIES.supportsHooks)
      expect(isHookMaterializer(engine)).toBe(true);
    if (CLAUDE_CODE_CAPABILITIES.supportsExtensions)
      expect(isExtensionMaterializer(engine)).toBe(true);
    if (CLAUDE_CODE_CAPABILITIES.supportsSettings)
      expect(isSettingsMaterializer(engine)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test --workspace=packages/harness-engine-claude-code -- spi-conformance`
Expected: PASS.

- [ ] **Step 3: Update docs**

In the design spec §9, replace the Claude Code paragraph to state that hooks/MCP/settings are delivered **programmatically** via `sdk.query({ options })` (not files): hooks → `options.hooks` (command-running callbacks), extensions → merged into `options.mcpServers`, settings → `options.settings` + `options.env`; author MCP tools are gated by `canUseTool` → `checkPermission`.

In `docs/guide/41-harness-runtime.md`, update the contributions subsection: Claude Code now materializes all three types; show a tiny example of an authored hook/extension/setting and what it maps to.

- [ ] **Step 4: Commit**

```bash
git add packages/harness-engine-claude-code/src/__tests__/claude-code-engine.spi-conformance.spec.ts \
        docs/superpowers/specs/2026-06-23-harness-native-contributions-design.md \
        docs/guide/41-harness-runtime.md
git commit -m "test+docs(harness-claude-code): SPI conformance + contribution docs"
```

---

## Phase 3 Completion Check

- [ ] `npm run test --workspace=packages/harness-engine-claude-code` — all green
- [ ] Empty bundle → `options` unchanged from today (no new keys)
- [ ] Author hooks/extensions/settings appear in `sdk.query` options
- [ ] Author MCP tool call routes through `ctx.checkPermission`
- [ ] SPI conformance test passes; docs updated
- [ ] Live smoke (when a Phase-4 authoring surface exists): author a hook + an MCP server on a profile, run a real Claude Code step, confirm the hook fires and the MCP tool is available and governed.

Claude Code now honors authored contributions end-to-end inside the engine. Nothing populates contributions until the authoring surfaces land — that is Phase 4.
