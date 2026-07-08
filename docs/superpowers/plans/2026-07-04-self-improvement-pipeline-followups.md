# Self-Improvement Pipeline — Follow-Up Work Plan

**Date:** 2026-07-04
**Context:** Epics A–E (unified improvement-proposal pipeline, skill assignment, memory
scope-targeting, definition-change proposals, code-change bridge) shipped and merged to
local `main` (merge `341448007`). Every task was reviewed; the final whole-branch review
returned **READY TO MERGE, no blockers**. The items below are the follow-ups that were
deliberately deferred during implementation (each reviewed as "OK-to-merge-and-track").

None of these block the shipped feature. They fall into three buckets: **correctness/safety
hardening**, **feature-completeness** (features that are half-wired and only partially deliver
their value), and **hygiene/DRY/docs**. Plus a short list of **product decisions** that aren't
pure engineering.

Effort key: **S** ≈ <½ day · **M** ≈ ½–1.5 days · **L** ≈ 2+ days.

---

## Priority 0 — Correctness & safety

### FU-1 · Auto-rollback (or re-order the overrides marker) on definition-change apply failure — **M**

**Problem.** `AgentProfileChangeApplier` and `WorkflowDefinitionChangeApplier` (Epic D) set the
`overrides` reseed-protection marker _before_ mutating the profile/workflow. If the mutation then
throws, `ImprovementProposalService.applyProposal` marks the proposal `failed` but **never calls
the applier's `rollback`** — leaving the profile/workflow reseed-protected with its _original_
definition and an orphaned marker. The snapshot exists in `rollback_data`, so it's manually
recoverable, but the state is silently wrong.

**Where.**

- `apps/api/src/improvement/appliers/agent-profile-change.applier.ts`
- `apps/api/src/improvement/appliers/workflow-definition-change.applier.ts`
- `apps/api/src/improvement/appliers/definition-change.helpers.ts` (the marker helper)
- `apps/api/src/improvement/improvement-proposal.service.ts` (`applyProposal` failure path, ~L234-254)

**Fix (pick one; option A preferred).**

- **A —** In `applyProposal`, when an applier's `apply()` returns `{ok:false}` or throws AND the
  applier implements `rollback`, invoke `rollback(proposal)` before marking `failed` (best-effort,
  logged). This makes the failure path symmetric with the snapshot-restore.
- **B —** Re-order the appliers so the `overrides` marker is written _after_ the mutation succeeds
  (snapshot still first, for rollback). Simpler, but a mutation that partially applies then throws
  leaves the marker unset (reseed could clobber a partial change) — A is safer.

**Test.** Applier test: `apply()` where the underlying update rejects → assert the snapshot is
restored (or the marker is not left set) and status is `failed`. Round-trip regression already
exists (`definition-change-rollback.roundtrip.spec.ts`) — extend it with a failure case.

---

### FU-2 · Fix the shared embedding-similarity threshold mismatch — **M** (high leverage; pre-existing)

**Problem.** `EmbeddingSimilarityService.findNearest` returns **RRF-fused** scores (`RRF_K=60` →
max ≈ `2/61 ≈ 0.033`), but every caller compares against `CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT
= 0.85` (a raw-cosine-scale threshold). The fused score can never cross it, so **embedding-based
dedup/matching never actually fires** once embeddings are configured. Affected callers fall back
to exact/lexical-only matching:

- `LearningRouterService.matchExistingSkill` (skill dedup)
- `CandidateClustererService`
- `RememberWriteGuardService` (near-dup memory guard)
- (Epic E's `CodeChangeDedupService` already side-stepped this by dropping its embedding tier and
  keeping exact-title dedup — see its doc comment.)

This is **pre-existing infrastructure**, not introduced by this work, but it silently defeats a
whole class of "semantic dedup" features.

**Where.** `apps/api/src/memory/signals/embedding-similarity.service.ts`,
`apps/api/src/memory/signals/candidate-similarity.config.ts` (the `RRF_K` + threshold constants),
and the three call sites above.

**Fix.** Two viable directions:

- Expose a **raw-similarity** path (0..1 cosine / normalized lexical) alongside the RRF-fused
  `findNearest`, and have the dedup/matching callers compare _that_ against 0.85; keep RRF for
  ranked retrieval where relative order is all that matters.
- Or introduce a **separate, RRF-scaled threshold constant** for the fused-score callers (with a
  test pinning a real near-duplicate above it and an unrelated pair below it).

**Test.** For each caller, a test that a genuine near-duplicate (high raw similarity) IS matched
and an unrelated item is NOT — currently no such test can pass, which is why the bug went unnoticed.

**Note.** Once fixed, reconsider re-enabling Epic E's `CodeChangeDedupService` embedding tier
(it deliberately declined it; the exact-title tier is safe in the meantime).

---

### FU-3 · Validate governance-mode overrides per-entry (fail-closed, not fail-open) — **S**

**Problem.** `ImprovementGovernancePolicyService.readOverrides()` casts the settings blob to
`Record<string, GovernanceMode>` with only an `object` check. A corrupted per-kind override value
(e.g. `{"code_change":"yolo"}`) matches neither the `manual` nor `tiered` branch in
`decideGovernanceAction` and **falls through to the most-permissive `autonomous`/auto-apply**
branch — "invalid data silently upgrades to the most permissive mode."

**Where.** `apps/api/src/improvement/governance/improvement-governance-policy.service.ts`
(`readOverrides`), mirroring the per-value validation already done in `readMode`.

**Fix.** Validate each override value against `GOVERNANCE_MODES`; drop/ignore unrecognized values
(fall back to the default mode). Add a test with a corrupted override asserting it does NOT reach
`auto_apply`.

---

### FU-4 · Guard against duplicate-kind applier registration — **S**

**Problem.** `ImprovementApplierRegistry` is last-write-wins on duplicate `kind` (plan-mandated),
unlike the special-step registry which throws. With five concrete appliers now wired under
`IMPROVEMENT_APPLIERS`, a future duplicate-kind wiring bug would be silently masked.

**Where.** `apps/api/src/improvement/appliers/improvement-applier.registry.ts`.

**Fix.** Throw (or log a startup assertion) on a second applier claiming an already-registered
`kind`, matching `StepSpecialStepRegistryService.registerHandler`'s duplicate guard. Add a test.

---

## Priority 1 — Feature completeness (finish the half-wired features)

### FU-5 · Thread step-scoped skill bindings into the subagent path — **M**

**Problem.** The step-executor path resolves profile ∪ workflow ∪ **step** skills, but the subagent
path only gets **workflow-level** bindings/YAML skills — the spawning step's YAML id is never
threaded through `SubagentSpawnParams`/`SubagentAsyncSpawnParams`. So a skill bound to a specific
step is _not_ delivered to a subagent that step spawns. (The shared-helper anti-divergence goal is
met; this is a missing _input_, not a re-implementation.)

**Where.** `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.types.ts`
(`SubagentSpawnParams`), the spawn call sites, and
`subagent-orchestrator.skills.helpers.ts` (`resolveSubagentProfileAndAssignedSkills`, which already
has the plumbing to accept a `stepId`). `workflowRepo` is already in the subagent context.

**Fix.** Add the spawning step's YAML id to the spawn params and pass it into the effective-skill
resolver so `stepBindingNames`/`stepYamlSkills` are populated for subagents too. Extend the
subagent characterization test to assert step-scoped skills reach the subagent.

---

### FU-6 · Re-thread workflow-level YAML `skills:` through the job retry chain — **M**

**Problem.** Workflow-level `skills:` populate `workflowYamlSkills` only at primary
enqueue/resume. They are **not** re-threaded through `retryJobWithMessage` /
output-contract-retry / fallback-advance / auto-retry re-enqueue, so a retried step silently loses
its workflow-declared skills (step-level skills survive via the carried `IJob`). First attempt and
retry then diverge in available capability — invisible to whoever debugs the failure.

**Where.** `apps/api/src/workflow/workflow-job-message-queue.service.ts` (`retryJobWithMessage`
`retryPayload`), `apps/api/src/workflow/workflow-step-execution/step-required-tool-retry.service.ts`
(`enqueueOutputContractRetry`), and the fallback/auto-retry re-enqueue paths (~5 files).

**Fix.** Include `workflowYamlSkills` in the retry payload alongside the already-threaded
`workflowPermissions`/`workflowSkillDiscoveryMode`. Add a test that a retried step keeps its
workflow-level skills. (Note: several call sites have exact-positional-arg `toHaveBeenCalledWith`
specs that will need updating.)

---

### FU-7 · Mount bound skills to disk (not just the prompt) — **M**

**Problem.** Skill _assignment_ (bindings) currently feeds only the **prompt-injection** path
(`resolveEffectiveSkills` → skill-content injection). The on-disk skill **mount**
(`resolveSkillMountForJob` in `step-agent-container-support.service.ts`) still uses profile-only
skills. A bound skill whose content overflows the injection budget (name-only listing) won't be
openable on disk by the agent.

**Where.** `apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts`
(`resolveSkillMountForJob`) and the subagent skill-mount path.

**Fix.** Route the mount through the same `resolveEffectiveSkills` resolver the prompt path uses,
so bound skills are both injected _and_ mounted. Test that a bound (non-profile) skill's SKILL.md
lands in the mount.

---

### FU-8 · Un-stub subagent promoted-learning / memory injection — **M/L**

**Problem.** `SubagentPromptContextService` still returns `''` for the promoted-learning section —
subagents receive _no_ memory/learning injection. Epic C threaded the identity fields
(`agentProfileName`) through the shared interface for both paths, but the subagent injection body
itself was left a documented stub, and `UniversalPromptContext` never gained a `workflowName` field
(so subagents can't resolve workflow-scoped memory even though `workflowRepo` is available in their
context — it's a scoping choice, not a dependency wall).

**Where.** `apps/api/src/workflow/workflow-subagents/subagent-prompt-context.service.ts`,
`apps/api/src/workflow/agent-prompt/universal-prompt-layers.helpers.ts` (add `workflowName` to
`UniversalPromptContext`/`PromptContextSupportLike`).

**Fix.** Implement the subagent injection body (reuse `resolvePromotedLessonsForInjection` with the
subagent's resolved identity), and thread `workflowName` into the shared prompt context so
workflow-scoped memories reach subagents. Characterization test parity with the step path.

---

### FU-9 · Teach the sweep workflow prompt about `suggest_skill_assignment` — **S**

**Problem.** The `suggest_skill_assignment` runtime tool is registered and granted, but the seeded
`memory-learning-sweep` workflow's `sweep.md` prompt + `output_contract` were not updated to
mention it — so the sweep agent won't organically use it.

**Where.** `seed/workflows/prompts/.../sweep.md` (or the memory-learning-sweep prompt) + its
`output_contract`.

**Fix.** Add prompt guidance on when to call `suggest_skill_assignment` (existing skill → useful in
agent/workflow). Keep `validate:seed-data` green. Requires a reseed to take effect live.

---

### FU-10 · Re-home the skill scope-confirmation UI in the Improvements surface — **M** _(product-adjacent)_

**Problem.** Epic A's web cutover removed the project-workspace LearningTab's embedded proposal UI
(including the skill **scope-confirmation** affordance) in favor of the global Improvements queue.
Scope confirmation for a materialized skill (which projects/agents/workflows it applies to) was
deferred and currently has no UI home.

**Where.** `apps/web/src/pages/improvements/` (new detail/action), the existing
`POST /skills/:name/confirm-scope`-style backend (verify what survived Epic A), or fold scope into
the `skill_assignment` flow.

**Fix.** Decide whether skill scoping belongs on the applied-skill-create proposal detail or as a
first-class `skill_assignment` action, then implement it in the Improvements queue. Small product
decision first (see Product Decisions below).

---

## Priority 2 — Hygiene, DRY, tests, docs

Batchable; low individual risk. Good "clean-up sweep" candidates.

**Correctness-adjacent minors**

- **FU-11 (S)** — `WorkflowSkillBindingService`: an empty-string `stepId` (`''`) bypasses the
  null-only dedupe special-case → possible unique-violation throw. Add `stepId?.trim() || null`
  normalization at the service boundary. Not currently reachable, but a latent footgun.
- **FU-12 (S)** — `resolveEffectiveSkills` dedupes by _raw_ string, but hydration normalizes
  (`test_generator` vs `test-generator`, case) — inconsistent naming across sources yields a
  duplicated injected skill block (wasted budget). Normalize before dedupe.
- **FU-13 (S)** — `agent-assigned-skills.helpers` calls `AgentSkillLibraryService.listSkills()`
  (uncached `readdirSync` + frontmatter parse) on **every** step/subagent even when there are zero
  bindings — a second full skill-library scan on the hot path. Short-circuit when `bindings` is
  empty and all effective names are covered by `profileSkills`.
- **FU-14 (S)** — `SkillAssignmentApplier.apply()` sets `status:'applied'` itself _and_
  `applyProposal` re-sets it (extra write, diverges from `SkillCreateApplier` which lets the wrapper
  own status). Have `apply()` only patch `rollback_data`.
- **FU-15 (S)** — `RememberWriteGuardService` near-dup dedup buckets by **project** `scopeId` for
  _all_ scopes, so agent-/workflow-scoped `remember` calls are dedup-checked against the project's
  pending pool (cross-scope leak). Key the bucket on the actual resolved scope.
- **FU-16 (S)** — `retrospective-analysis.service.ts` `isAlreadyKnown` dedup intentionally left at
  project+global (blast-radius choice). Revisit whether workflow/agent scopes should widen it.
- **FU-17 (S)** — `deriveSkillSlug` fallback `retrospective-skill` can collide: two findings with
  empty/non-alnum source text both slug to the same name, and if a skill with that name exists the
  second routes as `skill_assignment` onto an unrelated skill. Make the fallback unique (hash the
  source).

**DRY / dead code / docs**

- **FU-18 (S)** — Extract a shared `csvToArray` helper in `@nexus/core` (duplicated between
  `improvement-proposal-contracts.schema.ts` and `learning-contracts.schema.ts`).
- **FU-19 (S)** — Extract `resolveProfileByName` in `AgentSkillsService`
  (`addProfileSkillsByProfileName`/`removeProfileSkillsByProfileName` duplicate normalize/find/
  NotFound boilerplate).
- **FU-20 (S)** — `improvement.module.ts` doc comment still references the removed
  `MemorySignalsModule` edge (Epic E dropped the embedding dedup tier). Correct the comment.
- **FU-21 (S)** — Remove the 3 stale narrative "Repair Agent" prose mentions in
  `docs/guide/39-workflows-to-pi-runner.md`, `docs/guide/18-telemetry-observability.md`,
  `docs/guide/04-service-communication.md` (port tables are already clean).
- **FU-22 (S)** — Test-coverage top-ups flagged in review: Kanban handler test should assert
  `suspectedArea`/`evidence` land in `metadata.improvement`; web `ImprovementCodeChangeDetail`
  evidence section should not render when all three arrays are empty; web `ImprovementProposalRow`
  filter-bar `Select`s use uncontrolled `defaultValue` (won't reflect a programmatic reset).
- **FU-23 (S, optional)** — Spec-mock type hygiene: this branch inherited the repo's pervasive
  loose-spec-mock pattern (partial objects `as SomeService`) that `tsc -p apps/api/tsconfig.json`
  flags but no gate catches. A repo-wide spec-typing pass is out of scope for this feature but
  worth a dedicated ticket if spec type-safety is desired.

---

## Product decisions (not pure engineering — decide before building)

- **PD-1 · Dead-letter replay for parked `code_change` events.** The runbook
  (`docs/operations/self-improvement-project.md`) documents that the existing
  `/internal/core/lifecycle-stream/replay` endpoint is **cursor-forward-only** and cannot reach
  already-parked (dead-lettered) rows; today's real recovery is a manual `redis-cli XADD` of the
  stored payload. Decide whether to build a proper dead-letter **replay endpoint** (re-emit
  dead-letter rows to the stream, idempotent by `proposalId`).
- **PD-2 · Post-apply probation watcher.** Explicitly out of scope in the Epic D spec — the schema
  (`applied_at`/`rollback_data`/`provenance`/`rolled_back_at`) supports it, but nothing watches an
  applied definition-change to auto-revert if the next runs regress. Decide if/when to build it.
- **PD-3 · Agent-scoped `remember` governance tier.** Explicit `agent`-scoped `remember` captures
  keep today's routing (preserved via `scope_type` fallback). Aligning them with the
  `agent_preference` 0.8 governance tier was left out of scope — decide the intended posture.
- **PD-4 · Skill scope-confirmation UX** (see FU-10) — where scoping lives in the new surface.

---

## Suggested sequencing

1. **Correctness sweep (P0):** FU-3, FU-4 (both S, isolated) → FU-1 (definition-change rollback) →
   FU-2 (embedding threshold; highest leverage, but touches shared infra + 3 callers — do with
   care and its own verification).
2. **Feature-completeness (P1):** FU-6 (retry-chain skills) and FU-5 (subagent step bindings) are
   the two Important gaps that most directly complete the skills feature; FU-7 (mount) makes bound
   skills actually usable end-to-end. FU-8 (subagent memory injection) is the largest and can trail.
3. **Hygiene batch (P2):** FU-11…FU-22 as one or two consolidated clean-up PRs (each is S).
4. **Product decisions:** triage PD-1…PD-4 before their engineering.

Most P0/P1 items are independent and parallelizable; FU-2 and FU-8 are the two that warrant their
own focused effort and review.
