# Harness-Native Contributions — Design

> Spec for **EPIC-210** (`docs/epics/EPIC-210-harness-native-contributions.md`). Builds on EPIC-196's pluggable harness runtime.

**Status:** Approved for planning
**Created:** 2026-06-23
**Owner:** Runtime Platform / Harness Runtime

---

## 1. Context & Goals

EPIC-196 delivered a pluggable harness runtime: `HarnessEngine` (validate/createSession), `HarnessCapabilities`, a self-registering engine registry, and two built-in engines (`pi`, `claude-code`). It deliberately stopped at _execution_ — the only per-agent customization that flows into a session today is **skills** (mounted at `capabilities.skillsContainerPath`) and **governed tools** (mounted at `extensionsPath`, gated by `job ∩ profile`).

This design adds an author-facing **contribution model** so operators can declare **hooks**, **extensions (MCP servers)**, and **settings** once — in agent profiles, workflow steps, or skill bundles — and have each concrete harness materialize them into its native format. Coverage targets the two built-in harnesses.

Decisions locked during brainstorming:

- **Capabilities in scope:** hooks, extensions/MCP servers, settings. **Slash commands are out of scope** (future contribution type; the contracts must not preclude it).
- **Driver:** author-facing customization (not internal governance plumbing).
- **Interface shape:** separate per-feature materializer interfaces, each engine implements independently.
- **Authoring surfaces:** agent profiles, workflow steps, and skill bundles, with precedence merging.
- **Materialization site:** **engine-side** (option A) — each engine writes its own native artifacts at session creation, keeping harness internals behind the EPIC-196 boundary.

## 2. Architecture Overview

```
author (profile / step inputs / skill manifest)
  │
  ▼  apps/api
HarnessContributionResolver
  • merge by precedence: step → profile → skill-bundle → platform default
  • validate each contribution against the RESOLVED harness's capabilities
  • drop-with-diagnostics for unsupported types/events (event-ledger)
  │  → HarnessContributions bundle
  ▼  attach to HarnessRuntimeConfig.contributions, sent over websocket
kernel.startKernel()  (in-container, @nexus/harness-runtime)
  • client.waitForConfig() → runtimeConfig.contributions
  • passes bundle into HarnessSessionContext.contributions
  • invokes engine materializers the engine implements + capabilities admit
  ▼
engine.createSession(config, ctx)
  • PiEngine / ClaudeCodeEngine implement HookMaterializer / ExtensionMaterializer / SettingsMaterializer
  • writes native artifacts using paths it owns (agentDir, workspace)
  ▼
native harness loads hooks / MCP servers / settings at session start
```

Two invariants:

1. **Boundary preservation.** `apps/api` only ever handles the harness-neutral `HarnessContributions` bundle. It never writes `settings.json` or knows Claude Code's on-disk format. All native-format knowledge lives inside the engine packages.
2. **Governance by construction.** Extension-provided MCP tools enter the _same_ tool catalog and are gated by the existing `checkPermission` / `job ∩ profile` flow. A contribution can never widen an agent's tool surface beyond its profile ceiling. Hooks run shell, so hook commands are bounded (timeout) and validated against policy; secrets are never logged.

## 3. Canonical Contracts (`@nexus/core`)

New file `packages/core/src/interfaces/harness-contributions.types.ts`, exported from the package barrel. Harness-neutral, author-facing. Zod schemas live alongside in `packages/core/src/schemas/ai-config/harness-contributions.schema.ts` (following the existing `ai-config` schema convention) and the types are inferred from / kept in sync with the schemas.

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
  /** Shell command run by the native harness when the event fires. */
  command: string;
  /** Hard ceiling; engines clamp to their own max. */
  timeoutMs?: number;
}

export type HarnessExtensionTransport = "stdio" | "http";

/** An MCP server the harness should register for the session. */
export interface HarnessExtensionContribution {
  name: string;
  transport: HarnessExtensionTransport;
  /** stdio transport */
  command?: string;
  args?: string[];
  /** http transport */
  url?: string;
  /** Env passed to a stdio server; values may be secret_store refs. */
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

## 4. Capabilities Additions (`HarnessCapabilities`)

Extend the interface in `packages/core/src/interfaces/harness.types.ts` with honest, optional flags (optional so existing custom-harness definitions in the DB remain valid; the resolver treats absent as `false`/`[]`):

```ts
export interface HarnessCapabilities {
  // ...existing fields...
  supportsHooks?: boolean;
  supportsExtensions?: boolean;
  supportsSettings?: boolean;
  /** Hook events this harness can natively fire; subset of HarnessHookEvent. */
  supportedHookEvents?: HarnessHookEvent[];
}
```

Honest values (PI spike resolved — see §9/§10):

| Capability            | `pi`                                                                                  | `claude-code`                                                                         |
| --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `supportsHooks`       | `true`                                                                                | `true`                                                                                |
| `supportedHookEvents` | `["session_start","session_end","pre_tool_use","post_tool_use","user_prompt_submit"]` | `["session_start","session_end","pre_tool_use","post_tool_use","user_prompt_submit"]` |
| `supportsExtensions`  | `true`                                                                                | `true`                                                                                |
| `supportsSettings`    | `false`                                                                               | `true`                                                                                |

The original PI spike was wrong. `@earendil-works/pi-coding-agent@0.78.x` exposes a full extension system (`ExtensionAPI`): the `tool_call` event fires **before** a tool and _can block and mutate args_; `tool_result` fires **after** and _can modify the result_; `session_start`, `session_shutdown`, and `before_agent_start` cover the remaining hook events. PI extensions are TypeScript modules loaded from `ctx.extensionsPath` (already wired in our engine), so hooks materialize by generating an extension module. PI has no MCP _client_, so author MCP-server "extensions" are bridged engine-side: each server's tools are enumerated and registered through PI's existing governed-tool path (`wrapToolWithGovernance` → `ctx.checkPermission`, job ∩ profile), so they cannot widen the surface past the profile ceiling. `supportsSettings` stays `false` for PI — `env` is already applied at the container level and `outputStyle`/`permissions` have no faithful PI mapping.

## 5. Materializer SPI (`@nexus/harness-runtime`)

New file `packages/harness-runtime/src/engine/contribution-materializers.ts`, three optional interfaces (separate per the locked decision). An engine implements only what it supports.

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
  return typeof (e as HookMaterializer).materializeHooks === "function";
}
export function isExtensionMaterializer(e: object): e is ExtensionMaterializer {
  return (
    typeof (e as ExtensionMaterializer).materializeExtensions === "function"
  );
}
export function isSettingsMaterializer(e: object): e is SettingsMaterializer {
  return typeof (e as SettingsMaterializer).materializeSettings === "function";
}
```

`HarnessSessionContext` gains a `contributions` field so materializers and engines can read the bundle:

```ts
export interface HarnessSessionContext {
  // ...existing fields...
  contributions: HarnessContributions;
}
```

## 6. Runtime Config + Kernel Wiring

`HarnessRuntimeConfig` (in `@nexus/core`) gains `contributions?: HarnessContributions`. It is delivered to the container via the existing `client.waitForConfig()` path — no new transport.

In `kernel.startKernel()` (step 6, building `ctx`):

```ts
const ctx: HarnessSessionContext = {
  governedTools,
  toolCatalog: buildToolCatalog(rawTools),
  checkPermission,
  workspacePath: envConfig.workspacePath,
  agentDir: DEFAULT_AGENT_DIR,
  extensionsPath: envConfig.extensionsPath,
  sessionPath: envConfig.sessionPath,
  contributions: runtimeConfig.contributions ?? EMPTY_HARNESS_CONTRIBUTIONS,
};

await applyContributions(engine, ctx);
```

`applyContributions` (new `packages/harness-runtime/src/engine/apply-contributions.ts`) is the single dispatch point — it checks both the engine's capability flags and the `is*Materializer` type guards before calling each materializer, so a capability/implementation mismatch is a no-op rather than a crash:

```ts
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

Engines therefore stay free of dispatch logic; they only implement the materializer methods they support. Materialization happens once, before the first `prompt()`, because `applyContributions` runs at kernel bootstrap.

## 7. Resolver + Precedence + Governance (`apps/api`)

New `apps/api/src/harness/harness-contribution-resolver.ts`, mirroring the structure of `harness-runtime-selection.ts` and `harness-diagnostics.ts`.

```ts
export interface ContributionSource {
  origin: "step" | "profile" | "skill" | "platform";
  contributions: Partial<HarnessContributions>;
}

export interface ResolveContributionsParams {
  harnessId: HarnessId;
  capabilities: HarnessCapabilities;
  sources: ContributionSource[]; // highest precedence first
  ledger?: { emitBestEffort: (payload: unknown) => unknown };
}

export function resolveHarnessContributions(
  params: ResolveContributionsParams,
): HarnessContributions;
```

Behaviour:

- **Merge precedence:** step → profile → skill → platform. Hooks/extensions concatenate (de-duplicated by `event+matcher+command` / `name`); settings deep-merge with higher precedence winning per key.
- **Capability validation:** drop any hook whose `event` is not in `supportedHookEvents`; drop all hooks if `!supportsHooks`, all extensions if `!supportsExtensions`, settings if `!supportsSettings`. Each drop emits a best-effort `harness_contribution_dropped` ledger event `{ harnessId, type, reason, origin }` — never a hard failure, never silent.
- **Governance handoff:** extension MCP servers do not get a bypass. The resolved extensions are materialized by the engine, but their _tools_ still arrive through the kernel's mounted-tool + `checkPermission` flow; the resolver additionally annotates extension tools so the API's tool-policy layer treats them as subject to `job ∩ profile`. (Detailed wiring lands in Phase 3 alongside Claude Code MCP materialization.)

Call site: the resolver runs wherever `HarnessRuntimeConfig` is assembled for a step/subagent (alongside `resolveRunnerHarness`), and the result is attached as `runtimeConfig.contributions`.

## 8. Authoring Surfaces (Phase 4) — **delivered**

| Surface          | Storage                                                                     | Precedence |
| ---------------- | --------------------------------------------------------------------------- | ---------- |
| Workflow step    | `steps[].inputs.harness_contributions` (workflow YAML)                      | highest    |
| Agent profile    | new `agent_profiles.harness_contributions` jsonb column (+ migration)       | middle     |
| Skill bundle     | `contributions` block in the skill manifest, surfaced via the skill catalog | lower      |
| Platform default | static default (currently empty)                                            | lowest     |

Each surface is validated by the same zod schema from §3 at author/seed time (`validate:seed-data`).

**Delivered (Phase 4).** `HarnessContributionsInputSchema` (any-subset author
input with transport-coherence enforcement) + `IAgentProfile.harness_contributions`
in `@nexus/core`; the `agent_profiles.harness_contributions` jsonb column +
migration `AddAgentProfileHarnessContributions20260624000000`; the pure
`gatherContributionSources` (step → profile → skill, drop-invalid) and
`AgentProfileResolutionService.resolveContributions`; resolver wiring at both the
step config assembly (`buildStepRunnerConfigPayloadCore` via
`attachResolvedContributions`) and the subagent container-config operation; and a
web "Harness Contributions" JSON editor on the agent profile form. The author-trust
boundary for hook commands is documented in
[`docs/guide/41-harness-runtime.md`](../../guide/41-harness-runtime.md#authoring-harness-contributions)
(worked example: profile installing an MCP server + a `SessionStart` hook).

## 9. Native Materialization (spike-resolved)

**Claude Code (Phase 3) — programmatic, not files.** The spike found the Claude Agent SDK accepts hooks, MCP servers, and settings **programmatically via the `query({ options })` object** — no on-disk `settings.json`/`.mcp.json` write is needed. The engine reads `ctx.contributions` in `createSession` and merges converted fragments into the existing `options`:

- `HookMaterializer` → `options.hooks`: map neutral `HarnessHookEvent` → SDK names (`SessionStart`/`SessionEnd`/`PreToolUse`/`PostToolUse`/`UserPromptSubmit`); each hook becomes a callback that runs the author command (bounded by `timeoutMs`, output never logged).
- `ExtensionMaterializer` → merge author MCP servers into `options.mcpServers` alongside the kernel server (`{ type: "stdio"|"http", … }`).
- `SettingsMaterializer` → `options.settings` (`permissions`, `outputStyle`) + merge `settings.env` into `options.env`.

Because the SDK invokes `canUseTool` for **every** tool call — including author MCP tools — extension tools are gated by `ctx.checkPermission` (job ∩ profile) with no bypass. The engine still implements all three materializer interfaces (required by the SPI conformance rule); `ctx.contributions` is the single source of truth, so the interface methods are idempotent and the merge happens in `createSession`. (Secret refs in extension `env`/`headers` reuse `secret_store`, resolved engine-side, never logged.)

> **Implemented (Phase 3).** Pure converters live in `packages/harness-engine-claude-code/src/contribution-sdk-mappers.ts` (`toSdkHooks` / `toSdkMcpServers` / `toSdkSettings`, plus `deriveContributionQueryFragments` which the engine spreads into `options`). The merge is additive-only: `deriveContributionQueryFragments(EMPTY_HARNESS_CONTRIBUTIONS)` yields empty fragments, so an empty bundle produces **byte-identical** `query({ options })` to the pre-contribution path (locked by a regression test). Author MCP tools route through the existing `canUseTool` → `checkPermission` callback (governance passthrough test asserts a denied author tool returns `behavior: "deny"`).

**PI (Phase 2 — corrected).** The original spike was wrong: PI has a full extension
system, not observational-only events. PI materializes contributions natively:

- **Hooks** → a generated TypeScript extension module (default-export
  `ExtensionFactory`) written into `ctx.extensionsPath` (already loaded by our
  engine via jiti). It registers `pi.on(...)` handlers that run the author's
  shell command: `session_start`→`session_start`, `session_end`→`session_shutdown`,
  `user_prompt_submit`→`before_agent_start`, `pre_tool_use`→`tool_call` (which
  **can block** via `{ block: true }` on non-zero exit), `post_tool_use`→`tool_result`.
- **Extensions (MCP servers)** → PI has no MCP client, so each author MCP server
  is bridged **engine-side**: an MCP client (`@modelcontextprotocol/sdk`) connects
  (stdio/http), enumerates tools, and each remote tool becomes a
  `CanonicalToolDefinition` whose `execute` proxies `callTool`. These are run
  through `wrapToolWithGovernance(tool, ctx.checkPermission)` and added to the PI
  tool set, so every author tool is gated by job ∩ profile exactly like Claude
  Code — allowed only if the profile also grants it (no widening past the ceiling).
  Bridged client connections are disposed on session teardown.
- **Settings** → `supportsSettings: false`; `env` is already applied at the
  container level and `outputStyle`/`permissions` have no faithful PI mapping.

An empty bundle generates no extension file and bridges no servers, so PI behavior
is byte-identical to pre-contribution. New dependency: `@modelcontextprotocol/sdk`
in `packages/harness-engine-pi`.

## 10. Open Questions

- **PI native surfaces — Resolved (re-spike corrected).** The first spike was wrong. PI has a full extension system: hooks materialize via a generated extension module (`tool_call` can block, `tool_result` can modify, plus session/prompt events); MCP-server extensions are bridged engine-side through `wrapToolWithGovernance` (job ∩ profile). `supportsHooks`/`supportsExtensions` are `true`; `supportsSettings` stays `false`. See §9.
- **Secret handling for extensions.** Reuse `secret_store` references (resolved engine-side) rather than inlining credentials — confirm the in-container resolution path.
- **Skill-bundle opt-in.** Are skill-provided contributions auto-applied when the skill is mounted, or opt-in per profile? Default proposal: auto-applied but lowest precedence, overridable/removable by profile/step.
- **Slash commands.** Tracked as a future fourth contribution type; contracts in §3 are additive-friendly.

## 11. File Structure

| File                                                                    | Responsibility                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `packages/core/src/interfaces/harness-contributions.types.ts`           | Canonical contribution types + `EMPTY_HARNESS_CONTRIBUTIONS`    |
| `packages/core/src/schemas/ai-config/harness-contributions.schema.ts`   | Zod schemas (author/seed validation)                            |
| `packages/core/src/interfaces/harness.types.ts` (modify)                | Capability flags                                                |
| `packages/core/src/interfaces/harness-capabilities.ts` (modify)         | Honest values on `PI_CAPABILITIES` / `CLAUDE_CODE_CAPABILITIES` |
| `packages/core/src/interfaces/harness-runtime-config.types.ts` (modify) | `contributions?` field                                          |
| `packages/harness-runtime/src/engine/contribution-materializers.ts`     | SPI interfaces + type guards                                    |
| `packages/harness-runtime/src/engine/apply-contributions.ts`            | Capability-gated dispatch                                       |
| `packages/harness-runtime/src/engine/session-context.types.ts` (modify) | `contributions` on `HarnessSessionContext`                      |
| `packages/harness-runtime/src/kernel.ts` (modify)                       | Populate `ctx.contributions` + call `applyContributions`        |
| `apps/api/src/harness/harness-contribution-resolver.ts`                 | Precedence merge + capability validation + diagnostics          |
| `apps/api/src/harness/harness-contribution-resolver.types.ts`           | Resolver param/source types                                     |
| `packages/harness-engine-pi/src/*` (Phase 2)                            | PI materializers                                                |
| `packages/harness-engine-claude-code/src/*` (Phase 3)                   | Claude Code materializers                                       |
| `apps/api` profile/step/skill wiring (Phase 4)                          | Authoring surfaces + UI + docs                                  |

## 12. Testing Strategy

- **Unit (core):** zod schema accepts valid / rejects invalid contributions; `EMPTY_HARNESS_CONTRIBUTIONS` shape.
- **Unit (harness-runtime):** `applyContributions` calls only the materializers admitted by capabilities + implemented by the engine; no-ops otherwise. Type guards.
- **Unit (api):** resolver precedence (step > profile > skill > platform), de-dup, settings deep-merge, drop-with-diagnostics for unsupported events/types (assert ledger payloads).
- **SPI conformance:** extend `packages/harness-runtime/test/engine/spi-contract.test.ts` so any engine declaring a `supports*` flag must implement the matching materializer.
- **Governance:** contract test asserting an extension cannot surface a tool outside `job ∩ profile`.
- **Live smoke (per engine phase):** author a contribution, run a real step, assert the native artifact exists and the agent sees the effect.

## 13. Phasing (matches EPIC-210 §7, with the P2/P3 swap)

Each phase has its own full bite-sized implementation plan under `docs/superpowers/plans/`:

- **Phase 1 — Foundation** (`…-phase1-foundation.md`): contracts, capability flags, SPI + `applyContributions`, kernel wiring, resolver. No behavior change (every harness ships empty contributions until an authoring surface populates them).
- **Phase 2 — PI parity & spike** (`…-phase2-pi.md`): spike resolved → PI declares no native support; guard test locks the honest flags; docs.
- **Phase 3 — Claude Code materializers** (`…-phase3-claude-code.md`): programmatic merge of hooks/MCP/settings into the SDK `query` options, governed via `canUseTool`.
- **Phase 4 — Authoring surfaces** (`…-phase4-authoring.md`): profile column + migration, step inputs, skill metadata, resolver call-site wiring (step + subagent), web UI, docs.
