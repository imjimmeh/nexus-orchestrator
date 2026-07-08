# Multi-Language Harness Runtimes

Workflow execution containers default to the Node-only harness base images
(`nexus-heavy:latest` / `nexus-light:latest` / `nexus/harness-pi:latest` /
`nexus/harness-claude-code:latest`). This feature lets a step, agent profile,
or Kanban project declare additional language toolchains (e.g. `python@3.12`,
`go@1.23`) and apt packages; the API resolves the effective set per
execution and — only when it differs from a plain Node runtime — builds and
reuses a small, content-addressed **composite image** layered on top of the
harness base via [mise](https://mise.jdx.dev/).

Node-only workflows are completely unaffected: the resolver's fast path
returns the existing harness image unbuilt, with no new behavior.

## Shared types (`@nexus/core`)

All toolchain types live in one place —
`packages/core/src/interfaces/runtime-toolchain.types.ts` — and neither the
API nor the web app redeclares them:

```ts
export const SUPPORTED_TOOLS = [
  "node",
  "python",
  "go",
  "rust",
  "java",
  "ruby",
  "deno",
  "bun",
  "dotnet",
  "php",
] as const;

export interface ToolchainSpec {
  tool: string; // mise tool name, e.g. 'python'
  version: string; // '3.12', 'latest', or any mise-resolvable version spec
}

export interface CacheMountSpec {
  id: string; // Docker named volume `nexus-cache-<id>`; charset [a-z0-9-]
  path: string; // absolute container mount path
}

export interface RuntimeToolchainConfig {
  toolchains: ToolchainSpec[];
  aptPackages?: string[]; // system-library escape hatch, installed via apt
  caches?: CacheMountSpec[]; // user-added caches beyond the built-in presets
  disableCaches?: string[]; // built-in preset ids to turn off
}
```

## The 5-layer precedence chain

`ToolchainResolverService.resolve()`
(`apps/api/src/workflow/workflow-runtime-toolchains/toolchain-resolver.service.ts`)
merges up to five layers, highest precedence first:

1. **Step** — `steps[].inputs.{toolchains, apt_packages, caches, disable_caches}`
   in the workflow YAML, lifted by `parseStepRuntimeToolchainConfig`
   (`apps/api/src/workflow/validation/workflow-validation.runtime-toolchains.ts`).
2. **Agent profile** — `agent_profiles.runtime_toolchains` (jsonb column,
   migration `apps/api/src/database/migrations/20260630120000-add-agent-profile-runtime-toolchains.ts`).
   Threaded into `resolverInputs.agentProfileConfig` at both call sites:
   `StepAgentContainerSupportService` loads the profile entity in
   `resolveCanonicalAgentProfile()` and passes its `runtime_toolchains`
   through `buildProvisionedAgentContainerConfig()`
   (`apps/api/src/workflow/workflow-step-execution/`); the subagent path
   loads it in `resolveSubagentSkillDiscoveryModeForProfile()` and passes it
   into `buildSubagentContainerConfigOperation()`'s `applyRuntimeToolchains`
   call (`apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts`).
   An agent profile's toolchain config set via the web `AgentProfileForm`
   therefore does take effect at runtime.
3. **Run input** — the neutral `runtime_toolchains` field on the workflow
   run's trigger record (`stateVariables.trigger.runtime_toolchains`),
   parsed by `parseRunInputRuntimeToolchainConfig` in the same
   `workflow-validation.runtime-toolchains.ts` file. This is the layer
   Kanban populates — see [Boundary rule](#boundary-rule-kanban-injects-a-neutral-run-input) below.
4. **Repo-detected** — `RepoToolchainDetectorService.detect()`
   (`apps/api/src/workflow/workflow-runtime-toolchains/repo-toolchain-detector.service.ts`)
   inspects the checked-out workspace for `.tool-versions`, `go.mod`,
   `package.json` (`engines.node`), `Cargo.toml`, `requirements.txt` /
   `pyproject.toml`, and `pom.xml` (the exact filename list is
   `DETECTED_FILENAMES` in `repo-toolchain-detector.ts`), via the pure
   `detectToolchainsFromFiles()` function.
5. **Base default** — `{ toolchains: [] }` (`BASE_DEFAULT` in
   `toolchain-resolver.service.ts`) when nothing else applies.

Each _explicit_ (non-detected) layer is validated up front via
`validateRuntimeToolchainConfig`
(`apps/api/src/workflow/workflow-runtime-toolchains/toolchain-validation.ts`)
so an invalid request fails fast before any image build or merge work
starts. The fully **merged** result — which can be won by the untrusted
repo-detected layer (layer 4) whenever no explicit layer overrides it — is
validated again after the merge, inside `ToolchainResolverService.resolve()`,
before it is returned to any caller. This closes the gap where a malicious
`.tool-versions`/`go.mod`/`package.json` entry in repo content could
otherwise reach `generateCompositeDockerfile()` unvalidated. Validation
enforces: `tool` must be in `SUPPORTED_TOOLS`; `version` must match
`/^[A-Za-z0-9._-]+$/`; `aptPackages` entries must match
`/^[a-z0-9][a-z0-9.+-]*$/`; cache `id`s must match `/^[a-z0-9-]+$/`; cache
`path`s must be absolute, must not contain `..`, and (after normalization)
must not resolve to `/`, `/app`, or `/workspace`.

### Merge semantics

`mergeToolchainLayers()`
(`apps/api/src/workflow/workflow-runtime-toolchains/toolchain-merge.ts`) is
**not** a per-field deep merge across all five layers — it is "first
non-empty layer wins" for `toolchains` and `aptPackages` (the first layer in
precedence order that has a non-empty array supplies the _entire_ array for
that field), while `caches` are **unioned** across every layer (dedup by
`id`, first occurrence wins) and `disableCaches` is the **union** of all
layers' disable lists. In practice this means: if a step declares
`toolchains: [{tool: python, version: 3.12}]`, that entirely replaces
whatever the agent profile, run input, or repo-detector would have supplied
for `toolchains` — but any caches or disabled-cache ids declared at any
layer still apply.

## Composite image tagging, build, and GC

Tag format, computed by `computeCompositeImageTag()`
(`apps/api/src/workflow/workflow-runtime-toolchains/composite-image-tag.ts`):

```
nexus-rt/<harnessId>:<12-hex-sha256>
```

The hash is `sha256(baseImageId + canonical({toolchains: sorted "tool@version" list, apt: sorted aptPackages}))`,
truncated to 12 hex characters (`HASH_LEN = 12`) — content-addressed by both
the resolved harness base image's Docker image ID and the exact toolchain
set, so the same toolchain request against a rebuilt base image gets a new
tag automatically.

`isNodeOnly(config)` in the same file is the fast-path gate: true only when
`aptPackages` is empty and every toolchain entry's `tool === 'node'`.
`HarnessImageResolver.resolveImageRef()`
(`apps/api/src/workflow/workflow-runtime-toolchains/harness-image-resolver.service.ts`)
checks this first and returns the harness base image unbuilt when true;
otherwise it delegates to `CompositeImageBuilderService.ensureImage()`.

`CompositeImageBuilderService`
(`apps/api/src/workflow/workflow-runtime-toolchains/composite-image-builder.service.ts`):

- Checks whether the tag already exists locally (`docker.getImage(tag).inspect()`); if so, returns it immediately with no build.
- Otherwise de-duplicates concurrent build requests for the same tag via an in-process `Map<string, Promise<string>>` (`inFlight`) — concurrent callers for an identical toolchain set share one `docker buildImage` call instead of racing.
- Builds from a Dockerfile generated by `generateCompositeDockerfile()` (`apps/api/src/workflow/workflow-runtime-toolchains/composite-dockerfile.ts`), tarred in-memory (no disk build context) via `tar-stream`.
- Labels every built image `nexus.managed=true` (`MANAGED_LABEL`) so GC can find them by selector.
- On build failure, throws `CompositeImageBuildError` (`composite-image-build.error.ts`) carrying a NUL-sanitized, 2000-char-capped log tail (`BUILD_LOG_TAIL_MAX_CHARS`, via `normalizeContainerLogs`) rather than surfacing raw multiplexed Docker log bytes.

The generated composite Dockerfile (`generateCompositeDockerfile`) is
intentionally unescaped/unvalidated at that layer — **callers must run
`validateRuntimeToolchainConfig` first** (documented in the file's own
header comment). It emits, in order:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM <baseImageRef>
RUN --mount=type=cache,target=/var/cache/apt/archives \
    apt-get update && apt-get install -y --no-install-recommends <sorted apt packages>
RUN --mount=type=cache,target=/root/.cache/mise \
    mise use -g <sorted "tool@version" list> && mise reshim
```

(the apt `RUN` block is omitted entirely when `aptPackages` is empty, and
likewise for the mise block when `toolchains` is empty.)

### Garbage collection

`CompositeImageBuilderService.collectGarbage(maxAgeMs)` lists all
`nexus.managed=true` images, filters to ones whose repo tag starts with
`nexus-rt/`, and removes (`force: false`) any older than `maxAgeMs`,
logging (not throwing) on a removal failure.

It is wired into the existing periodic cleanup cron,
`ContainerCleanupService`
(`apps/api/src/docker/container-cleanup.service.ts`), which already runs
**hourly** (`repeat: { pattern: '0 * * * *' }`, added in `onModuleInit`).
Step 4 of that job's `process()` calls
`compositeImageBuilder.collectGarbage(COMPOSITE_IMAGE_MAX_AGE_MS)`, where
`COMPOSITE_IMAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000` (**7 days** — kept
deliberately longer than the container-level 24h stale window, since
rebuilding a composite image is far more expensive than restarting a
container).

`CompositeImageBuilderService` is resolved **lazily** by
`ContainerCleanupService` via `ModuleRef.get(CompositeImageBuilderService, { strict: false })`
rather than a constructor injection, specifically to avoid `DockerModule`
needing a static import of `WorkflowRuntimeToolchainsModule` (which itself
imports `DockerModule` for `DOCKER_CLIENT` — a static back-edge would close
a module cycle). See the class-doc comments on both
`ContainerCleanupService` and `WorkflowRuntimeToolchainsModule`
(`apps/api/src/workflow/workflow-runtime-toolchains/workflow-runtime-toolchains.module.ts`)
and `apps/api/CIRCULAR_BASELINE.md` for the wider module-cycle context. If
the lookup resolves to `null` (module not imported), the cron throws
explicitly rather than silently skipping GC.

## Cache-volume registry

`PackageCacheVolumeService.resolveCacheMounts()`
(`apps/api/src/workflow/workflow-runtime-toolchains/package-cache-volume.service.ts`)
ensures Docker named volumes exist (idempotent `createVolume`, labeled
`nexus.managed=true` + `nexus.cache=true`) and returns the volume mounts +
env vars to apply to the container.

Built-in presets — `CACHE_PRESETS` in
`apps/api/src/workflow/workflow-runtime-toolchains/cache-volume-presets.ts`,
volume name prefix `CACHE_VOLUME_PREFIX = 'nexus-cache-'` (so preset `pip`
→ Docker volume `nexus-cache-pip`):

| Preset id | Container path            | Env vars set            | Gated by                    |
| --------- | ------------------------- | ----------------------- | --------------------------- |
| `mise`    | `/root/.cache/mise`       | `MISE_CACHE_DIR`        | always on                   |
| `apt`     | `/var/cache/apt/archives` | —                       | always on                   |
| `npm`     | `/root/.npm`              | `npm_config_cache`      | toolchain contains `node`   |
| `pip`     | `/root/.cache/pip`        | `PIP_CACHE_DIR`         | toolchain contains `python` |
| `go`      | `/root/go/pkg/mod`        | `GOMODCACHE`, `GOCACHE` | toolchain contains `go`     |
| `cargo`   | `/root/.cargo/registry`   | `CARGO_HOME`            | toolchain contains `rust`   |
| `maven`   | `/root/.m2`               | —                       | toolchain contains `java`   |

`mise` and `apt` are unconditional presets (`enabledFor: () => true`) — they
apply even to node-only resolutions that skip the composite-image build
entirely, since the harness base images themselves use apt/mise at
provisioning time. The tool-gated presets are enabled per-request by
`enabledFor(config)` checking whether `config.toolchains` contains that
tool.

**Custom caches**: entries in `config.caches` (a `CacheMountSpec[]`) are
appended unconditionally as `nexus-cache-<id>` volumes mounted at the
caller-specified `path` (already validated by `toolchain-validation.ts`).

**Disabling caches**: any preset id present in `config.disableCaches` is
skipped entirely (e.g. `disableCaches: ['apt']` to opt a run out of the
apt cache).

Cache-volume creation degrades gracefully: `ensureVolume()` catches
`createVolume` failures and only `logger.warn`s (Docker's `createVolume`
is idempotent for "already exists"; a genuine failure — auth, disk-full —
surfaces as a warning, not a hard failure of the whole provisioning path).

## The apt/OS caching mechanism

By default, Debian-based images delete downloaded `.deb` packages after
`apt-get install` (`/etc/apt/apt.conf.d/docker-clean`), which would make the
`apt` cache-volume preset useless. Both `docker/Dockerfile.heavy` and
`docker/Dockerfile.claude-code` disable that behavior identically:

```dockerfile
# Keep downloaded .deb packages so a mounted /var/cache/apt/archives volume
# caches runtime apt installs across containers.
RUN rm -f /etc/apt/apt.conf.d/docker-clean \
    && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache
```

immediately followed by installing [mise](https://mise.jdx.dev/) itself
(`curl -fsSL https://mise.run | sh`, symlinked to `/usr/local/bin/mise`,
`MISE_DATA_DIR=/root/.local/share/mise`, shims prepended to `PATH`) so that
composite images built `FROM` these base images can immediately
`mise use -g <tool>@<version>`.

## Boundary rule: Kanban injects a neutral run input

The API and `@nexus/core` never read Kanban/project tables directly — the
same core/kanban boundary enforced everywhere else in this repo (see
`CLAUDE.md`/`AGENTS.md` → _Core/Kanban Boundary_) applies to this feature
too:

- `kanban_projects.runtime_toolchains` is a jsonb column, added by
  `apps/kanban/src/database/migrations/20260701090000-add-kanban-project-runtime-toolchains.ts`,
  editable via `ProjectService.update()` /
  `apps/web/src/pages/project-workspace/RuntimeToolchainsCard.tsx` and
  surfaced by `ProjectService.toRecord()`
  (`apps/kanban/src/project/project.service.ts`). The Zod contract lives in
  `packages/kanban-contracts/src/project.schema.ts`
  (`UpdateProjectRequestSchema`, `ProjectSchema`).
- When Kanban's auto-dispatch cycle (`apps/kanban/src/dispatch/`) launches a
  workflow run for a work item, `buildRunRequest()`
  (`apps/kanban/src/dispatch/dispatch-run-link.helper.ts`) calls
  `buildLaunchInputsWithToolchains()`, which appends the dispatched
  project's `runtime_toolchains` onto the launch input as a plain
  `runtime_toolchains` key — **omitted entirely** (not `null`) when the
  project has no config, so the API-side parser can treat "key absent" the
  same as "no run-input override."
- On the API side, `parseRunInputRuntimeToolchainConfig()`
  (`apps/api/src/workflow/validation/workflow-validation.runtime-toolchains.ts`)
  reads `stateVariables.trigger.runtime_toolchains` off the workflow run's
  trigger record — it has **no knowledge of Kanban, projects, or where the
  field originated**. It is exactly as neutral as `scopeId`/`contextId`.

This is the same "project layer, Kanban-injected as a neutral run input"
pattern the core/kanban boundary already requires for other Kanban-owned
concepts: Kanban writes a generic, provider-agnostic input; the API only
ever consumes generic inputs.

## How to add a new supported tool

1. Add the mise tool name to `SUPPORTED_TOOLS` in
   `packages/core/src/interfaces/runtime-toolchain.types.ts`. This is the
   single source of truth — `toolchain-validation.ts`'s
   `validateRuntimeToolchainConfig()` and the web
   `RuntimeToolchainEditor`'s tool `<Select>` both import it directly, so
   no other file needs to change for the tool to become requestable and
   pass validation.
2. If the tool needs a package-manager cache (like `pip`/`go`/`cargo`/
   `maven`), add a new entry to `CACHE_PRESETS` in
   `apps/api/src/workflow/workflow-runtime-toolchains/cache-volume-presets.ts`
   — see [Cache-volume registry](#cache-volume-registry) above.
3. If the tool typically needs OS-level libraries beyond what apt-get
   installs by default, no code change is required — callers can already
   pass `aptPackages` (validated against `/^[a-z0-9][a-z0-9.+-]*$/`).
4. Rebuild `packages/core`, then `apps/api`/`apps/kanban`/`apps/web` in
   that order (core is the shared dependency).
5. No seed/migration change is required — `SUPPORTED_TOOLS` is a pure
   compile-time constant, not a DB-driven allowlist.

See also `.agents/skills/runtime-toolchains/SKILL.md` for the full
step-by-step authoring workflow, including how to smoke-test a composite
build locally.

## Known gaps

1. **The manual dispatch/review/merge launch path does not inject
   `runtime_toolchains`.** Only the Kanban auto-dispatch cycle
   (`apps/kanban/src/dispatch/dispatch-work-items.core.ts` →
   `buildRunRequest()`) threads the project's `runtime_toolchains` onto the
   launch input. `requestWorkItemRun()`
   (`apps/kanban/src/work-item/work-item-run.helpers.ts`), which backs the
   manual "run this work item" / review / merge launch paths
   (`apps/kanban/src/work-item/work-item.service.ts`), builds its own
   `coreClient.requestWorkflowRun` request independently and never calls
   `buildRunRequest`/`buildLaunchInputsWithToolchains` — so a manually
   dispatched run silently falls back to layers 1/2/4/5 only, never layer 3.
   This is a real, self-flagged gap carried over from the design.
2. **Task 20 (optional step-level toolchain override in the workflow editor
   UI) was not implemented** — it was marked `(optional)` in the
   implementation plan and explicitly skipped. Step-level toolchains can
   still be set by hand-authoring `steps[].inputs.toolchains` etc. in the
   workflow YAML; there is just no dedicated editor widget for it.
3. **This plan's work surfaced (but did not cause) a pre-existing circular-
   dependency count drift** in `apps/api`'s `madge:ci` gate (34 observed vs.
   the 32 baseline recorded in `apps/api/CIRCULAR_BASELINE.md`), confirmed
   present as of the end of Task 8 — before Task 9 added any new module
   wiring for this feature. If `madge:ci` is failing at 34, this is a known,
   separate, pre-existing issue and not something introduced by the
   multi-language runtime work.
