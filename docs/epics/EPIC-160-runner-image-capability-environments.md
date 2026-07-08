# EPIC-160: Runner Image Capability Environments

Status: Proposed
Priority: P1
Depends On: EPIC-048, EPIC-083, EPIC-103, EPIC-122, EPIC-140
Related:

1. docker/Dockerfile.light
2. docker/Dockerfile.heavy
3. apps/api/src/workflow/workflow-subagents/
4. apps/api/src/docker/container-orchestrator.service.ts
5. packages/pi-runner/src/server/server.ts
6. docs/epics/EPIC-122-execution-capability-discovery-and-contract-consolidation.md
7. docs/epics/EPIC-140-capability-registry-policy-and-runtime-governance-unification.md
   Last Updated: 2026-04-30

---

## 1. Epic Summary

Design and implement capability-aware runner environments so agents are dispatched onto images that actually contain the tools, package managers, language runtimes, browser dependencies, repository metadata, and project dependency caches required for their assigned work.

The immediate subagent-control-plane fix will force all subagents onto the heavy image as a short-term safety measure. This epic replaces that blunt default with a principled runtime capability model.

Target outcomes:

1. Agents declare or infer required execution capabilities before container provisioning.
2. The orchestrator selects an appropriate runner image from a governed image catalog.
3. Runner images advertise installed tools and runtime versions.
4. Preflight probes fail fast when requested work cannot run in the selected environment.
5. Development/test tasks can access project dependencies without every subagent rediscovering missing `git`, `vitest`, `node_modules`, or package-manager state.

---

## 2. Problem Statement

Subagents currently request a coarse `light` or `heavy` tier, but that tier does not reliably communicate what is installed or mounted. In the observed workflow run, many subagents repeatedly failed because light containers lacked `git`, some containers lacked usable test dependencies, and the parent orchestrator had no fast way to know the selected environment was unsuitable.

This creates three failure modes:

1. Agents waste model/tool turns discovering missing executables.
2. Parent orchestrators spawn replacement subagents rather than receiving actionable environment diagnostics.
3. The platform cannot express richer environments such as repository-readonly, repository-write, Node test runner, browser-capable, Python, Docker-in-Docker, or project-specific dependency cache.

The platform needs capability-based runtime selection rather than model-authored image choice.

---

## 3. Goals

1. Replace agent-facing image/tier choice with orchestrator-owned capability selection.
2. Define a versioned runner image catalog with declared tools, package managers, language runtimes, browser support, and mount expectations.
3. Add preflight probes that verify selected image capabilities before launching expensive agent work.
4. Support project dependency strategies for test-running work, including dependency-cache mounts or prepared workspace images.
5. Make environment failures explicit, typed, and visible in `event_ledger` and subagent status outputs.
6. Preserve policy controls so privileged capabilities require explicit governance.
7. Keep rollout incremental: start with current light/heavy images, then add specialized images only when the contract is proven.

## 4. Non-Goals

1. Replacing Docker as the initial execution backend.
2. Implementing every language ecosystem in the first release.
3. Letting agents choose arbitrary images or install arbitrary host-level packages without policy.
4. Solving package lockfile generation or dependency upgrade workflows.
5. Removing heavy runner support; heavy remains a valid capability bundle.

---

## 5. Target Architecture

### 5.1 Capability Contract

Introduce a runtime capability contract that can express requirements such as:

1. `repo.git.read`
2. `repo.git.write`
3. `shell.bash`
4. `node.runtime`
5. `node.package_manager.npm`
6. `node.test.vitest`
7. `browser.playwright.chromium`
8. `python.runtime`
9. `workspace.dependencies.readonly_cache`
10. `workspace.dependencies.install_allowed`

Capability requirements should come from workflow job metadata, tool policy, agent profile policy, task classification, and explicit orchestrator defaults. Agents may describe intent, but the control plane makes the final selection.

### 5.2 Runner Image Catalog

Create a catalog of known images with declared capabilities and operational metadata:

1. image name/tag/digest,
2. supported capabilities,
3. runtime versions,
4. default user and filesystem assumptions,
5. network policy compatibility,
6. host mount compatibility,
7. security risk level,
8. preflight probe commands.

The catalog can start as checked-in seed/config data and later move into database-managed runtime settings.

### 5.3 Selection Pipeline

Before container provisioning:

1. Resolve required capabilities.
2. Filter catalog images by policy and capability coverage.
3. Select the smallest sufficient image, unless policy forces a safer default.
4. Attach required mounts and dependency caches.
5. Run fast preflight probes.
6. Emit a typed success/failure event before agent prompt execution.

### 5.4 Dependency Strategy

Test-running agents need a reliable answer for project dependencies. Candidate strategies to evaluate:

1. Host-mounted workspace plus shared `node_modules` cache.
2. Per-worktree dependency installation before dispatch.
3. Prepared project image layers for known repositories.
4. Ephemeral package-manager cache volumes keyed by lockfile hash.
5. A dedicated test-runner service that runs commands outside the agent container but reports through the same telemetry path.

The first implementation should prefer lockfile-keyed cache volumes because they keep images generic while avoiding repeated installs.

---

## 6. Scope

### In Scope

1. Runtime capability schema and image catalog model.
2. Selection service in the workflow/subagent provisioning path.
3. Preflight probe execution and typed diagnostics.
4. Dockerfile/image updates for declared baseline capabilities.
5. Dependency cache/mount design for Node/Vitest workflows.
6. Observability and status output for environment selection failures.
7. Documentation and operator runbook for adding a new runner image.

### Out of Scope

1. Kubernetes or remote runner scheduling.
2. Arbitrary agent-installed system packages in production images.
3. Full language matrix beyond the first Node/Vitest path.
4. Browser runtime migration already tracked by EPIC-103 except where image catalog metadata overlaps.

---

## 7. Proposed Phased Implementation

### Phase 1: Contract and Catalog Baseline

1. Define runtime capability names and schema.
2. Add image catalog entries for current light and heavy images.
3. Add validation that image entries declare required probe commands.

### Phase 2: Selection and Policy Wiring

1. Add a selection service used by workflow step and subagent provisioning.
2. Remove model-authored image/tier selection from runtime tools.
3. Map existing jobs/profiles/tools to initial capability requirements.

### Phase 3: Preflight Diagnostics

1. Run image capability probes after container startup and before agent prompt kickoff.
2. Fail fast with typed `environment_preflight_failed` results.
3. Surface diagnostics in subagent status, wait aggregation, and event-ledger exports.

### Phase 4: Node/Vitest Dependency Path

1. Design lockfile-keyed dependency cache mounts.
2. Add safe install/restore behavior for test-capable environments.
3. Verify `npm run test --workspace=apps/api -- <spec>` works in selected runner environments.

### Phase 5: Specialized Images and Governance

1. Split specialized images only where justified by startup time, security, or dependency size.
2. Add admin docs for registering images and capability probes.
3. Add policy gates for privileged capabilities.

---

## 8. Actionable Tasks

- [ ] E159-001 Inventory current light/heavy image contents and gaps.
- [ ] E159-002 Define runtime capability enum/schema and validation fixtures.
- [ ] E159-003 Add image catalog seed/config for current runner images.
- [ ] E159-004 Add image catalog validation tests.
- [ ] E159-005 Implement capability requirement resolver for workflow jobs/subagents.
- [ ] E159-006 Implement runner image selection service.
- [ ] E159-007 Wire selector into workflow step container provisioning.
- [ ] E159-008 Wire selector into subagent container provisioning.
- [ ] E159-009 Add preflight probe execution before agent kickoff.
- [ ] E159-010 Emit typed event-ledger rows for environment selection and preflight failures.
- [ ] E159-011 Add subagent status fields for environment diagnostics.
- [ ] E159-012 Design lockfile-keyed Node dependency cache mount strategy.
- [ ] E159-013 Implement first Node/Vitest dependency-cache path.
- [ ] E159-014 Add regression workflow proving a subagent can run targeted API Vitest tests.
- [ ] E159-015 Add operator docs for image catalog entries and probes.
- [ ] E159-016 Add governance docs for privileged capabilities.

---

## 9. Acceptance Criteria

1. Agents no longer choose runner images directly.
2. The control plane selects an image from a validated capability catalog.
3. Missing `git`, `vitest`, package-manager, browser, or dependency-cache support fails before the agent spends turns on the task.
4. Environment failures are visible in `event_ledger`, subagent status, and debug bundles.
5. At least one Node/Vitest workflow can run from a subagent without ad-hoc dependency setup.
6. Adding a new image requires a catalog entry, probes, docs, and tests.

---

## 10. Quality Gates

Recommended verification commands:

1. `npm run test:api -- runner-image-capability`
2. `npm run test:api -- subagent-orchestrator.container-config.operations.spec.ts`
3. `npm run test --workspace=packages/pi-runner`
4. `docker build -f docker/Dockerfile.light -t nexus-light:latest .`
5. `docker build -f docker/Dockerfile.heavy -t nexus-heavy:latest .`
6. A smoke workflow that dispatches a Node/Vitest-capable subagent and verifies test execution.

---

## 11. Risks and Mitigations

1. Risk: Catalog becomes another manual drift point.
   Mitigation: validate catalog entries by actually running probes in CI/smoke tests.
2. Risk: Dependency caches become stale or cross-contaminate worktrees.
   Mitigation: key caches by lockfile hash and package-manager version.
3. Risk: More specialized images increase operational complexity.
   Mitigation: start with current images, split only when data shows a need.
4. Risk: Preflight probes slow down dispatch.
   Mitigation: keep probes cheap and cache successful image-level probe results by image digest.
5. Risk: Privileged capabilities widen attack surface.
   Mitigation: require explicit policy and audit logging for privileged image selection.

---

## 12. Exit Criteria

1. Capability-based image selection replaces coarse tier choice for workflow and subagent execution.
2. Runner image capabilities are documented, validated, and observable.
3. Test-running subagents have a supported dependency strategy.
4. The temporary "always heavy" fallback from the subagent-control-plane fix can be retired safely.
