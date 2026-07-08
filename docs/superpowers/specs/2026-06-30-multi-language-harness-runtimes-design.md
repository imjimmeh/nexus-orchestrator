# Multi-Language Harness Runtimes — Design

- **Date:** 2026-06-30
- **Status:** Approved (design); implementation plan to follow
- **Owner:** Jimmeh

## 1. Problem & Goals

Today every Nexus execution container is JavaScript-centric. The harness images
(`nexus-heavy`, `nexus-light`, `nexus/harness-pi`, `nexus/harness-claude-code`)
bake a Node toolchain and an npm-only dependency story: `docker/heavy-entrypoint.sh`
hardlink-copies a baked `node_modules` and runs `npm install` on lockfile drift.
There is **no** concept of language, runtime, or toolchain anywhere in workflows,
jobs, steps, or agent profiles, and no caching for non-npm ecosystems.

We want agents to work in repos of **any language**, with the toolchain
**configurable** and both **images** and **packages** (including OS packages)
**cached**, while **existing JavaScript workflows keep running unchanged**.

### Goals

1. Agents can build/test/run repos in arbitrary languages (Python, Go, Rust,
   Java, Ruby, …) in addition to JS.
2. The toolchain is configurable through the same precedence model used for AI
   config (step → profile → DB → fallback), with sensible auto-detection.
3. Composite images are built on demand and cached locally, keyed by toolchain
   set — no rebuild for a repeated set.
4. Package downloads are cached across container runs per ecosystem
   (npm/pip/cargo/go-mod/maven/mise) **and** OS packages (apt).
5. Caches are extensible: presets out of the box, plus user-defined caches via
   config and a way to disable presets.
6. Frontend config: agent-profile and project settings expose the new fields.

### Non-Goals (YAGNI)

- No external image registry or remote build farm — everything builds and caches
  on the existing Docker host.
- No hand-maintained Dockerfile per language.
- No change to _how_ agents decide to run build/test commands — only to _what is
  available_ when they do.
- The currently-unused `agent_profiles.tier_preference` field is out of scope.

## 2. Chosen Approach

**Composable / on-demand build, using `mise` layered on a per-harness base image.**

- A single **base image per harness** (`pi`, `claude-code`) carries the
  harness-runtime + Node + git + build-essential + `mise`.
- The desired **toolchain set** is resolved per run and layered on top on demand
  via `mise` (e.g. `mise use -g python@3.12 go@1.23`), producing a **composite
  image** that is cached locally and keyed by a hash of the toolchains.
- **Package and OS caches** are mounted into every container as shared named
  volumes so installs are fast and persist across runs.

`mise` was chosen over Nixpacks (built for packaging finished apps, not agent dev
loops; awkward harness injection), devcontainer features (heavier/slower builds on
a memory-constrained host), and hand-rolled Dockerfiles (per-language maintenance
burden). `mise` gives the lowest build cost (prebuilt binaries), the widest
language coverage with near-zero per-language maintenance, and a declarative
config that maps cleanly onto the existing precedence layers. System libraries
that `mise` does not cover are handled by an `aptPackages` escape hatch.

## 3. Component Architecture

```
Workflow step / agent profile / project / repo
        │  (toolchain resolution — precedence chain)
        ▼
ToolchainResolverService ──► resolved RuntimeToolchainConfig (sorted, normalized)
        │
        ▼
HarnessImageResolver
  • toolchains == base default (node only)?  ─► existing pi / claude-code image  (today's path, unchanged)
  • else ─► CompositeImageBuilderService
                • tag = nexus-rt/<harnessId>:<sha256(baseImageId + sortedToolchains + sortedApt)[:12]>
                • image present locally?  reuse  :  build (generated Dockerfile FROM base, `mise use …`)
                • per-tag build lock (no duplicate concurrent builds)
        │
        ▼
ContainerOrchestratorService.provisionContainer()
  • image = resolved composite (or existing image)
  • + package/OS-cache volume mounts (PackageCacheVolumeService)
  • + existing /workspace + skill + checkpoint mounts
```

New units, each single-purpose and independently testable:

- **`ToolchainResolverService`** — runs the precedence chain and returns a
  normalized, sorted `RuntimeToolchainConfig`. Pure/deterministic.
- **`RepoToolchainDetector`** — maps repo files to toolchains
  (`.mise.toml`, `.tool-versions`, `go.mod`, `requirements.txt`/`pyproject.toml`,
  `Cargo.toml`, `package.json` engines, `pom.xml`).
- **`CompositeImageBuilderService`** — generates the thin Dockerfile, builds via
  dockerode, owns the local image cache, per-tag build lock, and GC.
- **`PackageCacheVolumeService`** — owns the cache registry (presets + custom),
  ensures named volumes exist, and produces the mount + env list.

This **extends** the existing `HarnessProviderRegistryService` rather than
replacing it: the registry's per-harness `imageRef` becomes the _base_ image, and
composites are derived from it.

### Touch points (existing code)

| Concern                       | File                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| Harness image resolution      | `apps/api/src/harness/harness-provider-registry.service.ts`                                     |
| Step container config         | `apps/api/src/workflow/workflow-step-execution/step-agent-container-config.helpers.ts`          |
| Subagent container config     | `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts` |
| Container create / docker run | `apps/api/src/docker/container-orchestrator.service.ts`                                         |
| Tier selection                | `apps/api/src/workflow/workflow-step-execution/step-support.service.ts`                         |
| Step provisioning             | `apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts`         |
| npm self-heal entrypoint      | `docker/heavy-entrypoint.sh`                                                                    |

## 4. Config Model & Data Model

Shared types live in `@nexus/core` (both API and harness-runtime consume them):

```ts
interface ToolchainSpec {
  tool: string; // mise tool name: 'python' | 'go' | 'rust' | 'node' | 'java' | 'ruby' | ...
  version: string; // '3.12', '1.23', 'latest', or a mise-resolvable spec
}

interface CacheMountSpec {
  id: string; // -> named volume `nexus-cache-<id>`
  path: string; // absolute mount path in the container
}

interface RuntimeToolchainConfig {
  toolchains: ToolchainSpec[];
  aptPackages?: string[]; // system-library escape hatch (libpq-dev, etc.)
  caches?: CacheMountSpec[]; // user-added caches
  disableCaches?: string[]; // opt a preset off by id
}
```

### Precedence chain (highest wins)

| Layer                  | Source                                                  | Storage                                  |
| ---------------------- | ------------------------------------------------------- | ---------------------------------------- |
| 1. Step override       | `steps[].inputs.toolchains` / `apt_packages` / `caches` | workflow YAML (validated)                |
| 2. Agent profile       | `agent_profiles.runtime_toolchains`                     | new nullable JSONB column (API-owned)    |
| 3. Project (run input) | `run.inputs.runtime_toolchains`                         | neutral launch input, injected by Kanban |
| 4. Repo auto-detect    | repo files (see `RepoToolchainDetector`)                | inferred at provision time               |
| 5. Base default        | `node@<base>` only                                      | constant                                 |

`caches` are **unioned** across layers (additive); `toolchains`/`aptPackages`
follow first-non-empty-wins per the chain. This mirrors the existing AI-config
precedence so it feels native and reuses the same resolver pattern.

**Project-layer boundary correction:** there is no `projects` entity in the API —
"project" is a **Kanban-domain** concept (`kanban_projects` in `apps/kanban`), and
`CLAUDE.md` forbids API/core from reading project-domain tables. So the
project-level toolchain config is **not** an API DB read. Instead:

1. A new nullable JSONB column `kanban_projects.runtime_toolchains` (Kanban side).
2. Kanban's launch path injects that value into the workflow launch payload as a
   **neutral** run-level input (`runtime_toolchains`), alongside the existing
   neutral `scopeId`/`contextId` fields.
3. The API-side `ToolchainResolverService` reads it from the resolved run inputs —
   never from a Kanban table. The API/core code stays Kanban-neutral.

### Migrations

Two additive **nullable** JSONB columns. No backfill — `NULL`/absent means "fall
through to detect/base," so every existing row keeps today's behavior:

- `agent_profiles.runtime_toolchains` (API migrations, via the
  `adding-entity-migration` skill).
- `kanban_projects.runtime_toolchains` (Kanban migrations).

### Validation

- Workflow validator gains an optional `toolchains` / `apt_packages` / `caches`
  schema on step inputs.
- Tool names validated against an **allowlist** of mise-supported tools; versions
  constrained to a safe charset.
- `aptPackages` allowlist/charset-validated.
- Cache `id` restricted to `[a-z0-9-]`; `path` must be absolute, no `..`
  traversal, and is blocked from sensitive mounts (`/workspace`, `/app`, `/`).

### Boundary note

All API/core-side config is **neutral runtime config** — no Kanban-domain
identifiers — so it stays clean against `nexus-boundaries/no-core-kanban-residue`.
The only Kanban-domain piece (`kanban_projects.runtime_toolchains` + launch
injection) lives entirely in `apps/kanban`; it reaches the API solely as a neutral
`runtime_toolchains` run input.

### Tier clarification

Tier (light/heavy) remains the **resource/size** axis, orthogonal to toolchain.
Composite-toolchain builds target the heavy/agent execution path; light stays the
minimal fast-path.

## 5. Caching Mechanics & Build Lifecycle

### A. Composite-image cache

- **Tag / key:** `nexus-rt/<harnessId>:<shortHash>` where
  `shortHash = sha256(baseImageId + JSON(sortedToolchains) + JSON(sortedApt))[:12]`.
  Identical sets → identical tag → built once, reused forever.
- **Lookup:** `docker image inspect <tag>` via dockerode. Hit → use. Miss → build.
- **Build:** generate a thin Dockerfile in a scratch build dir:

  ```dockerfile
  FROM nexus/harness-<harnessId>-base:latest
  RUN --mount=type=cache,target=/var/cache/apt/archives \
      apt-get update && apt-get install -y <aptPackages>   # only if declared
  RUN --mount=type=cache,target=${MISE_CACHE_DIR} \
      mise use -g python@3.12 go@1.23 ... && mise reshim
  ```

  Built with BuildKit cache mounts so apt `.deb`s and mise toolchain downloads are
  cached across builds without bloating image layers.

- **Concurrency:** a per-tag in-process build lock (`Map<tag, Promise>`) so two
  steps needing the same new set trigger **one** build and both await it. The lock
  is best-effort: if the holder dies, the promise rejects, the entry clears, and
  the next step simply rebuilds (cache miss). This explicitly avoids the
  "in-process promise orphaned on restart" wedge class.
- **GC:** a periodic reaper removes composite images not used within N days or
  above a total-size cap (LRU by a last-used label stamped at provision), tying
  into the existing cleanup-service pattern. Keeps the constrained VM from filling.

### B. Package & OS cache volumes

The cache set is a **registry**, not a hardcoded table. Built-in **presets**
auto-enable when the relevant toolchain is present; config adds **custom** caches
and can **disable** presets.

| Ecosystem     | Volume → mount                                | Env                     | Auto-enable trigger     |
| ------------- | --------------------------------------------- | ----------------------- | ----------------------- |
| npm           | `nexus-cache-npm` → `/root/.npm`              | `npm_config_cache`      | node present            |
| pip           | `nexus-cache-pip` → `/root/.cache/pip`        | `PIP_CACHE_DIR`         | python present          |
| Go            | `nexus-cache-go` → module + build cache       | `GOMODCACHE`, `GOCACHE` | go present              |
| Cargo         | `nexus-cache-cargo` → `/root/.cargo/registry` | `CARGO_HOME`            | rust present            |
| Maven         | `nexus-cache-maven` → `/root/.m2`             | —                       | java present            |
| mise          | `nexus-cache-mise` → mise download cache      | `MISE_CACHE_DIR`        | always                  |
| apt (runtime) | `nexus-cache-apt` → `/var/cache/apt/archives` | —                       | always (disable: `apt`) |

Caches are content-addressed/registry-style, so concurrent readers/writers across
parallel containers are safe (the package managers handle this themselves). First
install of a dep is normal speed; subsequent containers reuse it.

**OS / apt caching** is handled in two distinct places:

1. **Build-time** (composite image installing `aptPackages` / running `mise`):
   BuildKit cache mounts in the generated Dockerfile (above).
2. **Runtime** (agent runs `apt-get install` mid-task): the base image is
   configured with `APT::Keep-Downloaded-Packages "true"` (Debian `docker-clean`
   hook removed) and the `nexus-cache-apt` volume mounted, so repeated runtime apt
   installs reuse downloaded packages.

### C. Relationship to today's npm self-heal

The existing baked-`node_modules` hardlink optimization in `heavy-entrypoint.sh`
is specific to Nexus working on **its own** repo and stays as-is for that path.
For arbitrary repos, the agent runs its own `npm install` / `pip install` /
`cargo build`, made fast by the shared cache volumes.

### D. Build trigger — lazy with cache (default), optional pre-warm

- **Lazy:** a toolchain set is built the first time a step needs it; thereafter a
  cache hit. First-ever use of a new set pays a one-time build cost (typically
  tens of seconds with mise's prebuilt binaries + cache volume); every run after
  is instant.
- **Optional pre-warm:** a small admin/seed list of known toolchain sets can be
  built ahead of time. Lazy remains the default so we don't over-build.

## 6. Backward Compatibility & Migration

- When the resolved toolchain set is **node-only** (the base default),
  `HarnessImageResolver` returns the **existing** `pi` / `claude-code` image
  directly — no build, no new behavior. Every current JS workflow takes exactly
  today's path.
- New columns are nullable; `NULL` ⇒ detect/base. No backfill, no forced seed
  migration.
- The Makefile gains `nexus/harness-<id>-base` targets; the current
  `nexus-heavy` / `nexus-light` / `nexus/harness-pi` /
  `nexus/harness-claude-code` images keep building under their existing names so
  chat-execution and fallbacks are unaffected. The base images are effectively a
  generalization of the current heavy image (harness-runtime + build tools +
  `mise`).

## 7. Error Handling

- **Build failure** → typed `CompositeImageBuildError` capturing the failing
  `mise`/`apt` step + a NUL-sanitized log tail (per existing log-safety rules);
  the step fails with an actionable cause rather than a generic stall.
- **Unknown/unsupported tool or version** → caught at resolution/validation time
  with the offending `tool@version`, before any container is provisioned.
- **Build-lock holder dies** → awaited promise rejects, lock entry clears, next
  step retries cleanly (no permanent wedge).
- **Cache volume unavailable** → degrade gracefully to an uncached install
  (slower, not failed).

## 8. Security (OWASP-aligned)

- Tool names, versions, apt packages, and cache `id`/`path` all validated against
  allowlists / safe charsets — no shell injection into the generated Dockerfile,
  no path traversal, no escaping intended mount points.
- No secrets in build args or image layers; provider secrets continue to flow
  only via the existing runtime env path, never baked into composite images.
- Generated Dockerfiles live in a scratch build dir, never in the repo/workspace.

## 9. Frontend Config (apps/web)

### A. Reusable editor — `RuntimeToolchainEditor`

One self-contained component (pattern: existing `FallbackChainEditor`) edits a
whole `RuntimeToolchainConfig`:

- **Toolchains** — add/remove `{ tool, version }` rows; `tool` is a combobox
  backed by the mise-supported allowlist, `version` a validated input.
- **APT packages** — tag/chip input.
- **Caches** — add/remove `{ id, path }` rows; built-in presets shown as
  read-only "auto-enabled" chips with a `disableCaches` toggle per preset.
- Edits via an `onChange(value)` callback so it drops into react-hook-form (agent
  profile) and plain-state forms (project) identically.

### B. Agent profile — `apps/web/src/pages/agents/AgentProfileForm.tsx`

- New "Runtime" tab hosting `RuntimeToolchainEditor`.
- Extend the zod schema, `buildFormDefaults`, and `AgentProfileEditor.controller.ts`
  mapping; add `runtime_toolchains` to `AgentProfile`, `CreateAgentProfileRequest`,
  `UpdateAgentProfileRequest` in `apps/web/src/lib/api/types.ts`.

### C. Project settings — `apps/web/src/pages/project-workspace/SettingsTab.tsx`

- New "Runtime toolchains" card hosting the same editor. Because projects are
  **Kanban-owned**, this is wired to the **Kanban-backed** project settings
  endpoint (the project-workspace page already calls `api.updateProject` /
  project settings, which route to the Kanban service), persisting to
  `kanban_projects.runtime_toolchains`. Kanban then injects it into the workflow
  launch payload — the web layer just edits and saves the field.

### D. Workflow step (optional) — `components/workflow-editor/StepProperties.tsx`

- That panel already edits step `variables`/`harness`; add a collapsible
  "Toolchains override" using the same editor, writing to `steps[].inputs.toolchains`.
  Optional since steps are primarily YAML-authored.

### E. Shared types

`RuntimeToolchainConfig` / `ToolchainSpec` / `CacheMountSpec` live in `@nexus/core`
and are imported by web (matching the existing `FallbackChainEntry` pattern), so
the contract is single-sourced.

## 10. Testing (TDD, Vitest)

- **Unit:** `ToolchainResolverService` precedence (all 5 layers + tie-breaks +
  cache union); `RepoToolchainDetector` per file type; tag-hash determinism
  (same set → same tag, order-independent); Dockerfile generation snapshot;
  validation allowlist accept/reject; cache-registry preset auto-enable + disable.
- **Build-lock concurrency:** two concurrent requests for the same new tag ⇒ one
  build, both resolve.
- **Integration (dockerode mocked):** miss → build → reuse; volume mount + env
  assembly; node-only ⇒ existing-image fast path (no build invoked).
- **Frontend (Vitest):** `RuntimeToolchainEditor` (add/remove/validate, preset
  disable) and profile controller form-mapping; respect the web OOM fork cap.
- **Optional live E2E (gated):** build a real python composite, run
  `python --version` + a cached `pip install`, assert the cache volume is
  populated.

## 11. Documentation

- New `docs/guide` page: "Multi-language runtimes."
- Update harness/architecture docs and the relevant `CLAUDE.md` quirks section
  (image names, toolchain precedence, cache registry).
- New `.agents/skills` entry for authoring/maintaining toolchains and caches.

## 12. Open Items / Future Work

- Per-language image-build steps beyond `mise` + `apt` (e.g. custom build hooks)
  — deferred unless a real repo needs it.
- Remote/shared image cache across hosts — out of scope (single-host today).
- Pre-warm list management UI — start with seed/admin config; UI later if needed.
