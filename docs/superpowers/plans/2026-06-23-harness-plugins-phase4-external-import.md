# Harness Plugins & Extensions — Phase 4 (External-Source Import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **SPIKE-GATED.** Task 1 (spikes S2/S3) pins the on-disk/native format an imported Claude Code plugin and an imported PI extension package must take to load. Tasks 3+ (per-harness install materialization) are finalized from S2/S3 and reuse Phase 3's S1 contract.

**Goal:** Import harness plugins/extensions from **external sources** the way the native harnesses do — Claude Code plugin **marketplaces**/git and PI extension packages (git/npm) — fetched, **pinned by commit/digest, checksummed, vetted, and persisted** as immutable `harness_assets`, then materialized natively (Phases 2/3) with **no live network at run time**.

**Architecture:** A per-source-kind fetcher (git clone@ref, registry/npm) resolves to an immutable snapshot, validates the native manifest (S2/S3), checksums, and persists via the Phase 1 asset store. A Web import flow drives it. Materialization is the existing Phase 2 (PI) / Phase 3 (CC) staging — origin-agnostic.

**Tech Stack:** TypeScript (strict), Vitest, NestJS, React. Workspaces: `apps/api`, `apps/web`.

**Spec:** `docs/superpowers/specs/2026-06-23-harness-plugins-extensions-design.md` (§9 S2/S3, §10, §11) · **Depends on:** Phase 1 (asset store), and Phase 2/3 for the materialization the imported assets reuse.

## Global Constraints

- Strict lint policy; Kanban-neutral; never log secrets.
- **No live network at run time** — all external code imported + pinned + persisted ahead of execution; containers never fetch a marketplace mid-run.
- **Supply chain:** pin by commit/digest; checksum on import AND re-verify before staging; manifest validation; size caps; optional denylist. Imported `env`/`headers` are secret-store refs.
- Imported assets are **immutable snapshots** (new version = new row).
- Web: presentation-only components; fetch/pin/validate in API services.
- Test: `npm run test --workspace=apps/api -- <p>`, `npm run test:unit:web -- <p>`, `npm run build:api`, `npm run build:web`.

---

### Task 1: Spikes S2/S3 — pin the importable native formats

**Files:** Create `docs/analysis/2026-06-23-harness-asset-import-formats-spike.md`.

Determine, against the installed SDKs:

- **S2 (Claude Code plugin):** the directory layout + manifest (`plugin.json`, marketplace manifest) an external CC plugin/marketplace repo uses, and how it maps to Phase 3's S1 staging contract. What fields must be present to be loadable.
- **S3 (PI extension package):** how a packaged PI extension is structured (single module vs directory vs npm package), its entry resolution, and provider-registration timing — confirm it stages into `ctx.extensionsPath` and loads via the PI loader (largely known from EPIC-210; confirm packaging).

**Output:** the **import-materialization contract** per harness — what to fetch, what manifest to validate, and how the persisted snapshot maps to Phase 2/3 staging.

- [ ] **Step 1–2:** Investigate (clone a sample CC plugin repo + a PI extension package; inspect manifests/layout). Write the analysis doc with concrete layouts + manifest schemas.
- [ ] **Step 3: Commit** — `docs(analysis): harness asset import-format spike (S2/S3)`.

---

### Task 2: Import pipeline (fetch → pin → vet → persist)

**Files:** Create `apps/api/src/harness/import/asset-importer.service.ts`, `…/source-fetcher.ts` (git/registry), `…/asset-vetting.ts`; test `…/asset-importer.service.spec.ts`.

**Interfaces:**

- `importAsset(source: HarnessAssetSource)` → fetch at the pinned ref, compute checksum, validate manifest per S2/S3, enforce size/denylist caps, persist an immutable `harness_assets` row (kind from manifest), return its id. Injectable `fetcher` seam so tests don't hit the network.

- [ ] **Step 1: Failing tests (no network — inject a fake fetcher)** — a valid git CC-plugin source pins to a commit, checksums, validates, persists; a checksum/manifest mismatch is rejected; an oversize/denylisted bundle is rejected; the persisted row is immutable + carries provenance. Run → FAIL.
- [ ] **Step 2: Implement** the pipeline (real default fetcher uses git clone@ref / registry resolve; vetting per S2/S3). `npm run build:api`; tests → PASS.
- [ ] **Step 3: Commit** — `feat(api): external harness-asset import pipeline (fetch+pin+vet+persist)`.

---

### Task 3: Import endpoint + preview

**Files:** Modify the harness controller — `POST /harness/assets/import` (preview: fetch + validate + return manifest, no persist) and `POST /harness/assets/import/confirm` (persist). Test `…/asset-import.controller.spec.ts`.

- [ ] **Step 1: Failing test** — preview returns the resolved manifest + checksum without persisting; confirm persists the immutable asset; bad source surfaces a typed error. Run → FAIL.
- [ ] **Step 2: Implement** (controller transport-only; service does the work). `build:api`; tests → PASS.
- [ ] **Step 3: Commit** — `feat(api): harness-asset import endpoints (preview+confirm)`.

---

### Task 4: Web import flow

**Files:** Create `apps/web/src/pages/agents/HarnessAssetImport.tsx` (+ hook); wire into the asset editor (Phase 2). Test `…/HarnessAssetImport.spec.tsx`.

- [ ] **Step 1: Failing test** — pasting a git/marketplace/registry source → preview shows the manifest + pinned ref → confirm attaches the imported asset id to the profile; errors surface inline. Run → FAIL.
- [ ] **Step 2: Implement** (presentational component; logic in the hook/service calling Task 3). `build:web`; `test:unit:web` → PASS.
- [ ] **Step 3: Commit** — `feat(web): external harness-asset import flow`.

---

### Task 5: Re-verify-before-stage + docs + security runbook

**Files:** Modify Phase 2/3 staging to **re-verify checksum** before staging an imported asset; modify `docs/guide/41-harness-runtime.md` + add `docs/operations/harness-asset-supply-chain.md`.

- [ ] **Step 1: Failing test** — staging an imported asset whose stored checksum no longer matches its bundle is refused + diagnosed (defense in depth). Run → FAIL.
- [ ] **Step 2: Implement** the pre-stage re-verify in the PI (and CC, per Phase 3) staging path; write the import + supply-chain docs (pinning, checksums, trust tiers, no-runtime-network, secret handling).
- [ ] **Step 3: Commit** — `feat(harness): re-verify imported assets before staging + supply-chain docs`.

---

## Phase 4 Completion Check

- [ ] S2/S3 analysis doc committed
- [ ] `npm run test --workspace=apps/api -- "asset-importer|asset-import"` green; `build:api` clean
- [ ] `npm run test:unit:web -- HarnessAssetImport` green; `build:web` clean
- [ ] Imported assets are pinned + checksummed + immutable; re-verified before staging; no runtime network
- [ ] Guide + supply-chain runbook updated

Operators can now import CC plugins (marketplace/git) and PI extension packages, pinned and persisted, materialized natively by the Phase 2/3 staging — closing the "install from external sources like the harnesses do" gap.

## Out of Scope

- A Nexus-hosted marketplace (EPIC-188).
- Stricter sandbox isolation for imported code (documented follow-up / open question §12).
- Auto-update of pinned snapshots (manual re-import = new version).
