# Harness Plugins & Extensions — Phase 2 (Author-Your-Own + PI Staging) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators **author and persist** plugin/extension/hook **code** in the Web app, and have the **PI engine stage that code into the container** — author hook scripts become staged files invoked by the generated extension, and authored PI extension assets are staged into `ctx.extensionsPath` and loaded natively.

**Architecture:** Builds on Phase 1's asset store + resolver hydration. A structured Web editor writes authored assets to the `harness_assets` store via API; the PI engine (which already loads extension modules from `ctx.extensionsPath` and stages a generated hook extension in EPIC-210) is extended to stage authored extension bundles + authored hook-script files.

**Tech Stack:** TypeScript (strict), Vitest, NestJS, React. Workspaces: `apps/api`, `apps/web`, `packages/harness-engine-pi`.

**Spec:** `docs/superpowers/specs/2026-06-23-harness-plugins-extensions-design.md` (§8.1, §11) · **Depends on:** Phase 1 merged.

## Global Constraints

- Strict lint policy; Kanban-neutral api/core; canonical types from `@nexus/core`.
- Never log secrets; **hook/extension code output never logged**; staged scripts bounded by `timeoutMs` (reuse EPIC-210 clamping).
- **Empty asset set ⇒ byte-identical PI behavior** (no files staged, no tool-set change).
- Authored code runs at author trust in the existing container (isolation hardening is a documented follow-up).
- Web: presentation-only components; fetch/validate/persist logic in API services/hooks.
- Test commands: `npm run test --workspace=apps/api -- <p>`, `npm run test:unit:web -- <p>`, `npm run test --workspace=packages/harness-engine-pi -- <p>`, `npm run build:api`, `npm run build:web`.

---

### Task 1: API — author/persist asset endpoint + service

**Files:**

- Create: `apps/api/src/harness/assets/harness-asset.service.ts` (validate via Phase 1 zod, compute checksum, persist immutable row)
- Modify: the harness module/controller to expose `POST /harness/assets` (create authored asset) + `GET /harness/assets` (list by scope)
- Test: `apps/api/src/harness/assets/harness-asset.service.spec.ts`

- [ ] **Step 1: Failing test** — creating an authored `hook_script` asset validates source, computes a stable checksum, persists an immutable row, and returns its id; invalid source is rejected; listing returns scope-filtered rows. Run → FAIL.
- [ ] **Step 2: Implement** the service (reuse Phase 1 zod + repository; checksum via a stable hash of `kind|name|version|bundle`). Controller handles transport only (api quality gate). `npm run build:api`; tests → PASS.
- [ ] **Step 3: Commit** — `feat(api): author + persist harness assets`

---

### Task 2: PI — stage authored hook scripts as files

**Files:**

- Modify: `packages/harness-engine-pi/src/contribution-hook-extension.ts` (when a hook carries `script`, emit a registration that invokes a staged file path instead of an inline command)
- Modify: `packages/harness-engine-pi/src/contribution-tool-adapter.ts` (or a new `contribution-asset-staging.ts`): write authored hook scripts to a staged dir; chmod where applicable
- Test: `packages/harness-engine-pi/test/contribution-hook-asset-staging.test.ts`

**Interfaces:**

- `stageHookScripts(stageDir, hooks)` → writes each `script`-bearing hook to `<stageDir>/hook-<event>-<n>.<ext>`, returns a map event→path; `command`-bearing hooks (EPIC-210) are unchanged.
- The generated extension invokes the staged path (`sh -c <path>` / `node <path>` / `python3 <path>` by `language`), bounded by `timeoutMs`, output discarded.

- [ ] **Step 1: Failing tests** — a `script` hook produces a staged file with the right interpreter shebang/exec and a registration referencing that path; a `command` hook still inlines (back-compat); empty hooks stage nothing; injection-safe (path + args, no source splicing). Run → FAIL.
- [ ] **Step 2: Implement** staging + generation; rebuild PI engine; tests → PASS.
- [ ] **Step 3: Commit** — `feat(harness-engine-pi): stage authored hook scripts as files`

---

### Task 3: PI — stage authored extension assets into `extensionsPath`

**Files:**

- Modify: `packages/harness-engine-pi/src/pi-engine.ts` (in `createSession`, before `resolveExtensionPaths`/`reload`, stage `ctx.contributions.extensions` bundles into `ctx.extensionsPath`)
- Create: `packages/harness-engine-pi/src/contribution-extension-staging.ts`
- Test: `packages/harness-engine-pi/test/pi-engine.extension-asset-staging.test.ts`

**Interfaces:**

- `stageExtensionAssets(extensionsPath, extensions)` → writes each `ts-module` asset's `entry` bundle as a `.ts` default-export factory file (so PI's loader picks it up); returns staged paths; disposes/cleans on teardown (extend EPIC-210 dispose).

- [ ] **Step 1: Failing tests** — an extension asset is staged as a `.ts` file in `extensionsPath` and appears in the loaded set; empty extensions stage nothing (byte-identical); a malformed bundle is dropped+diagnosed, not crashing. Reuse the EPIC-210 PI test harness (mock `createAgentSession`/loader). Run → FAIL.
- [ ] **Step 2: Implement** staging + wire into `createSession`; rebuild; tests → PASS.
- [ ] **Step 3: Commit** — `feat(harness-engine-pi): stage authored PI extension assets`

---

### Task 4: Web — structured authoring editor

**Files:**

- Create: `apps/web/src/pages/agents/HarnessAssetEditor.tsx` (+ `.types.ts`, hook `useHarnessAssetEditor.ts`)
- Modify: `apps/web/src/pages/agents/AgentProfileForm.fields.tsx` (replace/augment the EPIC-210 JSON textarea with: per-hook code field [language + source], extension authoring, and attach-by-id)
- Test: `apps/web/src/pages/agents/HarnessAssetEditor.spec.tsx`

- [ ] **Step 1: Failing test** — authoring a hook with `language` + `source` produces a valid asset payload; switching a hook from `command` to `script` toggles the editor; attaching an existing asset id round-trips; invalid JSON/source surfaces an inline error without clobbering prior value. Run → FAIL.
- [ ] **Step 2: Implement** the editor + hook (logic in the hook/service, component presentational); wire create-asset to Task 1's endpoint. `npm run build:web`; `npm run test:unit:web -- HarnessAssetEditor` → PASS.
- [ ] **Step 3: Commit** — `feat(web): structured harness asset authoring editor`

---

### Task 5: Docs + seed validation

**Files:**

- Modify: `docs/guide/41-harness-runtime.md` (author-your-own section: where to author, how PI stages code, the author-trust boundary, secret handling, byte-identical-when-empty)
- Run: `npm run validate:seed-data`

- [ ] **Step 1** Update the guide; add an authored-hook-script example and the trust/security note.
- [ ] **Step 2** `npm run validate:seed-data` green.
- [ ] **Step 3: Commit** — `docs(harness): author-your-own assets + PI staging`

---

## Phase 2 Completion Check

- [ ] `npm run test --workspace=apps/api -- harness-asset` green; `build:api` clean
- [ ] `npm run test --workspace=packages/harness-engine-pi -- "hook-asset-staging|extension-asset-staging"` green; PI build clean
- [ ] `npm run test:unit:web -- HarnessAssetEditor` green; `build:web` clean
- [ ] Empty asset set ⇒ no staged files, no tool-set change (PI byte-identical)
- [ ] `validate:seed-data` green; guide updated

Operators can now author hook/extension **code** in the Web app, persist it, and have **PI** stage and run it. Claude Code plugins (Phase 3) and external import (Phase 4) follow.

## Out of Scope

- Claude Code native plugin staging (Phase 3, spike-gated).
- External-source import (Phase 4).
- Stricter isolation for code execution (documented follow-up).
