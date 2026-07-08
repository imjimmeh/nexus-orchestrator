# Epic C — Memory Targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix scope-blind memory recall and add first-class `agent`/`workflow` memory targeting per spec §4.3 of `docs/superpowers/specs/2026-07-02-self-improvement-pipeline-design.md`: the retrieval candidate pool becomes `global + project(scopeId) + agent(agentProfileName) + workflow(workflowName)`; a new `workflow` scope (`entity_type='workflow'`, `entity_id=<workflow definition name>`) flows through promotion routing/governance/destination; the `remember` tool gains `agent`/`workflow` scope values with ids auto-resolved from run context; the retrospective analyst's `scope_hint` vocabulary gains `workflow_specific`.

**Architecture:** All changes ride the EXISTING `entity_type`/`entity_id` scope key on `memory_segments` — no new tagging system, no migration (both columns are free-form `varchar`; `@nexus/core` `IMemorySegment.entity_type` is a plain `string` at `packages/core/src/interfaces/workflow-legacy.types.ts:150`, and `learningScopeTypeSchema` at `packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts:37-42` already accepts `workflow`/`agent`). Identity fields (`agentProfileName`, `workflowName`) are threaded as OPTIONAL fields on existing input types, never as parallel positional params. Workflow-definition names are resolved server-side from the run record via one new shared pure helper (`resolveWorkflowNameForRun`) reused at all three resolution sites (step prompt path, `remember` handler, retrospective router) — agents never supply raw ids. Downstream ranking (EmbeddingSimilarityService RRF, recency decay, usefulness, pinned boost, token-budget trim) is untouched. Governance (probation / contradiction / feedback-weight) is scope-agnostic by construction and stays untouched except for pinning regression tests.

**Tech Stack:** NestJS 11 + TypeORM (apps/api), Vitest with direct-construction mock harnesses (per `testing-unit-patterns`), Zod v4 schemas in `@nexus/core` (packages/core), seed prompt markdown under `seed/workflows/prompts/`.

## Global Constraints

- Strict TDD red→green→refactor for every behavioral change; regression-pinning tests (Task 7) are the only allowed pass-on-first-run tests.
- Unit tests use mocked repositories ONLY — do NOT touch `memory-drift-detection.integration.spec.ts` / `gitops/reconciliation.integration.spec.ts` style integration specs (they TRUNCATE the live dev DB when `DB_HOST` is set).
- Build `packages/core` before `apps/api` whenever core changes: `npm run build --workspace=packages/core`.
- NestJS builds use `nest build` (`npm run build:api`), never raw `tsc`.
- Never suppress lint (`eslint-disable`, `@ts-ignore`); `max-lines` is 500 — prefer pure `*.helpers.ts` additions over growing services.
- No re-exports, no compat aliases; shared types live in `packages/core`; API/core stay Kanban-neutral (nothing here touches Kanban).
- A memory targets exactly ONE scope (spec §4.3 deliberate simplification) — no tag lists anywhere in this epic.
- Skill-scoped recall (`entity_type='skill'`) is explicitly OUT OF SCOPE (spec §8) — do not add it.
- Work on branch `feature/epic-c-memory-targeting` cut from current `main`; single-file test runs via `npm run test --workspace=apps/api -- <spec path>` (maps to `vitest run --project unit <path>`).

---

## Task 1 — Recall union in `MemoryRetrievalService`

Extend the retrieval input with optional `agentProfileName` / `workflowName` and widen the candidate pool to `project + global + agent + workflow`. Also make the merged pool recency-honest (sorted `created_at DESC` across pools) so the recency fallback cannot starve the new pools behind a large project pool.

**Files:**

- Modify: `apps/api/src/memory/signals/memory-retrieval.types.ts` (whole file, 13 lines)
- Modify: `apps/api/src/memory/signals/memory-retrieval.service.ts` (`retrieve` at :97-111, `fetchCandidateSegments` at :241-249)
- Test: `apps/api/src/memory/signals/memory-retrieval.service.spec.ts` (append a new `describe`; existing tests keep passing — they mock exactly two `findByEntityType` calls and pass no identity fields)

**Interfaces:**

- Consumes: `MemorySegmentRepository.findByEntityType(entity_type: string, entity_id?: string, options?: { includeArchived?: boolean }): Promise<MemorySegment[]>` (`apps/api/src/memory/database/repositories/memory-segment.repository.ts:103-115`)
- Produces:

```ts
export interface MemoryRetrievalInput {
  readonly scopeId: string;
  readonly queryText: string;
  readonly tokenBudget: number;
  /** Optional current agent profile name — adds the `agent(<name>)` pool. */
  readonly agentProfileName?: string;
  /** Optional current workflow definition name — adds the `workflow(<name>)` pool. */
  readonly workflowName?: string;
}
```

**Steps:**

- [ ] Create the branch: `git checkout -b feature/epic-c-memory-targeting`
- [ ] RED — append to `apps/api/src/memory/signals/memory-retrieval.service.spec.ts` (reuses the file's existing `makeSegment`, `mockSegmentRepo`, `mockSimilarity`, `mockEmbeddingProvider`, `service` harness from its top-level `beforeEach`):

```ts
// ── Epic C: scoped recall union ────────────────────────────────────────────

describe("scoped recall union (agent + workflow pools)", () => {
  function stubPools(pools: Record<string, MemorySegment[]>) {
    mockSegmentRepo.findByEntityType.mockImplementation(
      (entityType: string, entityId?: string) =>
        Promise.resolve(pools[`${entityType}:${entityId ?? ""}`] ?? []),
    );
  }

  it("unions agent- and workflow-scoped segments into the candidate pool when identity fields are present", async () => {
    const projectSeg = makeSegment({
      id: "p1",
      entity_type: "project",
      entity_id: "proj-1",
    });
    const globalSeg = makeSegment({
      id: "g1",
      entity_type: "global",
      entity_id: "global",
    });
    const agentSeg = makeSegment({
      id: "a1",
      entity_type: "agent",
      entity_id: "implementer-agent",
    });
    const workflowSeg = makeSegment({
      id: "w1",
      entity_type: "workflow",
      entity_id: "work_item_implementation",
    });
    stubPools({
      "project:proj-1": [projectSeg],
      "global:": [globalSeg],
      "agent:implementer-agent": [agentSeg],
      "workflow:work_item_implementation": [workflowSeg],
    });
    mockSimilarity.findNearest.mockResolvedValue([
      { ownerType: "memory_segment", ownerId: "w1", score: 0.9 },
      { ownerType: "memory_segment", ownerId: "a1", score: 0.8 },
      { ownerType: "memory_segment", ownerId: "p1", score: 0.7 },
      { ownerType: "memory_segment", ownerId: "g1", score: 0.6 },
    ]);

    const result = await service.retrieve({
      scopeId: "proj-1",
      queryText: "query",
      tokenBudget: 10_000,
      agentProfileName: "implementer-agent",
      workflowName: "work_item_implementation",
    });

    expect(result.map((s) => s.id)).toEqual(["w1", "a1", "p1", "g1"]);
    expect(mockSegmentRepo.findByEntityType).toHaveBeenCalledWith(
      "agent",
      "implementer-agent",
    );
    expect(mockSegmentRepo.findByEntityType).toHaveBeenCalledWith(
      "workflow",
      "work_item_implementation",
    );
  });

  it("never queries the agent or workflow pool when the identity fields are absent", async () => {
    mockSegmentRepo.findByEntityType.mockResolvedValue([]);

    await service.retrieve({
      scopeId: "proj-1",
      queryText: "q",
      tokenBudget: 100,
    });

    const queriedTypes = mockSegmentRepo.findByEntityType.mock.calls.map(
      (call) => call[0],
    );
    expect(queriedTypes).toEqual(["project", "global"]);
  });

  it("never returns another workflow's segments (pool is keyed by the exact workflow name)", async () => {
    const otherWorkflowSeg = makeSegment({
      id: "other",
      entity_type: "workflow",
      entity_id: "some_other_workflow",
    });
    stubPools({ "workflow:some_other_workflow": [otherWorkflowSeg] });
    mockSimilarity.findNearest.mockResolvedValue([]);

    const result = await service.retrieve({
      scopeId: "proj-1",
      queryText: "query",
      tokenBudget: 10_000,
      workflowName: "work_item_implementation",
    });

    expect(result.map((s) => s.id)).not.toContain("other");
    expect(mockSegmentRepo.findByEntityType).toHaveBeenCalledWith(
      "workflow",
      "work_item_implementation",
    );
    expect(mockSegmentRepo.findByEntityType).not.toHaveBeenCalledWith(
      "workflow",
      "some_other_workflow",
    );
  });

  it("recency fallback interleaves pools by created_at instead of concatenating pool-by-pool", async () => {
    mockEmbeddingProvider.embed.mockResolvedValue({ configured: false });
    const oldProject = makeSegment({
      id: "old-project",
      created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1_000),
    });
    const freshWorkflow = makeSegment({
      id: "fresh-workflow",
      entity_type: "workflow",
      entity_id: "work_item_implementation",
      created_at: new Date(),
    });
    stubPools({
      "project:proj-1": [oldProject],
      "workflow:work_item_implementation": [freshWorkflow],
    });

    const result = await service.retrieve({
      scopeId: "proj-1",
      queryText: "query",
      tokenBudget: 10_000,
      workflowName: "work_item_implementation",
    });

    expect(result.map((s) => s.id)).toEqual(["fresh-workflow", "old-project"]);
  });
});
```

- [ ] Run: `npm run test --workspace=apps/api -- src/memory/signals/memory-retrieval.service.spec.ts` — expect the 4 new tests to FAIL (unknown input fields are ignored; `agent`/`workflow` pools never fetched; concat order not recency-sorted).
- [ ] GREEN — modify `apps/api/src/memory/signals/memory-retrieval.types.ts` to the `MemoryRetrievalInput` shape shown under **Interfaces** above (keep the existing JSDoc on the three original fields).
- [ ] GREEN — in `apps/api/src/memory/signals/memory-retrieval.service.ts`, replace the `retrieve` entry and `fetchCandidateSegments`:

```ts
  async retrieve(input: MemoryRetrievalInput): Promise<MemorySegment[]> {
    const { queryText, tokenBudget } = input;

    const segments = await this.fetchCandidateSegments(input);
    if (segments.length === 0) {
      return [];
    }

    const mode = await this.resolveMode();
    if (mode === 'recency' || queryText.trim().length === 0) {
      return this.recencyRetrieve(segments, tokenBudget);
    }

    return this.hybridRetrieveWithFallback(segments, queryText, tokenBudget);
  }
```

```ts
  /**
   * Fetch all non-archived segments for the recall union:
   * `project(scopeId) + global + agent(agentProfileName) + workflow(workflowName)`.
   * The agent / workflow pools are only queried when the caller supplied the
   * matching identity field, so a context without a profile or workflow name
   * can never receive (or leak) scoped segments. The merged pool is re-sorted
   * `created_at DESC` so the recency fallback is fair across pools.
   */
  private async fetchCandidateSegments(
    input: Pick<MemoryRetrievalInput, 'scopeId' | 'agentProfileName' | 'workflowName'>,
  ): Promise<MemorySegment[]> {
    const queries: Array<Promise<MemorySegment[]>> = [
      this.segmentRepo.findByEntityType('project', input.scopeId),
      this.segmentRepo.findByEntityType('global'),
    ];
    if (input.agentProfileName) {
      queries.push(this.segmentRepo.findByEntityType('agent', input.agentProfileName));
    }
    if (input.workflowName) {
      queries.push(this.segmentRepo.findByEntityType('workflow', input.workflowName));
    }
    const pools = await Promise.all(queries);
    return pools
      .flat()
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }
```

- [ ] Run: `npm run test --workspace=apps/api -- src/memory/signals/memory-retrieval.service.spec.ts` — ALL tests (old + new) pass. If any pre-existing test asserted pool-concat order that the new sort changes, fix the PRODUCTION expectation is the sort (the existing tests (a)-(d) already order newest-first per pool, so they stay green — verify, don't assume).
- [ ] REFACTOR — update the service's file-header JSDoc step 1 ("Fetch all non-archived `memory_segments` for the project scope + global") to describe the four-pool union.
- [ ] Commit: `git add -A && git commit -m "feat(memory): recall union — agent- and workflow-scoped pools in MemoryRetrievalService (Epic C, spec 4.3)"`

---

## Task 2 — Thread identity through promoted-lessons injection + legacy fallback union

`resolvePromotedLessonsForInjection` (`apps/api/src/workflow/workflow-step-execution/step-support-promoted-learning.helpers.ts:25-51`) is the single seam between step prompts and retrieval. Give it an identity argument, forward it to `retrieve`, and give the legacy `searchPromotedLessonsByScope` fallback the same union (one query per scope, merged newest-first, capped at the limit).

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-support-promoted-learning.types.ts` (add `PromotedLearningRecallIdentity`)
- Modify: `apps/api/src/workflow/workflow-step-execution/step-support-promoted-learning.helpers.ts` (`resolvePromotedLessonsForInjection` :25-51; add pure `mergeLessonsByRecency`)
- Test (Create): `apps/api/src/workflow/workflow-step-execution/step-support-promoted-learning.helpers.spec.ts` (none exists today; the function is currently only covered indirectly via `step-support.service.spec.ts`)

**Interfaces:**

- Consumes: `MemoryRetrievalService.retrieve(input: MemoryRetrievalInput)` (Task 1); `MemoryManagerService.searchPromotedLessonsByScope(opts: { entity_type: string; entity_id?: string; query?: string; limit?: number }): Promise<IMemorySegment[]>` (`apps/api/src/memory/memory-manager.service.ts:253-260`)
- Produces:

```ts
export interface PromotedLearningRecallIdentity {
  readonly agentProfileName?: string;
  readonly workflowName?: string;
}

export async function resolvePromotedLessonsForInjection(
  deps: PromotedLearningInjectionDeps,
  scope: ResolvedEntityScope,
  queryText: string,
  limit: number | undefined,
  identity: PromotedLearningRecallIdentity = {},
): Promise<IMemorySegment[]>;
```

**Steps:**

- [ ] RED — create `apps/api/src/workflow/workflow-step-execution/step-support-promoted-learning.helpers.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { resolvePromotedLessonsForInjection } from "./step-support-promoted-learning.helpers";
import type { IMemorySegment } from "@nexus/core";

function lesson(id: string, createdAt: Date): IMemorySegment {
  return {
    id,
    entity_type: "project",
    entity_id: "scope-1",
    memory_type: "fact",
    content: `lesson ${id}`,
    version: 1,
    metadata_json: null,
    created_at: createdAt,
    updated_at: createdAt,
  } as unknown as IMemorySegment;
}

function makeDeps(opts: { mode: "hybrid" | "recency" }) {
  return {
    systemSettings: { get: vi.fn().mockResolvedValue(opts.mode) },
    memoryRetrieval: { retrieve: vi.fn().mockResolvedValue([]) },
    memoryManager: {
      searchPromotedLessonsByScope: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("resolvePromotedLessonsForInjection — Epic C identity threading", () => {
  const scope = { entityType: "project", entityId: "scope-1" };

  it("forwards agentProfileName and workflowName to the hybrid retrieval call", async () => {
    const deps = makeDeps({ mode: "hybrid" });
    deps.memoryRetrieval.retrieve.mockResolvedValue([lesson("l1", new Date())]);

    await resolvePromotedLessonsForInjection(
      deps,
      scope,
      "query text",
      undefined,
      {
        agentProfileName: "implementer-agent",
        workflowName: "work_item_implementation",
      },
    );

    expect(deps.memoryRetrieval.retrieve).toHaveBeenCalledWith({
      scopeId: "scope-1",
      queryText: "query text",
      tokenBudget: 3000,
      agentProfileName: "implementer-agent",
      workflowName: "work_item_implementation",
    });
  });

  it("legacy fallback unions scope + agent + workflow searches, merged newest-first and capped", async () => {
    const deps = makeDeps({ mode: "recency" });
    const old = lesson("project-old", new Date("2026-01-01"));
    const fresh = lesson("workflow-fresh", new Date("2026-06-01"));
    const mid = lesson("agent-mid", new Date("2026-03-01"));
    deps.memoryManager.searchPromotedLessonsByScope.mockImplementation(
      ({ entity_type }: { entity_type: string }) => {
        if (entity_type === "project") return Promise.resolve([old]);
        if (entity_type === "agent") return Promise.resolve([mid]);
        if (entity_type === "workflow") return Promise.resolve([fresh]);
        return Promise.resolve([]);
      },
    );

    const result = await resolvePromotedLessonsForInjection(
      deps,
      scope,
      "",
      2,
      {
        agentProfileName: "implementer-agent",
        workflowName: "work_item_implementation",
      },
    );

    expect(
      deps.memoryManager.searchPromotedLessonsByScope,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: "agent",
        entity_id: "implementer-agent",
      }),
    );
    expect(
      deps.memoryManager.searchPromotedLessonsByScope,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: "workflow",
        entity_id: "work_item_implementation",
      }),
    );
    expect(result.map((l) => l.id)).toEqual(["workflow-fresh", "agent-mid"]);
  });

  it("legacy fallback queries only the resolved scope when no identity is supplied (no leak)", async () => {
    const deps = makeDeps({ mode: "recency" });

    await resolvePromotedLessonsForInjection(deps, scope, "", undefined);

    expect(
      deps.memoryManager.searchPromotedLessonsByScope,
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.memoryManager.searchPromotedLessonsByScope,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ entity_type: "project", entity_id: "scope-1" }),
    );
  });
});
```

- [ ] Run: `npm run test --workspace=apps/api -- src/workflow/workflow-step-execution/step-support-promoted-learning.helpers.spec.ts` — expect FAIL (extra identity fields not forwarded; fallback makes a single search call and takes no union).
- [ ] GREEN — in `step-support-promoted-learning.types.ts` add `PromotedLearningRecallIdentity` (shape above). In `step-support-promoted-learning.helpers.ts` replace the function body and add the pure merge helper + a named constant for the previously-inline `25`:

```ts
const DEFAULT_PROMOTED_LESSON_LIMIT = 25;
const AGENT_SCOPE_TYPE = "agent";
const WORKFLOW_SCOPE_TYPE = "workflow";

export async function resolvePromotedLessonsForInjection(
  deps: PromotedLearningInjectionDeps,
  scope: ResolvedEntityScope,
  queryText: string,
  limit: number | undefined,
  identity: PromotedLearningRecallIdentity = {},
): Promise<IMemorySegment[]> {
  const mode = await deps.systemSettings.get<string>(
    MEMORY_RETRIEVAL_MODE_SETTING,
    MEMORY_RETRIEVAL_MODE_DEFAULT,
  );
  if (mode === "hybrid" && queryText.length > 0 && scope.entityId.length > 0) {
    const retrieved = await deps.memoryRetrieval.retrieve({
      scopeId: scope.entityId,
      queryText,
      tokenBudget: PROMOTED_LEARNING_RETRIEVAL_TOKEN_BUDGET,
      ...(identity.agentProfileName
        ? { agentProfileName: identity.agentProfileName }
        : {}),
      ...(identity.workflowName ? { workflowName: identity.workflowName } : {}),
    });
    if (retrieved.length > 0) {
      return retrieved;
    }
  }
  const effectiveLimit = limit ?? DEFAULT_PROMOTED_LESSON_LIMIT;
  const fallbackScopes: Array<{ entity_type: string; entity_id: string }> = [
    { entity_type: scope.entityType, entity_id: scope.entityId },
    ...(identity.agentProfileName
      ? [
          {
            entity_type: AGENT_SCOPE_TYPE,
            entity_id: identity.agentProfileName,
          },
        ]
      : []),
    ...(identity.workflowName
      ? [{ entity_type: WORKFLOW_SCOPE_TYPE, entity_id: identity.workflowName }]
      : []),
  ];
  const perScope = await Promise.all(
    fallbackScopes.map((fallbackScope) =>
      deps.memoryManager.searchPromotedLessonsByScope({
        ...fallbackScope,
        ...(queryText.length > 0 ? { query: queryText } : {}),
        limit: effectiveLimit,
      }),
    ),
  );
  return mergeLessonsByRecency(perScope, effectiveLimit);
}

/** Merge per-scope lesson lists newest-first, dedupe by id, cap at `limit`. */
function mergeLessonsByRecency(
  perScope: IMemorySegment[][],
  limit: number,
): IMemorySegment[] {
  const byId = new Map<string, IMemorySegment>();
  for (const lessonSegment of perScope.flat()) {
    if (!byId.has(lessonSegment.id)) {
      byId.set(lessonSegment.id, lessonSegment);
    }
  }
  return [...byId.values()]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, limit);
}
```

- [ ] Run the new spec — PASS. Then run the two adjacent consumers to catch signature fallout: `npm run test --workspace=apps/api -- src/workflow/workflow-step-execution/step-support.service.spec.ts` (the added 5th parameter defaults to `{}`, so existing call sites compile and behave identically).
- [ ] Commit: `git add -A && git commit -m "feat(workflow): thread recall identity through promoted-lessons injection + union legacy fallback (Epic C)"`

---

## Task 3 — Thread identity from the step context (and verify the subagent path)

Callers of `buildPromotedLearningContext` supply the agent profile name (already available as `UniversalPromptContext.agentProfile`); the workflow definition name is resolved server-side from the run record with a new shared pure helper (sibling of the existing `resolveWorkflowIdForRun` at `apps/api/src/workflow/workflow-run-id-resolver.helpers.ts`). This helper is reused again in Tasks 5 and 6 — the three resolution sites share one implementation.

**Subagent-path verification (known step/subagent divergence pattern):** `grep` confirms exactly three production `retrieve({` callers — `step-support-promoted-learning.helpers.ts:36` (this chain), `retrospective-analysis.service.ts:284` (dedup, intentionally unchanged — see Deviations), and nothing in `workflow-subagents`. Subagents share the SAME `buildUniversalPromptLayers` entry (`subagent-orchestrator.container-config.operations.ts:243-265`) but their support adapter `SubagentPromptContextService.buildPromotedLearningContext` (`apps/api/src/workflow/workflow-subagents/subagent-prompt-context.service.ts:27-37`) is a documented stub returning `''` — subagents receive NO promoted-learning context today. This task threads the identity fields through the shared interface and both call sites so the stub receives them; implementing subagent promoted-learning injection itself remains the pre-existing follow-up (do NOT implement it here).

**Files:**

- Create: `apps/api/src/workflow/workflow-run-name-resolver.helpers.ts`
- Test (Create): `apps/api/src/workflow/workflow-run-name-resolver.helpers.spec.ts`
- Modify: `apps/api/src/workflow/workflow-step-execution/step-support.service.ts` (`buildPromotedLearningContext` :302-374; service already injects `runRepo`/`workflowRepo` at :78-79)
- Modify: `apps/api/src/workflow/agent-prompt/universal-prompt-context.types.ts` (`PromptContextSupportLike.buildPromotedLearningContext` :11-16)
- Modify: `apps/api/src/workflow/agent-prompt/universal-prompt-layers.helpers.ts` (`buildUniversalPromptLayers` :84-101)
- Modify: `apps/api/src/workflow/workflow-subagents/subagent-prompt-context.service.ts` (stub signature only, :27-37)
- Test: `apps/api/src/workflow/agent-prompt/universal-prompt-layers.helpers.spec.ts`, `apps/api/src/workflow/workflow-step-execution/step-support.service.spec.ts`

**Interfaces:**

- Produces:

```ts
// workflow-run-name-resolver.helpers.ts
export async function resolveWorkflowNameForRun(
  runRepo: Pick<WorkflowRunRepository, "findById">,
  workflowRepo: Pick<WorkflowRepository, "findById">,
  workflowRunId: string | undefined,
  onError: (message: string) => void,
): Promise<string | undefined>;
```

```ts
// PromptContextSupportLike (and StepSupportService.buildPromotedLearningContext params)
buildPromotedLearningContext(params: {
  workflowRunId: string;
  stateVariables?: Record<string, unknown>;
  query?: string;
  limit?: number;
  agentProfileName?: string;
}): Promise<string>;
```

- Consumes: `WorkflowRunRepository.findById(id): Promise<WorkflowRun | null>` (returns `workflow_id`, `apps/api/src/workflow/database/entities/workflow-run.entity.ts:19`); `WorkflowRepository.findById(id): Promise<Workflow | null>` (returns `name`, `apps/api/src/workflow/database/repositories/workflow.repository.ts:32-34`).

**Steps:**

- [ ] RED — create `apps/api/src/workflow/workflow-run-name-resolver.helpers.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { resolveWorkflowNameForRun } from "./workflow-run-name-resolver.helpers";

describe("resolveWorkflowNameForRun", () => {
  it("resolves run → workflow_id → workflow name", async () => {
    const runRepo = {
      findById: vi.fn().mockResolvedValue({ workflow_id: "wf-uuid" }),
    };
    const workflowRepo = {
      findById: vi
        .fn()
        .mockResolvedValue({ id: "wf-uuid", name: "work_item_implementation" }),
    };

    const name = await resolveWorkflowNameForRun(
      runRepo as never,
      workflowRepo as never,
      "run-1",
      vi.fn(),
    );

    expect(name).toBe("work_item_implementation");
    expect(runRepo.findById).toHaveBeenCalledWith("run-1");
    expect(workflowRepo.findById).toHaveBeenCalledWith("wf-uuid");
  });

  it("returns undefined without querying when workflowRunId is absent", async () => {
    const runRepo = { findById: vi.fn() };
    const name = await resolveWorkflowNameForRun(
      runRepo as never,
      { findById: vi.fn() } as never,
      undefined,
      vi.fn(),
    );
    expect(name).toBeUndefined();
    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it("is fail-soft: a repository error reports via onError and returns undefined", async () => {
    const onError = vi.fn();
    const runRepo = {
      findById: vi.fn().mockRejectedValue(new Error("DB down")),
    };

    const name = await resolveWorkflowNameForRun(
      runRepo as never,
      { findById: vi.fn() } as never,
      "run-1",
      onError,
    );

    expect(name).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] Run: `npm run test --workspace=apps/api -- src/workflow/workflow-run-name-resolver.helpers.spec.ts` — FAIL (module does not exist).
- [ ] GREEN — create `apps/api/src/workflow/workflow-run-name-resolver.helpers.ts`:

```ts
import type { WorkflowRunRepository } from "./database/repositories/workflow-run.repository";
import type { WorkflowRepository } from "./database/repositories/workflow.repository";

/**
 * Resolve the workflow DEFINITION NAME for a run (run → `workflow_id` →
 * `workflows.name`) with fail-soft semantics: absent run id, missing rows, or
 * a repository error all yield `undefined` (reported via `onError`) so callers
 * never throw. Sibling of {@link resolveWorkflowIdForRun} in
 * `workflow-run-id-resolver.helpers.ts`; shared by the step prompt path
 * (StepSupportService), the `remember` handler, and the retrospective output
 * router so workflow-name resolution lives in exactly one place (Epic C).
 */
export async function resolveWorkflowNameForRun(
  runRepo: Pick<WorkflowRunRepository, "findById">,
  workflowRepo: Pick<WorkflowRepository, "findById">,
  workflowRunId: string | undefined,
  onError: (message: string) => void,
): Promise<string | undefined> {
  if (!workflowRunId) {
    return undefined;
  }
  try {
    const run = await runRepo.findById(workflowRunId);
    if (!run?.workflow_id) {
      return undefined;
    }
    const workflow = await workflowRepo.findById(run.workflow_id);
    return workflow?.name;
  } catch (error) {
    onError(
      `Failed to resolve workflow name for run ${workflowRunId}: ${error}`,
    );
    return undefined;
  }
}
```

- [ ] Run the helper spec — PASS. Commit: `git add -A && git commit -m "feat(workflow): shared fail-soft run->workflow-name resolver helper (Epic C)"`
- [ ] RED — append to the `describe('StepSupportService.buildPromotedLearningContext', …)` block in `apps/api/src/workflow/workflow-step-execution/step-support.service.spec.ts` (its `beforeEach` constructs the service with `{} as any` for `runRepo`/`workflowRepo`, so build a locally-configured service for this test, mirroring the block's existing constructor-arg ordering at :189-204):

```ts
it("threads agentProfileName and the run-resolved workflow name into hybrid retrieval (Epic C)", async () => {
  settingsGet.mockResolvedValue("hybrid");
  retrieve.mockResolvedValueOnce([]);
  const scopedService = new StepSupportService(
    {} as any, // aiConfig
    { findById: vi.fn().mockResolvedValue({ workflow_id: "wf-uuid" }) } as any, // runRepo
    {
      findById: vi
        .fn()
        .mockResolvedValue({ id: "wf-uuid", name: "work_item_implementation" }),
    } as any, // workflowRepo
    {} as any, // toolMounting
    {} as any, // stateManager
    {} as any, // gitWorktreeService
    {} as any, // stageSkillPolicy
    {} as any, // toolPolicyEvaluator
    { searchPromotedLessonsByScope } as any, // memoryManager
    memoryMetrics as any, // memoryMetrics
    metrics as any, // metrics
    {} as any, // systemPromptAssembly
    { retrieve } as any, // memoryRetrieval
    { get: settingsGet } as any, // systemSettings
  );

  await scopedService.buildPromotedLearningContext({
    workflowRunId: "run-1",
    query: "how do I connect to the dev database",
    agentProfileName: "implementer-agent",
  });

  expect(retrieve).toHaveBeenCalledWith({
    scopeId: "run-1",
    queryText: "how do I connect to the dev database",
    tokenBudget: 3000,
    agentProfileName: "implementer-agent",
    workflowName: "work_item_implementation",
  });
});
```

- [ ] Run: `npm run test --workspace=apps/api -- src/workflow/workflow-step-execution/step-support.service.spec.ts` — new test FAILS.
- [ ] GREEN — in `StepSupportService.buildPromotedLearningContext` (:302-374): add `agentProfileName?: string` to the params type; import `resolveWorkflowNameForRun` from `../workflow-run-name-resolver.helpers`; before calling the helper resolve the name and pass the identity:

```ts
    const workflowName = await resolveWorkflowNameForRun(
      this.runRepo,
      this.workflowRepo,
      params.workflowRunId,
      (message) => this.logger.warn(message),
    );
    try {
      const lessons =
        await promotedLearningHelpers.resolvePromotedLessonsForInjection(
          {
            systemSettings: this.systemSettings,
            memoryRetrieval: this.memoryRetrieval,
            memoryManager: this.memoryManager,
          },
          scope,
          params.query?.trim() ?? '',
          params.limit,
          {
            ...(params.agentProfileName
              ? { agentProfileName: params.agentProfileName }
              : {}),
            ...(workflowName ? { workflowName } : {}),
          },
        );
```

(The existing tests in this describe construct `runRepo`/`workflowRepo` as `{} as any`; the fail-soft helper catches the resulting `TypeError` and resolves `undefined`, so they stay green with unchanged expectations — verify.)

- [ ] RED — extend `apps/api/src/workflow/agent-prompt/universal-prompt-layers.helpers.spec.ts` (mirror the existing `'forwards entityType and entityId to buildPromotedLearningContext via stateVariables'` test at :120-131 and its local `support`/context fixture pattern):

```ts
it("forwards the agent profile as agentProfileName to buildPromotedLearningContext (Epic C)", async () => {
  const support = {
    buildPromotedLearningContext: vi.fn(async () => ""),
    assembleAgentSystemPrompt: vi.fn(async () => ""),
  };

  await buildUniversalPromptLayers({
    support,
    workflowRunId: "run-1",
    jobId: "job-1",
    stepId: "step-1",
    resolvedSystemPrompt: "base",
    skillDiscoveryMode: "native",
    suppressMemoryCapture: false,
    agentProfile: "implementer-agent",
    runType: "workflow",
  });

  expect(support.buildPromotedLearningContext).toHaveBeenCalledWith(
    expect.objectContaining({ agentProfileName: "implementer-agent" }),
  );
});
```

- [ ] Run: `npm run test --workspace=apps/api -- src/workflow/agent-prompt/universal-prompt-layers.helpers.spec.ts` — FAILS.
- [ ] GREEN — in `universal-prompt-layers.helpers.ts` (:84-101) add to the `buildPromotedLearningContext` call: `...(ctx.agentProfile ? { agentProfileName: ctx.agentProfile } : {}),`. In `universal-prompt-context.types.ts` add `agentProfileName?: string;` to the `PromptContextSupportLike.buildPromotedLearningContext` params (:11-16). In `subagent-prompt-context.service.ts` add the same optional field to the stub's `_params` type (:27-32) — behavior stays `''`; note in its JSDoc that identity threading is now in place for the deferred subagent injection follow-up.
- [ ] Run: `npm run test --workspace=apps/api -- src/workflow/agent-prompt/universal-prompt-layers.helpers.spec.ts src/workflow/workflow-step-execution/step-support.service.spec.ts src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.spec.ts` — PASS.
- [ ] Commit: `git add -A && git commit -m "feat(workflow): thread agent profile + workflow name from step context into memory recall (Epic C)"`

---

## Task 4 — New `workflow` scope in the promotion pipeline

Preserve workflow-scoped candidates end-to-end: routing target `workflow` (never rewritten to `project`), governance treats it exactly like `project` (promotion floor 0.5, provisional + probation), and `resolveSegmentDestination` writes `entity_type='workflow'`.

**Files:**

- Modify: `apps/api/src/memory/learning/learning-router.types.ts` (`RoutingTarget` :12-18)
- Modify: `apps/api/src/memory/learning/learning-router.service.ts` (decision chain :108-135; pure helpers section)
- Modify: `apps/api/src/memory/learning/promotion-governance-policy.service.ts` (`decideGovernance` switch :112-151)
- Modify: `apps/api/src/memory/learning/learning-promotion.helpers.ts` (`resolveSegmentDestination` :33-63)
- Test: `apps/api/src/memory/learning/learning-router.service.spec.ts`, `apps/api/src/memory/learning/promotion-governance-policy.service.spec.ts`
- Test (Create): `apps/api/src/memory/learning/learning-promotion.helpers.destination.spec.ts`

**Interfaces:**

- Produces: `export type RoutingTarget = 'project' | 'global' | 'agent_preference' | 'workflow' | 'skill_new' | 'skill_patch' | 'drop';`
- Consumes: `decideGovernance(input, thresholds, nowMs): GovernanceDecision` (`promotion-governance-policy.service.ts:112`), `resolveSegmentDestination(candidate: LearningCandidate, governance: GovernanceDecision): SegmentDestination` (`learning-promotion.helpers.ts:33`). `dispatchByRoute` (`learning-promotion.dispatch.ts:24-87`) needs NO change — it passes `candidate.routing_target` straight into governance and the destination resolver.

**Steps:**

- [ ] RED — append to `apps/api/src/memory/learning/learning-router.service.spec.ts` (uses its existing `makeCandidate` factory at :9-40 and the `service` from `beforeEach`):

```ts
it("preserves a workflow-scoped candidate as target workflow (never rewritten to project)", async () => {
  const candidate = makeCandidate({
    scope_type: "workflow",
    scopeId: "work_item_implementation",
  });

  const decision = await service.route(candidate);

  expect(decision.target).toBe("workflow");
  expect(decision.scopeType).toBe("workflow");
  expect(decision.scopeId).toBe("work_item_implementation");
});

it("still drops templated noise even when workflow-scoped", async () => {
  templateNoise.classify.mockReturnValue({
    isTemplate: true,
    isLowSignal: true,
  });
  const candidate = makeCandidate({
    scope_type: "workflow",
    scopeId: "work_item_implementation",
  });

  const decision = await service.route(candidate);

  expect(decision.target).toBe("drop");
});
```

- [ ] RED — append to `apps/api/src/memory/learning/promotion-governance-policy.service.spec.ts` a table extension against the exported pure `decideGovernance` (that spec's existing style; reuse its threshold fixture — the canonical values are `promotionFloor: 0.5`, `agentPreferenceMinConfidence: 0.8`, `probationDays: 14` from `governance.settings.constants.ts`):

```ts
describe("workflow routing target (Epic C — treated like project)", () => {
  const thresholds = {
    promotionFloor: 0.5,
    agentPreferenceMinConfidence: 0.8,
    probationDays: 14,
  };
  const nowMs = Date.parse("2026-07-02T00:00:00.000Z");

  it("auto-promotes at/above the promotion floor with provisional state + probation", () => {
    const decision = decideGovernance(
      { routingTarget: "workflow", confidence: 0.5 },
      thresholds,
      nowMs,
    );
    expect(decision.autoPromote).toBe(true);
    expect(decision.governanceState).toBe("provisional");
    expect(decision.probationUntil).toEqual(new Date(nowMs + 14 * 86_400_000));
  });

  it("requires a proposal below the floor", () => {
    const decision = decideGovernance(
      { routingTarget: "workflow", confidence: 0.49 },
      thresholds,
      nowMs,
    );
    expect(decision.autoPromote).toBe(false);
    expect(decision.requiresProposal).toBe(true);
  });
});
```

- [ ] RED — create `apps/api/src/memory/learning/learning-promotion.helpers.destination.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveSegmentDestination } from "./learning-promotion.helpers";
import type { LearningCandidate } from "../database/entities/learning-candidate.entity";
import type { GovernanceDecision } from "./promotion-governance-policy.types";

const governance: GovernanceDecision = {
  autoPromote: true,
  governanceState: "provisional",
  probationUntil: new Date("2026-07-16T00:00:00.000Z"),
  requiresProposal: false,
  drop: false,
  reason: "test",
};

function candidate(overrides: Partial<LearningCandidate>): LearningCandidate {
  return {
    scope_type: "workflow",
    scopeId: "work_item_implementation",
    routing_target: "workflow",
    signals_json: {},
    ...overrides,
  } as LearningCandidate;
}

describe("resolveSegmentDestination — workflow routing target (Epic C)", () => {
  it("lands on a workflow-scoped fact segment keyed by the workflow definition name", () => {
    const destination = resolveSegmentDestination(candidate({}), governance);

    expect(destination).toEqual({
      entityType: "workflow",
      entityId: "work_item_implementation",
      memoryType: "fact",
      governanceState: "provisional",
      probationUntil: governance.probationUntil,
    });
  });

  it("falls back to provenance workflowName when scopeId is blank", () => {
    const destination = resolveSegmentDestination(
      candidate({
        scopeId: null,
        signals_json: { provenance: { workflowName: "run_retrospective" } },
      }),
      governance,
    );

    expect(destination.entityType).toBe("workflow");
    expect(destination.entityId).toBe("run_retrospective");
  });
});
```

- [ ] Run: `npm run test --workspace=apps/api -- src/memory/learning/learning-router.service.spec.ts src/memory/learning/promotion-governance-policy.service.spec.ts src/memory/learning/learning-promotion.helpers.destination.spec.ts` — all new tests FAIL.
- [ ] GREEN — `learning-router.types.ts`: add `'workflow'` to `RoutingTarget` with a one-line comment (`/** Workflow-definition-scoped home (Epic C). */`).
- [ ] GREEN — `learning-router.service.ts`: add constants `const WORKFLOW_SCOPE_TYPE = 'workflow';` and `const CONFIDENCE_WORKFLOW = 0.85;`, a pure helper in the helpers section, and the chain call between `routeDrop` and `routeAgentPreference` inside `route()`:

```ts
const workflowScope = routeWorkflowScope(candidate);
if (workflowScope) return workflowScope;
```

```ts
/**
 * A candidate explicitly captured against a workflow definition keeps its
 * workflow home — it must never be rewritten to `project` by the
 * scope-diversity pass (Epic C). Runs AFTER the credential and noise rails so
 * a credential-bearing or templated workflow capture is still pinned/dropped.
 */
function routeWorkflowScope(
  candidate: LearningCandidate,
): RoutingDecision | null {
  if (candidate.scope_type !== WORKFLOW_SCOPE_TYPE) {
    return null;
  }
  return {
    target: "workflow",
    scopeType: WORKFLOW_SCOPE_TYPE,
    scopeId: candidate.scopeId,
    rationale: "workflow-scoped capture → preserved workflow home",
    confidence: CONFIDENCE_WORKFLOW,
    signals: { workflowScoped: true },
  };
}
```

- [ ] GREEN — `promotion-governance-policy.service.ts` `decideGovernance`: add before the `'project'` case:

```ts
    case 'workflow':
      return tieredAutoDecision(
        'workflow',
        input.confidence,
        thresholds.promotionFloor,
        thresholds.probationDays,
        nowMs,
      );
```

Update the class JSDoc matrix (add a `workflow` row: "same tier as `project`").

- [ ] GREEN — `learning-promotion.helpers.ts`: add constants `const WORKFLOW_ROUTING_TARGET = 'workflow';` and `const WORKFLOW_SCOPE_TYPE = 'workflow';`, a branch in `resolveSegmentDestination` after the `agent_preference` branch, and the id resolver mirroring `resolveAgentEntityId` (:56-63):

```ts
if (candidate.routing_target === WORKFLOW_ROUTING_TARGET) {
  return {
    entityType: WORKFLOW_SCOPE_TYPE,
    entityId: resolveWorkflowEntityId(candidate),
    memoryType: FACT_MEMORY_TYPE,
    governanceState: governance.governanceState,
    probationUntil: governance.probationUntil ?? null,
  };
}
```

```ts
function resolveWorkflowEntityId(candidate: LearningCandidate): string {
  if (typeof candidate.scopeId === "string" && candidate.scopeId.trim()) {
    return candidate.scopeId;
  }
  return readProvenanceString(candidate, "workflowName") ?? DEFAULT_SCOPE_ID;
}
```

- [ ] Run the three spec files again — PASS. Also run `npm run test --workspace=apps/api -- src/memory/learning` to confirm no dispatch/promotion regression.
- [ ] Commit: `git add -A && git commit -m "feat(memory): workflow routing target — preserved home, project-tier governance, workflow-scoped destination (Epic C)"`

---

## Task 5 — `remember` tool: `agent` and `workflow` scope values

Extend the tool's `scope` enum in `@nexus/core` and auto-resolve the scope id in the handler: `agent` → `context.agentProfileName` (already on `InternalToolExecutionContext`, `packages/core/src/interfaces/internal-tool.types.ts:43`), `workflow` → workflow definition name from the run record via `resolveWorkflowNameForRun` (Task 3). Agents never pass raw ids. Strict-provider note: the tool schema is the Zod `rememberBodySchema` on `REMEMBER_RUNTIME_CAPABILITY` (`apps/api/src/workflow/workflow-runtime/workflow-runtime-capability.contracts.ts:214-237`); `scope` is ALREADY a `z.enum`, so widening the enum literal list is the established, provider-safe declaration pattern — no `anyOf`/`oneOf`, no format tricks. `bodyMapping` is field-name-based and needs no change.

**Files:**

- Modify: `packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts` (`rememberBodySchema.scope` :195)
- Test: `packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.spec.ts`
- Modify: `apps/api/src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.ts` (`ScopeParams.scope` :25-28 — retype to `RememberBody['scope']`, deleting the duplicated inline union)
- Modify: `apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts` (`remember` :242-292; constructor :55-64 gains `runRepo`/`workflowRepo`)
- Modify: `apps/api/src/workflow/workflow-runtime/workflow-runtime-capability.contracts.ts` (`REMEMBER_RUNTIME_CAPABILITY.description` :222-223 — document the four scopes and that ids are auto-resolved)
- Test: `apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.spec.ts`
- Verify: `apps/api/src/workflow/workflow-internal-tools/workflow-internal-tools.module.ts` — `MemoryToolsHandler`'s new repo dependencies resolve (`WorkflowRunRepository`/`WorkflowRepository` are provided + exported by `DatabaseModule`, `apps/api/src/database/database.module.ts:308,415`; add the module import only if it is not already in scope). Confirm DI wiring with the boot/module compile of `npm run build:api`.

**Interfaces:**

- Produces: `rememberBodySchema.scope: z.enum(["project", "global", "agent", "workflow"]).default("project")`; handler-private `resolveRememberScope(context: InternalToolExecutionContext, scope: RememberBody['scope']): Promise<{ ok: true; scopeId: string | null } | { ok: false }>`
- Consumes: `RecordLearningService.recordLearning(context, body, opts)` (unchanged — `scope_type` passes `learningScopeTypeSchema`, which already admits `agent`/`workflow`); `RememberWriteGuardService.checkBudgetAndNearDup(context, { content, scope })` (:54-64, type-widened only).

**Steps:**

- [ ] RED — append to `packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.spec.ts` (follow its existing parse-style assertions):

```ts
describe("rememberBodySchema scope values (Epic C)", () => {
  const base = {
    content: "The dev DB only accepts the nexus_dev role on port 5433.",
  };

  it.each(["project", "global", "agent", "workflow"] as const)(
    "accepts scope '%s'",
    (scope) => {
      const parsed = rememberBodySchema.parse({ ...base, scope });
      expect(parsed.scope).toBe(scope);
    },
  );

  it("rejects an unknown scope", () => {
    expect(() =>
      rememberBodySchema.parse({ ...base, scope: "team" }),
    ).toThrow();
  });
});
```

- [ ] Run: `npm run test --workspace=packages/core -- src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.spec.ts` — `agent`/`workflow` cases FAIL.
- [ ] GREEN — change line 195 of `workflow-runtime-inputs.schemas.ts` to `scope: z.enum(["project", "global", "agent", "workflow"]).default("project"),`. Re-run — PASS. Rebuild: `npm run build --workspace=packages/core`.
- [ ] RED — add a new `describe` to `apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.spec.ts`. That file's existing factories build a full promotion stack; the new scope-resolution tests need only the `remember` path, so use a minimal direct-construction harness local to the new block (constructor order per `memory-tools.handler.ts:55-64` plus the two new repos):

```ts
describe("MemoryToolsHandler.remember scope resolution (Epic C)", () => {
  function makeRememberHarness() {
    const recordLearning = vi
      .fn()
      .mockResolvedValue({ created: true, candidate_id: "c1" });
    const runRepo = {
      findById: vi.fn().mockResolvedValue({ workflow_id: "wf-uuid" }),
    };
    const workflowRepo = {
      findById: vi
        .fn()
        .mockResolvedValue({ id: "wf-uuid", name: "work_item_implementation" }),
    };
    const handler = new MemoryToolsHandler(
      {} as never, // memoryManager
      { recordLearning } as never, // recordLearningService
      {} as never, // candidates
      {} as never, // learningPromotion
      {} as never, // proposals
      {} as never, // feedbackService
      { get: vi.fn().mockResolvedValue(0.6) } as never, // settings
      {
        checkBudgetAndNearDup: vi.fn().mockResolvedValue({ action: "proceed" }),
      } as never, // rememberWriteGuard
      runRepo as never, // runRepo (Epic C)
      workflowRepo as never, // workflowRepo (Epic C)
    );
    return { handler, recordLearning, runRepo, workflowRepo };
  }

  const content =
    "Always run nest build, never tsc, for the api workspace output.";

  it("scope 'agent' resolves scope_id from context.agentProfileName", async () => {
    const { handler, recordLearning } = makeRememberHarness();

    await handler.remember(
      {
        workflowRunId: "run-1",
        agentProfileName: "implementer-agent",
        scopeId: "proj-1",
      },
      {
        content,
        scope: "agent",
        memory_type: "fact",
        tags: [],
        origin: "discovery",
      },
    );

    expect(recordLearning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope_type: "agent",
        scope_id: "implementer-agent",
      }),
      expect.anything(),
    );
  });

  it("scope 'workflow' resolves scope_id to the run's workflow definition name", async () => {
    const { handler, recordLearning, runRepo } = makeRememberHarness();

    await handler.remember(
      {
        workflowRunId: "run-1",
        agentProfileName: "implementer-agent",
        scopeId: "proj-1",
      },
      {
        content,
        scope: "workflow",
        memory_type: "fact",
        tags: [],
        origin: "discovery",
      },
    );

    expect(runRepo.findById).toHaveBeenCalledWith("run-1");
    expect(recordLearning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope_type: "workflow",
        scope_id: "work_item_implementation",
      }),
      expect.anything(),
    );
  });

  it("returns created:false scope_unresolvable instead of writing when the id cannot be resolved", async () => {
    const { handler, recordLearning } = makeRememberHarness();

    const result = await handler.remember(
      { workflowRunId: "run-1", scopeId: "proj-1" }, // no agentProfileName
      {
        content,
        scope: "agent",
        memory_type: "fact",
        tags: [],
        origin: "discovery",
      },
    );

    expect(result).toEqual({
      created: false,
      reason: "scope_unresolvable",
      scope: "agent",
    });
    expect(recordLearning).not.toHaveBeenCalled();
  });

  it("scope 'project' keeps today's behavior (context.scopeId)", async () => {
    const { handler, recordLearning } = makeRememberHarness();

    await handler.remember(
      { workflowRunId: "run-1", scopeId: "proj-1" },
      {
        content,
        scope: "project",
        memory_type: "fact",
        tags: [],
        origin: "discovery",
      },
    );

    expect(recordLearning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope_type: "project", scope_id: "proj-1" }),
      expect.anything(),
    );
  });
});
```

- [ ] Run: `npm run test --workspace=apps/api -- src/workflow/workflow-internal-tools/handlers/memory-tools.handler.spec.ts` — new tests FAIL (constructor arity + resolution logic).
- [ ] NOTE: `memory-tools.handler.spec.ts` already constructs `new MemoryToolsHandler(...)` POSITIONALLY at several sites (:38, :165, :244, :345, …). After the constructor gains the two repos, append two benign mocks to EVERY existing construction site: `{ findById: vi.fn().mockResolvedValue(null) } as never, // runRepo` and `{ findById: vi.fn().mockResolvedValue(null) } as never, // workflowRepo` — the existing tests never use `scope: 'workflow'`, so null-resolving mocks keep them behaviorally identical.
- [ ] GREEN — `memory-tools.handler.ts`:
  - Constructor: append `private readonly runRepo: WorkflowRunRepository,` and `private readonly workflowRepo: WorkflowRepository,` (imports from `../../database/repositories/workflow-run.repository` and `../../database/repositories/workflow.repository`; the handler lives under `apps/api/src/workflow/`, so relative paths are `../../database/repositories/...`).
  - Replace the inline `const scopeId = params.scope === 'global' ? null : (context.scopeId ?? null);` (:259-260) with:

```ts
const scopeResolution = await this.resolveRememberScope(context, params.scope);
if (!scopeResolution.ok) {
  return { created: false, reason: "scope_unresolvable", scope: params.scope };
}
```

and pass `scope_id: scopeResolution.scopeId` to `recordLearning`. Add the private resolver:

```ts
  /**
   * Resolve the entity id for a `remember` scope from run context — agents
   * never supply raw ids (Epic C). `agent` → the calling profile's name;
   * `workflow` → the run's workflow definition name; `project` → the neutral
   * scopeId; `global` → null.
   */
  private async resolveRememberScope(
    context: InternalToolExecutionContext,
    scope: RememberBody['scope'],
  ): Promise<{ ok: true; scopeId: string | null } | { ok: false }> {
    if (scope === 'global') {
      return { ok: true, scopeId: null };
    }
    if (scope === 'agent') {
      const profileName = context.agentProfileName?.trim();
      return profileName ? { ok: true, scopeId: profileName } : { ok: false };
    }
    if (scope === 'workflow') {
      const workflowName = await resolveWorkflowNameForRun(
        this.runRepo,
        this.workflowRepo,
        context.workflowRunId,
        (message) => this.logger.warn(message),
      );
      return workflowName ? { ok: true, scopeId: workflowName } : { ok: false };
    }
    return { ok: true, scopeId: context.scopeId ?? null };
  }
```

- `remember-write-guard.service.ts`: change `ScopeParams` to `interface ScopeParams { content: string; scope: RememberBody['scope']; }` (import `RememberBody` type from `@nexus/core`) — no logic change; the guard treats non-global scopes uniformly.
- `workflow-runtime-capability.contracts.ts`: extend `REMEMBER_RUNTIME_CAPABILITY.description` to: `'Record a durable memory from a single agent call. scope targets project (default), global, agent (this agent profile), or workflow (this workflow definition) — scope ids are resolved from run context automatically. Writes a learning_candidate with fast-track promotion for user-approved memories.'`
- [ ] Run the handler spec — PASS. Then `npm run build --workspace=packages/core && npm run build:api` — clean (also verifies the module DI change compiles; if Nest DI fails at boot-spec level, add the missing repository providers/imports to `workflow-internal-tools.module.ts`).
- [ ] Commit: `git add -A && git commit -m "feat(runtime-tools): remember gains agent/workflow scopes with context-resolved ids (Epic C)"`

---

## Task 6 — Analyst routing: `scope_hint` gains `workflow_specific`

Extend the shared finding contract, map `workflow_specific` → workflow scope in `RetrospectiveOutputRouter` (resolving the workflow name from the original run — the port input `RetrospectiveRouteInput` at `retrospective-router.types.ts:24-28` stays UNCHANGED, so the orchestrator is untouched), and update the seeded analyst prompt. Rails preserved verbatim: `global` is never self-elected; a credential-bearing finding is forced to `project` BEFORE any hint mapping; `agent_preference` → agent behavior is byte-identical.

**Files:**

- Modify: `packages/core/src/retrospectives/retrospective-finding.schema.ts` (`RETROSPECTIVE_SCOPE_HINTS` :45-49)
- Test (Create): `packages/core/src/retrospectives/retrospective-finding.schema.spec.ts`
- Modify: `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.ts` (constants :69-73, constructor :107-112, `routeMemory` :161-189, `resolveScopeType` :317-328)
- Test: `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.spec.ts`
- Modify: `seed/workflows/prompts/run-retrospective/analyze.md` (finding shape :37 + a guidance bullet)
- Verify: `apps/api/src/database/seeds/workflow/run-retrospective.seed.contract.spec.ts` stays green (it asserts field NAMES only, :246-258) and `apps/api/src/workflow/workflow-retrospective/workflow-retrospective.module.ts` can inject the two repositories (provided by `DatabaseModule` — add the import only if absent).

**Interfaces:**

- Produces: `RETROSPECTIVE_SCOPE_HINTS = ["project", "global", "agent_preference", "workflow_specific"] as const;` and router-internal `resolveMemoryScope(finding, rail, scopeId, originalRunId): Promise<{ scopeType: string; scopeId: string | null }>`
- Consumes: `resolveWorkflowNameForRun` (Task 3); `RecordLearningService.recordLearning` (unchanged).

**Steps:**

- [ ] RED — create `packages/core/src/retrospectives/retrospective-finding.schema.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  RETROSPECTIVE_SCOPE_HINTS,
  retrospectiveFindingSchema,
} from "./retrospective-finding.schema";

describe("retrospectiveFindingSchema scope hints (Epic C)", () => {
  it("admits workflow_specific alongside the existing hints", () => {
    expect(RETROSPECTIVE_SCOPE_HINTS).toEqual([
      "project",
      "global",
      "agent_preference",
      "workflow_specific",
    ]);

    const parsed = retrospectiveFindingSchema.parse({
      kind: "memory",
      lesson: "This workflow's retry budget masks the real failure.",
      root_cause: "quality gate timeout",
      fix: "raise the step timeout",
      scope_hint: "workflow_specific",
      confidence_self: 0.4,
      evidence_event_ids: ["evt-1"],
    });
    expect(parsed.scope_hint).toBe("workflow_specific");
  });
});
```

- [ ] Run: `npm run test --workspace=packages/core -- src/retrospectives/retrospective-finding.schema.spec.ts` — FAIL.
- [ ] GREEN — add `"workflow_specific",` to `RETROSPECTIVE_SCOPE_HINTS`; rebuild core (`npm run build --workspace=packages/core`). Re-run — PASS.
- [ ] RED — append to `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.spec.ts` (mirror the file's existing construction pattern — it builds the router with mocked `RecordLearningService`, `SkillImprovementProposalRepository`, `StruggleDetectorService`, `SystemSettingsService`; extend the local factory with the two new repo mocks in the same order as the updated constructor):

```ts
describe("scope_hint 'workflow_specific' (Epic C)", () => {
  it("routes to workflow scope keyed by the original run's workflow definition name", async () => {
    const { router, recordLearning, runRepo } = buildRouter({
      runRepo: {
        findById: vi.fn().mockResolvedValue({ workflow_id: "wf-uuid" }),
      },
      workflowRepo: {
        findById: vi
          .fn()
          .mockResolvedValue({ id: "wf-uuid", name: "auto_merge_default" }),
      },
    });

    await router.route({
      finding: makeFinding({ kind: "memory", scope_hint: "workflow_specific" }),
      scopeId: "proj-1",
      originalRunId: "run-1",
    });

    expect(runRepo.findById).toHaveBeenCalledWith("run-1");
    expect(recordLearning.recordLearning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope_type: "workflow",
        scope_id: "auto_merge_default",
      }),
      expect.anything(),
    );
  });

  it("falls back to project scope when the workflow name cannot be resolved", async () => {
    const { router, recordLearning } = buildRouter({
      runRepo: { findById: vi.fn().mockResolvedValue(null) },
      workflowRepo: { findById: vi.fn() },
    });

    await router.route({
      finding: makeFinding({ kind: "memory", scope_hint: "workflow_specific" }),
      scopeId: "proj-1",
      originalRunId: "run-1",
    });

    expect(recordLearning.recordLearning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope_type: "project", scope_id: "proj-1" }),
      expect.anything(),
    );
  });

  it("credential rail still forces project even with a workflow_specific hint", async () => {
    const { router, recordLearning } = buildRouter({
      runRepo: { findById: vi.fn() },
      workflowRepo: { findById: vi.fn() },
    });

    await router.route({
      finding: makeFinding({
        kind: "memory",
        scope_hint: "workflow_specific",
        lesson: "set DB_PASSWORD=hunter2-super-secret in the gate env",
      }),
      scopeId: "proj-1",
      originalRunId: "run-1",
    });

    expect(recordLearning.recordLearning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope_type: "project" }),
      expect.anything(),
    );
  });
});
```

If the existing spec has no shared `buildRouter`/`makeFinding` factories, add them at the top of the new `describe` following the file's established mock style (`recordLearning: { recordLearning: vi.fn() }`, `struggleDetector: { detect: vi.fn().mockResolvedValue([]) }`, `settings: { get: vi.fn((_k, d) => Promise.resolve(d)) }`, `proposals: { create: vi.fn() }`) — do NOT rewrite the existing tests, only extend the constructor arg list everywhere the router is constructed.

- [ ] Run: `npm run test --workspace=apps/api -- src/workflow/workflow-retrospective/retrospective-output-router.service.spec.ts` — new tests FAIL.
- [ ] GREEN — `retrospective-output-router.service.ts`:
  - Constants: add `const SCOPE_WORKFLOW = 'workflow';` and `const SCOPE_HINT_WORKFLOW_SPECIFIC = 'workflow_specific';` next to :70-72.
  - Constructor: append `private readonly runRepo: WorkflowRunRepository,` / `private readonly workflowRepo: WorkflowRepository,` (imports `../database/repositories/workflow-run.repository`, `../database/repositories/workflow.repository`, and `resolveWorkflowNameForRun` from `../workflow-run-name-resolver.helpers`).
  - Pure `resolveScopeType` (:317-328): add `if (scopeHint === SCOPE_HINT_WORKFLOW_SPECIFIC) { return SCOPE_WORKFLOW; }` after the agent branch (credential check stays FIRST — rail preserved).
  - `routeMemory` (:161-189): replace the two `scope_type`/`scope_id` inputs with a resolved pair:

```ts
  private async routeMemory(ctx: RouteContext): Promise<void> {
    const { finding, scopeId, originalRunId, rail, struggleBacked } = ctx;
    const scope = await this.resolveMemoryScope(finding, rail, scopeId, originalRunId);
    const tags = buildTags(struggleBacked, rail.credentialBearing);

    await this.recordLearning.recordLearning(
      { workflowRunId: originalRunId, jobId: SYNTHETIC_JOB_ID, scopeId },
      {
        scope_type: scope.scopeType,
        scope_id: scope.scopeId,
        lesson: rail.lesson,
        evidence: buildEvidence(finding.evidence_event_ids, originalRunId),
        confidence: ctx.confidence,
        tags,
      },
      {
        candidateType: CANDIDATE_TYPE,
        sourceTool: SOURCE_TOOL,
        sourceQualityConfidence: ctx.confidence,
      },
    );
  }

  /**
   * Map the hint to a concrete (scope_type, scope_id). `workflow_specific`
   * resolves the original run's workflow definition name; when unresolvable it
   * degrades to project scope (never dropped, never global). Credential-bearing
   * findings were already forced to project by resolveScopeType (Epic C).
   */
  private async resolveMemoryScope(
    finding: RetrospectiveFinding,
    rail: CredentialRailResult,
    scopeId: string | null,
    originalRunId: string,
  ): Promise<{ scopeType: string; scopeId: string | null }> {
    const scopeType = resolveScopeType(finding.scope_hint, rail.credentialBearing);
    if (scopeType !== SCOPE_WORKFLOW) {
      return { scopeType, scopeId };
    }
    const workflowName = await resolveWorkflowNameForRun(
      this.runRepo,
      this.workflowRepo,
      originalRunId,
      (message) => this.logger.warn(message),
    );
    return workflowName
      ? { scopeType: SCOPE_WORKFLOW, scopeId: workflowName }
      : { scopeType: SCOPE_PROJECT, scopeId };
  }
```

- [ ] Run the router spec — PASS (existing `agent_preference` and credential tests untouched and green).
- [ ] Update `seed/workflows/prompts/run-retrospective/analyze.md`:
  - Line 37 finding shape: `"scope_hint": "project | global | agent_preference | workflow_specific (your suggestion only; the router decides)",`
  - Add one bullet under "What counts as a finding", after the `Environment Facts` bullet: `- **Workflow-definition quirks**: lessons that only apply when running THIS workflow definition (step ordering, retry-budget traps, definition-specific tool behavior) — suggest `scope_hint: 'workflow_specific'` for these.`
- [ ] Run: `npm run test --workspace=apps/api -- src/database/seeds/workflow/run-retrospective.seed.contract.spec.ts` and `npm run validate:seed-data` — green.
- [ ] Commit: `git add -A && git commit -m "feat(retrospective): workflow_specific scope hint routes to workflow-scoped memory (Epic C)"`

---

## Task 7 — Governance regression pins: workflow-scoped segments behave identically

Spec §4.3: probation, contradiction/supersede, and feedback-weight tuning operate on segments REGARDLESS of scope with NO code changes. Pin that with regression tests (these are characterization pins — they should pass on first run; if any fails, STOP: that is a real scope-coupling bug to fix before proceeding).

**Files:**

- Test: `apps/api/src/memory/learning/memory-probation-evaluator.service.spec.ts` (reuse its `segment`/`build` harness at :46-96)
- Test: `apps/api/src/memory/learning/memory-contradiction.service.spec.ts` (self-contained addition; constructor order per `memory-contradiction.service.ts:57-63`)
- Feedback-weight note: `MemorySegmentFeedbackService.computeUsefulnessForSegments(segmentIds)` and the tuner (`apps/api/src/memory/signals/feedback-weight-tuner.*`) are keyed by segment ID with no `entity_type` access anywhere in their inputs — scope-blind by construction. Task 1's ranking test already exercises usefulness over a workflow-scoped segment id. No additional test file needed; do NOT add speculative coverage.

**Interfaces:** none new — tests only.

**Steps:**

- [ ] Append to `memory-probation-evaluator.service.spec.ts`:

```ts
describe("workflow-scoped segments (Epic C regression pin)", () => {
  it("confirms a workflow-scoped provisional segment identically to project scope", async () => {
    const workflowSegment = segment({
      id: "seg-wf",
      entity_type: "workflow",
      entity_id: "work_item_implementation",
    } as Partial<MemorySegment>);
    const usefulness = new Map([
      ["seg-wf", { usefulness: 0.9, sampleSize: 5 }],
    ]);
    const { service, repo } = build({
      segments: [workflowSegment],
      usefulness,
    });

    const counts = await service.runProbationPass(NOW);

    expect(repo.update).toHaveBeenCalledWith("seg-wf", {
      governance_state: "confirmed",
    });
    expect(counts).toEqual({ confirmed: 1, reverted: 0, held: 0 });
  });
});
```

- [ ] Append to `memory-contradiction.service.spec.ts` (imports per the existing file; if the file lacks a suitable factory, construct inline as shown):

```ts
describe("workflow-scoped segments (Epic C regression pin)", () => {
  it("scopes contradiction detection to the workflow entity pool", async () => {
    const settings = {
      get: vi.fn(async (key: string, fallback: unknown) =>
        key === MEMORY_CONTRADICTION_ENABLED_SETTING ? true : fallback,
      ),
    };
    const findByEntity = vi
      .fn()
      .mockResolvedValue([
        {
          id: "existing-wf",
          content: "always run nest build",
          superseded_by: null,
        },
      ]);
    const similarity = { findNearest: vi.fn().mockResolvedValue([]) };
    const eventLedger = { emitBestEffort: vi.fn() };
    const service = new MemoryContradictionService(
      similarity as unknown as ICandidateSimilarity,
      { findByEntity } as unknown as MemorySegmentRepository,
      eventLedger as unknown as EventLedgerService,
      settings as unknown as SystemSettingsService,
    );

    const decision = await service.evaluateCreatedSegment({
      id: "new-wf",
      content: "never run tsc directly",
      entity_type: "workflow",
      entity_id: "work_item_implementation",
      version: 1,
    });

    expect(findByEntity).toHaveBeenCalledWith(
      "workflow",
      "work_item_implementation",
    );
    expect(decision.kind).toBe("none"); // no near neighbour → no contradiction
  });
});
```

- [ ] Run: `npm run test --workspace=apps/api -- src/memory/learning/memory-probation-evaluator.service.spec.ts src/memory/learning/memory-contradiction.service.spec.ts` — both PASS with zero production changes. Any failure = scope coupling; investigate with `superpowers:systematic-debugging` before touching governance code.
- [ ] Commit: `git add -A && git commit -m "test(memory): pin scope-agnostic governance behavior for workflow-scoped segments (Epic C)"`

---

## Task 8 — Documentation

**Files:**

- Modify: `docs/guide/35-memory-learning.md` (the memory guide page — sibling of `docs/guide/memory-token-budget-resolver.md`)

**Steps:**

- [ ] Add a `## Memory Scopes & Recall Union (Epic C)` section to `docs/guide/35-memory-learning.md` covering, concisely:
  - The scope key: `entity_type`/`entity_id` with the recognized scope rows — `global` (entity_id n/a), `project` (`scopeId`), `agent` (agent profile name), `workflow` (workflow definition name). One memory targets exactly ONE scope; genuinely multi-workflow knowledge belongs in `project`. `skill`-scoped recall is a noted future extension (not recalled today).
  - Recall union: `MemoryRetrievalService.fetchCandidateSegments` pools `global + project(scopeId) + agent(agentProfileName) + workflow(workflowName)`; identity is threaded from the step context (`StepSupportService.buildPromotedLearningContext` → `resolvePromotedLessonsForInjection`); the legacy recency fallback performs the same union. Downstream ranking (RRF × recency × usefulness × pinned, token-budget trim) unchanged. Subagent prompts still receive no promoted-learning section (documented stub in `SubagentPromptContextService`).
  - Write paths: `remember` `scope: project|global|agent|workflow` with ids auto-resolved from run context (unresolvable → `created:false, reason:'scope_unresolvable'`); analyst `scope_hint: workflow_specific` → workflow scope via `RetrospectiveOutputRouter` (credential-bearing still forced to project; `global` never self-elected).
  - Governance: `workflow` routing target uses the project tier (0.5 floor, provisional + probation); probation/contradiction/feedback-weight are scope-agnostic.
- [ ] Update the scope table/prose anywhere else in that page that currently says recall is "project + global" only.
- [ ] Commit: `git add -A && git commit -m "docs(guide): memory scopes and recall union for agent/workflow targeting (Epic C)"`

---

## Task 9 — Full verification gate

**Steps:**

- [ ] `npm run build --workspace=packages/core` — clean.
- [ ] `npm run build:api` — clean (`nest build`, verifies DI + typing across all touched modules).
- [ ] `npm run test --workspace=packages/core` — full core suite green.
- [ ] `npm run test:api` — full api unit suite green. WARNING (memory note `project_integration_tests_truncate_live_db`): ensure `DB_HOST` is NOT set in the shell, or the integration project's drift/gitops specs will TRUNCATE the live dev DB; the plain `test:api` script runs `--project unit` only, but verify the invocation before running.
- [ ] `npm run lint:api` and `npm run lint --workspace=packages/core` — zero warnings/errors, no suppressions added anywhere (grep the diff: `git diff main -- ':!docs' | grep -E 'eslint-disable|ts-ignore|ts-nocheck'` must return nothing).
- [ ] `npm run validate:seed-data` — green (analyst prompt change).
- [ ] Self code-review of `git diff main`: no re-exports, no Kanban identifiers in api/core, every new exported type in a `*.types.ts` file, all touched files < 500 lines.
- [ ] Commit any review fixes, then hand off per `superpowers:finishing-a-development-branch` (merge/PR decision belongs to the operator — do not push or merge unprompted).

---

## Spec §4.3 Coverage & Resolved Ambiguities

| Spec §4.3 item                                                                                                                           | Where                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Recall union `global + project + agent + workflow`                                                                                       | Task 1                                                     |
| Identity resolved from step context via `buildPromotedLearningContext` → `resolvePromotedLessonsForInjection`                            | Tasks 2–3                                                  |
| Legacy fallback gets the same union                                                                                                      | Task 2                                                     |
| Downstream ranking unchanged                                                                                                             | Tasks 1–2 (no ranking code touched)                        |
| New `workflow` scope: `resolveSegmentDestination` branch + governance like `project`                                                     | Task 4                                                     |
| `remember` gains `agent`/`workflow`, ids auto-resolved, agents never supply ids                                                          | Task 5                                                     |
| Analyst `scope_hint` + `workflow_specific`; `agent_preference` unchanged; rails (no self-elected global, credential → project) unchanged | Task 6                                                     |
| One-scope-per-memory simplification (no tag lists)                                                                                       | Global constraint; no multi-target API introduced anywhere |
| Skill-scoped recall deferred                                                                                                             | Global constraint (explicitly not built)                   |
| Governance operates on new scopes with no changes + regression proof                                                                     | Task 7                                                     |
| Docs                                                                                                                                     | Task 8                                                     |

**Deviations / judgment calls (flag to reviewer):**

1. **Cross-pool recency sort (Task 1)** — the spec is silent on fallback ordering; without it the enlarged project pool would starve the new pools in recency mode. Additive, covered by a dedicated test.
2. **`retrospective-analysis.service.ts:284` (`isAlreadyKnown` dedup) intentionally unchanged** — it is the only other `retrieve({` caller. Widening the dedup pool to workflow scope could suppress a genuine project-level finding because a similar workflow-scoped memory exists (different blast radius). Left as project+global; noted as a possible follow-up.
3. **Subagent promoted-learning injection stays a stub** — Epic C threads the identity fields through the shared interface (both paths), but implementing subagent injection is the pre-existing deferred follow-up documented in `SubagentPromptContextService`; building it here would exceed the epic's scope.
4. **`scope_unresolvable` result for `remember`** — the spec doesn't define behavior when context lacks the id (e.g. no `agentProfileName`). Chosen: refuse loudly (`created:false`) rather than silently falling back to project scope, matching the "agents never supply raw ids / no silent mis-scoping" intent.
5. **Explicit `agent`-scoped `remember` candidates** keep today's router behavior (they are preserved by `resolveSegmentDestination`'s scope_type fallback; only `workflow` gets a dedicated routing target because the scope-diversity pass would otherwise rewrite it to `project`). Aligning `agent` captures with the `agent_preference` 0.8 governance tier is out of scope — flagged for the reviewer.
