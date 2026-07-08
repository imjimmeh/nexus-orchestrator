# Step / Subagent Execution-Path Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the accidental duplication-and-divergence between the workflow-**step** agent path and the **subagent** path so that "universal" execution concerns (system-prompt layers, tool authorization, container identity) are built once and inherited by both — closing the class of silent bugs where a capability is added to one path and missing from the other (the EPIC-212 `remember` directive being the live example).

**Architecture:** Today two parallel implementations build an agent's runtime: `buildAgentSystemPrompt` + `assembleAgentSystemPrompt` (step) vs `buildSubagentSystemPrompt` (subagent), plus separate tool-policy and container-config code. They already share _some_ seams (`signAgentToken`, `resolveRunnerHarness`, `attachResolvedContributions`, `WorkflowStageSkillPolicyService`, skill renderers, `ExecutionSupervisorService`). This plan extends that pattern: extract the remaining **universal** seams into shared builders that both callers invoke, while leaving genuinely **step-only** concerns (upstream-DAG context, strategic-intent, running-workflows) on the step caller. No behavior change for step agents; subagents gain the universal layers + correct tool authorization.

**Tech Stack:** NestJS (apps/api), TypeORM, Vitest, BullMQ. System prompt assembly via `SystemPromptAssemblyService`. Tool policy via `step-support-tool-policy.helpers.ts` + `ToolPolicyEvaluatorService`. Container config via `*-container-config.helpers.ts` / `subagent-orchestrator.container-config.operations.ts`.

## Global Constraints

- **Behavior-preserving for step agents.** Step-path output must be byte-identical before/after each refactor task (locked by Phase 0 characterization tests).
- **No eslint suppression / `@ts-ignore` / rule downgrade.** Files at the `max-lines` cap (e.g. `kanban-retrospective.service.ts`, several step-support files) must be split, not suppressed.
- **TDD (Red-Green-Refactor)** for every change. Characterization test first where refactoring existing behavior.
- **Core/Kanban boundary** unaffected — all work is in `apps/api/src/workflow/**` and `apps/api/src/system-prompt/**`, Kanban-neutral.
- **Each phase is independently shippable and reversible.** Land Phase 1, deploy, verify, before Phase 2.
- **Verify branch before commit** (`git branch --show-current`); **typecheck + `npm run test:api` + `npm run lint:api`** before declaring a task done.
- **Build order:** `npm run build --workspace=packages/core` first if any `@nexus/core` contract changes.

---

## Audit Summary (the divergence map this plan resolves)

Classification of every compared concern (full evidence in the three audit runs, 2026-06-29):

**Already shared (no work):** `signAgentToken`/`resolveAgentTokenTtl` (24h TTL), `resolveRunnerHarness`, `gatherContributionSources`/`attachResolvedContributions`, `WorkflowStageSkillPolicyService.resolveAssignedSkills`, skill renderers (`renderInjectedSkillContent`/`renderSkillSection`/`resolveSkillContentBudgetTokens`), `AiConfigurationService.resolveStepSettings`, `ExecutionSupervisorService` (unified lifecycle), `canProfileUseTool` evaluator.

**Bucket 1 — Universal prompt layers MISSING on subagents (accidental; Phase 1):**
| Layer | Step | Subagent | Verdict |
|---|---|---|---|
| Resolved base prompt | ✓ | ✓ | shared |
| Skill content | ✓ | ✓ | shared |
| **Memory-capture-guidance** | ✓ (cond.) | **MISSING** | universal → add |
| **Promoted-learning (memory injection)** | ✓ hybrid recall | **MISSING** | universal → add |
| **Runtime/scope context** (scopeId/contextId in prompt) | ✓ | **MISSING** | universal → add |
| **`assembleAgentSystemPrompt` envelope** (contributor blocks, transforms, `## headers`) | ✓ | **bypassed** | universal → route through it |
| Upstream-DAG context | ✓ | n/a | **step-only-legitimate** |
| Strategic-intent | ✓ | n/a | **step-only-legitimate** |
| Running-workflows | ✓ | n/a | **step-only-legitimate** |

**Bucket 2 — Tool authorization divergence (correctness/safety; Phase 2):** subagents **skip** the `jobScoped ∩ profileAllowed` intersection (`step-support-tool-policy.helpers.ts:13-107`) and the 3-phase companion-tool propagation entirely — they receive whatever the parent passed + SDK natives via `provisionSubagentToolMount`. Gap site: `workflow-runtime-subagent-tools.service.ts:53-115`.

**Bucket 3 — Container/identity/lifecycle divergence (Phase 3):** subagent tier hardcoded `ContainerTier.HEAVY`; `HARNESS_ID` env + `harnessDefaultEnv` missing (only in labels); no `SESSION_CHECKPOINT_PATH`; **no idle-tracking** (`question-idle-tracker` covers steps only → container-leak risk when a subagent awaits input); contributions sourced from profile only (legitimate — no step inputs exist). JWT claims legitimately differ (`isSubagent`/`parent_job_id`).

---

## File Structure

| File                                                                                                     | Responsibility                                                                                                                                  | Phase |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `apps/api/src/workflow/agent-prompt/universal-prompt-layers.helpers.ts` (new)                            | Build the universal layer list (resolved, skill, runtime/scope, promoted-learning, memory-capture) from a context object — called by both paths | 1     |
| `apps/api/src/workflow/agent-prompt/universal-prompt-context.types.ts` (new)                             | `UniversalPromptContext` type (the shared inputs)                                                                                               | 1     |
| `apps/api/src/workflow/workflow-step-execution/step-agent-system-prompt.helpers.ts` (modify)             | Reduce to: step-only layers + `buildUniversalPromptLayers` + `assembleAgentSystemPrompt`                                                        | 1     |
| `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts` (modify) | Route `buildSubagentSystemPrompt` through `buildUniversalPromptLayers` + `assembleAgentSystemPrompt({runType:'subagent'})`                      | 1     |
| `apps/api/src/system-prompt/system-prompt-assembly.service.ts` (modify)                                  | Accept `runType:'subagent'`; contributors may opt into subagent                                                                                 | 1     |
| `apps/api/src/workflow/workflow-execution-tools/execution-tool-policy.helpers.ts` (new, extracted)       | `resolveAllowedToolNamesForExecution(...)` used by step + subagent                                                                              | 2     |
| `apps/api/src/workflow/workflow-runtime/workflow-runtime-subagent-tools.service.ts` (modify)             | Apply the shared intersection + companion propagation                                                                                           | 2     |
| `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts` (modify) | Tier param, `HARNESS_ID`/`harnessDefaultEnv` env, idle-tracking enrolment                                                                       | 3     |

---

## Phase 0 — Characterization tests (lock current behavior before touching anything)

### Task 0.1: Pin the step-path system prompt output

**Files:**

- Test: `apps/api/src/workflow/workflow-step-execution/step-agent-system-prompt.helpers.spec.ts`

- [ ] **Step 1: Add a golden-output test** that drives `buildAgentSystemPrompt` with a representative fixture (profile prompt, one assigned skill in native mode, a scopeId, a promoted lesson, non-suppressed workflow) and asserts the full assembled string — layer order, `## Todo List` contributor block, memory-capture-guidance presence, runtime-context bullets. This is the regression oracle for Phase 1.

- [ ] **Step 2: Run it — expect PASS** (documents today's behavior). `npm run test:api -- step-agent-system-prompt.helpers.spec`

- [ ] **Step 3: Commit.** `git commit -m "test(prompt): characterize step-path system prompt before consolidation"`

### Task 0.2: Pin the subagent-path system prompt output

**Files:**

- Test: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.skills.spec.ts`

- [ ] **Step 1: Add a golden-output test** for `buildSubagentSystemPrompt` (native + search modes) asserting the _current_ thin output (base + skills, nothing else). After Phase 1 this test changes intentionally — that diff is the proof subagents gained the universal layers.

- [ ] **Step 2: Run — expect PASS. Commit.**

---

## Phase 1 — Unified system-prompt composition (highest value; subsumes EPIC-212 Task C2)

> This phase makes subagents receive memory-capture-guidance, promoted-learning injection, runtime/scope context, and the contributor envelope — fixing the "zero `agent_capture`" gap _and_ giving subagents the lessons they currently fly blind to. The narrow C2 task in `2026-06-29-epic212-memory-loop-reactivation.md` is **replaced** by this phase.

### Task 1.1: Define the universal prompt context type

**Files:**

- Create: `apps/api/src/workflow/agent-prompt/universal-prompt-context.types.ts`

**Interfaces — Produces:**

```typescript
export interface UniversalPromptContext {
  support: StepSupportService; // provides buildPromotedLearningContext + assembleAgentSystemPrompt
  harnessId?: HarnessId;
  workflowRunId: string;
  jobId: string;
  stepId: string;
  scopeId?: string;
  contextId?: string;
  contextType?: string;
  resolvedSystemPrompt: string; // profile/system base prompt (resolveStepSettings)
  assignedSkills?: SkillLibraryRecord[];
  availableCategories?: string[];
  skillDiscoveryMode: SkillDiscoveryMode;
  taskPrompt?: string; // step.prompt OR subagent task — used as the memory-recall query
  suppressMemoryCapture: boolean; // shouldSuppressMemoryCapture(workflowId) || sweep/CEO
  agentProfile?: string;
  runType: "workflow" | "subagent";
}
```

- [ ] **Step 1: Create the file** with the interface above and a one-line JSDoc. (No test — pure type.)
- [ ] **Step 2: Commit.** `git commit -m "feat(prompt): UniversalPromptContext shared input type"`

### Task 1.2: Extract `buildUniversalPromptLayers`

**Files:**

- Create: `apps/api/src/workflow/agent-prompt/universal-prompt-layers.helpers.ts`
- Test: `apps/api/src/workflow/agent-prompt/universal-prompt-layers.helpers.spec.ts`

**Interfaces — Produces:**

```typescript
// Returns the UNIVERSAL baseLayers (order: runtime → promoted-learning → resolved → skill → memory-capture),
// each {id, content}; callers prepend their own context-specific layers before assembling.
export async function buildUniversalPromptLayers(
  ctx: UniversalPromptContext,
): Promise<Array<{ id: string; content: string }>>;
```

- [ ] **Step 1: Write the failing test** — assert the returned layers include `runtime`, `promoted-learning` (when `support.buildPromotedLearningContext` returns content), `resolved`, `skill`, and `memory-capture-guidance` (when `suppressMemoryCapture=false`); and that `memory-capture-guidance` is absent when `suppressMemoryCapture=true`. Mock `support`.

- [ ] **Step 2: Run — expect FAIL** (module absent). `npm run test:api -- universal-prompt-layers.helpers.spec`

- [ ] **Step 3: Implement** by lifting the layer-building logic that currently lives inline in `buildAgentSystemPrompt` (the `skillSection` computation at lines 71-91, `buildRuntimeContextSection`, the `buildPromotedLearningContext` call, the resolved + memory-capture layers). Reuse the existing helpers (`renderInjectedSkillContent`, `renderSkillSection`, `MEMORY_CAPTURE_GUIDANCE`, `resolveSkillContentBudgetTokens`) — do not re-implement them.

- [ ] **Step 4: Run — expect PASS. Commit.** `git commit -m "feat(prompt): extract buildUniversalPromptLayers shared by step+subagent"`

### Task 1.3: Reduce the step path to use the shared builder (behavior-preserving)

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-system-prompt.helpers.ts`

- [ ] **Step 1:** Rewrite `buildAgentSystemPrompt` so it builds only the **step-only** layers (`upstream`, `strategic-intent`, `running-workflows`), calls `buildUniversalPromptLayers({...ctx, runType:'workflow'})`, concatenates `[stepOnly..., universal...]` preserving the _current_ order, and calls `support.assembleAgentSystemPrompt` exactly as before.

- [ ] **Step 2: Run the Task 0.1 characterization test — expect PASS unchanged** (proves step output is byte-identical). `npm run test:api -- step-agent-system-prompt.helpers.spec`

- [ ] **Step 3: Commit.** `git commit -m "refactor(prompt): step path composes via shared universal layers (no behavior change)"`

### Task 1.4: Route the subagent path through the shared builder + assembly envelope

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts`
- Modify: `apps/api/src/system-prompt/system-prompt-assembly.service.ts` (accept `runType:'subagent'`)

- [ ] **Step 1: Update the Task 0.2 test to the NEW expected output** — subagent prompt now contains memory-capture-guidance (for non-suppressed workflows), runtime-context bullets, and promoted-learning when available. This is the intentional behavior change.

- [ ] **Step 2: Run — expect FAIL** (subagent still thin). `npm run test:api -- subagent-orchestrator.container-config.skills.spec`

- [ ] **Step 3: Implement** — `buildSubagentSystemPrompt` calls `buildUniversalPromptLayers({ runType:'subagent', resolvedSystemPrompt: baseSystemPrompt, taskPrompt: <subagent task/prompt>, suppressMemoryCapture: shouldSuppressMemoryCapture(workflowId), scopeId/contextId from spawn context, ... })` then `context.support.assembleAgentSystemPrompt({ runType:'subagent', baseLayers, ... })`. Thread `workflowId` + `scopeId` (already available in subagent spawn params/JWT) into the builder. Inject `StepSupportService` into the subagent container-config operation context if not already available.

- [ ] **Step 4: Allow `runType:'subagent'`** in `SystemPromptAssemblyService` — contributors that should fire for subagents check `ctx.runType === 'subagent'`. Leave `TodoPromptContributor` as `runType==='workflow'` only **unless** the decision in §Decisions says otherwise.

- [ ] **Step 5: Run — expect PASS. Lint + commit.** `git commit -m "feat(prompt): subagents inherit universal layers + assembly envelope (EPIC-212 Pillar A fix)"`

- [ ] **Step 6: Verify on a live run** after deploy — `event_ledger` shows `remember` calls from subagents and `learning_candidates` gains `agent_capture` rows.

---

## Phase 2 — Unified tool authorization (correctness/safety)

> Closes the gap where subagents bypass `jobScoped ∩ profileAllowed`. After this, a subagent can never receive a tool its profile would deny, and companion tools (e.g. `wait_for_subagents` alongside `spawn_subagent_async`) survive consistently.

### Task 2.1: Extract the shared execution tool-policy resolver

**Files:**

- Create: `apps/api/src/workflow/workflow-execution-tools/execution-tool-policy.helpers.ts`
- Test: `apps/api/src/workflow/workflow-execution-tools/execution-tool-policy.helpers.spec.ts`

**Interfaces — Produces:**

```typescript
// The single intersection used by both step and subagent provisioning.
export function resolveAllowedToolNamesForExecution(input: {
  requestedTools: string[]; // step: jobScoped; subagent: parent-spawn requested set
  profileAllowed: ReadonlySet<string>;
  companionRules?: CompanionToolRule[];
}): string[];
```

- [ ] **Step 1: Write failing tests** mirroring the existing step-policy spec cases (intersection drops profile-denied tools; companion tools survive; deny-default respected). Move/duplicate the relevant assertions from `step-support-tool-policy.helpers` coverage.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** by lifting the intersection + companion logic (`step-support-tool-policy.helpers.ts:87-106`, `applyCompanionTools`, `addMissingCompanionsToFinalResult`, `ensureCompanionsInProfileResult`) into the shared helper. Re-point the step path to call it (behavior-preserving — its spec must stay green).
- [ ] **Step 4: Run step + new specs — expect PASS. Commit.**

### Task 2.2: Apply the resolver to subagent provisioning

**Files:**

- Modify: `apps/api/src/workflow/workflow-runtime/workflow-runtime-subagent-tools.service.ts`
- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts` (`provisionSubagentToolMount`)
- Test: subagent tools spec

- [ ] **Step 1: Write failing test** — spawning a subagent whose parent passes a tool the subagent profile denies results in that tool being **absent** from the written allowlist; a granted primary tool keeps its companion.
- [ ] **Step 2: Run — expect FAIL** (today the tool passes through).
- [ ] **Step 3: Implement** — resolve the subagent profile's `profileAllowed` set (via `WorkflowStageSkillPolicyService`/`AiConfigurationService` profile lookup, same source the step path uses) and pass `{ requestedTools: spawnParams.tools, profileAllowed, companionRules }` to `resolveAllowedToolNamesForExecution` before `writeSdkToolAllowlist`. Keep `filterSearchSkillForMode` afterward.
- [ ] **Step 4: Run — expect PASS. Lint + commit.**

---

## Phase 3 — Container/identity/lifecycle parity

### Task 3.1: Parameterize subagent container tier

**Files:** modify `subagent-orchestrator.container-config.operations.ts:262`; test alongside.

- [ ] **Step 1: Failing test** — a subagent spawned with `tier: 'light'` (or inheriting a light parent) gets `ContainerTier.LIGHT`. **Step 2:** FAIL (hardcoded HEAVY). **Step 3:** resolve tier from `spawnParams.tier` → parent step tier → default HEAVY. **Step 4:** PASS, commit.

### Task 3.2: Forward `HARNESS_ID` + `harnessDefaultEnv` to subagent env

**Files:** modify the subagent env construction (`:297-311`); test.

- [ ] **Step 1: Failing test** — subagent env includes `HARNESS_ID` and the resolved harness registry `defaultEnv`. **Step 2:** FAIL. **Step 3:** add both (mirror `step-agent-container-config.helpers.ts:91,101`). **Step 4:** PASS, commit.

### Task 3.3: Enrol subagents in idle-tracking (close the container-leak)

**Files:** modify `question-idle-tracker.service.ts` (or its caller) to track subagent executions that post questions; test.

- [ ] **Step 1: Failing test** — a subagent that posts a question and goes idle is stopped/removed after `idle_remove_seconds`. **Step 2:** FAIL (subagents untracked). **Step 3:** extend the tracker to enrol subagent executions (keyed by `subagentExecutionId`, respecting the unified `ExecutionSupervisorService`). **Step 4:** PASS, commit.

---

## Decisions (resolve with the product owner before Phase 1 Step 4 / Phase 3)

1. **Memory-capture-guidance for subagents** — recommended **YES** (they do the implementation work). Default of this plan: inject it (suppressed only for sweep/CEO).
2. **Promoted-learning injection for subagents** — recommended **YES** (they benefit from prior lessons); cost is one extra recall query per spawn. Default: inject.
3. **Todo contributor for subagents** — recommended **NO** (subagents track their own task, not the workflow todo). Default: keep `runType==='workflow'` only.
4. **Strategic-intent / upstream / running-workflows** — **step-only-legitimate**; do not add to subagents.
5. **Checkpoint resume for subagents (Task not included)** — deferred; lower value, larger surface. Flag if needed.

---

## Final: deploy + verify + supersede note

- [ ] **Step 1: Rebuild + redeploy** after each phase (`npm run build --workspace=packages/core && npm run build:api && docker compose up -d --build api`); confirm clean boot.
- [ ] **Step 2: Phase-1 acceptance** — subagent `agent_capture` rows appear; subagents reference scope/runtime correctly; step output unchanged (Task 0.1 green).
- [ ] **Step 3: Phase-2 acceptance** — a profile-denied tool no longer reaches a subagent; companions survive.
- [ ] **Step 4: Phase-3 acceptance** — light subagents use light tier; idle subagent containers are reaped.
- [ ] **Step 5: Update** the EPIC-212 reactivation plan to mark Task C2 **superseded by Phase 1** here, and update `docs/guide` (subagent vs step execution differences) + the memory file.

## Self-Review

- **Audit coverage:** every row from the three audits maps to a phase — Bucket 1 → Phase 1, Bucket 2 → Phase 2, Bucket 3 → Phase 3; already-shared seams explicitly excluded.
- **Behavior preservation:** Phase 0 characterization tests gate the step path (Task 1.3 must keep them green); subagent behavior changes are intentional and re-pinned (Task 1.4 Step 1, 0.2).
- **Type consistency:** `UniversalPromptContext` / `buildUniversalPromptLayers` / `resolveAllowedToolNamesForExecution` names used consistently across tasks; `runType: 'workflow' | 'subagent'` threaded through both the context type and `SystemPromptAssemblyService`.
- **Scope honesty:** Phase 2 (tool auth) and Phase 3 (container) could each ship as their own PR/epic; flagged. Checkpoint-resume parity explicitly deferred.
- **Decisions surfaced:** the four debatable "should subagents get X" items are listed for owner sign-off rather than silently assumed.
