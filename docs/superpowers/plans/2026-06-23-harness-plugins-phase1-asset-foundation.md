# Harness Plugins & Extensions — Phase 1 (Asset Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the harness-neutral plugin/extension **asset** model — canonical contracts, capability flags, a DB-backed `harness_assets` store, resolver hydration, and reconciliation of EPIC-210's inline MCP reference with the existing `apps/api/src/mcp` runtime — with no engine behavior change until later phases.

**Architecture:** Additive to EPIC-210. New `@nexus/core` contracts (`HarnessPlugin`, `HarnessExtensionAsset`, `HarnessHookAsset`, `HarnessAssetSource`); new capability flags; a `harness_assets` entity + migration; resolver gathers + hydrates asset references by id; MCP servers move to reference-by-id resolved through `apps/api/src/mcp`.

**Tech Stack:** TypeScript (strict), Vitest, TypeORM (jsonb), Zod, NestJS DI. Workspaces: `packages/core`, `apps/api`.

**Spec:** `docs/superpowers/specs/2026-06-23-harness-plugins-extensions-design.md` (§3–§7) · **Depends on:** EPIC-210 merged.

## Global Constraints

- Strict lint policy: NO `eslint-disable`/`@ts-ignore`/`@ts-nocheck`/rule downgrades.
- API/core must stay **Kanban-neutral**.
- Canonical contracts live in `@nexus/core`; never redefined downstream.
- **Reuse `apps/api/src/mcp`** for MCP servers — do not add a parallel MCP path.
- Never log secrets; asset `source`/credentials handling must not inline or log secrets.
- After editing `packages/core`, rebuild it before downstream consumes it.
- Follow the existing migration convention (`apps/api/src/database/migrations`, register in the migrations list) and the EPIC-210 resolver/test patterns.
- Test commands: `npm run test --workspace=packages/core -- <p>`, `npm run test --workspace=apps/api -- <p>`, `npm run build:api`.

---

### Task 1: Canonical asset contracts + zod in `@nexus/core`

**Files:**

- Create: `packages/core/src/interfaces/harness-asset.types.ts` (HarnessAssetSource, HarnessHookAsset, HarnessExtensionAsset, HarnessPlugin)
- Modify: `packages/core/src/interfaces/harness-contributions.types.ts` (extend `HarnessContributions` with `plugins`; change `hooks` to `HarnessHookAsset[]`; remove `HarnessExtensionContribution`, replace `extensions` with `HarnessExtensionAsset[]`)
- Create: `packages/core/src/schemas/ai-config/harness-assets.schema.ts` (zod)
- Test: `packages/core/src/schemas/ai-config/harness-assets.schema.spec.ts`

**Interfaces:**

- Produces the exact types in spec §3 and a zod schema that validates them, including the hook discriminated union (`script` | `command`) and the `HarnessAssetSource` discriminated union.

- [ ] **Step 1: Write failing schema tests** — assert: a valid authored hook-script asset parses; a `git` source requires `repo`+`ref`; an extension asset requires `entry`+`runtime`; a plugin with `mcpServerRefs` parses; an invalid hook with neither `script` nor `command` is rejected. Run `npm run test --workspace=packages/core -- harness-assets.schema` → FAIL (module missing).
- [ ] **Step 2: Implement the types + zod** per spec §3. For the hook union use a zod discriminated/`.or` with a `superRefine` ensuring exactly one of `script`/`command`. Rebuild core. Run tests → PASS.
- [ ] **Step 3: Reconcile `HarnessContributions`** — update `EMPTY_HARNESS_CONTRIBUTIONS` to `{ hooks: [], extensions: [], plugins: [], settings: {} }`; update any EPIC-210 references to the removed `HarnessExtensionContribution`. Build core + `@nexus/harness-runtime` + both engines to surface breakage (fix references; the inline MCP shape becomes a reference-by-id — see Task 5). Run the EPIC-210 contribution tests; adjust fixtures that used the inline extension shape.
- [ ] **Step 4: Commit** — `feat(core): add harness plugin/extension asset contracts + zod`

> Note: removing `HarnessExtensionContribution` is the one breaking reconciliation. No live authored data references it yet (EPIC-210 not seeded with inline MCP extensions), so this is safe; confirm via a repo grep for `HarnessExtensionContribution` and update every site.

---

### Task 2: Capability flags + honest presets

**Files:**

- Modify: `packages/core/src/interfaces/harness-capabilities.ts` (add `supportsPlugins`, `supportsExtensionPackages`, `supportedAssetSources`; set `PI_CAPABILITIES`/`CLAUDE_CODE_CAPABILITIES`)
- Modify (test): `packages/core/src/interfaces/harness-capabilities.spec.ts`

- [ ] **Step 1: Failing test** — assert PI: `supportsExtensionPackages: true`, `supportsPlugins: false`; Claude Code: `supportsPlugins: true` (provisional — see note), `supportsExtensionPackages: false`; both `supportedAssetSources` include `"authored"`. Run → FAIL.
- [ ] **Step 2: Implement** the flags + presets; rebuild core; tests → PASS.
- [ ] **Step 3: Commit** — `feat(core): add plugin/extension capability flags`

> Note: `CLAUDE_CODE_CAPABILITIES.supportsPlugins` is provisional until Phase 3's spike S1 confirms the native loading mechanism. Keep it `true` (the product supports plugins); if S1 finds the SDK path can't load them, Phase 3 flips it with its own guard test.

---

### Task 3: `harness_assets` entity + migration

**Files:**

- Create: `apps/api/src/harness/assets/harness-asset.entity.ts`
- Create: `apps/api/src/harness/assets/harness-asset.repository.ts`
- Create: migration `apps/api/src/database/migrations/<ts>-add-harness-assets.ts` + register it
- Test: `apps/api/src/harness/assets/harness-asset.repository.spec.ts`

**Interfaces:**

- Entity columns per spec §5: `id` (uuid), `kind` (`plugin|extension|hook_script`), `name`, `version`, `source` (jsonb), `checksum`, `bundle` (text/jsonb; object-store ref optional later), `scopeNodeId` (nullable), `createdAt`. Immutable rows.
- Repository: `create(asset)`, `findById(id)`, `findByIds(ids)`, `findByScope(scopeNodeId)`.

- [ ] **Step 1: Failing repository test** — create + findById round-trips; `findByIds` preserves a multi-id query; checksum + source jsonb persist. Run → FAIL.
- [ ] **Step 2: Implement** entity + repository following an existing entity (model on `apps/api/src/mcp/database/entities/mcp-server.entity.ts`). Write the migration mirroring a recent one (up: create table + indexes; down: drop). Register in the migrations list. Run `npm run build:api`; run the repo test → PASS.
- [ ] **Step 3: Commit** — `feat(api): add harness_assets store + migration`

---

### Task 4: Resolver hydration of asset references

**Files:**

- Modify: `apps/api/src/harness/harness-contribution-resolver.ts` (+ `gather-contribution-sources.ts`)
- Create: `apps/api/src/harness/harness-asset-hydration.ts` (pure-ish: ids → assets via repository, checksum-verify, capability-gate)
- Test: `apps/api/src/harness/harness-asset-hydration.spec.ts`

**Interfaces:**

- `gatherContributionSources` also collects `pluginRefs` / `extensionRefs` per surface.
- `hydrateAssetReferences(refs, repo, capabilities)` → `{ plugins, extensions, dropped[] }`, verifying checksum and dropping capability-unsupported kinds with a `harness_contribution_dropped` diagnostic (`contributionType: "plugin"|"extension"`).

- [ ] **Step 1: Failing tests** — hydration loads referenced assets; a checksum mismatch is dropped+diagnosed; a plugin asset on a `supportsPlugins:false` harness is dropped; precedence/de-dup by id holds. Run → FAIL.
- [ ] **Step 2: Implement** hydration + wire into the resolver after the EPIC-210 gather/merge. Empty refs ⇒ empty arrays (byte-identical). Run tests → PASS.
- [ ] **Step 3: Commit** — `feat(api): resolve + hydrate harness asset references`

---

### Task 5: Reconcile MCP references with `apps/api/src/mcp`

**Files:**

- Modify: `apps/api/src/harness/harness-contribution-resolver.ts` (resolve `plugin.capabilities.mcpServerRefs` via the MCP runtime)
- Modify: `packages/harness-engine-pi/src/contribution-mcp-bridge.ts` (accept resolved MCP descriptors instead of inline `HarnessExtensionContribution`)
- Test: `apps/api/src/harness/harness-mcp-ref-resolution.spec.ts`

**Interfaces:**

- `resolveMcpServerRefs(ids, mcpRepo)` → resolved server descriptors (host/transport/secret refs) sourced from `apps/api/src/mcp` (`mcp-server.repository`).
- The PI bridge's `bridgeExtensionsToGovernedTools` is refactored to take resolved descriptors; the governed-tool path (`wrapToolWithGovernance`) is unchanged.

- [ ] **Step 1: Failing test** — a plugin `mcpServerRefs: ["id1"]` resolves to the MCP runtime's descriptor; an unknown id is dropped+diagnosed; the resolved descriptor flows to the bridge shape the PI engine expects. Run → FAIL.
- [ ] **Step 2: Implement** ref resolution against `mcp-server.repository`; refactor the bridge signature to consume descriptors (keep the governed-tool wrapping + dispose). Update EPIC-210 PI bridge tests to the descriptor shape. `npm run build:api` + PI engine build. Run tests → PASS.
- [ ] **Step 3: Commit** — `feat(api): resolve plugin MCP refs via the existing MCP runtime`

---

## Phase 1 Completion Check

- [ ] `npm run test --workspace=packages/core -- harness-assets.schema` + `harness-capabilities` green
- [ ] `npm run test --workspace=apps/api -- "harness-asset|harness-mcp-ref|harness-contribution-resolver"` green
- [ ] `npm run build:api` clean; `npm run build --workspace=packages/harness-engine-pi` clean
- [ ] Grep shows no remaining references to the removed `HarnessExtensionContribution`
- [ ] No engine behavior change yet (empty asset set ⇒ byte-identical)

Foundation only: assets are modeled, persisted, resolved, and MCP is reconciled to the single API runtime. No code is staged into containers until Phase 2.

## Out of Scope (later phases)

- Container staging of asset code (Phase 2 PI, Phase 3 CC).
- External-source fetch/pin (Phase 4).
- Web authoring UI (Phase 2).
