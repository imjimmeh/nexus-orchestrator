# Harness Plugins & Extensions — Authoring, Persistence, and External Import — Design Spec

**Epic:** [EPIC-211](../../epics/EPIC-211-harness-plugins-extensions-authoring-and-import.md) · **Builds on:** EPIC-210 (harness-native contributions), EPIC-196 (pluggable harness runtime) · **Reuses:** `apps/api/src/mcp` (existing MCP server runtime) · **Status:** Proposed

## 1. Overview

EPIC-210 delivered a harness-neutral _contribution_ model — hook **definitions** (event + shell command string), an MCP-server **reference** shape, and a settings bag — materialized natively by `pi` and `claude-code`. This design adds the two capabilities the real harnesses ship natively and that EPIC-210 deliberately left out:

1. **Harness-native plugins/extensions as first-class, persisted, materializable units** — Claude Code **plugins** (bundles of hooks + slash commands + MCP servers + subagents) and PI **extensions** (TS modules registering tools/commands/hooks/providers via `ExtensionAPI`).
2. **Author-your-own + import-from-external-source** — author and persist plugin/extension/hook **code** in the Web app (DB-backed), and import from external sources (Claude Code marketplaces/git, PI extension packages) pinned + checksummed + persisted.

The unifying abstraction is a **harness asset**: a DB-persisted, scoped, versioned, immutable unit carrying _source/bundle bytes_ (not just a reference), with provenance (`authored` | `git` | `registry`). The EPIC-210 precedence resolver (step → profile → skill → platform) is reused to gather asset references; each engine **stages real code into the execution container** at session creation.

**Hard boundary — MCP servers are not re-invented.** `apps/api/src/mcp` already owns MCP servers (DB entity, runtime manager, reconciliation loop, stdio/http transports, governance linkage). Any MCP server a plugin declares is registered/resolved through that runtime. EPIC-210's inline `HarnessExtensionContribution` is reconciled to point at it (§7).

## 2. Design Principles

- **Reuse over reinvention.** MCP servers → `apps/api/src/mcp`. Precedence/resolution → EPIC-210 resolver. PI hook-file staging → extend the EPIC-210 generated-extension path. Nexus-internal plugins (EPIC-188) are a different layer — never conflated.
- **Engine-side materialization** (EPIC-196 boundary). `apps/api` only ever handles the neutral asset bundle; each engine maps it to its native plugin/extension format and stages code.
- **Immutable, pinned, offline-at-runtime.** Imported external code is fetched, checksummed, pinned by commit/digest, and persisted ahead of execution. Containers never reach a marketplace mid-run.
- **Governed by construction.** Every tool a plugin/extension contributes flows through `job ∩ profile` (`wrapToolWithGovernance` / `canUseTool`). A plugin cannot widen the tool surface past the profile ceiling. Hook/extension code is bounded; output is never logged; credentials are secret-store refs only.
- **Honest capabilities.** New `HarnessCapabilities` flags drive drop-with-diagnostics for unsupported asset kinds — never silent, never fatal. Empty asset set ⇒ byte-identical to pre-epic behavior.
- **Spike before transcribe.** EPIC-210's PI spike was wrong; the CC plugin-loading contract and the exact external-install formats are **spike-gated** here (§9, §10).

## 3. Canonical Contracts (`@nexus/core`)

New harness-neutral, zod-validated types (following `ai-config` schema conventions). Additive to EPIC-210's `HarnessContributions`.

```ts
// Provenance — always resolves to an immutable, checksummed snapshot.
export type HarnessAssetSource =
  | { kind: "authored" }
  | { kind: "git"; repo: string; ref: string; subdir?: string }
  | { kind: "registry"; name: string; version: string };

// A hook is promoted from a bare command to an asset: either an authored
// script (source + language) OR a plain command (EPIC-210 back-compat).
export type HarnessHookAsset = {
  event: HarnessHookEvent;
  matcher?: string;
  timeoutMs?: number;
} & (
  | { script: { language: "bash" | "node" | "python"; source: string } }
  | { command: string }
);

// A PI-style extension module/package.
export interface HarnessExtensionAsset {
  id: string;
  name: string;
  runtime: "ts-module" | "package";
  entry: string; // default-export ExtensionFactory module path within the bundle
  source: HarnessAssetSource;
  checksum: string;
}

// A Claude-Code-style plugin: a bundle that may carry hooks, slash commands,
// subagents, and MCP-server references (the latter resolved via apps/api/src/mcp).
export interface HarnessPlugin {
  id: string;
  name: string;
  version: string;
  source: HarnessAssetSource;
  checksum: string;
  capabilities: {
    hooks?: HarnessHookAsset[];
    slashCommands?: string[];
    subagents?: string[];
    mcpServerRefs?: string[]; // ids into apps/api/src/mcp
  };
  manifest: Record<string, unknown>; // native manifest (e.g. CC plugin.json)
}

// Extends EPIC-210's resolved bundle.
export interface HarnessContributions {
  hooks: HarnessHookAsset[]; // was HarnessHookContribution[]
  extensions: HarnessExtensionAsset[]; // PI extension assets (NOT MCP servers)
  plugins: HarnessPlugin[]; // NEW
  settings: HarnessSettingsContribution;
}
```

`HarnessExtensionContribution` (EPIC-210's inline MCP reference) is **removed** from the neutral model; MCP servers are referenced by id into the API MCP runtime (§7). This is the one breaking reconciliation; it is contained to the contribution model (no live authored data references it yet).

## 4. Capability Flags (`HarnessCapabilities`)

```ts
supportsPlugins?: boolean;              // claude-code: true (S1-confirmed), pi: false
supportsExtensionPackages?: boolean;    // pi: true, claude-code: false
supportedAssetSources?: HarnessAssetSourceKind[]; // e.g. ["authored","git"]
```

`supportsPlugins` for `claude-code` is no longer provisional (spike S1 complete; Phase 3 implemented). Drop-with-diagnostics reuses EPIC-210's `harness_contribution_dropped` ledger event with `contributionType: "plugin" | "extension"`.

## 5. Asset Store (`apps/api`)

- New entity/table `harness_assets` (+ migration): `id`, `kind` (`plugin` | `extension` | `hook_script`), `name`, `version`, `source` (jsonb provenance), `checksum`, `bundle` (bytes/text or object-store ref), `scope_node_id` (nullable = platform-global), `created_at`. Immutable rows; new version = new row.
- Authored assets and imported snapshots share the table; `source.kind` distinguishes them.
- Profiles / steps / skills reference assets **by id** (extending `agent_profiles.harness_contributions` and `steps[].inputs` with `pluginRefs` / `extensionRefs`). The resolver hydrates ids → asset rows during gather (§6).
- Large bundles MAY live in object storage with the row holding a ref + checksum; v1 may inline small text bundles.

## 6. Resolution & Hydration (`apps/api/src/harness`)

Extend the EPIC-210 resolver:

1. `gatherContributionSources` also collects `pluginRefs` / `extensionRefs` from each surface (step/profile/skill).
2. A new hydration step loads referenced `harness_assets` rows (verifying checksum), producing `HarnessPlugin[]` / `HarnessExtensionAsset[]`.
3. Precedence-merge (step → profile → skill → platform) and de-dup by `id`.
4. Capability-gate against the resolved harness; drop-with-diagnostics for unsupported kinds.
5. Plugin `mcpServerRefs` are resolved against `apps/api/src/mcp` and handed to the engine the same way EPIC-210 handed MCP references (so the existing MCP runtime owns them).

## 7. Reconciling MCP with `apps/api/src/mcp`

- The neutral model no longer carries an inline MCP-server definition. Plugins reference MCP servers **by id** (`mcpServerRefs`).
- The resolver resolves those ids via the MCP runtime (`mcp-server.repository` / `mcp-runtime-manager.service`) and passes resolved server descriptors to the engine.
- **PI engine:** the existing EPIC-210 MCP bridge (`bridgeExtensionsToGovernedTools`) is refactored to take resolved descriptors from the MCP runtime instead of inline contributions — same governed-tool path, single source of MCP truth.
- **Claude Code engine:** plugin MCP refs map to the SDK `mcpServers` option exactly as EPIC-210 already does, sourced from the MCP runtime.

## 8. Engine Materialization

### 8.1 PI (concrete — extension loading is confirmed)

- PI loads extension modules from `ctx.extensionsPath` (jiti, default-export `ExtensionFactory`; `loadExtensions(paths)` / `discoverAndLoadExtensions`). EPIC-210 already generates and stages one extension file there.
- **Extension assets:** stage the asset bundle (a `.ts`/package with a default-export factory) into `ctx.extensionsPath`; PI loads it natively. Provider-registering extensions use `pi.registerProvider`.
- **Authored hook code:** instead of inlining the command string (EPIC-210), write the authored **script** to a staged file and have the generated extension invoke that file path (bounded, output discarded).
- Lifecycle: staged files live for the session; cleanup on teardown (extend EPIC-210's dispose path).

### 8.2 Claude Code (S1-confirmed — implemented in Phase 3)

Spike S1 confirmed: `@anthropic-ai/claude-agent-sdk@0.3.170` exposes a first-class programmatic `plugins` field on the `Options` type (`sdk.d.ts:1722–1736`, `SdkPluginConfig` at `sdk.d.ts:3776–3787`). No managed-settings file, marketplace network call, or `~/.claude` mutation is required for a `type: "local"` plugin. The exact staging contract is:

**SDK option** (added to the existing `sdk.query({ options })` call):

```ts
plugins: [{ type: "local", path: "/abs/path/to/<plugin-name>" }];
```

**Staged layout per plugin** (under `<agentDir>/plugins/<plugin-name>/`):

```
<plugin-root>/
  .claude-plugin/
    plugin.json    # manifest — only `name` (kebab-case) is hard-required
  hooks/
    hooks.json     # auto-loaded; same Settings hooks shape (event-keyed, type:"command")
  .mcp.json        # only when plugin declares MCP servers; may carry resolved secrets
```

**Implementation details** (from Task 3 / `plugin-staging.ts` + `plugin-sdk-mappers.ts`):

- `stagePlugins(contributions, agentDir)` is called inside `createSession`; it delegates pure mapping to `mapPluginsToNativeArtifact` then writes files and returns a `{ pluginOption, dispose }` pair.
- `pluginOption` is `{}` for an empty plugin list — the no-plugin path is byte-identical to pre-EPIC-211 (locked by regression test).
- The `dispose` callback removes all staged plugin directories via `rm({ recursive: true, force: true })` on session teardown.

**Plugin MCP governance.** Plugin MCP servers surface as `mcp__<server>__<tool>` and are gated by the session-wide `canUseTool` → `ctx.checkPermission` callback — the same gate as kernel and author-extension tools. They are declared in the staged `.mcp.json` (not in `options.mcpServers`) and merged by the SDK plugin loader. `strictMcpConfig` MUST NOT be set; it would suppress plugin MCP.

**SPI conformance.** `ClaudeCodeEngine` implements `PluginMaterializer` (`isPluginMaterializer(engine) === true`). The `supportsPlugins: true` capability and the SPI materializer are in agreement — no longer provisional. See `test/claude-code-engine.plugins-governance.test.ts` for the governance + conformance assertions.

## 9. Spikes (must complete before the gated workstreams)

- **S1 — Claude Code plugin loading.** Determine the exact mechanism the installed `@anthropic-ai/claude-agent-sdk` / CLI uses to load a plugin: programmatic option vs `.claude` filesystem layout + manifest schema (`plugin.json`, marketplace manifest). Output: the staging contract for Workstream D.
- **S2 — External install formats.** Pin the on-disk/native format an imported CC plugin and an imported PI extension package must take to be loaded (directory layout, manifest, entry resolution). Output: the import-materialization contract for Workstream E.
- **S3 — PI extension packaging.** Confirm whether a multi-file/packaged extension can be staged as a directory or must be a single module; confirm provider-registration timing. (Largely known from EPIC-210; confirm packaging.)

## 10. Security Model

- **Supply chain.** External assets pinned by commit/digest + checksum-verified on import and again before staging; manifest validation; size caps; optional denylist. No live network at run time.
- **Trust tiers (open question §12).** Authored code = author trust; imported code MAY warrant stricter isolation. v1: both run in the existing execution container at author trust, with bounded execution and no-secret-logging; isolation hardening tracked as follow-up.
- **Tool governance.** Any tool a plugin/extension exposes is gated by `job ∩ profile` (PI: `wrapToolWithGovernance`; CC: `canUseTool`). No widening past the profile ceiling.
- **Secrets.** Extension/plugin env/headers are secret-store refs, resolved engine-side, never logged. Hook/extension stdout/stderr never logged.

## 11. Authoring & Import UX (`apps/web`)

- Replace/augment EPIC-210's raw-JSON field with a **structured editor**: per-hook code field (language + source), plugin assembler (attach hooks/commands/subagents/MCP-server refs), and extension authoring.
- **Import flow:** paste a git/marketplace/registry source → server fetches + pins + previews manifest → operator confirms → persisted as an immutable asset → attachable to a profile/step/skill.
- Presentation-only components; fetch/pin/validate logic in API services (web quality gate).

## 12. Open Questions

- Isolation level for imported vs authored code (same container/trust vs stricter sandbox for imported)?
- Asset scoping/versioning: platform-global vs project-scoped vs profile-pinned; upgrade/rollback semantics for imported snapshots.
- Should authored assets be promotable into / shared via the skill library (overlap with EPIC-101)?
- Object-store vs inline bundle storage threshold.

## 13. File / Module Map

| Area                 | Location                                                                  |
| -------------------- | ------------------------------------------------------------------------- |
| Canonical contracts  | `packages/core/src/interfaces/harness-*.types.ts` + `schemas/ai-config/*` |
| Capabilities         | `packages/core/src/interfaces/harness-capabilities.ts`                    |
| Asset store          | `apps/api/src/harness/assets/*` (entity, repository, service) + migration |
| Resolver hydration   | `apps/api/src/harness/harness-contribution-resolver.ts` + gather helpers  |
| MCP reconciliation   | `apps/api/src/mcp/*` (reused) + resolver wiring                           |
| PI materialization   | `packages/harness-engine-pi/src/*` (extend EPIC-210 staging + MCP bridge) |
| CC materialization   | `packages/harness-engine-claude-code/src/*` (spike-gated)                 |
| Import pipeline      | `apps/api/src/harness/import/*`                                           |
| Web authoring/import | `apps/web/src/pages/agents/*` + import flow                               |

## 14. Phasing → Implementation Plans

- **Phase 1 — Asset foundation** (Workstream A): contracts + capabilities + `harness_assets` store + migration + resolver hydration + MCP reconciliation. _Spike-independent._
- **Phase 2 — Author-your-own + PI staging** (Workstreams B + C): web structured editor + DB persistence + PI extension/hook-code staging. _Spike-independent (PI confirmed)._
- **Phase 3 — Claude Code plugins** (Workstream D): spike S1 → native plugin staging. _Spike-gated._
- **Phase 4 — External-source import** (Workstream E): spikes S2/S3 → fetch/pin/vet/persist + import UI + per-harness install materialization. _Spike-gated._
- Security hardening + `docs/guide` (Workstream F) folded into each phase.

Each plan lives in `docs/superpowers/plans/2026-06-23-harness-plugins-phase{1..4}-*.md`.
