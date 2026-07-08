# Memory & Learning Loop — Phase 4: Skill Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make auto-generated skills validate at creation, survive a reseed, and actually reach the agents/subagents/workflows they are scoped to.

**Architecture:** Four tightly-related workstreams on the EPIC-205 skill-materialization rails: (1) invoke the existing `SkillValidationService` at runtime `create_skill`/`update_skill` (today it is seeder-only); (2) stamp a durable runtime-origin marker on agent-authored skills and teach the filesystem reseed to preserve them + their confirmed-scope frontmatter (the EPIC-101 risk); (3) thread `workflowId` (and `scopeId`) into the **subagent** skill-mount path (the remaining EPIC-205 W4 gap — the step path already threads it); (4) settings-gated auto-apply / staged-confirm of the analyst-recommended skill scope.

**Tech Stack:** NestJS (`apps/api`), TypeScript (strict), Vitest, TypeORM (the `skills` DB table is GitOps/admin-owned; agent-authored skills are **filesystem** records under `NEXUS_SKILLS_LIBRARY_PATH`), Zod tool schemas, `js-yaml` frontmatter.

## Global Constraints

- **No suppressions:** never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- **`max-lines:500`** per file; **`complexity ≤14`** per function. Exported interfaces/types live ONLY in `*.types.ts` (rule `no-restricted-syntax`).
- **Pure decision logic separated from I/O.** Mirror the Phase-2/3 pattern (a pure `decideX(...)` wrapped by an async settings-reading service).
- **Kanban-neutral:** no kanban / work-item / project-domain identifiers in `apps/api` or `packages/core` code, tests, comments, migrations, or fixtures.
- **Everything net-new is flag-gated and inert by default** (the deterministic Phase-0…3 loop must stay byte-for-byte intact when the new flags are off), EXCEPT runtime skill **validation**, which is a correctness gate that should be ON by default but MUST fail-soft to a warning (never hard-block a `create_skill` the seeder itself would have accepted) — see Task 2's `STRICT_SKILL_VALIDATION` gate.
- **Fail-soft:** a validator/service error degrades to today's behaviour; never throw out of a tool handler in a way that wedges a run.
- **Build (`apps/api/tsconfig.build.json`) EXCLUDES specs** — adding a required entity column compiles clean but breaks spec object-literals. This phase adds **no new DB columns** (skill provenance is filesystem-side), so that trap does not apply; if you deviate, fix fixture literals CRLF-safely.
- **Settings:** single source `SYSTEM_SETTING_DEFAULTS` (`apps/api/src/settings/system-settings.defaults.ts`); per-feature `*-settings.constants.ts` fragment with a non-throwing `coerceX` helper, spread in.
- **Verification gate (authoritative — never trust `<new-diagnostics>`):** `npx tsc --noEmit -p apps/api/tsconfig.build.json` (exit 0) + targeted `npx vitest run <specs>` + `npx eslint <files>` (0 problems).

---

## Pre-flight verification (do before writing code)

Confirm the research facts still hold (the loop moves fast):

1. **`SkillValidationService` is seeder-only.** File `apps/api/src/database/seeds/skills/skill-validation.service.ts`; public surface `validateSkillMarkdown(params): SkillValidationResult`, `assertValidSkill(params): SkillValidationResult` (throws on invalid), `isStrictValidationEnabled(): boolean`. `SkillValidationResult` is in `skill-validation.types.ts` (`{ skillName, valid, errors[], warnings[], metadata }`). Confirm the only two call sites are `skills.seed.ts:95` and `skills/skill-dependency-resolver.service.ts:156`. It is a **pure** service (no DB/Nest deps beyond `Logger`) — relocation is low-risk.
2. **Runtime create/update tools persist with no validation.** `CreateSkillTool.execute` (`apps/api/src/workflow/workflow-internal-tools/tools/skill/create-skill.tool.ts:67-85`) calls `this.agentSkillsService.upsertSkill({ name, description:'', skill_markdown })` after `injectProvenance(...)`. `UpdateSkillTool.execute` (`.../update-skill.tool.ts:57-66`) calls `this.agentSkillsService.updateSkill(skill_id, { skill_markdown })`. Neither validates. Both depend only on `AgentSkillsService`.
3. **Reseed is filesystem-only and per-skill destructive.** `SkillSeedService.seed()` (`apps/api/src/database/seeds/skills.seed.ts:31-77`) iterates seed dirs; `seedSkill(...)` (79-117) calls `replaceDirectory(sourceDir, targetDir)` (119-130) which does `copyDirectory→fs.rmSync(targetDir,{recursive,force})→renameSync`. So **for every seed-skill name, the matching `storage/skills/<name>` dir is blown away** — destroying any runtime edits + confirmed-scope frontmatter for a same-named skill. Runtime skills whose names do NOT collide with a seed skill survive (never iterated). There is **no DB row** for filesystem skills and **no preservation guard** (contrast `workflows.seed.override-safe.spec.ts` / `agent-profile-seed.override-safe.spec.ts`). Library root = `NEXUS_SKILLS_LIBRARY_PATH` (default `<cwd>/storage/skills`); seed root resolved by `resolveSkillsSeedRoot()`.
4. **`workflowId` is already threaded on the STEP path, missing on the SUBAGENT path.** `WorkflowStageSkillPolicyService.resolveAssignedSkills(params: { agentProfile?, workflowStage?, stateVariables?, scopeId?, workflowId? })` (`apps/api/src/workflow/workflow-stage-skill-policy.service.ts:50-139`) already accepts + uses `workflowId`, forwarding to `AgentSkillLibraryService.listSkillsForScope({ scopeId, agentProfile, workflowId })` which matches `scope.workflows.includes(workflowId)` (`agent-skill-library.service.ts:71-93`). `StepSupportService.resolveAssignedSkillsForProfile` already passes `workflowId` (`step-support.service.ts:215-221`). The GAP is `resolveSubagentAssignedSkills` (`apps/api/src/workflow/workflow-subagents/subagent-orchestrator.skills.helpers.ts:39-53`) which passes only `agentProfile` + `workflowStage`, dropping `workflowId`/`scopeId`/`stateVariables` even though the caller `prepareSkillMountContext` (`subagent-orchestrator.spawn.operations.ts:~258`) has `params.params.workflowRunId`.
5. **Recommended-scope is produced then parked pending a human.** `SkillProposalCompletionListener.handleWorkflowCompleted` (`apps/api/src/memory/learning/skill-proposal-completion.listener.ts:14-43`, `buildAppliedUpdate` 63-81) hardcodes `diagnostics_json.scope_confirmation = { pending: true, recommended_scope, scope_rationale }`. A human clears it via `POST /skills/proposals/:id/confirm-scope` → `SkillProposalService.confirmScope(id, dto)` (`skill-proposal.service.ts:139-198`) which writes `confirmed_scope` + rewrites the skill's frontmatter `scope:` via `buildScopedMarkdown` (200-229), precondition `status==='applied'`. **No auto-apply / staged setting exists** (`pending:true` is hardcoded). `SkillProposalScopeConfirmation` type at `learning.types.ts:26-31`.
6. **Skill scope persistence is frontmatter, not a join table.** A skill's scope lives only in its SKILL.md frontmatter (`scope: { projects, agents, workflows }`, parsed by `agent-skill-library.service.ts parseScope` 376-395). There is **no** `agent_skill_assignments`/`skill_scope` binding table for filesystem skills. This is why confirmed-scope durability == skill-dir durability (Task 5).

---

## File structure (what each task creates/touches)

| Path                                                                                                                                                   | Responsibility                                                   | Task |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---- |
| `apps/api/src/ai-config/skills/skill-validation.service.ts` (moved) + `skill-validation.types.ts`                                                      | Pure SKILL.md validator, runtime-importable                      | 1    |
| `apps/api/src/ai-config/skills/skill-validation.module.ts`                                                                                             | Provides+exports the validator for both seed + runtime importers | 1    |
| `create-skill.tool.ts`, `update-skill.tool.ts` (+ specs)                                                                                               | Validate before persistence; structured invalid result           | 2, 3 |
| `apps/api/src/ai-config/skills/skill-origin.helper.ts` (+ `.types.ts`, spec)                                                                           | Stamp + detect the durable runtime-origin frontmatter marker     | 4    |
| `skills.seed.ts` (+ override-safe spec)                                                                                                                | Preserve runtime-origin skill dirs across reseed                 | 5    |
| `subagent-orchestrator.skills.helpers.ts` + `subagent-orchestrator.spawn.operations.ts` (+ specs)                                                      | Thread `workflowId`/`scopeId` into subagent skill mount          | 6    |
| `skill-proposal-completion.listener.ts` + `skill-scope-auto-apply.decide.ts` (+ `.types.ts`, specs) + `skill-scope-confirmation.settings.constants.ts` | Settings-gated auto-apply / staged-confirm of recommended scope  | 7    |
| `system-settings.defaults.ts`, `docs/guide/35-memory-learning.md`, EPIC-212 doc                                                                        | Wiring, settings registration, docs, verification                | 8    |

---

## Task 1 — Make `SkillValidationService` runtime-reachable · S

A runtime tool must not import from `database/seeds` (backwards layering). Relocate the **pure** validator to a neutral home and provide it via a Nest module both the seeder and the workflow-internal-tools module import.

**Files:**

- Move: `apps/api/src/database/seeds/skills/skill-validation.service.ts` → `apps/api/src/ai-config/skills/skill-validation.service.ts`
- Move: `apps/api/src/database/seeds/skills/skill-validation.types.ts` → `apps/api/src/ai-config/skills/skill-validation.types.ts`
- Move spec: `skill-validation.service.spec.ts` alongside.
- Create: `apps/api/src/ai-config/skills/skill-validation.module.ts` (`@Module({ providers:[SkillValidationService], exports:[SkillValidationService] })`).
- Modify import sites: `apps/api/src/database/seeds/skills.seed.ts:4`, `apps/api/src/database/seeds/skills/skill-dependency-resolver.service.ts:16` → import from the new path. (`SkillSeedService` constructs `new SkillValidationService()` directly today — keep that default-construct path working since the validator stays dependency-free.)
- Grep for any other importer of the old path and update it. Per the aggressive-hygiene rule, leave NO re-export shim at the old location.

**TDD:**

- _Red:_ the moved `skill-validation.service.spec.ts` imports from the new path and still passes unchanged (pure relocation).
- _Green:_ move files; fix every import; add the module.
- _Refactor:_ confirm `database/seeds/skills/` no longer holds the validator and nothing imports the old path (`grep -r seeds/skills/skill-validation`).

**Acceptance:** validator lives under `ai-config/skills`, is exported by a module, all old import sites compile, validator specs green, no seed→runtime layering violation. **Effort: S.**

---

## Task 2 — Validate at runtime `create_skill` · M

Gate `CreateSkillTool` on the validator before persistence; an invalid skill is rejected with a structured (non-throwing) result and is NOT written.

**Files:**

- Modify: `apps/api/src/workflow/workflow-internal-tools/tools/skill/create-skill.tool.ts` — inject `SkillValidationService`; validate the **enriched** markdown (after `injectProvenance`) against `params.name` BEFORE `agentSkillsService.upsertSkill`.
- Modify: `CreateSkillResult` type (its `*.types.ts`) — add `validated: boolean` and optional `validation_errors?: string[]` so the agent sees why a create was refused (additive/optional).
- Modify module: ensure `WorkflowInternalToolsModule` (or the tool's owning module) imports `SkillValidationModule`.
- Test: `create-skill.tool.spec.ts`.

**Behaviour:**

- Resolve strictness from `SkillValidationService.isStrictValidationEnabled()` (env `STRICT_SKILL_VALIDATION`). In **non-strict** (default): call `validateSkillMarkdown(...)`; if `valid:false`, log a warning, return `{ validated:false, validation_errors, action:'rejected', name, scope:null }` WITHOUT persisting (fail-soft correctness gate — the noisy invalid skill never lands). If `valid:true`, persist and return `{ validated:true, action, name, scope }`. In **strict**: identical, but additionally surface the errors verbatim. Never throw out of `execute` (fail-soft: a validator exception is caught → log → fall through to persist, matching today's no-gate behaviour so a validator bug can't wedge skill creation).
- Keep `execute` under `complexity ≤14` by extracting the validate-and-decide into a small private method or the Task-4 helper.

**TDD:**

- _Red:_ a `create_skill` with markdown missing required frontmatter/sections → `upsertSkill` is NOT called and the result is `{ validated:false, action:'rejected', validation_errors:[...] }`; a valid skill → `upsertSkill` called once and `{ validated:true }`; a thrown validator (mock `validateSkillMarkdown` to throw) → still persists (fail-soft) and logs.
- _Green:_ wire the validator + branch.
- _Refactor:_ shared validate helper; keep result-shape additive.

**Acceptance:** invalid agent-authored skills are refused at creation with actionable errors; valid ones persist; a validator fault never blocks creation. **Effort: M.**

---

## Task 3 — Validate at runtime `update_skill` · S

Same gate for edits. An `update_skill` that would make a skill invalid is refused; the existing skill is left intact.

**Files:**

- Modify: `apps/api/src/workflow/workflow-internal-tools/tools/skill/update-skill.tool.ts` — inject `SkillValidationService`; validate `params.skill_markdown` against the skill's name (derive from frontmatter / `skill_id`) BEFORE `agentSkillsService.updateSkill`.
- Modify: `UpdateSkillResult` type — add `validated: boolean` + optional `validation_errors?: string[]`.
- Test: `update-skill.tool.spec.ts`.

**Behaviour:** identical fail-soft semantics to Task 2. On `valid:false` (non-strict) → do NOT call `updateSkill`; return `{ validated:false, validation_errors, name:<unchanged>, scope:<unchanged> }`. Reuse the Task-2 validate helper (DRY).

**TDD:**

- _Red:_ an update with broken markdown → `updateSkill` NOT called, result `validated:false`; a good update → `updateSkill` called once, `validated:true`; validator throw → still updates (fail-soft).
- _Green:_ wire + branch.
- _Refactor:_ share the helper with Task 2.

**Acceptance:** an agent edit cannot corrupt a skill into an unparseable state; the prior content survives a rejected edit. **Effort: S.**

---

## Task 4 — Durable runtime-origin marker · M

Stamp every agent-authored skill with a durable, machine-readable origin marker so the reseed (Task 5) can recognise and preserve it. Filesystem skills have no DB row, so the marker lives in the SKILL.md frontmatter.

**Files:**

- Create: `apps/api/src/ai-config/skills/skill-origin.helper.ts` + `skill-origin.types.ts` (+ spec) — pure helpers:
  - `stampRuntimeOrigin(markdown: string, origin: RuntimeSkillOrigin): string` — inject/merge a frontmatter block `nexus_origin: { source: 'agent_factory', source_proposal_id?, generated_from_run_id?, stamped_at }` using the same `js-yaml` frontmatter rewrite approach as `buildScopedMarkdown` (`skill-proposal.service.ts:200-229`). Idempotent (re-stamp updates in place, never duplicates).
  - `readRuntimeOrigin(markdown: string): RuntimeSkillOrigin | null` — parse the frontmatter and return the marker (or `null` for a seed/admin skill).
  - `isRuntimeAuthored(markdown: string): boolean` — `readRuntimeOrigin(markdown)?.source === 'agent_factory'`.
  - `RuntimeSkillOrigin` interface in `skill-origin.types.ts`.
- Modify: `CreateSkillTool.injectProvenance` (or a step right after it) to ALSO `stampRuntimeOrigin(...)` so a created skill carries the marker. `UpdateSkillTool` must PRESERVE an existing marker on edit (re-stamp if present; do not strip it) — read the current skill markdown's origin and re-apply.
- Note: the existing comment-based provenance `injectProvenance` writes (HTML-comment provenance) is human-facing; the `nexus_origin` frontmatter is the machine signal Task 5 reads. Keep both.

**TDD:**

- _Red:_ `stampRuntimeOrigin` on bare markdown yields parseable frontmatter with `nexus_origin.source==='agent_factory'`; re-stamping is idempotent (one block); `readRuntimeOrigin` round-trips; a seed skill (no marker) → `readRuntimeOrigin===null`, `isRuntimeAuthored===false`; markdown with no frontmatter is handled fail-soft (returns input unchanged on stamp failure / `null` on read).
- _Green:_ implement the pure helpers; wire into create/update tools.
- _Refactor:_ share the frontmatter parse/dump with `buildScopedMarkdown` if a clean common helper emerges (DRY) — otherwise leave both, documented.

**Acceptance:** every agent-authored skill carries a durable `nexus_origin` frontmatter marker; seeded/admin skills do not; the marker survives edits. **Effort: M.**

---

## Task 5 — Reseed preservation (the EPIC-101 fix) · M

Teach `SkillSeedService.seedSkill` to PRESERVE a runtime-authored target skill instead of blowing it away — mirroring the workflow/agent-profile override-safe re-seed pattern. This protects runtime skills + their confirmed-scope frontmatter.

**Files:**

- Modify: `apps/api/src/database/seeds/skills.seed.ts` — in `seedSkill`, before `replaceDirectory`, when `targetExists`: read the EXISTING target `SKILL.md` and, if `isRuntimeAuthored(existingMarkdown)` (Task 4 helper) is true, SKIP the replace and return a new `'preserved'` outcome (count it; do not overwrite). Seed-origin or absent targets behave exactly as today (`replaceDirectory`).
- Add a force escape hatch: env `NEXUS_SKILLS_SEED_FORCE_OVERWRITE==='true'` (or a `force` param) bypasses preservation (operator can intentionally reset). Default off.
- Extend the summary log + the `'created'|'updated'|'skipped'|'invalid'` union with `'preserved'`.
- Import the Task-4 `isRuntimeAuthored` helper (now under `ai-config/skills`, runtime-neutral, importable from seeds).
- Test: new `skills.seed.override-safe.spec.ts` mirroring `workflows.seed.override-safe.spec.ts` style (temp dirs).

**TDD:**

- _Red:_ a target `storage/skills/<name>/SKILL.md` carrying `nexus_origin.source: agent_factory` (with a confirmed `scope:` block) is NOT overwritten by a same-named seed skill (the runtime markdown + scope survive byte-for-byte) and is reported `preserved`; a seed-origin target (no marker) IS replaced (today's behaviour, `updated`); a brand-new skill is `created`; with `NEXUS_SKILLS_SEED_FORCE_OVERWRITE=true` the runtime skill IS replaced.
- _Green:_ add the preservation branch + force flag + outcome.
- _Refactor:_ keep `seedSkill` under complexity cap (extract the existing-origin read into a small private method).

**Acceptance:** a reseed no longer destroys agent-authored skills or their confirmed scopes; seeded skills still update; an operator can force a reset. **Effort: M.**

---

## Task 6 — Thread `workflowId`/`scopeId` into the subagent skill mount · M

Close the remaining EPIC-205 W4 gap: subagents currently never receive workflow-scoped skills because the subagent skill-mount path drops `workflowId`.

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.skills.helpers.ts` (`resolveSubagentAssignedSkills`, 39-53) — accept + forward `workflowId`, `scopeId`, and `stateVariables` to `stageSkillPolicy.resolveAssignedSkills`.
- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.spawn.operations.ts` (`prepareSkillMountContext`, ~258) — resolve `workflowId` from the run context (mirror `StepSupportService.resolveWorkflowId(workflowRunId)` at `step-support.service.ts:211-213` — it maps `workflowRunId`→`workflow_id` via the run repo) and the `scopeId` from the trigger, and pass them into `resolveSubagentAssignedSkills`. Reuse the SAME resolution seam the step path uses (do not duplicate the run→workflowId lookup; extract/share if needed).
- Test: `subagent-orchestrator.skills.helpers.spec.ts` (+ the spawn-operations spec if present).

**TDD:**

- _Red:_ given a subagent spawn whose run resolves to `workflowId='create_skill'` and a skill scoped `scope.workflows:['create_skill']`, `resolveSubagentAssignedSkills` now requests skills with `workflowId` populated and the workflow-scoped skill is mounted; with no workflow match it is not; a run with no resolvable `workflowId` degrades to today (profile/scope-only) fail-soft.
- _Green:_ thread the params through both files.
- _Refactor:_ share the `workflowRunId→workflowId` resolver between the step and subagent paths (single source of truth).

**Acceptance:** workflow-scoped skills reach subagents, not just top-level step agents; unscoped behaviour unchanged. **Effort: M.**

---

## Task 7 — Auto-apply / staged-confirm recommended scope · M

Let the analyst-recommended skill scope auto-apply (or stay staged for human review) under a setting, instead of always parking `pending:true`.

**Files:**

- Create: `apps/api/src/memory/learning/skill-scope-auto-apply.decide.ts` + `skill-scope-auto-apply.decide.types.ts` (+ spec) — pure `decideScopeApplication({ recommendedScope, rationale, mode }, ): { action: 'auto_apply' | 'stage', confirmedScope?: SkillScope | null, reason: string }`. `mode` ∈ `manual` (today — always `stage`), `staged` (stage but mark eligible), `auto` (apply when a non-empty `recommendedScope` exists; otherwise stage).
- Create: `apps/api/src/settings/skill-scope-confirmation.settings.constants.ts` — key `skill_scope_confirmation_mode` (default `manual`), enum `manual|staged|auto`, non-throwing `coerceSkillScopeConfirmationMode`, `*_SYSTEM_SETTING_DEFAULTS` fragment.
- Modify: `apps/api/src/memory/learning/skill-proposal-completion.listener.ts` — resolve the mode (via `SystemSettingsService.get(key, 'manual')`), call `decideScopeApplication`; when `auto_apply` and a non-empty recommended scope exists, invoke `SkillProposalService.confirmScope(proposalId, { scope: recommendedScope })` (which rewrites the frontmatter + clears `pending`) and record `scope_confirmation = { pending:false, recommended_scope, confirmed_scope:recommendedScope, auto_applied:true }`; otherwise keep today's `pending:true` parking. Fail-soft: a `confirmScope` error → fall back to `pending:true` (never lose the proposal).
- Extend `SkillProposalScopeConfirmation` type (`learning.types.ts:26-31`) with optional `auto_applied?: boolean`.
- Tests: `skill-scope-auto-apply.decide.spec.ts`, extend `skill-proposal-completion.listener.spec.ts`.

**TDD:**

- _Red (pure):_ `mode:auto` + non-empty recommendedScope → `auto_apply` with `confirmedScope`; `mode:auto` + empty/null → `stage`; `mode:manual`/`staged` → `stage`.
- _Red (listener):_ `mode:auto` + materialized + recommended scope → `confirmScope` called with the recommended scope and `scope_confirmation.pending===false, auto_applied===true`; `mode:manual` → `confirmScope` NOT called, `pending===true` (today's behaviour, regression guard); a `confirmScope` throw → falls back to `pending:true`.
- _Green:_ implement the pure decider + settings + listener wiring.
- _Refactor:_ pure decision in its own file; default-`manual` keeps the loop inert.

**Acceptance:** with `skill_scope_confirmation_mode=auto` a recommended scope self-applies to the skill frontmatter (so the skill immediately reaches its scoped agents/workflows); default `manual` is byte-identical to today. **Effort: M.**

---

## Task 8 — Wiring, settings, docs, verification · M

- **Settings:** register `skill_scope_confirmation_mode` in `SYSTEM_SETTING_DEFAULTS` (`system-settings.defaults.ts`) via the Task-7 fragment.
- **Module wiring:** confirm `SkillValidationModule` is imported wherever `CreateSkillTool`/`UpdateSkillTool` are provided; confirm no new import cycle (the validator is dependency-free; the auto-apply listener stays in the learning module which already owns `SkillProposalService`). Confirm the relocated validator's two seed import sites compile.
- **Docs:** update `docs/guide/35-memory-learning.md` (runtime skill validation, runtime-origin marker + reseed preservation, subagent workflow-scope threading, recommended-scope auto-apply modes), and mark Phase 4 complete in `docs/epics/EPIC-212-memory-learning-loop-rebuild.md` + the EPIC progress/status line. Update `.superpowers/sdd/progress.md` per-task completion lines.
- **Verification gate:** `npm run build --workspace=packages/core` → `build:api` → `build:web`; `test:api` + `test:unit:web` green; `lint:api`/`lint:web` clean (no suppressions, `max-lines:500`, `complexity ≤14`, interfaces in `*.types.ts`); `validate:seed-data` 7/7. Re-run the relocated validator specs + the new override-safe seed spec specifically.

**Acceptance:** validation gates runtime skill authoring; agent-authored skills + confirmed scopes survive reseed; workflow-scoped skills reach subagents; recommended scope auto-applies under the flag (default-off); full suite green; docs current. **Effort: M.**

---

## Settings introduced (Phase 4)

| Setting                         | Default  | Purpose                                                                                                                                                                                                   |
| ------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skill_scope_confirmation_mode` | `manual` | `manual`\|`staged`\|`auto` — how an analyst-recommended skill scope is confirmed. `manual` (default) = today's human `confirm-scope`; `auto` self-applies the recommended scope to the skill frontmatter. |

> Env knobs (non-DB, operator/CI): `STRICT_SKILL_VALIDATION` (existing — strict runtime + seed validation) and `NEXUS_SKILLS_SEED_FORCE_OVERWRITE` (new — bypass reseed preservation). Reuses existing `NEXUS_SKILLS_LIBRARY_PATH` / `NEXUS_SKILLS_SEED_PATH`.

## Rollback

- **`skill_scope_confirmation_mode=manual` (default)** → recommended-scope handling is byte-identical to today (`pending:true`, human confirm). No auto-application.
- **Runtime validation is fail-soft** → a validator fault or a non-strict invalid skill never wedges a run; in the worst case behaviour reverts to today's no-gate persistence (logged).
- **Reseed preservation is additive** → without the `nexus_origin` marker a skill reseeds exactly as today; `NEXUS_SKILLS_SEED_FORCE_OVERWRITE=true` restores the old blow-away behaviour for a deliberate reset.
- **No DB migration, no new columns** → nothing to roll back at the schema level; the origin marker is frontmatter-only and inert to consumers that ignore it.

## Carry-forwards / follow-ups

- The `skills` DB table (GitOps/admin-owned) and the filesystem library remain two representations; this phase hardens the filesystem path (where agent-authored skills live). A future unification (DB-row provenance + `locked`/`overrides` parity with workflows/profiles) is out of scope.
- `recommended_scope` quality depends on the `author_skill` workflow output; Phase 4 only routes it. Improving the recommendation (reusing the Phase-3 `signal_weight_history` / behaviour-change labels for skill-scope ranking) is a follow-up.
- A skill patch that contradicts an existing skill should reuse the Phase-3 `MemoryContradictionService` supersede/version seam rather than forking — a future `update_skill` enhancement.
