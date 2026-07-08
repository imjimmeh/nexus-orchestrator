---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: gitops-contracts
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - packages/gitops-contracts/package.json
  - packages/gitops-contracts/tsconfig.json
  - packages/gitops-contracts/tsconfig.build.json
  - packages/gitops-contracts/vitest.config.ts
  - packages/gitops-contracts/src/index.ts
  - packages/gitops-contracts/src/common.schema.ts
  - packages/gitops-contracts/src/scope.schema.ts
  - packages/gitops-contracts/src/rbac.schema.ts
  - packages/gitops-contracts/src/overrides.schema.ts
  - packages/gitops-contracts/src/desired-state.schema.ts
  - packages/gitops-contracts/src/desired-state.ts
  - packages/gitops-contracts/src/validate-desired-state.ts
source_paths:
  - packages/gitops-contracts/
  - packages/gitops-contracts/src/
updated_at: 2026-06-15T17:11:11Z
---

# Probe Result: GitOps Contracts (Schemas)

## Narrative Summary

`packages/gitops-contracts` is a **fully implemented Zod leaf package** (mirroring the shape of `packages/kanban-contracts`) that defines the canonical schemas, parse/serialize helpers, and a pure `validateDesiredState()` referential-integrity checker for the GitOps declarative config repository. The package declares a single runtime dependency (`zod ^4.4.3`) and a single dev dependency (`vitest ^4.1.8`), with `tsc -p tsconfig.build.json` for build and `vitest run` for tests. It is the single source of truth for the GitOps document model used by `apps/api` (export/validate/yaml-loader services) and is designed to be importable by a future CLI and the reconciler without dragging in NestJS/TypeORM.

Seven schema modules are exported via `src/index.ts`:

- `common.schema.ts` — `GITOPS_API_VERSION` constant (`"nexus.gitops/v1"`), `SlugSchema` (lowercase, hyphen-friendly), `ScopePathSchema` (`"/"` or a `/slug/slug` chain).
- `scope.schema.ts` — `ScopeNodeTypeSchema` enum (`platform|org|region|team|project`, mirroring SCOPE_NODE_TYPES from 204A) and `ScopeNodeDocSchema` (the body of a `scope.yaml`).
- `rbac.schema.ts` — `PermissionNameSchema` (`resource:action`), `RoleDocSchema` (custom role with optional `ownerScope`), `AssignmentSchema`, and `AssignmentDocSchema` (the `assignments.yaml` file).
- `overrides.schema.ts` — `OverrideStrategySchema` (`replace|merge`), `OverrideSourceSchema` (`seeded|admin|repository|imported|agent_factory`), first-class definition schemas (`AgentProfileDocSchema`, `WorkflowDocSchema`, `SkillDocSchema`), override schemas (`AgentOverrideDocSchema`, `WorkflowOverrideDocSchema`, `SkillOverrideDocSchema`) with a shared `withBodyRule` superRefine enforcing the replace/merge body contract.
- `desired-state.schema.ts` — `PlacedScopeNodeSchema` (path + doc) and `DesiredStateSchema` (the whole repo: nodes, roles, assignments, agents, workflows, skills, and three override lists).
- `desired-state.ts` — `GITOPS_LAYOUT` constants, `serializeDesiredState(state)` (in-memory `DesiredState` → `DesiredStateFile[]`), and `parseDesiredStateFiles(files)` (reverse, with per-file and aggregate error reporting).
- `validate-desired-state.ts` — pure cross-document validation: `scope.orphan_parent`, `scope.duplicate_slug`, `role.unknown_permission`, `role.unknown_owner_scope`, `assignment.unknown_role`, `assignment.unknown_scope`, `assignment.unknown_user`, `override.unknown_scope`, `override.unknown_default`. Performs no IO; takes a `ValidationContext` (known permissions, system roles, default agent/workflow/skill names, optional known users).

## Capability Updates

- **GitOps document model (schemas)** — implemented. All seven top-level schemas are `.strict()` Zod objects with a stable `apiVersion: "nexus.gitops/v1"` and a `kind` discriminator.
- **Repository layout constants** — implemented. `GITOPS_LAYOUT` exports `manifest` (`gitops.yaml`), `scopesDir`, `rolesDir`, `assignmentsFile`, `scopeFile`, `agentsDir`, `workflowsDir`, `skillsDir`, with internal helpers `scopeFilePath` / `scopeDirOf` for path ↔ slug-path conversion.
- **Parse / serialize round-trip** — implemented. `serializeDesiredState` and `parseDesiredStateFiles` cover all ten document kinds (ScopeNode × N, Role × N, AssignmentList, AgentProfile, Workflow, Skill, plus the three scoped override kinds). Parsing collects per-file issues first and only runs aggregate `DesiredStateSchema.safeParse` if no individual file failed.
- **Cross-document referential integrity** — implemented as a pure function (`validateDesiredState(state, ctx)`) covering scope tree, roles, assignments, and overrides.
- **Override body contract** — implemented. `replace` strategy requires `definition` or `bodyRef`; `merge` strategy requires an `overrides` patch; enforced via a shared `withBodyRule` superRefine.
- **Consumed by `apps/api`** — confirmed via `grep`. The package is imported by `apps/api/src/gitops/config-validation.service.ts`, `config-validation.service.types.ts`, `config-export.service.ts`, `gitops-yaml-loader.ts`, `actual-state-reader.service.ts`, and the integration test `gitops.integration.spec.ts`. The API Dockerfile also copies the package for build.
- **Documentation coverage** — the package is referenced from `docs/project-context/ARCHITECTURE.md` (listed as new in 2026-06) and `docs/project-context/CAPABILITY_MAP.md`. Design rationale is captured in `docs/plans/2026-06-08-epic-204h-declarative-config-schema-repository.md` and the bindings design/implementation plans from 2026-06-11.

## Health Findings

- **Test coverage is comprehensive**: every `*.schema.ts` / `desired-state.ts` / `validate-desired-state.ts` source file has an adjacent `*.spec.ts` (7 spec files, all colocated in `src/`). `vitest.config.ts` is configured to include `src/**/*.spec.ts` with a 15s test/hook timeout. Each spec covers both positive and negative parsing paths (e.g. `common.schema.spec.ts` validates slug acceptance, nested paths, rejection of empty/uppercase/leading-segment cases; `validate-desired-state.spec.ts` exercises each error code, plus a positive case for in-repo override targets and a negative for orphan parents / duplicate slugs).
- **No `dist/` build artifact** in the probed tree — package is source-only here (build runs in CI/Docker per `apps/api/Dockerfile`). Strict TS (`"strict": true`) and `.strict()` Zod objects throughout reduce shape drift between YAML/JSON and TS types.
- **Recent churn** — file mtimes cluster around 2026-06-10 to 2026-06-12, with the more recent (2026-06-12) edits to `desired-state.schema.ts`, `desired-state.ts`, `overrides.schema.ts`, and the corresponding spec files consistent with the 2026-06-11 bindings implementation plan evolving workflows/agents/skills to first-class documents.
- **Churn risk** — the package is a leaf, so churn is bounded to itself and its consumers. The `.strict()` discipline and a single `apiVersion` constant make additive evolution safe; the `OverrideSourceSchema` enum and `OverrideStrategySchema` enum are the most likely breaking-change points if new sources/strategies are added.
- **Code quality** — schemas are colocated with their `.types.ts` re-exports of `z.infer`, keeping the public surface obvious. `desired-state.ts` cleanly separates platform-level vs scoped config dispatch (`dispatchPlatformConfigFile` vs `dispatchScopedConfigFile`) and explicitly ignores `bodyRef` sidecars at the parse step (handled elsewhere).
- **No linter or CI workflow for the package alone was probed** — lint uses the repo-wide `eslint.config.mjs`; CI invocation is governed by the root `turbo.json` pipeline (not read in this probe).

## Open Questions

- Whether the Zod v4 `z.uuid()` usage in `ScopeNodeDocSchema` matches the project's supported UUID format (v4 only vs any version) — the schema does not specify a version, and downstream `actual-state-reader` may need to enforce one.
- Whether the `bodyRef` sidecar files (`*.PROMPT.md`, `*.body.yaml`, `*.SKILL.md`) are resolved by `apps/api` or by a future reconciler — `parseDesiredStateFiles` explicitly skips them, so the sidecar-loading layer lives outside this package.
- Whether the `OverrideSourceSchema` value `"agent_factory"` is exercised by any current consumer or is a forward-looking value.
- Whether `validateDesiredState` is intended to be called synchronously inside request paths or only by an async reconciler — affects whether `knownUsers` resolution (currently `204I` apply-time) needs to be plumbed through this package or a downstream service.
- Whether the `dist/` output is published to a registry or consumed only via the monorepo workspace — affects whether the `main`/`types` entries in `package.json` are exercised.
