# EPIC-212 Task 11a — Sweep Contract, Write-Guard, Grants (Backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `listPendingCandidates` to return rich ranked candidates with an honest count, upgrade `remember` with near-dup write-guard + per-job budget, update the sweep prompt, and roll `remember` to the full profile floor with contract tests.

**Architecture:**

- `listPendingCandidates` returns `signals_json` + `recurrence_count` + `total_sweep_eligible` (post-filter count).
- A new `RememberWriteGuardService` encapsulates per-job budget enforcement and near-dup reinforcement via `ICandidateSimilarity`, keeping `MemoryToolsHandler` under the 500-line eslint limit.
- `CANDIDATE_SIMILARITY` is re-exported from `MemoryModule` so `WorkflowInternalToolsModule` can inject it without importing `MemorySignalsModule` directly.

**Tech Stack:** NestJS, TypeORM, Vitest/SWC, YAML seed files, TypeScript strict

## Global Constraints

- No `eslint-disable`/`@ts-ignore`; `max-lines: 500` (skip blank+comments); `max-lines-per-function: 120`; `complexity ≤ 14`
- Exported interfaces/types only in `*.types.ts` files
- Kanban-neutral — no kanban identifiers in API/core code
- TDD: failing test first, minimal impl, green, refactor, commit
- Run targeted tests during iteration; do NOT run full suite until the end
- Working directory: `G:\code\AI\nexus-orchestator\.worktrees\epic-212-memory-learning-loop`
- Commit after each task

---

## File Map

| Action | Path                                                                                          |
| ------ | --------------------------------------------------------------------------------------------- |
| Modify | `apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts`              |
| Modify | `apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.list-pending.spec.ts`    |
| Create | `apps/api/src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.ts`      |
| Create | `apps/api/src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.spec.ts` |
| Modify | `apps/api/src/workflow/workflow-internal-tools/workflow-internal-tools.module.ts`             |
| Modify | `apps/api/src/memory/database/repositories/learning-candidate.repository.ts`                  |
| Modify | `apps/api/src/memory/memory.module.ts`                                                        |
| Modify | `apps/api/src/settings/system-settings.defaults.ts`                                           |
| Modify | `seed/workflows/prompts/memory-learning-sweep/sweep.md`                                       |
| Modify | `seed/agents/qa_automation/agent.json`                                                        |
| Modify | `seed/agents/testing-agent/agent.json`                                                        |
| Modify | `seed/agents/staff_engineer/agent.json`                                                       |
| Modify | `seed/agents/software-engineer-assistant/agent.json`                                          |
| Modify | `seed/workflows/automated-quality-check.workflow.yaml`                                        |
| Modify | `seed/workflows/work-item-in-review-default.workflow.yaml`                                    |
| Modify | `seed/workflows/work-item-in-progress-default.workflow.yaml`                                  |
| Modify | `seed/workflows/work-item-refinement-default.workflow.yaml`                                   |
| Modify | `seed/workflows/documentation-audit.workflow.yaml`                                            |
| Modify | `seed/workflows/conversational-artifact-steering.workflow.yaml`                               |
| Modify | `seed/workflows/workflow-failure-doctor.workflow.yaml`                                        |
| Modify | `seed/workflows/nightly_ci_qa.workflow.yaml`                                                  |
| Modify | `apps/api/src/database/seeds/workflow/remember-tool-grants.seed.contract.spec.ts`             |

---

## Task 1: `listPendingCandidates` — rich fields + honest count

**Files:**

- Modify: `apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts`
- Modify: `apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.list-pending.spec.ts`

**Context:** The current `listPendingCandidates` response omits `signals_json` and `recurrence_count` (needed by the sweep agent for provenance-based trust and rank-to-budget selection). The `total` is the pre-template-filter DB count, which misrepresents the actual sweep-eligible set. `status='merged'` rows produced by the clusterer are already excluded because the DB query filters `statuses: ['pending']`; this stays unchanged.

**Honest-count decision:** Add `total_sweep_eligible: sweepCandidates.length` as the post-template-filter count of the current page. Keep `total` as the raw DB pending count (needed for pagination). The sweep agent should use `total_sweep_eligible` to know the actual work volume.

**Interfaces:**

- `listPendingCandidates` returns `{ items, total, total_sweep_eligible, limit, offset }`
- Each `item` adds `signals_json` and `recurrence_count`

- [ ] **Step 1: Write failing test for `signals_json` + `recurrence_count` in items**

Add to `memory-tools.list-pending.spec.ts` (after the last existing test block):

```typescript
describe("MemoryToolsHandler.listPendingCandidates — rich fields", () => {
  it("includes signals_json and recurrence_count in each returned item", async () => {
    const candidate = buildCandidate(
      "cand-rich",
      "Use explicit timeout on run_command to prevent watchdog reap",
      "Always set timeout_ms on run_command.",
    );
    candidate.signals_json = {
      lesson: "Always set timeout_ms",
      provenance: { tool: "remember" },
    };
    candidate.recurrence_count = 3;
    candidate.score = 0.85;

    const handler = buildHandler([candidate]);
    const result = (await handler.listPendingCandidates({})) as {
      items: Array<{
        id: string;
        signals_json: unknown;
        recurrence_count: number;
        score: number;
      }>;
      total: number;
      total_sweep_eligible: number;
    };

    expect(result.items).toHaveLength(1);
    expect(result.items[0].signals_json).toEqual(candidate.signals_json);
    expect(result.items[0].recurrence_count).toBe(3);
    expect(result.items[0].score).toBe(0.85);
  });

  it("returns total_sweep_eligible equal to post-template-filter count", async () => {
    const handler = buildHandler([ACTIONABLE_CANDIDATE, TEMPLATE_RECURRING]);

    const result = (await handler.listPendingCandidates({})) as {
      total: number;
      total_sweep_eligible: number;
    };

    expect(result.total).toBe(2); // raw DB count from mock
    expect(result.total_sweep_eligible).toBe(1); // only actionable passes template filter
  });

  it("returns score-ordered items (repository orders by score DESC)", async () => {
    // The repository already orders by score DESC; listPendingCandidates preserves that order.
    const lowScore = buildCandidate(
      "cand-low",
      "Low score lesson",
      "Low score lesson content text.",
    );
    lowScore.score = 0.2;
    const highScore = buildCandidate(
      "cand-high",
      "High score lesson",
      "High score lesson content text.",
    );
    highScore.score = 0.9;

    // Mock returns them in DB order (already score-ordered)
    const handler = buildHandler([highScore, lowScore]);
    const result = (await handler.listPendingCandidates({})) as {
      items: Array<{ id: string; score: number }>;
    };

    expect(result.items[0].id).toBe("cand-high");
    expect(result.items[1].id).toBe("cand-low");
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
cd /g/code/AI/nexus-orchestator/.worktrees/epic-212-memory-learning-loop
npm run test --workspace=apps/api -- src/workflow/workflow-internal-tools/handlers/memory-tools.list-pending.spec.ts
```

Expected: FAIL — `signals_json`, `recurrence_count`, and `total_sweep_eligible` are missing from the response.

- [ ] **Step 3: Update `listPendingCandidates` in `memory-tools.handler.ts`**

Replace the `listPendingCandidates` method (lines 364–403):

```typescript
async listPendingCandidates(params: {
  limit?: number;
  offset?: number;
}): Promise<Record<string, unknown>> {
  const limit = Number(params.limit) || 100;
  const offset = Number(params.offset) || 0;
  const { data, total } = await this.candidates.list({
    statuses: ['pending'],
    limit,
    offset,
  });

  // Exclude template-classified rows from the sweep queue.
  // Template rows are not deleted — they still accumulate recurrence_count
  // for future scoring — but content-free noise must never reach the sweep
  // agent to waste a promotion slot.
  const sweepCandidates = data.filter(
    (candidate) => !classifyTemplateNoise(candidate).isTemplate,
  );

  return {
    items: sweepCandidates.map((candidate) => ({
      id: candidate.id,
      scope_type: candidate.scope_type,
      scope_id: candidate.scopeId,
      candidate_type: candidate.candidate_type,
      title: candidate.title,
      summary: candidate.summary,
      fingerprint: candidate.fingerprint,
      signals_json: candidate.signals_json,
      recurrence_count: candidate.recurrence_count,
      score: candidate.score,
      confidence: candidate.confidence,
      status: candidate.status,
      created_at: candidate.created_at,
      updated_at: candidate.updated_at,
    })),
    // total: raw DB pending count (for pagination)
    total,
    // total_sweep_eligible: post-template-filter count (actual sweep work volume)
    total_sweep_eligible: sweepCandidates.length,
    limit,
    offset,
  };
}
```

- [ ] **Step 4: Run the tests again to verify they pass**

```bash
npm run test --workspace=apps/api -- src/workflow/workflow-internal-tools/handlers/memory-tools.list-pending.spec.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /g/code/AI/nexus-orchestator/.worktrees/epic-212-memory-learning-loop
git add apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts \
        apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.list-pending.spec.ts
git commit -m "feat(memory): enrich listPendingCandidates with signals_json, recurrence_count, score and add total_sweep_eligible honest count"
```

---

## Task 2: Update sweep.md prompt

**Files:**

- Modify: `seed/workflows/prompts/memory-learning-sweep/sweep.md`

**Context:** The current sweep.md calls `list_pending_learning_candidates` and processes candidates in list order with no ranking guidance, and treats all provenance equally. The upgraded `listPendingCandidates` now returns `score`-ordered results with `signals_json`, enabling top-ranked-to-budget processing and higher-trust processing for `struggle_backed`/`agent_capture` candidates.

**Note:** No automated test for prompt changes — validated via `npm run validate:seed-data`.

- [ ] **Step 1: Replace the content of `sweep.md`**

Write the entire file:

```markdown
You are the Memory Learning Sweep Agent.

Your primary objective is to review the highest-ranked pending learning
candidates, evaluate whether they contain generic, useful, and high-quality
learnings, promote the good ones to persistent project memory, and if they
suggest improvements to existing skills or new capabilities, generate skill
proposals.

## Input ranking and budget

Candidates are returned **pre-sorted by score DESC** by `list_pending_learning_candidates`.
Only process the **top candidates up to the token budget** (default: 20 candidates per
sweep). Do not waste tokens on long-tail low-score candidates when the sweep budget
allows for one high-quality review cycle.

## Provenance trust levels

| `candidate_type` / `source.tool` in `signals_json` | Trust level | Guidance                                                                                |
| -------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| `struggle_backed`                                  | High        | Battle-tested signal from real failure chains. Promote unless content is clearly noise. |
| `agent_capture` (remember tool)                    | High        | Evidence-backed, agent-authored capture. Promote unless too vague or duplicates memory. |
| `runtime_learning`                                 | Medium      | Standard automated capture. Apply normal evaluation criteria.                           |

## Execution process

1. Call `list_pending_learning_candidates` (optionally with `limit: 20`) to retrieve the top-ranked batch.
2. For each candidate in the returned `items` array (already score-ranked, highest first):
   - Inspect `candidate_type` and `signals_json.source.tool` to determine trust level.
   - For **high-trust** candidates (`struggle_backed`, `agent_capture`): promote unless the
     content is clearly a template fragment, pure noise, or duplicates existing memory.
   - For **medium/low-trust** candidates: apply normal evaluation:
     - Reject if it contains only noise, useless logging, placeholders, or duplicated content.
     - Promote if it contains meaningful, generalizable lessons, context, patterns, or preferences.
   - If rejecting: call `reject_learning_candidate` with the candidate's `id`.
   - If promoting: call `promote_learning_candidate` with the candidate's `id`.
   - After promoting: if the candidate suggests a clear skill improvement, call
     `create_skill_proposal` with:
     - `candidate_id`: the promoted candidate's ID
     - `target_skill_name`: the skill to create or improve
     - `proposal_title`: a short, descriptive title
     - `proposal_summary`: why this change is suggested
     - `patch_markdown`: the proposed changes/markdown for the skill
     - `rationale`: the technical explanation of what patterns this solves
3. Track total counts of promoted candidates and skill proposals created.
4. Call `set_job_output` with your final counts:
   `{"data": {"promotedCandidates": <number>, "createdSkillProposals": <number>}}`
5. Call `step_complete` to finalize your job execution.
```

- [ ] **Step 2: Validate seed data**

```bash
cd /g/code/AI/nexus-orchestator/.worktrees/epic-212-memory-learning-loop
npm run validate:seed-data
```

Expected: PASS (no prompt-contract failures for the sweep workflow).

- [ ] **Step 3: Commit**

```bash
git add seed/workflows/prompts/memory-learning-sweep/sweep.md
git commit -m "feat(memory): update sweep prompt to consume ranked-to-budget candidates and trust high-provenance sources"
```

---

## Task 3: `remember` budget enforcement — `memory_capture_max_per_job`

**Files:**

- Modify: `apps/api/src/settings/system-settings.defaults.ts`
- Modify: `apps/api/src/memory/database/repositories/learning-candidate.repository.ts`
- Create: `apps/api/src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.ts`
- Create: `apps/api/src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.spec.ts`
- Modify: `apps/api/src/workflow/workflow-internal-tools/workflow-internal-tools.module.ts`
- Modify: `apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts`

**Context:** Phase 0 does not cap how many `agent_capture` candidates a single job can create, allowing a runaway agent to flood the queue. We enforce `memory_capture_max_per_job` (default 8) by counting existing `agent_capture` rows for the same `(workflowRunId, jobId)` and returning early when the cap is reached.

**Interfaces:**

- `RememberWriteGuardService.checkBudget(context)` → `{ exhausted: true, reason: 'budget_exhausted' } | { exhausted: false }`
- `LearningCandidateRepository.countAgentCaptureByJob(workflowRunId, jobId)` → `number`

- [ ] **Step 1: Add `memory_capture_max_per_job` to system-settings.defaults.ts**

In `system-settings.defaults.ts`, inside the EPIC-212 Phase 0 section (after the existing `memory_capture_default_confidence` entry), add:

```typescript
  memory_capture_max_per_job: {
    value: 8,
    description:
      'Maximum number of agent_capture learning candidates the `remember` tool may create per job. When the cap is reached, subsequent `remember` calls return {created:false, reason:"budget_exhausted"} without inserting. Default 8 prevents runaway agents from flooding the learning queue.',
  },
```

- [ ] **Step 2: Write failing tests for budget enforcement**

Create `apps/api/src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.spec.ts`:

```typescript
/**
 * Unit tests for RememberWriteGuardService.
 *
 * Tests budget enforcement and near-dup reinforcement in isolation.
 * ICandidateSimilarity is mocked here; the real similarity stack is
 * tested in its own specs.
 */
import { describe, expect, it, vi } from "vitest";
import type { InternalToolExecutionContext } from "@nexus/core";
import { RememberWriteGuardService } from "./remember-write-guard.service";

const BUDGET_SETTING_KEY = "memory_capture_max_per_job";
const DEFAULT_BUDGET = 8;

function buildContext(
  overrides: Partial<InternalToolExecutionContext> = {},
): InternalToolExecutionContext {
  return {
    workflowRunId: "run-abc",
    jobId: "job-xyz",
    scopeId: "scope-1",
    agentProfileName: "senior_dev",
    userId: "user-1",
    ...overrides,
  } as InternalToolExecutionContext;
}

function buildService(opts: {
  capturedCount: number;
  budget?: number;
  similarityResult?: Array<{
    ownerType: string;
    ownerId: string;
    score: number;
  }>;
  candidateForReinforce?: { id: string; recurrence_count: number } | null;
}): RememberWriteGuardService {
  const {
    capturedCount,
    budget = DEFAULT_BUDGET,
    similarityResult = [],
    candidateForReinforce = null,
  } = opts;

  const candidates = {
    countAgentCaptureByJob: vi.fn().mockResolvedValue(capturedCount),
    findById: vi.fn().mockResolvedValue(candidateForReinforce),
    updateById: vi.fn().mockResolvedValue(candidateForReinforce),
    list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  };

  const settings = {
    get: vi.fn((key: string, def: unknown) => {
      if (key === BUDGET_SETTING_KEY) return Promise.resolve(budget);
      return Promise.resolve(def);
    }),
  };

  const similarity = {
    findNearest: vi.fn().mockResolvedValue(similarityResult),
  };

  return new RememberWriteGuardService(
    candidates as never,
    settings as never,
    similarity as never,
  );
}

describe("RememberWriteGuardService — budget enforcement", () => {
  it("returns budget_exhausted when captured count equals the budget", async () => {
    const service = buildService({ capturedCount: 8, budget: 8 });
    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: "Use retry on flaky tests",
      scope: "project",
    });
    expect(result).toEqual({ action: "budget_exhausted" });
  });

  it("returns budget_exhausted when captured count exceeds budget", async () => {
    const service = buildService({ capturedCount: 10, budget: 8 });
    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: "Use retry on flaky tests",
      scope: "project",
    });
    expect(result).toEqual({ action: "budget_exhausted" });
  });

  it("allows insert when under budget", async () => {
    const service = buildService({ capturedCount: 3, budget: 8 });
    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: "Use retry on flaky tests, set timeout_ms on run_command",
      scope: "project",
    });
    expect(result).toEqual({ action: "proceed" });
  });

  it("skips budget check when workflowRunId or jobId is absent", async () => {
    const service = buildService({ capturedCount: 100, budget: 8 });
    const result = await service.checkBudgetAndNearDup(
      buildContext({ workflowRunId: undefined, jobId: undefined }),
      {
        content: "Use retry on flaky tests, set timeout_ms on run_command",
        scope: "project",
      },
    );
    // No context to count against — proceed
    expect(result).toEqual({ action: "proceed" });
  });
});

describe("RememberWriteGuardService — near-dup reinforcement", () => {
  it("reinforces an existing candidate when similarity >= threshold", async () => {
    const existingCandidate = { id: "cand-existing", recurrence_count: 2 };
    const service = buildService({
      capturedCount: 0,
      similarityResult: [
        {
          ownerType: "learning_candidate",
          ownerId: "cand-existing",
          score: 0.9,
        },
      ],
      candidateForReinforce: existingCandidate as never,
    });

    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content:
        "Some lesson about retries that nearly duplicates an existing one",
      scope: "project",
    });

    expect(result).toEqual({
      action: "reinforced",
      candidateId: "cand-existing",
    });
  });

  it("proceeds to insert when no similar candidate found", async () => {
    const service = buildService({ capturedCount: 0, similarityResult: [] });
    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content:
        "A completely novel lesson about build timeouts and infrastructure",
      scope: "project",
    });
    expect(result).toEqual({ action: "proceed" });
  });

  it("proceeds to insert when similarity is below threshold", async () => {
    const existingCandidate = { id: "cand-other", recurrence_count: 1 };
    const service = buildService({
      capturedCount: 0,
      similarityResult: [
        { ownerType: "learning_candidate", ownerId: "cand-other", score: 0.5 },
      ],
      candidateForReinforce: existingCandidate as never,
    });

    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: "A lesson about different topic entirely",
      scope: "project",
    });
    expect(result).toEqual({ action: "proceed" });
  });

  it("falls back to proceed when similarity service throws", async () => {
    const candidates = {
      countAgentCaptureByJob: vi.fn().mockResolvedValue(0),
      findById: vi.fn().mockResolvedValue(null),
      updateById: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    };
    const settings = {
      get: vi.fn((_key: string, def: unknown) => Promise.resolve(def)),
    };
    const brokenSimilarity = {
      findNearest: vi
        .fn()
        .mockRejectedValue(new Error("embedding service down")),
    };

    const service = new RememberWriteGuardService(
      candidates as never,
      settings as never,
      brokenSimilarity as never,
    );

    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: "A lesson about handling errors in embedding services",
      scope: "project",
    });
    // Fail-soft: similarity error → fall through to insert
    expect(result).toEqual({ action: "proceed" });
  });

  it("skips near-dup check for global scope (no scopeId to search)", async () => {
    const service = buildService({
      capturedCount: 0,
      similarityResult: [
        { ownerType: "learning_candidate", ownerId: "cand-x", score: 0.99 },
      ],
    });

    const result = await service.checkBudgetAndNearDup(
      buildContext({ scopeId: undefined }),
      {
        content: "A global scope lesson, very long content to pass min length",
        scope: "global",
      },
    );
    // global scope has no candidates to reinforce against
    expect(result).toEqual({ action: "proceed" });
  });
});
```

- [ ] **Step 3: Run the failing tests**

```bash
npm run test --workspace=apps/api -- src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.spec.ts
```

Expected: FAIL — `RememberWriteGuardService` does not exist.

- [ ] **Step 4: Add `countAgentCaptureByJob` to `LearningCandidateRepository`**

In `apps/api/src/memory/database/repositories/learning-candidate.repository.ts`, add after `countByStatuses`:

```typescript
  /**
   * Count agent_capture candidates created in a specific workflow run and job.
   * Used by the per-job write-budget guard on the remember tool.
   * Queries signals_json JSONB provenance fields.
   */
  async countAgentCaptureByJob(
    workflowRunId: string,
    jobId: string,
  ): Promise<number> {
    return this.repository
      .createQueryBuilder('candidate')
      .where('candidate.candidate_type = :type', { type: 'agent_capture' })
      .andWhere(
        "candidate.signals_json -> 'provenance' ->> 'workflowRunId' = :runId",
        { runId: workflowRunId },
      )
      .andWhere(
        "candidate.signals_json -> 'provenance' ->> 'jobId' = :jobId",
        { jobId },
      )
      .getCount();
  }
```

- [ ] **Step 5: Create `RememberWriteGuardService`**

Create `apps/api/src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.ts`:

```typescript
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import type { InternalToolExecutionContext } from "@nexus/core";
import { LearningCandidateRepository } from "../../../memory/database/repositories/learning-candidate.repository";
import { SystemSettingsService } from "../../../settings/system-settings.service";
import { CANDIDATE_SIMILARITY } from "../../../memory/signals/candidate-similarity.interface";
import type {
  ICandidateSimilarity,
  CandidateSimilarityScope,
} from "../../../memory/signals/candidate-similarity.interface";
import {
  CANDIDATE_SIMILARITY_THRESHOLD_SETTING,
  CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT,
} from "../../../memory/signals/candidate-similarity.config";

const MEMORY_CAPTURE_MAX_PER_JOB_SETTING = "memory_capture_max_per_job";
const MEMORY_CAPTURE_MAX_PER_JOB_DEFAULT = 8;
const PENDING_STATUS = "pending";
const AGENT_CAPTURE_TYPE = "agent_capture";
const OWNER_TYPE = "learning_candidate";
const NEAR_DUP_SCOPE_CANDIDATE_LIMIT = 200;
const NEAR_DUP_K = 1;

type ScopeParams = { content: string; scope: "project" | "global" };

export type WriteGuardResult =
  | { action: "proceed" }
  | { action: "budget_exhausted" }
  | { action: "reinforced"; candidateId: string };

/**
 * Enforces two pre-insert guards on the `remember` (agent_capture) write path:
 *
 * 1. Per-job budget: if the run+job already has ≥ `memory_capture_max_per_job`
 *    agent_capture rows, return `budget_exhausted` without inserting.
 *
 * 2. Near-duplicate collapse: if an existing pending candidate in the same
 *    scope scores ≥ `candidate_similarity_threshold` via ICandidateSimilarity,
 *    reinforce it (bump last_seen_at + recurrence_count) instead of inserting.
 *    Similarity errors are fail-soft: on error the guard falls through to
 *    the normal insert path.
 */
@Injectable()
export class RememberWriteGuardService {
  private readonly logger = new Logger(RememberWriteGuardService.name);

  constructor(
    private readonly candidates: LearningCandidateRepository,
    private readonly settings: SystemSettingsService,
    @Optional()
    @Inject(CANDIDATE_SIMILARITY)
    private readonly similarity: ICandidateSimilarity | null,
  ) {}

  async checkBudgetAndNearDup(
    context: InternalToolExecutionContext,
    params: ScopeParams,
  ): Promise<WriteGuardResult> {
    const budgetResult = await this.checkBudget(context);
    if (budgetResult.action === "budget_exhausted") {
      return budgetResult;
    }

    return this.checkNearDup(context, params);
  }

  private async checkBudget(
    context: InternalToolExecutionContext,
  ): Promise<WriteGuardResult> {
    const runId = context.workflowRunId;
    const jobId = context.jobId;
    if (!runId || !jobId) {
      return { action: "proceed" };
    }

    const budget = await this.settings.get<number>(
      MEMORY_CAPTURE_MAX_PER_JOB_SETTING,
      MEMORY_CAPTURE_MAX_PER_JOB_DEFAULT,
    );
    const captured = await this.candidates.countAgentCaptureByJob(runId, jobId);
    if (captured >= budget) {
      return { action: "budget_exhausted" };
    }

    return { action: "proceed" };
  }

  private async checkNearDup(
    context: InternalToolExecutionContext,
    params: ScopeParams,
  ): Promise<WriteGuardResult> {
    if (!this.similarity) {
      return { action: "proceed" };
    }

    const scopeId =
      params.scope === "global" ? null : (context.scopeId ?? null);
    if (scopeId === null) {
      // Global scope: no bounded candidate set to search against
      return { action: "proceed" };
    }

    try {
      const scope = await this.buildSimilarityScope(scopeId);
      if (scope.ownerIds.length === 0) {
        return { action: "proceed" };
      }

      const threshold = await this.settings.get<number>(
        CANDIDATE_SIMILARITY_THRESHOLD_SETTING,
        CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT,
      );

      const neighbours = await this.similarity.findNearest(
        params.content,
        NEAR_DUP_K,
        scope,
      );

      const topNeighbour = neighbours[0];
      if (!topNeighbour || topNeighbour.score < threshold) {
        return { action: "proceed" };
      }

      return this.reinforceCandidate(topNeighbour.ownerId);
    } catch (error) {
      this.logger.warn(
        `Near-dup check failed (fail-soft, proceeding to insert): ${(error as Error).message}`,
      );
      return { action: "proceed" };
    }
  }

  private async buildSimilarityScope(
    scopeId: string,
  ): Promise<CandidateSimilarityScope> {
    const { data } = await this.candidates.list({
      statuses: [PENDING_STATUS],
      scopeId,
      limit: NEAR_DUP_SCOPE_CANDIDATE_LIMIT,
      offset: 0,
    });

    return {
      ownerType: OWNER_TYPE,
      ownerIds: data.map((c) => c.id),
    };
  }

  private async reinforceCandidate(
    candidateId: string,
  ): Promise<WriteGuardResult> {
    const existing = await this.candidates.findById(candidateId);
    if (!existing) {
      return { action: "proceed" };
    }

    await this.candidates.updateById(candidateId, {
      last_seen_at: new Date(),
      recurrence_count: existing.recurrence_count + 1,
    });

    return { action: "reinforced", candidateId };
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run test --workspace=apps/api -- src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.spec.ts
```

Expected: All tests PASS.

- [ ] **Step 7: Register `RememberWriteGuardService` in `WorkflowInternalToolsModule`**

In `workflow-internal-tools.module.ts`, add to the `providers` array:

```typescript
import { RememberWriteGuardService } from './handlers/remember-write-guard.service';
// ...
providers: [
  RememberWriteGuardService,
  MemoryToolsHandler,
  // ... rest of providers
],
```

- [ ] **Step 8: Wire `RememberWriteGuardService` into `MemoryToolsHandler.remember()`**

In `memory-tools.handler.ts`:

Add import:

```typescript
import { RememberWriteGuardService } from "./remember-write-guard.service";
```

Add to constructor (after `settings`):

```typescript
private readonly rememberWriteGuard: RememberWriteGuardService,
```

Replace the `remember` method body (keep the signature, replace the body):

```typescript
async remember(
  context: InternalToolExecutionContext,
  params: RememberBody,
): Promise<Record<string, unknown>> {
  const guardResult = await this.rememberWriteGuard.checkBudgetAndNearDup(
    context,
    { content: params.content, scope: params.scope },
  );

  if (guardResult.action === 'budget_exhausted') {
    return { created: false, reason: 'budget_exhausted' };
  }

  if (guardResult.action === 'reinforced') {
    return {
      created: false,
      reason: 'near_duplicate',
      candidate_id: guardResult.candidateId,
    };
  }

  const scopeId =
    params.scope === 'global' ? null : (context.scopeId ?? null);
  const confidence =
    params.confidence ??
    (await this.settings.get<number>(
      MEMORY_CAPTURE_DEFAULT_CONFIDENCE_SETTING,
      MEMORY_CAPTURE_DEFAULT_CONFIDENCE_FALLBACK,
    ));

  return this.recordLearningService.recordLearning(
    context,
    {
      scope_type: params.scope,
      scope_id: scopeId,
      lesson: params.content,
      evidence: [],
      confidence,
      tags: params.tags,
    },
    {
      candidateType: 'agent_capture',
      sourceTool: REMEMBER_SOURCE_TOOL,
      sourceQualityConfidence: AGENT_CAPTURE_SOURCE_QUALITY_CONFIDENCE,
      humanApprovedAt: params.origin === 'user_request' ? new Date() : null,
      signalsJsonExtra: {
        memory_type: params.memory_type,
        origin: params.origin,
      },
    },
  );
}
```

- [ ] **Step 9: Export `CANDIDATE_SIMILARITY` from `MemoryModule`**

In `apps/api/src/memory/memory.module.ts`, add to the `exports` array:

```typescript
import { CANDIDATE_SIMILARITY } from './signals/candidate-similarity.interface';
// ...
exports: [
  MemoryManagerService,
  // ... existing exports ...
  EmbeddingWriteEnqueueService,
  EmbeddingBackfillService,
  CANDIDATE_SIMILARITY,  // ← add this
],
```

- [ ] **Step 10: Run the existing memory-tools handler spec to confirm no regressions**

```bash
npm run test --workspace=apps/api -- src/workflow/workflow-internal-tools/handlers/memory-tools.handler.spec.ts
```

Expected: All tests PASS. (The constructor now has 8 params; existing tests pass `null as never` for the trailing optional `rememberWriteGuard` — which works because the tests don't exercise the `remember` method path via the guard.)

**IMPORTANT:** If the existing handler spec is currently passing `null as never` for `proposals` and `feedbackService`, it must also pass `null as never` for the new `rememberWriteGuard` param. The new param is the 8th positional arg; tests need to be updated to pass it (or leave it as a default).

Actually — the `RememberWriteGuardService` is now a constructor param. Any test that calls `new MemoryToolsHandler(...)` directly needs to pass the 8th arg. The existing spec already passes:

```ts
new MemoryToolsHandler(
  memoryManager, // 1
  recordLearning, // 2
  candidateRepository, // 3
  promotion, // 4
  null as never, // 5 (proposals)
  feedbackService, // 6
  settingsMock, // 7
);
```

Add `null as never` as the 8th arg to all direct `new MemoryToolsHandler(...)` calls in both spec files.

- [ ] **Step 11: Fix constructor calls in both spec files**

In `memory-tools.handler.spec.ts`, find each `new MemoryToolsHandler(...)` and add `null as never` as the 8th arg (for `rememberWriteGuard`).

In `memory-tools.list-pending.spec.ts`, `buildHandler` builds the handler — add `null as never` as 8th arg.

- [ ] **Step 12: Run both spec files together**

```bash
npm run test --workspace=apps/api -- src/workflow/workflow-internal-tools/handlers/memory-tools
```

Expected: All tests PASS.

- [ ] **Step 13: Run signals DI smoke test**

```bash
npm run test --workspace=apps/api -- src/memory/signals
```

Expected: All tests PASS.

- [ ] **Step 14: Commit**

```bash
git add \
  apps/api/src/settings/system-settings.defaults.ts \
  apps/api/src/memory/database/repositories/learning-candidate.repository.ts \
  apps/api/src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.ts \
  apps/api/src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.spec.ts \
  apps/api/src/workflow/workflow-internal-tools/workflow-internal-tools.module.ts \
  apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts \
  apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.spec.ts \
  apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.list-pending.spec.ts \
  apps/api/src/memory/memory.module.ts
git commit -m "feat(memory): add remember write-guard — per-job budget cap + near-dup reinforcement via ICandidateSimilarity"
```

---

## Task 4: Grants — roll `remember` to the full profile floor

**Files:**

- Modify: `seed/agents/qa_automation/agent.json`
- Modify: `seed/agents/testing-agent/agent.json`
- Modify: `seed/agents/staff_engineer/agent.json`
- Modify: `seed/agents/software-engineer-assistant/agent.json`
- Modify: `seed/workflows/automated-quality-check.workflow.yaml`
- Modify: `seed/workflows/work-item-in-review-default.workflow.yaml`
- Modify: `seed/workflows/work-item-in-progress-default.workflow.yaml`
- Modify: `seed/workflows/work-item-refinement-default.workflow.yaml`
- Modify: `seed/workflows/documentation-audit.workflow.yaml`
- Modify: `seed/workflows/conversational-artifact-steering.workflow.yaml`
- Modify: `seed/workflows/workflow-failure-doctor.workflow.yaml`
- Modify: `seed/workflows/nightly_ci_qa.workflow.yaml`
- Modify: `apps/api/src/database/seeds/workflow/remember-tool-grants.seed.contract.spec.ts`

**Context:** Currently `remember` is granted to 4 profiles: `junior_dev`, `senior_dev`, `architect-agent`, `research-and-automation-assistant`. This task extends it to: `qa_automation`, `testing-agent`, `staff_engineer`, `software-engineer-assistant`.

Excluded by policy:

- `ceo-agent` — pure-orchestration CEO profile, must not self-capture
- `memory_learning_sweep` workflow and its dedicated agents
- `project_orchestration_cycle_ceo` and its dedicated agents
- `investigation-subagent`/`investigation-coordinator` — analysis-only read profiles that do not need to self-capture lessons

For `remember` to be callable, BOTH the profile-level AND the workflow/job-level deny-default policies must grant it. Both must be updated.

**Workflow policy rules format (YAML object rule):**

```yaml
- effect: allow
  tool: remember
```

- [ ] **Step 1: Write failing contract tests for the new profiles**

Open `apps/api/src/database/seeds/workflow/remember-tool-grants.seed.contract.spec.ts` and extend the `REMEMBER_GRANT_MATRIX` array. Add these entries inside the array after the existing `senior_dev` block:

```typescript
  // qa_automation — QA profile gets remember in all QA job contexts
  {
    profile: 'qa_automation',
    workflowFile: 'automated-quality-check.workflow.yaml',
    jobId: 'quality_check',
  },
  {
    profile: 'qa_automation',
    workflowFile: WF_IN_PROGRESS,
    jobId: 'check_repeated_failures',
  },
  {
    profile: 'qa_automation',
    workflowFile: WF_REFINEMENT,
    jobId: 'plan_validation',
  },
  {
    profile: 'qa_automation',
    workflowFile: 'work-item-in-review-default.workflow.yaml',
    jobId: 'review_work_item',
  },
  {
    profile: 'qa_automation',
    workflowFile: 'workflow-failure-doctor.workflow.yaml',
    jobId: 'diagnose_failure',
  },
  {
    profile: 'qa_automation',
    workflowFile: 'nightly_ci_qa.workflow.yaml',
    jobId: 'run_checks',
  },

  // staff_engineer — documentation audit
  {
    profile: 'staff_engineer',
    workflowFile: 'documentation-audit.workflow.yaml',
    jobId: 'audit_docs',
  },

  // software-engineer-assistant — artifact steering
  {
    profile: 'software-engineer-assistant',
    workflowFile: 'conversational-artifact-steering.workflow.yaml',
    jobId: 'apply_changes',
  },
```

Also extend the `HIGH_TRAFFIC_PROFILES` constant to include the new profiles:

```typescript
const HIGH_TRAFFIC_PROFILES = [
  "junior_dev",
  "senior_dev",
  "architect-agent",
  "research-and-automation-assistant",
  "qa_automation",
  "testing-agent",
  "staff_engineer",
  "software-engineer-assistant",
] as const;
```

- [ ] **Step 2: Run the failing contract tests**

```bash
npm run test --workspace=apps/api -- src/database/seeds/workflow/remember-tool-grants.seed.contract.spec.ts
```

Expected: FAIL — new profiles do not have `remember` in their tool_policy.

- [ ] **Step 3: Update `qa_automation/agent.json`**

In `seed/agents/qa_automation/agent.json`, add `"allow remember *"` to the rules array. After `"allow query_memory *"`:

```json
{
  "name": "qa_automation",
  "tier_preference": "heavy",
  "model_name": null,
  "provider_name": null,
  "tool_policy": {
    "default": "deny",
    "rules": [
      "allow read *",
      "allow bash *",
      "allow ask_user_questions *",
      "allow query_memory *",
      "allow remember *",
      "allow step_complete *",
      "allow submit_qa_decision *",
      "allow set_job_output *",
      "allow search_skills *",
      "allow ls *",
      "allow get_todo_list *",
      "allow manage_todo_list *",
      "allow find *",
      "allow grep *",
      "allow open_war_room *",
      "allow invite_war_room_participant *",
      "allow post_war_room_message *",
      "allow close_war_room *"
    ]
  },
  "assigned_skills": [
    "test-driven-development",
    "code-review",
    "qa-regression-check"
  ],
  "is_active": true
}
```

- [ ] **Step 4: Update `testing-agent/agent.json`**

Add `"allow remember *"` after `"allow query_memory *"`:

```json
{
  "name": "testing-agent",
  "tier_preference": "light",
  "tool_policy": {
    "default": "deny",
    "rules": [
      "allow read *",
      "allow write *",
      "allow edit *",
      "allow bash *",
      "allow query_memory *",
      "allow remember *",
      "allow step_complete *",
      "allow spawn_subagent_async *",
      "allow check_subagent_status *",
      "allow set_job_output *",
      "allow search_skills *",
      "allow ls *",
      "allow get_todo_list *",
      "allow manage_todo_list *",
      "allow find *",
      "allow grep *"
    ]
  },
  "assigned_skills": ["task-progress-tracking"],
  "is_active": true
}
```

- [ ] **Step 5: Update `staff_engineer/agent.json`**

Add `"allow remember *"` after `"allow query_memory *"`:

```json
{
  "name": "staff_engineer",
  "tier_preference": "heavy",
  "tool_policy": {
    "default": "deny",
    "rules": [
      "allow read *",
      "allow write *",
      "allow edit *",
      "allow bash *",
      "allow get_todo_list *",
      "allow manage_todo_list *",
      "allow query_memory *",
      "allow remember *",
      "allow spawn_subagent_async *",
      "allow check_subagent_status *",
      "allow step_complete *",
      "allow set_job_output *",
      "allow search_skills *",
      "allow ls *",
      "allow find *",
      "allow grep *"
    ]
  },
  "assigned_skills": [
    "test-driven-development",
    "debugging",
    "code-review",
    "refactoring",
    "api-design",
    "coding-standards",
    "task-progress-tracking"
  ],
  "is_active": true
}
```

- [ ] **Step 6: Update `software-engineer-assistant/agent.json`**

Add `"allow remember *"` after `"allow query_memory *"`:

```json
{
  "name": "software-engineer-assistant",
  "tier_preference": "heavy",
  "tool_policy": {
    "default": "deny",
    "rules": [
      "allow read *",
      "allow write *",
      "allow edit *",
      "allow bash *",
      "allow get_todo_list *",
      "allow manage_todo_list *",
      "allow query_memory *",
      "allow remember *",
      "allow get_capabilities *",
      "allow get_agent_profiles *",
      "allow step_complete *",
      "allow spawn_subagent_async *",
      "allow wait_for_subagents *",
      "allow check_subagent_status *",
      "allow create_tool_candidate *",
      "allow validate_tool_candidate *",
      "allow publish_tool_candidate *",
      "allow upsert_tool *",
      "allow create_skill *",
      "allow update_skill *",
      "allow list_skill_files *",
      "allow upsert_skill_file *",
      "allow delete_skill_file *",
      "allow replace_profile_skills *",
      "allow add_profile_skills *",
      "allow remove_profile_skills *",
      "allow save_script_as_skill *",
      "allow create_artifact *",
      "allow list_artifacts *",
      "allow list_artifact_files *",
      "allow upsert_artifact_file *",
      "allow delete_artifact_file *",
      "allow save_script_as_artifact *",
      "allow browser_open_page *",
      "allow browser_navigate *",
      "allow browser_click *",
      "allow browser_type *",
      "allow browser_wait_for *",
      "allow browser_read_page *",
      "allow browser_screenshot *",
      "allow browser_close_page *",
      "allow browser_list_failure_artifacts *",
      "allow browser_get_failure_artifact *",
      "allow set_job_output *",
      "allow search_skills *",
      "allow ls *",
      "allow find *",
      "allow grep *"
    ]
  },
  "assigned_skills": [
    "test-driven-development",
    "debugging",
    "code-review",
    "refactoring",
    "api-design",
    "coding-standards",
    "task-progress-tracking"
  ],
  "is_active": true
}
```

- [ ] **Step 7: Update workflow-level and job-level policies for `qa_automation`**

**`automated-quality-check.workflow.yaml`** — add `remember` to workflow-level `rules`:

```yaml
- effect: allow
  tool: remember
```

Add it after `tool: query_memory`.

**`work-item-in-review-default.workflow.yaml`** — add `remember` to:

1. Workflow-level rules (after `tool: query_memory`):
   ```yaml
   - effect: allow
     tool: remember
   ```
2. Job `review_work_item` job-level rules (after `tool: query_memory`):
   ```yaml
   - effect: allow
     tool: remember
   ```

**`work-item-in-progress-default.workflow.yaml`** — workflow-level already has `remember`. Add to job `check_repeated_failures` job-level rules (after `tool: ask_user_questions`):

```yaml
- effect: allow
  tool: remember
```

**`work-item-refinement-default.workflow.yaml`** — workflow-level already has `remember`. Add to job `plan_validation` job-level rules (after `tool: query_memory`):

```yaml
- effect: allow
  tool: remember
```

**`workflow-failure-doctor.workflow.yaml`** — add `remember` to:

1. Workflow-level rules (after `tool: query_memory` if present, else before the deny rules):
   ```yaml
   - effect: allow
     tool: remember
   ```
2. Job `diagnose_failure` job-level rules (after `tool: query_memory`):
   ```yaml
   - effect: allow
     tool: remember
   ```

**`nightly_ci_qa.workflow.yaml`** — workflow-level already has `remember`. Job `run_checks` has no job-level policy, so inherits from workflow — no change needed there.

- [ ] **Step 8: Update workflow-level policies for `staff_engineer` and `software-engineer-assistant`**

**`documentation-audit.workflow.yaml`** — add `remember` to workflow-level rules (after `tool: query_memory`):

```yaml
- effect: allow
  tool: remember
```

**`conversational-artifact-steering.workflow.yaml`** — add `remember` to workflow-level rules. Currently no `query_memory` rule. Add it after `tool: edit`:

```yaml
- effect: allow
  tool: remember
```

Job `apply_changes` has no job-level policy — inherits from workflow.

- [ ] **Step 9: Run the contract tests again**

```bash
npm run test --workspace=apps/api -- src/database/seeds/workflow/remember-tool-grants.seed.contract.spec.ts
```

Expected: All tests PASS.

- [ ] **Step 10: Run `validate:seed-data`**

```bash
npm run validate:seed-data
```

Expected: PASS — no regressions from profile/workflow policy changes.

- [ ] **Step 11: Commit**

```bash
git add \
  seed/agents/qa_automation/agent.json \
  seed/agents/testing-agent/agent.json \
  seed/agents/staff_engineer/agent.json \
  seed/agents/software-engineer-assistant/agent.json \
  seed/workflows/automated-quality-check.workflow.yaml \
  seed/workflows/work-item-in-review-default.workflow.yaml \
  seed/workflows/work-item-in-progress-default.workflow.yaml \
  seed/workflows/work-item-refinement-default.workflow.yaml \
  seed/workflows/documentation-audit.workflow.yaml \
  seed/workflows/conversational-artifact-steering.workflow.yaml \
  seed/workflows/workflow-failure-doctor.workflow.yaml \
  seed/workflows/nightly_ci_qa.workflow.yaml \
  apps/api/src/database/seeds/workflow/remember-tool-grants.seed.contract.spec.ts
git commit -m "feat(memory): roll remember grant to qa_automation, testing-agent, staff_engineer, software-engineer-assistant profiles and their workflow/job policies"
```

---

## Task 5: Final verification

- [ ] **Step 1: Full targeted test run**

```bash
npm run test --workspace=apps/api -- src/workflow/workflow-internal-tools/handlers/memory-tools.list-pending.spec.ts
npm run test --workspace=apps/api -- src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.spec.ts
npm run test --workspace=apps/api -- src/workflow/workflow-internal-tools/handlers/memory-tools.handler.spec.ts
npm run test --workspace=apps/api -- src/database/seeds/workflow/remember-tool-grants.seed.contract.spec.ts
npm run test --workspace=apps/api -- src/memory/signals
```

Expected: All PASS.

- [ ] **Step 2: API build (TypeScript clean)**

```bash
npm run build:api
```

Expected: clean build, no TS errors.

- [ ] **Step 3: ESLint on changed files**

```bash
cd /g/code/AI/nexus-orchestator/.worktrees/epic-212-memory-learning-loop
npx eslint \
  apps/api/src/workflow/workflow-internal-tools/handlers/memory-tools.handler.ts \
  apps/api/src/workflow/workflow-internal-tools/handlers/remember-write-guard.service.ts \
  apps/api/src/memory/database/repositories/learning-candidate.repository.ts \
  apps/api/src/memory/memory.module.ts \
  apps/api/src/settings/system-settings.defaults.ts \
  --max-warnings 0
```

Expected: 0 errors, 0 warnings. If `max-lines` violations appear, extract additional helpers to separate files.

- [ ] **Step 4: Validate seed data**

```bash
npm run validate:seed-data
```

Expected: PASS.

- [ ] **Step 5: Write report**

Write to `.superpowers/sdd/task-11a-report.md` (do NOT `git add` it).

---

## Self-Review

**Spec coverage check:**

1. ✅ `listPendingCandidates` returns `signals_json`, `recurrence_count`, `score` — Task 1
2. ✅ `total_sweep_eligible` honest count — Task 1
3. ✅ `merged` rows excluded (already by `statuses: ['pending']` — documented, no code change needed)
4. ✅ Sweep prompt consumes top-ranked-to-budget, trusts struggle_backed/agent_capture — Task 2
5. ✅ Near-dup reinforcement via `ICandidateSimilarity` — Task 3
6. ✅ Budget exhaustion check — Task 3
7. ✅ Fail-soft on similarity error — Task 3
8. ✅ Profile grants: qa_automation, testing-agent, staff_engineer, software-engineer-assistant — Task 4
9. ✅ Workflow/job-level grants for all new profiles — Task 4
10. ✅ Contract test matrix extended — Task 4
11. ✅ `npm run validate:seed-data` — Task 4 + Task 5
12. ✅ `npm run build:api` clean — Task 5
13. ✅ ESLint clean — Task 5

**Not in scope (11b):**

- `LearningTabClusterCard.tsx` — web only
- Score-breakdown popover — web only
- Suppressed-noise drawer — web only
