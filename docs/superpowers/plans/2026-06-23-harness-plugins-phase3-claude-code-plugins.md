# Harness Plugins & Extensions — Phase 3 (Claude Code Plugins) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **SPIKE-GATED.** Task 1 (spike S1) pins the Claude Code plugin-loading contract against the installed SDK/CLI. **Do not transcribe Tasks 2+ until S1's findings are recorded** — the exact staging shape (programmatic option vs `.claude` filesystem layout + manifest schema) is unknown today and EPIC-210 proved that guessing a harness SDK contract is costly. Tasks 2+ below describe the work and its tests; their exact code is finalized from S1.

**Goal:** Materialize harness-neutral `HarnessPlugin` assets natively for the `claude-code` engine, so a persisted/imported plugin's hooks, slash commands, subagents, and (via the existing MCP runtime) MCP servers load in a real Claude Code session — governed and empty-bundle-safe.

**Architecture:** The programmatic SDK path our engine uses (EPIC-210) exposes `mcpServers`/`hooks`/`settings` but no confirmed first-class plugin option, so CC plugin support most likely requires staging the native `.claude` plugin layout the agent reads at startup. S1 confirms; Tasks 2+ implement the confirmed contract engine-side.

**Tech Stack:** TypeScript (strict), Vitest. Workspaces: `packages/harness-engine-claude-code`, `packages/core` (capability flag), docs.

**Spec:** `docs/superpowers/specs/2026-06-23-harness-plugins-extensions-design.md` (§8.2, §9 S1) · **Depends on:** Phase 1 merged (asset model + plugins in the resolved bundle).

## Global Constraints

- Strict lint policy; canonical types from `@nexus/core`; never log secrets.
- **Governance:** any tool a plugin contributes is gated by `canUseTool` → `ctx.checkPermission` (job ∩ profile); no widening past the profile ceiling. Plugin MCP servers come from the resolved API MCP runtime (Phase 1), mapped to `mcpServers` exactly as EPIC-210 does.
- **Empty bundle ⇒ byte-identical** `query({ options })` (no `plugins`/staging when `plugins: []`).
- After editing `packages/core`/`packages/harness-runtime`, rebuild dist before this package consumes it; `npm run build --workspace=packages/harness-engine-claude-code`.
- Test: `npm run test --workspace=packages/harness-engine-claude-code -- <p>`.

---

### Task 1: Spike S1 — pin the Claude Code plugin-loading contract

**Files:** Create `docs/analysis/2026-06-23-claude-code-plugin-loading-spike.md`.

**Investigate against the installed `@anthropic-ai/claude-agent-sdk` (resolve its real path — it ships platform subpackages; `CLAUDE_CODE_BIN` points at the platform binary) and confirm:**

1. Does the SDK `query({ options })` accept a first-class plugins / marketplace / `settingSources` / plugin-dir option? Read the SDK's options `.d.ts`. Quote the exact field(s) or record their absence.
2. If absent, what filesystem layout does a Claude Code session load at startup — `.claude/plugins/<name>/` with a `plugin.json`? a local marketplace manifest? Document the manifest schema (fields, hook/command/subagent/MCP declaration format) the agent expects.
3. How do plugin-declared **MCP servers** surface — through the same `mcpServers` option we already use, or via the plugin manifest? Confirm the governance path still routes through `canUseTool`.
4. What is the minimal staging that makes a single hook-only plugin load and fire in a session in the container image?

**Output (record in the analysis doc):** the **staging contract** — programmatic option(s) to set and/or the exact files+manifest to write and where, plus how MCP/governance flow. This contract is the input to Tasks 2-4.

- [ ] **Step 1:** Run the investigation; reproduce SDK option/loader behavior inside the image if needed (`docker run --entrypoint node`), as EPIC-210 did for PI.
- [ ] **Step 2:** Write the analysis doc with exact field/manifest evidence.
- [ ] **Step 3: Commit** — `docs(analysis): Claude Code plugin-loading spike (S1)`.
- [ ] **Step 4 — gate:** If S1 finds CC plugins are **not** loadable through any path our engine controls, set `CLAUDE_CODE_CAPABILITIES.supportsPlugins = false` with a guard test (mirroring EPIC-210's PI honesty), record the finding, and STOP — the resolver then drops CC plugins with diagnostics. Otherwise proceed to Task 2 with the confirmed contract.

---

### Task 2: Pure plugin → native-layout/options mappers

**Files:** Create `packages/harness-engine-claude-code/src/plugin-sdk-mappers.ts` (+ `.types.ts`); test `…/test/plugin-sdk-mappers.test.ts`.

Per S1's contract, write pure functions mapping `HarnessPlugin[]` → the native artifact: either the `query` option fragment or the set of files to stage (`{ path, contents }[]` + manifest), reusing EPIC-210's `toSdkMcpServers` for plugin MCP refs and `toSdkHooks` for plugin hooks where applicable.

- [ ] **Step 1: Failing tests** — a hook-only plugin maps to the S1 artifact; an empty plugin list yields an empty artifact (byte-identical); MCP refs map to the existing `mcpServers` shape. Run → FAIL.
- [ ] **Step 2: Implement** per S1; tests → PASS.
- [ ] **Step 3: Commit** — `feat(harness-engine-claude-code): pure plugin → native mappers`.

---

### Task 3: Engine materialization in `createSession`

**Files:** Modify `packages/harness-engine-claude-code/src/claude-code-engine.ts`; test `…/test/claude-code-engine.plugins.test.ts`.

`ClaudeCodeEngine` implements a `PluginMaterializer` (conformance) and `createSession` reads `ctx.contributions.plugins`, applies the S1 artifact (set option and/or stage files in the session workspace/agent dir), and merges plugin MCP servers alongside `nexus-kernel-tools`. **Empty plugins ⇒ byte-identical options/files.** Stage cleanup on teardown if files are written.

- [ ] **Step 1: Failing tests** — with one plugin, the S1 artifact is applied (option set or file staged); empty plugins ⇒ byte-identical (assert the exact option key-set / no staged files); plugin MCP server appears under `mcpServers` and is still governed. Reuse the EPIC-210 CC engine test harness. Run → FAIL.
- [ ] **Step 2: Implement** per S1; rebuild; tests → PASS.
- [ ] **Step 3: Commit** — `feat(harness-engine-claude-code): materialize plugins in createSession`.

---

### Task 4: Governance passthrough + SPI conformance + docs

**Files:** Test `…/test/claude-code-engine.plugins-governance.test.ts`; modify `docs/guide/41-harness-runtime.md` + spec §8.2.

- [ ] **Step 1:** Governance test — a tool contributed by a plugin routes through `canUseTool` → `checkPermission`; a denied plugin tool returns `behavior: "deny"`; surface cannot widen past the profile ceiling. SPI conformance: `supportsPlugins` is backed by the `PluginMaterializer`. Run → it should pass against Task 3; fix engine gaps, don't weaken tests.
- [ ] **Step 2:** Update the guide (CC plugin materialization per S1) + spec §8.2 with the resolved contract.
- [ ] **Step 3: Commit** — `test+docs(harness-claude-code): plugin governance + SPI conformance`.

---

## Phase 3 Completion Check

- [ ] S1 analysis doc committed; capability flag honest (and guard-tested if `false`)
- [ ] `npm run test --workspace=packages/harness-engine-claude-code -- "plugin"` green; build clean
- [ ] Empty plugins ⇒ byte-identical; plugin MCP via the existing runtime; governance no-bypass (tested)
- [ ] Guide + spec §8.2 reflect the S1-confirmed contract

## Out of Scope

- External-source import of plugins (Phase 4 — this phase materializes already-resolved `HarnessPlugin` assets regardless of origin).
- PI plugin support (PI uses extensions, covered in Phase 2).
