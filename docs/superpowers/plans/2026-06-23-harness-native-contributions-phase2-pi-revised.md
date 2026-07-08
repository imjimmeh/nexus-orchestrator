# Harness-Native Contributions — Phase 2 (PI Full Contributions) Implementation Plan — REVISED

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **This plan SUPERSEDES `2026-06-23-harness-native-contributions-phase2-pi.md`.** The original concluded PI has no native contribution support; that was wrong. This plan implements real PI materialization. Part of the original Phase 2 (capability flags `false`, the `contributions-unsupported` guard test, the "no support" docs) must be **undone** — capability flags in Task 1, the guard test + docs in Task 5.

**Goal:** Make the PI engine materialize harness contributions natively — **hooks** via a generated PI extension module, and **MCP-server extensions** via an engine-side MCP client bridge whose tools route through PI's existing governance path — with an empty bundle remaining byte-identical to today.

**Architecture:** PI extensions are TypeScript modules (default-export `ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>`) loaded from `ctx.extensionsPath` (already wired: `pi-engine.ts:156-168`, jiti, `.ts` files only). Hooks → generate one such module that registers `pi.on(event, …)` handlers running the author's shell command (`pre_tool_use` → `tool_call` with `{ block: true }` on non-zero exit). MCP extensions → connect with `@modelcontextprotocol/sdk`, enumerate tools, wrap each as a governed `CanonicalToolDefinition` via `wrapToolWithGovernance(tool, ctx.checkPermission)`, add to the PI tool set, dispose clients on teardown. Settings stay unsupported.

**Tech Stack:** TypeScript (strict), Vitest. Workspace: `packages/harness-engine-pi` (+ a new dep `@modelcontextprotocol/sdk`), plus `packages/core` capability flags and doc edits.

**Spec:** `docs/superpowers/specs/2026-06-23-harness-native-contributions-design.md` (§4 matrix + §9 PI paragraph, already corrected) · **Depends on:** Phase 1 (foundation) merged. Independent of Phase 3/4.

## Global Constraints

- Strict lint policy: NO `eslint-disable`/`@ts-ignore`/`@ts-nocheck`/rule downgrades.
- **Governance (security):** every bridged MCP tool MUST pass through `wrapToolWithGovernance(tool, ctx.checkPermission)` (job ∩ profile). A bridged tool reaching `execute` without governance is a Critical defect. Contributions cannot widen the tool surface past the profile ceiling — a tool the profile does not grant is denied by `checkPermission`.
- **Empty bundle ⇒ byte-identical PI behavior:** no extension file written, no MCP client connected, no tool-set change when `ctx.contributions` is `EMPTY_HARNESS_CONTRIBUTIONS`.
- Never log secrets; hook command output is never logged; hook commands are timeout-bounded. Extension `env`/`headers` may carry `secret_store`-resolved values — never log them.
- Generated extension file: a **`.ts`** file with a **default export** that is the factory (loader uses `jiti.import(path, { default: true })` then calls it; `resolveExtensionPaths` includes only `*.ts` except `index.ts`).
- Canonical contracts come from `@nexus/core`; `wrapToolWithGovernance`, `CanonicalToolDefinition`, `PermissionDecision`, `CheckPermission` come from `@nexus/harness-runtime`. Never redefine locally.
- Build gotcha: after editing `packages/core`, rebuild it before downstream consumes it; after editing `packages/harness-engine-pi`, `npm run build --workspace=packages/harness-engine-pi`.
- Test command: `npm run test --workspace=packages/harness-engine-pi -- <pattern>`.

## Grounded facts (from research — use verbatim, but each implementer should re-confirm against the installed sources noted)

- **PI ExtensionAPI** (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`): `on(event, handler)` for `session_start`, `session_shutdown`, `before_agent_start` (result may set `systemPrompt`/`message`), `tool_call` (result `{ block?: boolean; reason?: string }`, `event.input` mutable), `tool_result` (result `{ content?, details?, isError? }`). `ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>`.
- **Loader** (`.../extensions/loader.js`): `const module = await jiti.import(extensionPath, { default: true }); const factory = module;` then `typeof factory !== "function"` → dropped. So **default-export a function**.
- **Engine extension discovery** (`packages/harness-engine-pi/src/pi-engine.ts:484-489`): reads `ctx.extensionsPath`, filters `file.endsWith(".ts") && file !== "index.ts"`.
- **`CanonicalToolDefinition`** (`packages/harness-runtime/src/engine/session-context.types.ts:17-26`): `{ name: string; description: string; parameters: unknown /* JSON schema */; execute(callId: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> }`.
- **`CheckPermission`** (`packages/harness-runtime/src/governance/check-permission-client.types.ts`): `(toolName: string, params: unknown) => Promise<PermissionDecision>`; `PermissionDecision = { status: "allowed" } | { status: "denied"; reason?; code? } | { status: "approval_required"; reason? }`.
- **`wrapToolWithGovernance`** (`packages/harness-runtime/src/governance/wrap-tool.ts`, used in `kernel.ts:146-148`): wraps a bare `CanonicalToolDefinition`'s `execute` to call `checkPermission(tool.name, params)` first. Exported from `@nexus/harness-runtime` (confirm the export; if not exported, export it). `ctx.governedTools` are ALREADY wrapped — do not double-wrap those; only wrap the NEW bridged tools.
- **`@modelcontextprotocol/sdk`**: NOT installed. Must be added to `packages/harness-engine-pi`. The client API (confirm against the installed `.d.ts` after install): `Client` from `@modelcontextprotocol/sdk/client/index.js`; `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio.js` (`{ command, args, env }`); `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk/client/streamableHttp.js` (`new URL(url)`, headers via `requestInit`); `client.connect(transport)`, `client.listTools()` → `{ tools: [{ name, description?, inputSchema }] }`, `client.callTool({ name, arguments })` → `{ content: [...], isError? }`, `client.close()`.

---

### Task 1: Flip PI capability flags to honest values + update core capability tests

**Files:**

- Modify: `packages/core/src/interfaces/harness-capabilities.ts` (the `PI_CAPABILITIES` preset)
- Modify (test): `packages/core/src/interfaces/harness-capabilities.spec.ts`

**Interfaces:**

- Consumes: `HarnessHookEvent` (Phase 1).
- Produces: `PI_CAPABILITIES` with `supportsHooks: true`, `supportsExtensions: true`, `supportsSettings: false`, and `supportedHookEvents` = all five events.

- [ ] **Step 1: Update the failing test first (RED)**

In `packages/core/src/interfaces/harness-capabilities.spec.ts`, change the PI assertions to the new honest values (this is the spec for Task 1):

```ts
it("PI declares hook + extension contribution support (no settings)", () => {
  expect(PI_CAPABILITIES.supportsHooks).toBe(true);
  expect(PI_CAPABILITIES.supportsExtensions).toBe(true);
  expect(PI_CAPABILITIES.supportsSettings ?? false).toBe(false);
  expect(PI_CAPABILITIES.supportedHookEvents).toEqual(
    expect.arrayContaining([
      "session_start",
      "session_end",
      "pre_tool_use",
      "post_tool_use",
      "user_prompt_submit",
    ]),
  );
  expect(PI_CAPABILITIES.supportedHookEvents).toHaveLength(5);
});
```

Remove/replace any existing assertion that PI flags are `false`. Run: `npm run test --workspace=packages/core -- harness-capabilities` → expect FAIL (flags still false).

- [ ] **Step 2: Flip the preset (GREEN)**

In `packages/core/src/interfaces/harness-capabilities.ts`, update `PI_CAPABILITIES`:

```ts
export const PI_CAPABILITIES: HarnessCapabilities = {
  // ...existing non-contribution fields unchanged...
  supportsHooks: true,
  supportsExtensions: true,
  supportsSettings: false,
  supportedHookEvents: [
    "session_start",
    "session_end",
    "pre_tool_use",
    "post_tool_use",
    "user_prompt_submit",
  ],
};
```

Rebuild core: `npm run build --workspace=packages/core`. Run the test → expect PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/interfaces/harness-capabilities.ts packages/core/src/interfaces/harness-capabilities.spec.ts
git commit -m "feat(core): PI declares native hook + extension contribution support"
```

---

### Task 2: Pure hook → PI-extension-module source generator

**Files:**

- Create: `packages/harness-engine-pi/src/contribution-hook-extension.ts`
- Create (test): `packages/harness-engine-pi/test/contribution-hook-extension.test.ts`

**Interfaces:**

- Consumes: `HarnessHookContribution`, `HarnessHookEvent` (`@nexus/core`).
- Produces:
  - `const PI_HOOK_EVENT_BY_NEUTRAL: Record<HarnessHookEvent, "session_start" | "session_shutdown" | "before_agent_start" | "tool_call" | "tool_result">`
  - `function generateHookExtensionSource(hooks: HarnessHookContribution[]): string | null` — returns the `.ts` source of a default-export `ExtensionFactory`, or `null` when `hooks` is empty.

This task is **pure** (string generation) — no fs, no SDK. The generated source embeds hook commands and registers `pi.on(...)` handlers. Keep the generated runtime helper (shell exec) inline in the emitted source so the extension is self-contained.

- [ ] **Step 1: Write failing tests (RED)**

`packages/harness-engine-pi/test/contribution-hook-extension.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  generateHookExtensionSource,
  PI_HOOK_EVENT_BY_NEUTRAL,
} from "../src/contribution-hook-extension.js";

describe("generateHookExtensionSource", () => {
  it("returns null for no hooks (no file should be written)", () => {
    expect(generateHookExtensionSource([])).toBeNull();
  });

  it("maps neutral events to PI events", () => {
    expect(PI_HOOK_EVENT_BY_NEUTRAL).toEqual({
      session_start: "session_start",
      session_end: "session_shutdown",
      user_prompt_submit: "before_agent_start",
      pre_tool_use: "tool_call",
      post_tool_use: "tool_result",
    });
  });

  it("emits a default-export factory that registers a handler per hook", () => {
    const src = generateHookExtensionSource([
      { event: "session_start", command: "echo hi" },
      { event: "pre_tool_use", command: "guard.sh", timeoutMs: 5000 },
    ]);
    expect(src).not.toBeNull();
    expect(src as string).toContain("export default");
    expect(src as string).toContain('pi.on("session_start"');
    expect(src as string).toContain('pi.on("tool_call"');
    // pre_tool_use handler must be able to block
    expect(src as string).toContain("block");
  });

  it("safely encodes commands (no raw interpolation/injection into source)", () => {
    const src = generateHookExtensionSource([
      { event: "session_start", command: 'echo "a"; rm -rf /`backtick`' },
    ]) as string;
    // The command must be embedded as a JSON-encoded string literal, not spliced raw.
    expect(src).toContain(JSON.stringify('echo "a"; rm -rf /`backtick`'));
  });
});
```

Run: `npm run test --workspace=packages/harness-engine-pi -- contribution-hook-extension` → FAIL (module missing).

- [ ] **Step 2: Implement (GREEN)**

`packages/harness-engine-pi/src/contribution-hook-extension.ts`:

```ts
import type { HarnessHookContribution, HarnessHookEvent } from "@nexus/core";

/** Neutral hook event → PI ExtensionAPI event name. */
export const PI_HOOK_EVENT_BY_NEUTRAL: Record<
  HarnessHookEvent,
  | "session_start"
  | "session_shutdown"
  | "before_agent_start"
  | "tool_call"
  | "tool_result"
> = {
  session_start: "session_start",
  session_end: "session_shutdown",
  user_prompt_submit: "before_agent_start",
  pre_tool_use: "tool_call",
  post_tool_use: "tool_result",
};

const DEFAULT_HOOK_TIMEOUT_MS = 30_000;
const MAX_HOOK_TIMEOUT_MS = 600_000;

function clampTimeout(ms: number | undefined): number {
  if (typeof ms !== "number" || Number.isNaN(ms))
    return DEFAULT_HOOK_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(ms), 1), MAX_HOOK_TIMEOUT_MS);
}

/**
 * Generate the TypeScript source of a PI extension module (default-export
 * factory) that runs each contributed hook command on its mapped PI event.
 * Returns null when there are no hooks (caller writes no file).
 *
 * The generated module is self-contained: it embeds a small runShell helper
 * so it has no import dependency on this package at load time. Commands are
 * embedded as JSON string literals (never spliced raw) to avoid source
 * injection. A `pre_tool_use` (tool_call) hook blocks when the command exits
 * non-zero. Command output is never logged.
 */
export function generateHookExtensionSource(
  hooks: HarnessHookContribution[],
): string | null {
  if (hooks.length === 0) return null;

  const registrations = hooks
    .map((hook) => {
      const piEvent = PI_HOOK_EVENT_BY_NEUTRAL[hook.event];
      const command = JSON.stringify(hook.command);
      const timeout = clampTimeout(hook.timeoutMs);
      const blocks = piEvent === "tool_call";
      return `  pi.on(${JSON.stringify(piEvent)}, async () => {
    const code = await __runShell(${command}, ${timeout});
    ${blocks ? 'if (code !== 0) return { block: true, reason: "blocked by hook" };' : ""}
  });`;
    })
    .join("\n");

  return `// AUTO-GENERATED by @nexus/harness-engine-pi — do not edit.
import { execFile } from "node:child_process";

const __shell = process.platform === "win32" ? "cmd" : "sh";
const __shellFlag = process.platform === "win32" ? "/c" : "-c";

function __runShell(command, timeoutMs) {
  return new Promise((resolve) => {
    execFile(__shell, [__shellFlag, command], { timeout: timeoutMs }, (err) => {
      // Output is intentionally discarded — never logged (may carry secrets).
      resolve(err && typeof err.code === "number" ? err.code : err ? 1 : 0);
    });
  });
}

export default function (pi) {
${registrations}
}
`;
}
```

Run the test → expect PASS.

> Confirm-and-adjust: verify the PI `tool_call` handler result shape (`{ block?: boolean; reason?: string }`) and that `before_agent_start`/`session_*` handlers accept a no-arg-return async handler, against `types.d.ts`. Adjust the emitted handler bodies if the SDK requires a specific return. Do NOT change the public function signatures.

- [ ] **Step 3: Commit**

```bash
git add packages/harness-engine-pi/src/contribution-hook-extension.ts packages/harness-engine-pi/test/contribution-hook-extension.test.ts
git commit -m "feat(harness-engine-pi): pure PI hook-extension source generator"
```

---

### Task 3: Add `@modelcontextprotocol/sdk` + MCP client bridge → governed tools

**Files:**

- Modify: `packages/harness-engine-pi/package.json` (add dependency)
- Modify: root `package-lock.json` (via `npm install`)
- Create: `packages/harness-engine-pi/src/contribution-mcp-bridge.ts`
- Create (test): `packages/harness-engine-pi/test/contribution-mcp-bridge.test.ts`

**Interfaces:**

- Consumes: `HarnessExtensionContribution` (`@nexus/core`); `CanonicalToolDefinition`, `CheckPermission`, `wrapToolWithGovernance` (`@nexus/harness-runtime`).
- Produces:
  - `interface BridgedExtensions { tools: CanonicalToolDefinition[]; dispose(): Promise<void>; }`
  - `function bridgeExtensionsToGovernedTools(extensions: HarnessExtensionContribution[], checkPermission: CheckPermission, deps?: McpBridgeDeps): Promise<BridgedExtensions>` — connects each MCP server, enumerates tools, wraps each as a **governed** `CanonicalToolDefinition`, returns them plus a `dispose()` that closes all clients. Returns `{ tools: [], dispose: async () => {} }` for empty input.
  - `interface McpBridgeDeps { connect(ext): Promise<McpClientHandle>; }` (injectable for tests; real default uses `@modelcontextprotocol/sdk`).
  - `interface McpClientHandle { listTools(): Promise<Array<{ name: string; description?: string; inputSchema: unknown }>>; callTool(name: string, args: Record<string, unknown>): Promise<unknown>; close(): Promise<void>; }`

The bridge constructs each tool's `execute` to call `handle.callTool`, then wraps it with `wrapToolWithGovernance(bareTool, checkPermission)` so the call is gated by job ∩ profile. The tool `name` is the remote MCP tool name (so the profile must grant that name for it to be allowed); `parameters` is the remote `inputSchema` (already JSON Schema).

- [ ] **Step 1: Add the dependency**

```bash
npm install @modelcontextprotocol/sdk --workspace=packages/harness-engine-pi
```

Confirm it resolves and inspect the installed client API: read `node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts`, `.../client/stdio.d.ts`, `.../client/streamableHttp.d.ts` to confirm the import paths and method signatures named in "Grounded facts". Adjust the real-connect implementation to match the installed version.

- [ ] **Step 2: Write failing tests (RED)** — governance + proxy behavior with a fake client (no real server)

`packages/harness-engine-pi/test/contribution-mcp-bridge.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { CheckPermission } from "@nexus/harness-runtime";
import {
  bridgeExtensionsToGovernedTools,
  type McpBridgeDeps,
} from "../src/contribution-mcp-bridge.js";

function fakeDeps(toolName: string): McpBridgeDeps {
  return {
    connect: async () => ({
      listTools: async () => [
        {
          name: toolName,
          description: "remote",
          inputSchema: { type: "object" },
        },
      ],
      callTool: async (_n, args) => ({ echoed: args }),
      close: async () => {},
    }),
  };
}

const allow: CheckPermission = async () => ({ status: "allowed" });
const deny: CheckPermission = async () => ({
  status: "denied",
  reason: "not granted",
});

const ext = { name: "fs", transport: "stdio" as const, command: "srv" };

describe("bridgeExtensionsToGovernedTools", () => {
  it("returns no tools and a no-op dispose for empty input", async () => {
    const b = await bridgeExtensionsToGovernedTools([], allow, fakeDeps("x"));
    expect(b.tools).toEqual([]);
    await expect(b.dispose()).resolves.toBeUndefined();
  });

  it("registers each remote tool as a governed CanonicalToolDefinition", async () => {
    const b = await bridgeExtensionsToGovernedTools(
      [ext],
      allow,
      fakeDeps("read_file"),
    );
    expect(b.tools.map((t) => t.name)).toEqual(["read_file"]);
    expect(b.tools[0].parameters).toEqual({ type: "object" });
    await b.dispose();
  });

  it("executes the remote tool when governance allows", async () => {
    const b = await bridgeExtensionsToGovernedTools(
      [ext],
      allow,
      fakeDeps("read_file"),
    );
    const out = await b.tools[0].execute("call-1", { path: "/x" });
    expect(out).toMatchObject({ echoed: { path: "/x" } });
    await b.dispose();
  });

  it("blocks the remote tool when governance denies (no proxy call)", async () => {
    const deps = fakeDeps("read_file");
    const connectSpy = vi.spyOn(deps, "connect");
    const b = await bridgeExtensionsToGovernedTools([ext], deny, deps);
    await expect(
      b.tools[0].execute("call-1", { path: "/x" }),
    ).rejects.toThrow();
    // connect happened (to enumerate), but callTool must not run when denied.
    expect(connectSpy).toHaveBeenCalledOnce();
    await b.dispose();
  });

  it("dispose closes every connected client", async () => {
    const close = vi.fn(async () => {});
    const deps: McpBridgeDeps = {
      connect: async () => ({
        listTools: async () => [{ name: "t", inputSchema: {} }],
        callTool: async () => ({}),
        close,
      }),
    };
    const b = await bridgeExtensionsToGovernedTools([ext], allow, deps);
    await b.dispose();
    expect(close).toHaveBeenCalledOnce();
  });
});
```

Run → FAIL (module missing).

> Note on the "denied" test: governance is applied via `wrapToolWithGovernance`, whose wrapped `execute` rejects (or returns a denial) when `checkPermission` denies. Confirm the actual denial behavior of `wrapToolWithGovernance` (throw vs structured result) by reading `packages/harness-runtime/src/governance/wrap-tool.ts`, and assert accordingly — adjust `.rejects.toThrow()` to match the real contract. The invariant to prove: **when denied, `callTool` is never invoked.** If `wrapToolWithGovernance` returns a structured denial instead of throwing, assert the proxy (`callTool`) spy was not called.

- [ ] **Step 3: Implement (GREEN)**

`packages/harness-engine-pi/src/contribution-mcp-bridge.ts`:

```ts
import type { HarnessExtensionContribution } from "@nexus/core";
import {
  wrapToolWithGovernance,
  type CanonicalToolDefinition,
  type CheckPermission,
} from "@nexus/harness-runtime";

export interface McpClientHandle {
  listTools(): Promise<
    Array<{ name: string; description?: string; inputSchema: unknown }>
  >;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpBridgeDeps {
  connect(ext: HarnessExtensionContribution): Promise<McpClientHandle>;
}

export interface BridgedExtensions {
  tools: CanonicalToolDefinition[];
  dispose(): Promise<void>;
}

export async function bridgeExtensionsToGovernedTools(
  extensions: HarnessExtensionContribution[],
  checkPermission: CheckPermission,
  deps: McpBridgeDeps = defaultMcpBridgeDeps(),
): Promise<BridgedExtensions> {
  const handles: McpClientHandle[] = [];
  const tools: CanonicalToolDefinition[] = [];

  for (const ext of extensions) {
    const handle = await deps.connect(ext);
    handles.push(handle);
    const remoteTools = await handle.listTools();
    for (const remote of remoteTools) {
      const bare: CanonicalToolDefinition = {
        name: remote.name,
        description:
          remote.description ?? `MCP tool ${remote.name} (${ext.name})`,
        parameters: remote.inputSchema,
        execute: async (_callId, params) =>
          handle.callTool(remote.name, params),
      };
      // Gate by job ∩ profile exactly like every other governed tool.
      tools.push(wrapToolWithGovernance(bare, checkPermission));
    }
  }

  return {
    tools,
    dispose: async () => {
      await Promise.all(handles.map((h) => h.close().catch(() => undefined)));
    },
  };
}

function defaultMcpBridgeDeps(): McpBridgeDeps {
  return {
    connect: async (ext) => {
      // Confirm import paths/signatures against the installed
      // @modelcontextprotocol/sdk version (see Task 3 Step 1).
      const { Client } =
        await import("@modelcontextprotocol/sdk/client/index.js");
      const client = new Client(
        { name: "nexus-pi-bridge", version: "1.0.0" },
        { capabilities: {} },
      );
      if (ext.transport === "stdio") {
        const { StdioClientTransport } =
          await import("@modelcontextprotocol/sdk/client/stdio.js");
        await client.connect(
          new StdioClientTransport({
            command: ext.command as string,
            args: ext.args,
            env: ext.env,
          }),
        );
      } else {
        const { StreamableHTTPClientTransport } =
          await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        await client.connect(
          new StreamableHTTPClientTransport(new URL(ext.url as string), {
            requestInit: ext.headers ? { headers: ext.headers } : undefined,
          }),
        );
      }
      return {
        listTools: async () => {
          const res = await client.listTools();
          return res.tools.map(
            (t: {
              name: string;
              description?: string;
              inputSchema: unknown;
            }) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            }),
          );
        },
        callTool: async (name, args) =>
          client.callTool({ name, arguments: args }),
        close: async () => {
          await client.close();
        },
      };
    },
  };
}
```

Rebuild: `npm run build --workspace=packages/harness-engine-pi`. Run the test → expect PASS. (If `wrapToolWithGovernance` is not exported from `@nexus/harness-runtime`, add it to that package's barrel and rebuild it first.)

- [ ] **Step 4: Commit**

```bash
git add packages/harness-engine-pi/package.json package-lock.json \
        packages/harness-engine-pi/src/contribution-mcp-bridge.ts \
        packages/harness-engine-pi/test/contribution-mcp-bridge.test.ts
git commit -m "feat(harness-engine-pi): MCP client bridge → governed tools"
```

---

### Task 4: Integrate hooks + bridged tools into `createSession`; engine implements materializer SPI

**Files:**

- Modify: `packages/harness-engine-pi/src/pi-engine.ts`
- Create (test): `packages/harness-engine-pi/test/pi-engine.contributions.test.ts`

**Interfaces:**

- Consumes: `generateHookExtensionSource` (Task 2), `bridgeExtensionsToGovernedTools` (Task 3); `EMPTY_HARNESS_CONTRIBUTIONS` (`@nexus/core`); the three materializer interfaces + type guards (`@nexus/harness-runtime`, Phase 1).
- Produces: `PiEngine` implements `HookMaterializer`, `ExtensionMaterializer` (idempotent conformance methods); `createSession` reads `ctx.contributions` and (a) writes the generated hook extension file into `ctx.extensionsPath` **before** `resolveExtensionPaths`/`resourceLoader.reload()`, (b) bridges extensions and merges bridged governed tools into the tool set passed to `createAgentSession`, (c) disposes bridged clients on session teardown.

- [ ] **Step 1: Write failing tests (RED)**

`packages/harness-engine-pi/test/pi-engine.contributions.test.ts` — assert:

1. `PiEngine` implements the materializer SPI: `isHookMaterializer(engine) === true`, `isExtensionMaterializer(engine) === true`, `isSettingsMaterializer(engine) === false` (use guards from `@nexus/harness-runtime`).
2. With `ctx.contributions` containing one hook, `createSession` writes a `.ts` extension file into the temp `extensionsPath` whose contents include `pi.on(` (use a temp dir for `extensionsPath`; assert a generated file appears).
3. With `EMPTY_HARNESS_CONTRIBUTIONS`, `createSession` writes **no** generated extension file and bridges no servers (the extensions dir gains no nexus-generated file; tool set length equals the no-contribution baseline).
4. Bridged tools are added to the tools passed into `createAgentSession` (spy/mock `createAgentSession` to capture `customTools`/`tools`), and a denied bridged tool is present but governed.

Build the `ctx` from the real `HarnessSessionContext` shape (reuse the fixture pattern in `pi-engine.resume.spec.ts`). Mock `createAgentSession`/resource loader as those specs do. Run → FAIL.

> Confirm-and-adjust: match the existing PI engine test harness (how `pi-engine.resume.spec.ts` mocks `createAgentSession`, `DefaultResourceLoader`, `SettingsManager`). Reuse that exact mocking approach so these tests are consistent and don't hit the SDK.

- [ ] **Step 2: Implement (GREEN)**

In `packages/harness-engine-pi/src/pi-engine.ts`:

- Add materializer interface implementations to the `PiEngine` class (idempotent no-ops — the real work is in `createSession`; this mirrors the Claude Code engine and satisfies the SPI conformance rule that a declared capability is backed by its interface):

```ts
async materializeHooks(): Promise<void> {/* handled in createSession via ctx.contributions */}
async materializeExtensions(): Promise<void> {/* handled in createSession via ctx.contributions */}
```

(Match the actual SPI method names/arity from Phase 1's `contribution-materializers.types.ts`.)

- In `createSession`, before `resolveExtensionPaths(ctx.extensionsPath)` (line ~156):

```ts
const contributions = ctx.contributions ?? EMPTY_HARNESS_CONTRIBUTIONS;
const hookSource = generateHookExtensionSource(contributions.hooks);
if (hookSource) {
  fs.mkdirSync(ctx.extensionsPath, { recursive: true });
  fs.writeFileSync(
    `${ctx.extensionsPath}/${NEXUS_HOOK_EXTENSION_FILENAME}`,
    hookSource,
  );
}
```

with `const NEXUS_HOOK_EXTENSION_FILENAME = "nexus-contributed-hooks.ts";` (a `.ts` file so `resolveExtensionPaths` picks it up).

- After `convertGovernedTools(...)` and before `createAgentSession`, bridge extensions and merge:

```ts
const bridged = await bridgeExtensionsToGovernedTools(
  contributions.extensions,
  ctx.checkPermission,
);
const bridgedPiTools = convertBridgedTools(bridged.tools, onTerminate); // reuse the same adapter convertGovernedTools uses
const allTools = dedupeTools([
  ...builtInTools,
  ...governedPiTools,
  ...bridgedPiTools,
]);
```

Bridged tools are `CanonicalToolDefinition` already governance-wrapped; adapt them to PI's tool shape the same way `convertGovernedTools` does (extract the inner mapping into a shared helper so both call sites share it — DRY). Register `bridged.dispose` so it runs on session teardown (hook it into the same path that disposes/terminates the session — find where `PiHarnessSession` cleans up and call `bridged.dispose()` there).

- Empty bundle: `generateHookExtensionSource([])` → `null` (no file), `bridgeExtensionsToGovernedTools([], …)` → no tools, `dispose` no-op. So options/tool-set are unchanged — byte-identical behavior. Assert via test 3.

Rebuild + run tests → PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/harness-engine-pi/src/pi-engine.ts packages/harness-engine-pi/test/pi-engine.contributions.test.ts
git commit -m "feat(harness-engine-pi): materialize hooks + bridged MCP tools in createSession"
```

---

### Task 5: Replace the stale "no support" guard test + correct docs

**Files:**

- Delete: `packages/harness-engine-pi/test/pi-engine.contributions-unsupported.test.ts` (its assertions are now false)
- Modify: `docs/guide/41-harness-runtime.md` (the PI paragraph in the "Harness Contributions" subsection)
- Modify: `.agents/skills/*` only if a skill references PI contribution support (search; edit if found)

**Interfaces:** none (cleanup + docs).

- [ ] **Step 1: Remove the contradicted guard test**

```bash
git rm packages/harness-engine-pi/test/pi-engine.contributions-unsupported.test.ts
```

(The honest-support assertions now live in Task 1's core spec + Task 4's engine test.)

- [ ] **Step 2: Correct the guide**

In `docs/guide/41-harness-runtime.md`, replace the PI paragraph (currently "PI currently materializes no contributions…") with:

```markdown
**PI** materializes contributions natively. Hooks are emitted as a generated PI
extension module (TypeScript, loaded from the session's extensions dir): the
`tool_call` event backs `pre_tool_use` (and can block), `tool_result` backs
`post_tool_use`, and `session_start`/`session_shutdown`/`before_agent_start`
back the rest. MCP-server extensions are bridged engine-side (PI has no MCP
client): each server's tools are enumerated and registered through PI's
existing governed-tool path, so they are gated by `ctx.checkPermission`
(job ∩ profile) exactly like Claude Code and cannot widen the tool surface past
the profile ceiling. PI does not map `settings` (`supportsSettings: false`):
`env` is already applied at the container level and `outputStyle`/`permissions`
have no PI equivalent.
```

Also fix the earlier line that says PI's capability flags are `false`.

- [ ] **Step 3: Commit**

```bash
git add -A docs/guide/41-harness-runtime.md packages/harness-engine-pi/
git commit -m "docs(harness): PI materializes hooks + bridged MCP tools (correct prior spike)"
```

---

### Task 6: Governance + lifecycle integration test (security gate)

**Files:**

- Create (test): `packages/harness-engine-pi/test/pi-engine.contributions-governance.test.ts`

**Interfaces:** consumes everything above.

- [ ] **Step 1: Write the test (this is the security proof)**

Assert end-to-end through `createSession` (with mocked `createAgentSession` capturing the tool set, and an injected fake MCP bridge or fake `createAgentSession`):

1. A bridged author tool whose name the profile does NOT grant is **denied** by `ctx.checkPermission` and never proxies to `callTool`.
2. A bridged author tool the profile DOES grant proxies through.
3. Session teardown calls the bridge `dispose()` (assert the fake client `close()` ran).
4. An empty contributions bundle adds no tools and writes no extension file (byte-identical assertion repeated at the engine boundary).

Use the same DI seams introduced in Tasks 3-4 (inject `McpBridgeDeps`/fake bridge so no real MCP server is needed). Run → it should pass against the Task 4 implementation; if any assertion fails, the integration has a governance or lifecycle gap — fix it in `pi-engine.ts`, do not weaken the test.

- [ ] **Step 2: Commit**

```bash
git add packages/harness-engine-pi/test/pi-engine.contributions-governance.test.ts
git commit -m "test(harness-engine-pi): governance + lifecycle for PI contributions"
```

---

## Phase 2 (revised) Completion Check

- [ ] `npm run test --workspace=packages/core -- harness-capabilities` — green (PI flags honest)
- [ ] `npm run test --workspace=packages/harness-engine-pi -- contribution-hook-extension` — green
- [ ] `npm run test --workspace=packages/harness-engine-pi -- contribution-mcp-bridge` — green
- [ ] `npm run test --workspace=packages/harness-engine-pi -- pi-engine.contributions` — green
- [ ] `npm run test --workspace=packages/harness-engine-pi -- contributions-governance` — green
- [ ] `npm run build --workspace=packages/harness-engine-pi` — clean
- [ ] Old `pi-engine.contributions-unsupported.test.ts` removed; spec §4/§9/§10 + guide corrected
- [ ] Pre-existing unrelated PI failures (`resourceLoader.reload`) are NOT touched by this work and remain out of scope

PI now materializes hooks (generated extension) and MCP extensions (governed bridge). Governance is preserved (job ∩ profile via `wrapToolWithGovernance`); empty bundle is byte-identical; settings stay honestly unsupported.

## Out of Scope

- PI `settings` materialization (`outputStyle`/`permissions`) — no faithful mapping.
- Reconnect/retry policy for flaky MCP servers beyond connect-or-fail + dispose-on-teardown.
- Streaming/partial MCP tool results — `callTool` result is returned whole.
