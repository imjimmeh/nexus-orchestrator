# EPIC-211: Harness Plugins & Extensions — Authoring, Persistence, and External-Source Import

Status: Proposed
Priority: P1
Created: 2026-06-23
Updated: 2026-06-23
Owner: Runtime Platform / Harness Runtime
Depends On: EPIC-196 (Pluggable Coding Harness Runtime), EPIC-210 (Harness-Native Contributions)
Related: `apps/api/src/mcp` (existing MCP server runtime — EPIC-080 / EPIC-114 / EPIC-115 / EPIC-154), EPIC-188 (Third-Party **Nexus** Plugin Platform — distinct), `packages/harness-engine-pi`, `packages/harness-engine-claude-code`

---

## 1. Summary

EPIC-210 gave us a harness-neutral **contribution** model — hook _definitions_ (event + shell command string), an MCP-server _reference_ shape, and a settings bag — materialized natively by `pi` and `claude-code`. Two capabilities that the **real harnesses ship natively** are still missing, and this epic delivers them:

1. **Harness-native plugins / extensions as first-class units.** Claude Code has **plugins** (marketplace- or git-distributed bundles of hooks, slash commands, MCP servers, and subagents); PI has **extensions** (TypeScript modules that register tools, commands, hooks, and providers via its `ExtensionAPI`). Nexus cannot author, persist, install, or materialize any of these today.
2. **Author-your-own + import-from-external-source.** Operators should be able to (a) **author and persist their own** plugin/extension/hook **code** in the Web app (stored in the DB, not just a command string that must already exist in the container), and (b) **import from external sources** the way the harnesses do natively — Claude Code plugin **marketplaces** (git repos) and plugins; PI extension packages (git/npm) — with the asset pinned, vetted, and persisted.

Both halves resolve to a harness-neutral **plugin/extension asset model** with DB persistence, a Web authoring + import surface, and per-engine native materialization that **stages real code into the execution container**.

> **Scope note — MCP servers are already supported.** MCP servers are a first-class, DB-persisted, governed, reconciled concept in `apps/api/src/mcp` (entity, runtime manager, reconciliation loop, stdio/http transports, tool-name + governance linkage). This epic **reuses that runtime** for any MCP server a plugin declares — it does **not** reinvent MCP-server management. EPIC-210's `HarnessExtensionContribution` (an inline MCP reference) is reconciled with the API MCP runtime as part of Workstream A.

## 2. Problem Statement

- **Plugins/extensions are unreachable.** The single richest native extensibility unit in each harness — a Claude Code plugin or a PI extension — has **no representation** in Nexus. Operators cannot say "this agent profile loads the `security-review` plugin" or "install the PI `linting` extension." The harness engines have zero plugin/marketplace/extension-package wiring (grep confirms).
- **EPIC-210 persists definitions, not code.** A `HarnessHookContribution.command` is a shell string that **must already resolve inside the container** (a baked-in binary, a repo script, or an installable command). There is no way to author a hook's **script body** in the Web app, persist its source, and have it delivered into the container as an executable. Same for an MCP server's implementation or a plugin's logic.
- **No external-source import.** The native harnesses install plugins from marketplaces/registries/git. Nexus has no fetch-pin-vet-persist path, so none of that ecosystem is reachable. (If an author writes `npx -y some-pkg` as a command, that is an incidental run-time install, not a managed capability.)
- **Authoring surface is raw JSON.** EPIC-210's Web field is a JSON textarea for contribution _definitions_; there is no structured editor and no place to put code or to attach an imported plugin.
- **Security boundary is undefined for code.** Author-written and externally-imported **code** executing in-container is a new trust surface (supply-chain risk, secret exposure, unbounded execution) that must be governed by construction — pinned/checksummed sources, bounded execution, secret-store-only credentials, and the existing `job ∩ profile` tool gate for any tools a plugin contributes.

## 3. Current State Review

| Concern                   | Today                                                                                                                                                                        | Gap                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| MCP servers               | **First-class & supported** — `apps/api/src/mcp` (`mcp-server.entity`, `mcp-runtime-manager.service`, reconciliation loop, stdio/http transport clients, governance linkage) | Reuse for plugin-declared MCP servers; reconcile EPIC-210's inline `HarnessExtensionContribution` |
| Hooks / settings          | EPIC-210 contribution model: hook _definitions_ (event + command string) + settings bag, materialized per engine                                                             | Hook **code/asset** authoring + persistence + container staging                                   |
| Claude Code plugins       | Not represented; the engine uses the programmatic `query({ options })` subset only (hooks/mcpServers/settings) — **not** the plugin/marketplace install path                 | Plugin model + marketplace/git import + native install/staging                                    |
| PI extensions             | The PI SDK loads extension TS modules from `ctx.extensionsPath` (jiti); EPIC-210 _generates_ one for hooks. No author/import of full extensions                              | Extension-package model + import + author-your-own + staging                                      |
| Authored code persistence | Contribution definitions persist as jsonb on `agent_profiles.harness_contributions`; **no code/source persisted anywhere**                                                   | A DB-backed asset store for plugin/extension/hook **source** + bundles                            |
| External import           | None                                                                                                                                                                         | Fetch → pin/checksum → vet → persist for marketplaces/git/registries                              |
| Authoring UI              | Raw-JSON textarea on the agent profile (EPIC-210)                                                                                                                            | Structured Web editor for plugins/extensions/hook code + import flow                              |
| Nexus plugin platform     | EPIC-188–195 = **Nexus-internal** plugin SDK/kernel/isolation — a different layer                                                                                            | Do not conflate; harness plugins target the harness, not the Nexus kernel                         |

## 4. Goals

1. **Harness-neutral plugin/extension asset model** in `@nexus/core`: a `HarnessPlugin` that may bundle hooks, slash commands, subagents, and MCP-server references, plus a `source` (authored vs imported) and a pinned/checksummed provenance; a `HarnessExtensionAsset` for PI-module / packaged extensions. Hook **code** becomes a first-class asset (source + interpreter), not just a command string.
2. **DB persistence + asset store.** Persist plugin/extension/hook **source and bundles** (new entity/table + migration), scoped and versioned, referenced from agent profiles / steps / skill bundles by id — reusing the EPIC-210 precedence resolver (step → profile → skill → platform).
3. **Author-your-own in the Web app.** A structured editor to write hook/extension code and assemble a plugin, persisted server-side and validated (zod + interpreter/manifest checks). Reusable across harnesses where the capability is supported.
4. **Import from external sources.** Fetch + **pin by commit/digest** + checksum + vet + persist: Claude Code plugin **marketplaces** (git) and plugins; PI extension packages (git/npm). Imported assets are immutable snapshots in the asset store (no live network at run time).
5. **Per-engine native materialization (engine-side, EPIC-196 boundary intact).**
   - **Claude Code:** stage an installed-plugin layout (`.claude` plugin dir / marketplace manifest) and/or pass via the SDK so plugins load natively; route plugin-declared MCP servers through the existing API MCP runtime.
   - **PI:** stage extension modules into `ctx.extensionsPath` (the engine already loads modules there) and register providers; author hook code becomes a real staged file the generated extension invokes.
6. **Reuse, don't reinvent, MCP servers.** Any MCP server a plugin declares is registered/resolved through `apps/api/src/mcp` (DB entity + runtime manager + transports + governance), not a parallel path. Reconcile the EPIC-210 inline `HarnessExtensionContribution` with it.
7. **Security & governance by construction.** Pinned/checksummed external sources; bounded execution and no-log-secrets for hook/extension code; secret-store-only credentials; every tool a plugin/extension contributes flows through the `job ∩ profile` gate (`wrapToolWithGovernance` / `canUseTool`) — a plugin cannot widen the tool surface past the profile ceiling.
8. **Honest capabilities + diagnostics.** Extend `HarnessCapabilities` with `supportsPlugins` / `supportsExtensionPackages` (+ supported import-source kinds); unsupported plugin/extension assets are dropped with event-ledger diagnostics, never silently.

## 5. Non-Goals

- **A public/third-party contribution marketplace of our own** — that overlaps EPIC-188 (Nexus plugin platform). This epic imports from the harnesses' **existing** ecosystems and lets operators author privately.
- **Reworking or replacing the `apps/api/src/mcp` runtime** — it is reused as-is for MCP servers.
- **Conflating harness plugins with Nexus plugins** (EPIC-188–195) — different layer, different kernel.
- **A standalone neutral slash-command contribution type** — slash commands ride along inside Claude Code plugins natively; a harness-neutral slash-command abstraction remains out of scope (consistent with EPIC-210's non-goal).
- **Live network fetch at run time** — all external assets are imported, pinned, and persisted ahead of execution; containers never reach out to a marketplace mid-run.

## 6. Target Architecture

### 6.1 Canonical contracts (`@nexus/core`)

- `HarnessPlugin` — `{ id; name; version; source: PluginSource; capabilities: { hooks?; slashCommands?; subagents?; mcpServerRefs? }; manifest; checksum }`. Harness-neutral; each engine maps it to its native plugin/extension format.
- `HarnessExtensionAsset` — a PI-style extension module/package: `{ id; name; entry; runtime: "ts-module" | "package"; source; checksum }`.
- `HarnessHookAsset` — promotes EPIC-210's hook from a bare command to an asset: `{ event; matcher?; script: { language; source } | { command }; timeoutMs? }` (backward compatible — a plain `command` still works).
- `PluginSource` — `{ kind: "authored" } | { kind: "git"; repo; ref; subdir? } | { kind: "registry"; name; version }`, always resolved to an **immutable, checksummed** snapshot.
- Extend `HarnessContributions` (EPIC-210) with `plugins: HarnessPlugin[]` and `extensions: HarnessExtensionAsset[]` (distinct from the existing MCP-server reference shape, which now points at the API MCP runtime).

### 6.2 Asset store + persistence (`apps/api`)

- New entity/table (e.g. `harness_assets`) + migration: stores plugin/extension/hook **source/bundles**, provenance, checksum, scope, version. Authored assets and imported snapshots live side by side.
- Profiles / steps / skills reference assets by id; the EPIC-210 resolver gathers + precedence-merges asset references and hydrates them.

### 6.3 Import pipeline (`apps/api`)

- Fetcher per source kind (git clone@ref, registry/npm) → checksum/pin → optional vet (manifest validation, denylist, size caps) → persist snapshot. No run-time network.

### 6.4 Engine materialization (engine-side)

- **Claude Code engine:** assemble the native plugin/marketplace layout the SDK/CLI expects (staged `.claude` plugin dir + manifest) and/or the relevant `query({ options })` fields; plugin MCP servers resolved via API MCP runtime.
- **PI engine:** stage extension modules + authored hook scripts into `ctx.extensionsPath`; register providers via `ExtensionAPI`; the generated hook extension invokes staged script files (not inline strings).

### 6.5 Governance & security

- External sources pinned + checksummed; size/manifest vetting; secret-store-only env/headers; bounded hook/extension execution; output never logged.
- Plugin/extension-contributed tools gated by `job ∩ profile` (reuse EPIC-210's `wrapToolWithGovernance` for PI and `canUseTool` for Claude Code).

### 6.6 Web authoring + import UI (`apps/web`)

- Structured editor to author hook/extension code and assemble plugins (replacing/augmenting the EPIC-210 JSON textarea), plus an import flow (paste a marketplace/git/registry source, preview, pin, persist), and attach assets to a profile/step/skill.

## 7. Workstreams & Phased Delivery

- **A — Asset model + reconcile with API MCP (P1 foundation).** Canonical contracts; `harness_assets` entity + migration; reconcile `HarnessExtensionContribution` with `apps/api/src/mcp`; capability flags `supportsPlugins`/`supportsExtensionPackages`; resolver hydration. _(E211-001…E211-0xx)_
- **B — Author-your-own (P1).** Web structured editor + DB persistence of authored hook/extension/plugin source; engine staging of authored code into the container (PI first — it already loads `extensionsPath`).
- **C — PI extensions native (P2).** Full PI extension packages (module/package) staged + provider registration; authored hook code → staged script files.
- **D — Claude Code plugins native (P2).** Native plugin/marketplace layout staging + SDK wiring; plugin-declared MCP servers via API MCP runtime.
- **E — External-source import (P2/P3).** Git/marketplace/registry fetch → pin/checksum/vet → persist; import UI.
- **F — Governance, security hardening, docs (cross-cutting).** Supply-chain pinning, sandbox/limits, secret handling, `job ∩ profile` for plugin tools, `docs/guide` + operator runbook.

## 8. Acceptance Criteria

1. An operator can **author** a hook/extension's **code** in the Web app; it is **persisted server-side** and materialized into the container for a supported harness (PI first), reusable across harnesses where supported.
2. An operator can **import** a Claude Code plugin (from a marketplace/git) and a PI extension (git/npm); the asset is **pinned + checksummed + persisted**, then materialized natively at run time with **no live network**.
3. Plugin-declared **MCP servers** are registered/resolved through the **existing `apps/api/src/mcp` runtime** — no parallel MCP path.
4. Every tool a plugin/extension contributes is gated by `job ∩ profile`; a plugin cannot widen the tool surface past the profile ceiling.
5. Unsupported plugin/extension assets are **dropped with event-ledger diagnostics** per the resolved harness's capabilities; an empty asset set is byte-identical to pre-epic behavior.
6. Secrets are never logged; external code runs bounded; credentials are secret-store refs only.
7. All gates green (lint/types/tests); `docs/guide` documents authoring, import, the security model, and the reuse of the API MCP runtime.

## 9. Risks

- **Supply chain.** Importing external plugin/extension code is a real attack surface — mitigate with pinning, checksums, manifest vetting, size caps, and clear author-trust framing; consider isolation for imported code.
- **Native format drift.** Claude Code's plugin/marketplace layout and PI's extension contract can change across SDK versions — spike each against the installed SDK and pin assumptions (as EPIC-210 learned the hard way with the PI extension contract).
- **Overlap/confusion with MCP and Nexus plugins.** Keep crisp boundaries: MCP servers → `apps/api/src/mcp`; Nexus plugins → EPIC-188; harness plugins/extensions → here.
- **Container staging complexity.** Writing code into the execution container + path rewriting + lifecycle/cleanup adds operational surface (build on EPIC-210's PI extension-file staging).

## 10. Open Questions

- Isolation level for **imported** plugin/extension code vs **authored** code — same trust, or sandbox imported more strictly?
- Does the Claude Agent SDK expose a first-class plugin/marketplace install option, or must we stage the `.claude` plugin layout ourselves? (Spike — Workstream D.)
- Asset scoping/versioning model: platform-global vs project-scoped vs profile-pinned; upgrade/rollback semantics for imported snapshots.
- Should authored assets be promotable into the skill library / shareable across projects (overlap with EPIC-101 authoring mounts)?

## 11. References

- EPIC-210 — Harness-Native Contributions (the hook/settings/MCP-ref contribution model this builds on).
- EPIC-196 — Pluggable Coding Harness Runtime (engine SPI + capabilities boundary).
- `apps/api/src/mcp/*` — existing MCP server runtime (entity, runtime manager, reconciliation, transports, governance) — reused, not reinvented.
- EPIC-080 / EPIC-114 / EPIC-115 / EPIC-154 — MCP client runtime, local MCP service, governance linkage, kanban MCP tools.
- EPIC-188–195 — Nexus (internal) plugin platform — distinct layer; do not conflate.
- EPIC-101 — hybrid skill-library authoring mounts + governed runtime sync (precedent for author → persist → materialize-into-container).
- `packages/harness-engine-pi` (PI `ExtensionAPI`, `ctx.extensionsPath` module loading) and `packages/harness-engine-claude-code` (programmatic `query({ options })`).
