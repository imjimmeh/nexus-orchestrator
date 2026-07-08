# Nexus Orchestrator

## Monorepo Structure

```
apps/          Deployable services
  api/         NestJS orchestration engine (NestJS CLI, BullMQ, TypeORM)
  kanban/      Kanban domain service (NestJS, separate TypeORM instance)
  web/         Vite + React + Tailwind management UI
  chat/        Chat channel ingestion (Telegram, etc.)
packages/      Shared libraries
  core/        Shared TS interfaces, enums, schemas — build this first
  e2e-tests/   Black-box E2E and workflow integration suites
  kanban-contracts/ Kanban domain contracts
  kanban-mcp/  Kanban MCP server
  pi-runner/   Runtime bridge for execution containers
  plugin-sdk/  Plugin SDK
  shared/      Shared utilities
  agent-local/ Local MCP-compatible service
```

- `apps/` = deployable services, `packages/` = shared libraries.
- Shared contracts live in `@nexus/core` — never redefine them locally.
- Import via absolute paths (configured in workspace tsconfig paths).

## Commands (from repo root)

### Build

Build `packages/core` first — all apps depend on it.

```bash
npm run build --workspace=packages/core
npm run build:api
npm run build:kanban
npm run build:web
```

### Dev Servers

```bash
npm run start:api          # NestJS --watch
npm run start:dev --workspace=apps/kanban
npm run dev:web            # Vite dev server
```

### Lint

```bash
npm run lint               # Runs per-workspace; stops on first failure
npm run lint:api
npm run lint:web
npm run lint:kanban
npm run lint:summary       # PowerShell script — repo-wide visibility instead
```

### Test

```bash
npm run test:api                  # Vitest (apps/api)
npm run test:kanban               # Vitest (apps/kanban)
npm run test:integration:kanban-core  # Kanban integration suite
npm run test:unit:web             # Vitest (apps/web)
npm run test:e2e:web              # Playwright (apps/web)
npm run test:e2e                  # Black-box E2E against live stack
npm run test:e2e:kanban:strict    # Kanban deterministic E2E
npm run test:e2e:kanban:deterministic  # API-side deterministic kanban E2E
npm run test:e2e:review           # Review E2E
npm run validate:seed-data        # Seed data validation
```

Targeted iteration: `npm run test --workspace=apps/api` (same pattern for any workspace).

### Docker / Local Stack

```bash
docker compose up -d --build
```

### Validation

```bash
npm run validate:seed-data
```

## Service Ports (docker compose)

| Service       | Port |
| ------------- | ---- |
| API HTTP      | 3010 |
| API WebSocket | 3011 |
| Kanban API    | 3012 |
| Web UI        | 3120 |
| Postgres      | 5433 |
| Redis         | 6380 |

Honcho profile (add `--profile honcho` to compose):
| Honcho API | 8030 |
| Honcho Postgres | 5443 |

## Architecture Quirks

- **AI config precedence** (runtime, always check this order):
  1. Workflow step override (`steps[].inputs.model` / `provider` / `agent_profile`)
  2. Agent profile from DB (`agent_profiles`)
  3. DB default model for use case
  4. Environment fallback (`MODEL`, `DISTILLATION_MODEL`, `SUMMARIZATION_MODEL`)
- **Thinking/effort level precedence** (runtime): step input
  (`steps[].inputs.thinking_level`) → agent profile (`agent_profiles.thinking_level`)
  → per-model default (`llm_models.default_thinking_level`) → omit. The resolved
  level is clamped to the model's supported levels (pi SDK
  `getSupportedThinkingLevels`, DB `thinkingLevelMap` fallback); `off` is never
  clamped up.
- **Memory token budget resolver** — model-aware 60/30/10 slice of the resolved `contextWindow` and the `MEMORY_BUDGET_*` env knobs that drive it. See [docs/guide/memory-token-budget-resolver.md](docs/guide/memory-token-budget-resolver.md).
- **Improvement governance mode precedence** (`ImprovementGovernancePolicyService`, `apps/api/src/improvement/`): per-kind override (`improvement_governance_overrides[kind]`) → global mode (`improvement_governance_mode`, default `tiered`) → confidence is always capped by evidence class first (`struggle_backed` ≤ `retrospective_confidence_struggle_cap` 0.7, `inference` ≤ `retrospective_confidence_inference_cap` 0.45 — shared with the retrospective router) before any mode rule runs, and a capped confidence `<= 0` always drops regardless of mode — **except** an operator-directed `skill_assignment` proposal (`provenance.source === 'ui_operator'`, the web "Assign skill" flow, FU-10/PD-4), which skips the evidence-class cap entirely (`CAP_EXEMPT_OPERATOR_KIND`, scoped to `skill_assignment` only — no other kind is exempt even if it carried the same marker). `tiered` auto-applies only `skill_assignment`; `autonomous` auto-applies at capped confidence ≥ 0.5; `manual` always proposes. See [docs/guide/48-improvement-pipeline.md](docs/guide/48-improvement-pipeline.md).
- **Effective skill assignment precedence** (runtime, Epic B): `resolveEffectiveSkills` (`apps/api/src/workflow/agent-prompt/effective-skills.helpers.ts`) unions the agent profile's skills, workflow-YAML `skills:`, step-YAML `skills:`, and DB-backed `workflow_skill_bindings` (workflow-scoped + step-scoped rows), tagging each resolved skill by its **most specific** source — step > workflow > profile. It is wrapped by the single shared entry point `resolveAgentAssignedSkills` (`agent-assigned-skills.helpers.ts`), called from BOTH the step-executor path (`workflow-step-execution/step-agent-effective-skills.helpers.ts`) and the subagent prompt-injection path (`workflow-subagents/subagent-orchestrator.skills.helpers.ts`) — this is the fix for the historical step-vs-subagent skill divergence. The subagent path threads the spawning step's YAML id through `SubagentSpawnParams.parent_step_id` (set from the agent JWT's `stepId` claim in `WorkflowRuntimeSubagentToolsService`), so step-scoped `workflow_skill_bindings` and step-level YAML `inputs.skills` reach subagents the same way they reach the step executor (FU-5) — only subagents spawned outside a step context (no `parent_step_id`) fall back to workflow-level-only sources. `workflow_skill_bindings` is runtime-only (bound via the `skill_assignment` improvement-proposal applier or `suggest_skill_assignment`), deliberately separate from `workflows.yaml_definition` so a workflow reseed never clobbers pipeline-made assignments. See [docs/guide/48-improvement-pipeline.md](docs/guide/48-improvement-pipeline.md) and [docs/guide/06-workflow-engine.md](docs/guide/06-workflow-engine.md#skill-assignment-skills-yaml-surface).
- **Code-change bridge** (Epic E, `apps/api/src/improvement/appliers/code-change.applier.ts`): the `code_change` improvement-proposal applier never touches Kanban directly — it publishes a neutral `improvement.task.requested.v1` event onto the shared Redis lifecycle stream (`stream:core:lifecycle`), and `apps/kanban`'s `CoreLifecycleStreamImprovementTaskHandler` files it as a work item (id = proposal id, idempotent) on the project configured via the Kanban `self_improvement_project_id` setting, or parks it (dead-lettered to `kanban_core_lifecycle_dead_letters`, cursor still advances) if unset. `code_change` proposals are deduped at intake by exact normalized title (`CodeChangeDedupService`) before a row is ever created. `apps/repair-agent` (the standalone WebSocket-listener repair service it superseded) is deleted, not deprecated. See [docs/guide/48-improvement-pipeline.md#code-change-bridge-epic-e](docs/guide/48-improvement-pipeline.md#code-change-bridge-epic-e) and [docs/operations/self-improvement-project.md](docs/operations/self-improvement-project.md).
- **Runtime toolchain precedence** (multi-language harness images): step (`steps[].inputs.toolchains`) → agent profile (`agent_profiles.runtime_toolchains`, threaded into `resolverInputs.agentProfileConfig` at both the step and subagent container-provisioning call sites) → run input (neutral `runtime_toolchains` on the trigger record) → repo-detected (`.tool-versions`/`go.mod`/`package.json`/etc.) → base default `{toolchains:[]}`, merged by `ToolchainResolverService.resolve()` (final merged result is re-validated after merge, since the repo-detected layer is untrusted repo content). Non-node-only sets build a composite image tagged `nexus-rt/<harnessId>:<12-hex>` (content-addressed on base image ID + toolchain set), GC'd hourly via the existing `ContainerCleanupService` cron at a 7-day age threshold (that cron's volume prune excludes `nexus.cache=true` volumes so package/OS cache volumes survive between runs). The Kanban project layer is **Kanban-injected as a neutral run input** — the API never reads `kanban_projects` directly; Kanban's dispatch cycle writes the plain `runtime_toolchains` key onto the launch input. See [docs/guide/multi-language-runtimes.md](docs/guide/multi-language-runtimes.md).
- Provider credentials stored in `secret_store` (encrypted server-side), referenced by `llm_providers.secret_id`.
- Workflow containers enforce real AI execution — they fail fast without DB-configured provider secrets.
- Container images: `nexus-light:latest` and `nexus-heavy:latest` — rebuild when changing Dockerfiles.
- Docker host path remapping can break workspace/tool mounts; keep compose mounts and host env values consistent.
- `npm run lint` stops on first failing workspace. Use `npm run lint:summary` for full repo visibility.
- `package-lock.json` at repo root governs all workspaces. Docker builds run from repo-root context.
- Avoid storing source-of-truth artifacts in `data/` (worktrees, workspaces, tool-mounts are runtime-generated).

## Core/Kanban Boundary

- `apps/api/src` and `packages/core/src` must remain Kanban-neutral.
- Do not use `kanban`, work-item, or project-domain identifiers in API/core code, tests, migrations, fixtures, comments, or seed contracts.
- API/core workflow context uses neutral `scopeId`/`scope_id` and `contextId`/`context_id` fields only.
- Kanban lifecycle validation, event payload shape, status names, tool names, and work-item/resource projections belong in `apps/kanban`, `packages/kanban-contracts`, or `packages/kanban-mcp`.
- Boundary enforcement is lint-driven by `nexus-boundaries/no-core-kanban-residue`; never add allowlists, quarantine symbols, `eslint-disable`, or compatibility aliases to bypass it.
- Workflows needing Kanban behavior must call Kanban-owned API/MCP/tool from the Kanban side rather than teaching API/core the Kanban domain.

## Workflow Module Boundaries

When adding workflow-adjacent functionality, use the narrowest existing module boundary — don't dump providers into `WorkflowModule` by default.

| Module                        | Path                                             | Responsibility                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkflowModule`              | `apps/api/src/workflow/`                         | Core engine: parsing, validation, persistence, state, DAG, event log, triggers                                                                                                                                                                                                                                                                                                |
| `WorkflowLaunchModule`        | `apps/api/src/workflow/workflow-launch/`         | Launch API, contracts, orchestration helpers                                                                                                                                                                                                                                                                                                                                  |
| `WorkflowRunOperationsModule` | `apps/api/src/workflow/workflow-run-operations/` | Run-facing API, steering, reconciliation, idle tracking                                                                                                                                                                                                                                                                                                                       |
| `WorkflowSpecialStepsModule`  | `apps/api/src/workflow/workflow-special-steps/`  | Special step registry, executor, handlers                                                                                                                                                                                                                                                                                                                                     |
| `WorkflowSubagentsModule`     | `apps/api/src/workflow/workflow-subagents/`      | Subagent provisioning, lifecycle, communication mesh                                                                                                                                                                                                                                                                                                                          |
| `WorkflowStepExecutionModule` | `apps/api/src/workflow/workflow-step-execution/` | Step queue consumer, container execution, retry policy                                                                                                                                                                                                                                                                                                                        |
| `WorkflowHostMountModule`     | `apps/api/src/workflow/workflow-host-mount/`     | Host mount resolution, audit, startup validation                                                                                                                                                                                                                                                                                                                              |
| `WorkflowPublishSpecsModule`  | `apps/api/src/workflow/workflow-publish-specs/`  | Publish-specs parser, pure helpers                                                                                                                                                                                                                                                                                                                                            |
| `WorkflowRuntimeModule`       | `apps/api/src/workflow/workflow-runtime/`        | Agent-facing runtime capabilities, formatting/contracts                                                                                                                                                                                                                                                                                                                       |
| `WorkflowRepairModule`        | `apps/api/src/workflow/workflow-repair/`         | Failure classification, repair policy, dispatch                                                                                                                                                                                                                                                                                                                               |
| `WorkflowInternalToolsModule` | `apps/api/src/workflow/workflow-internal-tools/` | Internal tool adapters and handler services                                                                                                                                                                                                                                                                                                                                   |
| `WorkflowRetrospectiveModule` | `apps/api/src/workflow/workflow-retrospective/`  | EPIC-212 retrospective analyst pipeline: terminal-run enqueue, interest gate, drain, LLM analyst orchestration. `forwardRef`-imports `ExecutionLifecycleModule` (Epic D) to read the acting agent profile off the execution row for `agent_profile_change` finding context — closes a pre-existing module cycle, doesn't introduce one (see `apps/api/CIRCULAR_BASELINE.md`). |
| `WorkflowSkillBindingsModule` | `apps/api/src/workflow/workflow-skill-bindings/` | Runtime skill→workflow/step bindings (`workflow_skill_bindings` table), separate from YAML so reseed can't clobber them                                                                                                                                                                                                                                                       |
| `WebAutomationModule`         | `apps/api/src/web-automation/`                   | Playwright driver, browser sessions, selectors                                                                                                                                                                                                                                                                                                                                |
| `WarRoomModule`               | `apps/api/src/war-room/`                         | Multi-agent war-room sessions, blackboard, consensus                                                                                                                                                                                                                                                                                                                          |

Not itself under `apps/api/src/workflow/`, but `forwardRef`-imports `WorkflowCoreModule` (a cycle through `WorkflowRetrospectiveModule`) and dispatches workflow runs, so it belongs in this boundary list:

| `ImprovementModule` | `apps/api/src/improvement/` | Unified improvement-proposal pipeline: governance policy, applier registry, REST API (`improvement/proposals`). See [docs/guide/48-improvement-pipeline.md](docs/guide/48-improvement-pipeline.md). |

## Development Conventions

- **Strict lint policy**: Never suppress linting (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`, rule downgrades). Fix findings in code; if blocked, escalate with rule name, file, and compliant alternatives. See `.github/instructions/lint-warning-policy.instructions.md`.
- **API quality gate**: Controllers handle transport only. Services own domain logic. Repositories own persistence. See `.github/instructions/api-quality-gate.instructions.md`.
- **Web quality gate**: React components are presentation-focused; side effects go into hooks/services. See `.github/instructions/web-quality-gate.instructions.md`.
- **NestJS**: Tests rely on SWC decorator metadata. Keep Vitest/SWC config aligned with existing settings.
- **NestJS apps**: Use `nest build` (not `tsc`) — it handles TypeORM reflection and NestJS-specific output.
- **TypeScript**: Enforce strong typing. Shared interfaces in `packages/core`.

## Documentation Map

- **Primary entry point:** `docs/guide/README.md` — unified guide with C4 diagrams, domain deep-dives, and onboarding
- Setup and operations: `README.md`
- Architecture: `docs/architecture/README.md`, `docs/architecture/*.md`
- `BackendInstrumentation` helper extraction — see [ADR-backend-instrumentation-helper-extraction.md](docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md) (`apps/api/src/memory/backend-instrumentation.ts`).
- Operations runbooks: `docs/operations/README.md`
- Product/specs: `docs/specs/PRD-*.md`, `docs/specs/SDD-*.md`
- Epics: `docs/epics/EPIC-*.md` (reference these before implementing features)
- Plans: `docs/plans/*.md`
- Analysis reports: `docs/analysis/*.md`
- API-specific: `apps/api/README.md`
- Kanban-specific: `apps/kanban/README.md`

## Agent Skills

Specialized workflows in `./.agents/skills/`:

- `adding-entity-migration` — TypeORM entity + migration
- `agent-runtime-tools-and-context` — Agent-facing runtime tools, run/job/step/scope context injection, delegation (invoke/await/delegate\_\*) and durable agent-await
- `core-kanban-boundaries` — API/core versus Kanban ownership boundaries and interaction patterns
- `kanban-work-item-lifecycle` — Kanban status transitions
- `nestjs-module-conventions` — NestJS module/service/controller patterns
- `retrieve-debug-bundle` — Session/event ledger retrieval
- `retrieve-session-logs` — Session JSONL log retrieval
- `retrieve-workflow-events` — Workflow event ledger retrieval
- `runtime-toolchains` — Add a language/toolchain/cache preset to the harness, composite build smoke-test
- `seed-workflow-patterns` — Seed data (workflows, agent profiles, skills)
- `special-step-handler-implementation` — Custom special step handlers
- `testing-unit-patterns` — Vitest/NestJS testing patterns
- `workflow-yaml-authoring` — Workflow YAML definitions

## Development requirements

- Always update documentation when appropriate, particularly in ./docs/guide
- Ensure linting and unit tests pass
- Ensure kanban functionality is not in the API project

## Other

- When debugging something, consider creating a new agent ski in ./.agents/skills if there is a not an existing one covering the process you have followed, or detailed information about complicated processes.
