# Work Item Cost Prediction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Predict a work item's cost before it runs (with model what-if comparisons) and report predicted-vs-actual cost after, using historical per-attempt token usage bucketed by workflow+type+story-points and multiplied by live model pricing.

**Architecture:** Extend the lifecycle-stream usage payload with a per-model token/cost breakdown; persist per-attempt cost history and a synced model-pricing cache in Kanban's own database (Kanban owns the work-item domain); materialize bucketed token-distribution stats on a background timer; compute estimates by looking up the best-fit bucket and multiplying by cached pricing, with zero synchronous cross-service calls on the read path.

**Tech Stack:** NestJS, TypeORM/PostgreSQL, Zod, Vitest, React Query, existing `KanbanCoreHttpClient` service-to-service pattern.

## Global Constraints

- Work-item concepts (type, story points, cost estimate) are Kanban-owned; API/core stays neutral — no `work_item`/kanban identifiers in `apps/api/src` or `packages/core/src` (per `CLAUDE.md` core/kanban boundary).
- No synchronous cross-service HTTP call on the estimate **read** path — pricing is synced into a local Kanban cache on a timer, not fetched per-request.
- Never suppress lint (`eslint-disable`, `@ts-ignore`) — fix findings in code.
- `npm run build --workspace=packages/core` must run before `npm run build:api` whenever `packages/core` changes.
- All new tables use `uuid` primary keys, snake_case columns, `created_at`/`updated_at` via `@CreateDateColumn`/`@UpdateDateColumn` (per `adding-entity-migration` skill conventions, adapted to Kanban's flat `apps/kanban/src/database/{entities,repositories,migrations}` layout — no domain subfolders there, unlike `apps/api`).
- Migrations use `CREATE TABLE IF NOT EXISTS` / raw SQL, are added to the `migrations` array in `apps/kanban/src/database/database.module.ts` **at the top** (newest-first), and get a `down()`.

---

### Task 1: Per-model usage breakdown on the lifecycle-stream usage payload

**Files:**

- Modify: `packages/core/src/schemas/events/event-envelope.schema.ts:76-83`
- Modify: `packages/core/src/schemas/events/event-envelope.schema.spec.ts`
- Modify: `apps/api/src/cost-governance/database/repositories/budget-usage-event.repository.ts:78-109`
- Modify: `apps/api/src/cost-governance/database/repositories/budget-usage-event.repository.spec.ts`
- Modify: `apps/api/src/workflow/listeners/workflow-core-lifecycle-stream.listener.ts:152-178`
- Modify: `apps/api/src/workflow/listeners/workflow-core-lifecycle-stream.listener.spec.ts`

**Interfaces:**

- Produces: `CoreWorkflowRunModelUsageV1Schema` (new, exported from `packages/core`), and `CoreWorkflowRunUsageV1Schema.model_breakdown: CoreWorkflowRunModelUsageV1Shape[] | null | undefined`. Consumed by Task 3 (Kanban terminal projection) via `payload.usage.model_breakdown`.
- Produces: `BudgetUsageEventRepository.getRunTotalsByModel(runId: string): Promise<Array<{ modelId: string | null; providerName: string | null; modelName: string | null; inputTokens: number; outputTokens: number; costCents: number }>>`.

- [ ] **Step 1: Write the failing schema test**

Add to `packages/core/src/schemas/events/event-envelope.schema.spec.ts`, after the existing `"accepts run usage totals on a terminal run event payload"` test:

```ts
it("accepts a per-model usage breakdown on a terminal run event payload", () => {
  const parsed = CoreWorkflowRunEventEnvelopeV1Schema.parse({
    event_id: "evt-core-usage-breakdown",
    event_type: "core.workflow.run.completed.v1",
    event_version: "v1",
    occurred_at: "2026-04-13T00:00:00.000Z",
    correlation_id: "corr-usage-breakdown",
    source_service: "core",
    payload: {
      run_id: "run-1",
      workflow_id: "workflow-1",
      status: "COMPLETED",
      usage: {
        total_tokens: 1234,
        input_tokens: 1000,
        output_tokens: 234,
        model_breakdown: [
          {
            model_id: "model-1",
            provider_name: "anthropic",
            model_name: "claude-sonnet-5",
            input_tokens: 1000,
            output_tokens: 234,
            cost_cents: 12,
          },
        ],
      },
    },
  });

  expect(parsed.payload.usage?.model_breakdown?.[0]?.model_name).toBe(
    "claude-sonnet-5",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- event-envelope.schema.spec.ts`
Expected: FAIL — `usage` is a `.strict()` object, so the unknown key `model_breakdown` throws a `ZodError` ("Unrecognized key(s) in object").

- [ ] **Step 3: Add the schema field**

In `packages/core/src/schemas/events/event-envelope.schema.ts`, replace lines 76-83:

```ts
export const CoreWorkflowRunModelUsageV1Schema = z
  .object({
    model_id: z.string().min(1).nullable(),
    provider_name: z.string().min(1).nullable(),
    model_name: z.string().min(1).nullable(),
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cost_cents: z.number().int().nonnegative(),
  })
  .strict();

export const CoreWorkflowRunUsageV1Schema = z
  .object({
    total_tokens: z.number().int().nonnegative().nullable().optional(),
    input_tokens: z.number().int().nonnegative().nullable().optional(),
    output_tokens: z.number().int().nonnegative().nullable().optional(),
    estimated_cost_cents: z.number().int().nonnegative().nullable().optional(),
    // Per-model breakdown of the same cumulative totals above. Neutral/additive
    // — lets downstream consumers (e.g. Kanban's cost-history projection)
    // attribute spend to a specific model without reaching into cost tables.
    model_breakdown: z
      .array(CoreWorkflowRunModelUsageV1Schema)
      .nullable()
      .optional(),
  })
  .strict();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/core -- event-envelope.schema.spec.ts`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Write the failing repository test**

Add to `apps/api/src/cost-governance/database/repositories/budget-usage-event.repository.spec.ts`, inside the `describe` block (reusing the `mockRepo`/`queryBuilder` fixture already defined in `beforeEach`):

```ts
it("getRunTotalsByModel groups summed usage by model", async () => {
  const queryBuilder = mockRepo.createQueryBuilder();
  queryBuilder.getRawMany.mockResolvedValue([
    {
      modelId: "model-1",
      providerName: "anthropic",
      modelName: "claude-sonnet-5",
      inputTokens: "1000",
      outputTokens: "234",
      costCents: "12",
    },
  ]);

  const result = await repo.getRunTotalsByModel("run-1");

  expect(result).toEqual([
    {
      modelId: "model-1",
      providerName: "anthropic",
      modelName: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 234,
      costCents: 12,
    },
  ]);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- budget-usage-event.repository.spec.ts`
Expected: FAIL — `repo.getRunTotalsByModel is not a function`

- [ ] **Step 7: Implement `getRunTotalsByModel`**

In `apps/api/src/cost-governance/database/repositories/budget-usage-event.repository.ts`, add after `getRunTotals` (after line 109):

```ts
  /**
   * Sums usage grouped by model for a single run, so callers can attribute
   * spend to specific models rather than only the run-wide total (used to
   * populate the lifecycle-stream `usage.model_breakdown`).
   */
  async getRunTotalsByModel(runId: string): Promise<
    Array<{
      modelId: string | null;
      providerName: string | null;
      modelName: string | null;
      inputTokens: number;
      outputTokens: number;
      costCents: number;
    }>
  > {
    const rows: Array<{
      modelId: string | null;
      providerName: string | null;
      modelName: string | null;
      inputTokens: string;
      outputTokens: string;
      costCents: string;
    }> = await this.repo
      .createQueryBuilder('e')
      .select('e.model_id', 'modelId')
      .addSelect('e.provider_name', 'providerName')
      .addSelect('e.model_name', 'modelName')
      .addSelect('COALESCE(SUM(e.input_tokens), 0)', 'inputTokens')
      .addSelect('COALESCE(SUM(e.output_tokens), 0)', 'outputTokens')
      .addSelect('COALESCE(SUM(e.estimated_cost_cents), 0)', 'costCents')
      .where('e.context_id = :runId', { runId })
      .groupBy('e.model_id')
      .addGroupBy('e.provider_name')
      .addGroupBy('e.model_name')
      .getRawMany();

    return rows.map((row) => ({
      modelId: row.modelId,
      providerName: row.providerName,
      modelName: row.modelName,
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      costCents: Number(row.costCents),
    }));
  }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- budget-usage-event.repository.spec.ts`
Expected: PASS

- [ ] **Step 9: Write the failing listener test**

Add to `apps/api/src/workflow/listeners/workflow-core-lifecycle-stream.listener.spec.ts`, extending the `usageEvents` fixture (near the top, replace lines 9-13):

```ts
const usageEvents = {
  getRunTotals: vi
    .fn()
    .mockResolvedValue({ totalTokens: 0, inputTokens: 0, outputTokens: 0 }),
  getRunTotalsByModel: vi.fn().mockResolvedValue([]),
};
```

and update the `beforeEach` reset block (lines 16-22) to also reset `getRunTotalsByModel`:

```ts
beforeEach(() => {
  vi.clearAllMocks();
  usageEvents.getRunTotals.mockResolvedValue({
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
  });
  usageEvents.getRunTotalsByModel.mockResolvedValue([]);
  listener = new WorkflowCoreLifecycleStreamListener(
    publisher as never,
    usageEvents as never,
  );
});
```

Then add a new test (after the `'publishes completed workflow run events with parseable execution context'` test):

```ts
it("attaches a per-model usage breakdown to terminal run events", async () => {
  usageEvents.getRunTotals.mockResolvedValue({
    totalTokens: 1234,
    inputTokens: 1000,
    outputTokens: 234,
    estimatedCostCents: 12,
  });
  usageEvents.getRunTotalsByModel.mockResolvedValue([
    {
      modelId: "model-1",
      providerName: "anthropic",
      modelName: "claude-sonnet-5",
      inputTokens: 1000,
      outputTokens: 234,
      costCents: 12,
    },
  ]);

  await listener.onRunCompleted({
    workflowRunId: "run-1",
    workflowId: "workflow-1",
    status: WorkflowStatus.COMPLETED,
    stateVariables: {},
    triggerData: {},
  });

  const envelope = publisher.publish.mock.calls[0][0];
  expect(envelope.payload.usage.model_breakdown).toEqual([
    {
      model_id: "model-1",
      provider_name: "anthropic",
      model_name: "claude-sonnet-5",
      input_tokens: 1000,
      output_tokens: 234,
      cost_cents: 12,
    },
  ]);
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-core-lifecycle-stream.listener.spec.ts`
Expected: FAIL — `envelope.payload.usage.model_breakdown` is `undefined`

- [ ] **Step 11: Wire `getRunTotalsByModel` into `resolveRunUsage`**

In `apps/api/src/workflow/listeners/workflow-core-lifecycle-stream.listener.ts`, replace the `resolveRunUsage` method (lines 152-178):

```ts
  private async resolveRunUsage(
    event: WorkflowRunEvent,
  ): Promise<CoreWorkflowRunUsageV1Shape | null> {
    if (!isTerminalWorkflowRunStatus(event.status)) {
      return null;
    }

    try {
      const totals = await this.usageEvents.getRunTotals(event.workflowRunId);
      if (totals.totalTokens === 0) {
        this.logger.warn(
          `No budget_usage_events found for terminal run ${event.workflowRunId} (status=${event.status}); downstream token accrual will be skipped`,
        );
      }
      const byModel = await this.usageEvents.getRunTotalsByModel(
        event.workflowRunId,
      );
      return {
        total_tokens: totals.totalTokens,
        input_tokens: totals.inputTokens,
        output_tokens: totals.outputTokens,
        estimated_cost_cents: totals.estimatedCostCents,
        model_breakdown: byModel.map((row) => ({
          model_id: row.modelId,
          provider_name: row.providerName,
          model_name: row.modelName,
          input_tokens: row.inputTokens,
          output_tokens: row.outputTokens,
          cost_cents: row.costCents,
        })),
      };
    } catch (error) {
      this.logger.warn(
        `Failed to resolve run usage for ${event.workflowRunId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- workflow-core-lifecycle-stream.listener.spec.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 13: Build packages/core and api, then commit**

Run: `npm run build --workspace=packages/core && npm run build:api`
Expected: both succeed with no type errors

```bash
git add packages/core/src/schemas/events/event-envelope.schema.ts packages/core/src/schemas/events/event-envelope.schema.spec.ts apps/api/src/cost-governance/database/repositories/budget-usage-event.repository.ts apps/api/src/cost-governance/database/repositories/budget-usage-event.repository.spec.ts apps/api/src/workflow/listeners/workflow-core-lifecycle-stream.listener.ts apps/api/src/workflow/listeners/workflow-core-lifecycle-stream.listener.spec.ts
git commit -m "feat(cost-governance): attach per-model usage breakdown to terminal lifecycle events"
```

---

### Task 2: `kanban_work_item_run_costs` entity, migration, repository

**Files:**

- Create: `apps/kanban/src/database/migrations/20260707090000-create-work-item-run-costs.ts`
- Create: `apps/kanban/src/database/entities/kanban-work-item-run-cost.entity.ts`
- Create: `apps/kanban/src/database/repositories/kanban-work-item-run-cost.repository.ts`
- Create: `apps/kanban/src/database/repositories/kanban-work-item-run-cost.repository.spec.ts`
- Modify: `apps/kanban/src/database/database.module.ts`

**Interfaces:**

- Produces: `KanbanWorkItemRunCostEntity` (table `kanban_work_item_run_costs`), `KanbanWorkItemRunCostRepository.recordAttempt(input: RecordRunCostAttemptInput): Promise<{ inserted: boolean }>` — idempotent on `run_id` (no-op if a row for that `run_id` already exists). Consumed by Task 3.
- Produces: `KanbanWorkItemRunCostRepository.findAllForBucketAggregation(): Promise<KanbanWorkItemRunCostEntity[]>`. Consumed by Task 6 (bucket-stats aggregation) and Task 9 (calibration accuracy).

- [ ] **Step 1: Write the entity**

Create `apps/kanban/src/database/entities/kanban-work-item-run-cost.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

export interface ModelUsageBreakdownRow {
  model_id: string | null;
  provider_name: string | null;
  model_name: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
}

@Entity("kanban_work_item_run_costs")
@Index("idx_kanban_work_item_run_costs_work_item", ["work_item_id"])
@Index("idx_kanban_work_item_run_costs_run_id", ["run_id"], { unique: true })
@Index("idx_kanban_work_item_run_costs_bucket", [
  "workflow_id",
  "type",
  "story_points",
])
export class KanbanWorkItemRunCostEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  work_item_id!: string;

  @Column({ type: "varchar" })
  run_id!: string;

  @Column({ type: "varchar", nullable: true })
  workflow_id!: string | null;

  @Column({ type: "varchar", length: 16 })
  type!: string;

  @Column({ type: "smallint", nullable: true })
  story_points!: number | null;

  @Column({ type: "varchar", length: 32 })
  priority!: string;

  @Column({ type: "int" })
  attempt_number!: number;

  @Column({ type: "boolean" })
  is_retry!: boolean;

  @Column({ type: "jsonb" })
  model_breakdown!: ModelUsageBreakdownRow[];

  @Column({ type: "integer" })
  total_input_tokens!: number;

  @Column({ type: "integer" })
  total_output_tokens!: number;

  @Column({ type: "integer" })
  total_cost_cents!: number;

  @Column({ type: "timestamp", nullable: true })
  started_at!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  completed_at!: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
```

- [ ] **Step 2: Write the migration**

Create `apps/kanban/src/database/migrations/20260707090000-create-work-item-run-costs.ts`:

```ts
import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWorkItemRunCosts20260707090000 implements MigrationInterface {
  name = "CreateWorkItemRunCosts20260707090000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_work_item_run_costs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_item_id UUID NOT NULL,
        run_id character varying NOT NULL,
        workflow_id character varying NULL,
        type character varying(16) NOT NULL,
        story_points smallint NULL,
        priority character varying(32) NOT NULL,
        attempt_number integer NOT NULL,
        is_retry boolean NOT NULL,
        model_breakdown jsonb NOT NULL,
        total_input_tokens integer NOT NULL,
        total_output_tokens integer NOT NULL,
        total_cost_cents integer NOT NULL,
        started_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_work_item_run_costs_run_id
      ON kanban_work_item_run_costs(run_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_work_item_run_costs_work_item
      ON kanban_work_item_run_costs(work_item_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_work_item_run_costs_bucket
      ON kanban_work_item_run_costs(workflow_id, type, story_points);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS kanban_work_item_run_costs");
  }
}
```

- [ ] **Step 3: Write the failing repository test**

Create `apps/kanban/src/database/repositories/kanban-work-item-run-cost.repository.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { KanbanWorkItemRunCostEntity } from "../entities/kanban-work-item-run-cost.entity";
import { KanbanWorkItemRunCostRepository } from "./kanban-work-item-run-cost.repository";

describe("KanbanWorkItemRunCostRepository", () => {
  let repo: KanbanWorkItemRunCostRepository;
  let mockRepo: {
    findOne: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
    };
    mockRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn((input) => input),
      save: vi.fn(async (input) => ({ id: "cost-1", ...input })),
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    const module = await Test.createTestingModule({
      providers: [
        KanbanWorkItemRunCostRepository,
        {
          provide: getRepositoryToken(KanbanWorkItemRunCostEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repo = module.get(KanbanWorkItemRunCostRepository);
  });

  it("recordAttempt inserts a new row and computes attempt_number/is_retry from prior count", async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.count.mockResolvedValue(1);

    const result = await repo.recordAttempt({
      work_item_id: "wi-1",
      run_id: "run-2",
      workflow_id: "wf-1",
      type: "task",
      story_points: 3,
      priority: "p2",
      model_breakdown: [],
      total_input_tokens: 100,
      total_output_tokens: 20,
      total_cost_cents: 5,
      started_at: null,
      completed_at: null,
    });

    expect(result).toEqual({ inserted: true });
    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ attempt_number: 2, is_retry: true }),
    );
  });

  it("recordAttempt is a no-op when a row for run_id already exists", async () => {
    mockRepo.findOne.mockResolvedValue({ id: "existing", run_id: "run-1" });

    const result = await repo.recordAttempt({
      work_item_id: "wi-1",
      run_id: "run-1",
      workflow_id: "wf-1",
      type: "task",
      story_points: 3,
      priority: "p2",
      model_breakdown: [],
      total_input_tokens: 100,
      total_output_tokens: 20,
      total_cost_cents: 5,
      started_at: null,
      completed_at: null,
    });

    expect(result).toEqual({ inserted: false });
    expect(mockRepo.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- kanban-work-item-run-cost.repository.spec.ts`
Expected: FAIL — module resolution error, `./kanban-work-item-run-cost.repository` does not exist

- [ ] **Step 5: Implement the repository**

Create `apps/kanban/src/database/repositories/kanban-work-item-run-cost.repository.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  KanbanWorkItemRunCostEntity,
  type ModelUsageBreakdownRow,
} from "../entities/kanban-work-item-run-cost.entity";

export interface RecordRunCostAttemptInput {
  work_item_id: string;
  run_id: string;
  workflow_id: string | null;
  type: string;
  story_points: number | null;
  priority: string;
  model_breakdown: ModelUsageBreakdownRow[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_cents: number;
  started_at: Date | null;
  completed_at: Date | null;
}

@Injectable()
export class KanbanWorkItemRunCostRepository {
  constructor(
    @InjectRepository(KanbanWorkItemRunCostEntity)
    private readonly repository: Repository<KanbanWorkItemRunCostEntity>,
  ) {}

  /**
   * Idempotent on `run_id` — a redelivered lifecycle event must not double-count
   * an attempt. attempt_number/is_retry are derived from how many prior
   * terminal attempts this work item already has recorded.
   */
  async recordAttempt(
    input: RecordRunCostAttemptInput,
  ): Promise<{ inserted: boolean }> {
    const existing = await this.repository.findOne({
      where: { run_id: input.run_id },
    });
    if (existing) {
      return { inserted: false };
    }

    const priorAttempts = await this.repository.count({
      where: { work_item_id: input.work_item_id },
    });
    const attemptNumber = priorAttempts + 1;

    await this.repository.save(
      this.repository.create({
        ...input,
        attempt_number: attemptNumber,
        is_retry: attemptNumber > 1,
      }),
    );

    return { inserted: true };
  }

  findAllForBucketAggregation(): Promise<KanbanWorkItemRunCostEntity[]> {
    return this.repository.find();
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- kanban-work-item-run-cost.repository.spec.ts`
Expected: PASS

- [ ] **Step 7: Register the entity, repository, and migration in `DatabaseModule`**

In `apps/kanban/src/database/database.module.ts`:

- Add import: `import { KanbanWorkItemRunCostEntity } from "./entities/kanban-work-item-run-cost.entity";`
- Add import: `import { KanbanWorkItemRunCostRepository } from "./repositories/kanban-work-item-run-cost.repository";`
- Add import: `import { CreateWorkItemRunCosts20260707090000 } from "./migrations/20260707090000-create-work-item-run-costs";`
- Add `KanbanWorkItemRunCostEntity` to the `entities` array (line 93 area, after `KanbanProjectCharterItemEntity`)
- Add `KanbanWorkItemRunCostRepository` to the `repositories` array (line 117 area)
- Add `CreateWorkItemRunCosts20260707090000` as the **first** entry in the `migrations` array (line 121, above `AddWorkItemTypePointsHierarchy20260706120000`)

- [ ] **Step 8: Build kanban and run full kanban test suite**

Run: `npm run build --workspace=apps/kanban && npm run test:kanban`
Expected: build succeeds, all tests pass (including the new repository spec)

- [ ] **Step 9: Commit**

```bash
git add apps/kanban/src/database/entities/kanban-work-item-run-cost.entity.ts apps/kanban/src/database/repositories/kanban-work-item-run-cost.repository.ts apps/kanban/src/database/repositories/kanban-work-item-run-cost.repository.spec.ts apps/kanban/src/database/migrations/20260707090000-create-work-item-run-costs.ts apps/kanban/src/database/database.module.ts
git commit -m "feat(kanban): add kanban_work_item_run_costs per-attempt cost history table"
```

---

### Task 3: Record a per-attempt cost row from the terminal lifecycle event

**Files:**

- Modify: `apps/kanban/src/core/core-lifecycle-stream-terminal-projection.types.ts`
- Modify: `apps/kanban/src/core/core-lifecycle-stream-terminal-projection.helpers.ts`
- Modify: `apps/kanban/src/core/core-lifecycle-stream-terminal-projection.helpers.spec.ts`
- Modify: `apps/kanban/src/core/core-lifecycle-stream.consumer.ts:433-437`
- Modify: `apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts`
- Modify: `apps/kanban/src/core/core-integration.module.ts`

**Interfaces:**

- Consumes: `KanbanWorkItemRunCostRepository.recordAttempt` (Task 2), `KanbanWorkItemEntity.type`/`story_points`/`priority` (already exist on the entity per `apps/kanban/src/database/entities/kanban-work-item.entity.ts:19-39`).
- Produces: `recordWorkItemRunCostAttempt(deps, params): Promise<void>` exported from `core-lifecycle-stream-terminal-projection.helpers.ts`, called from `CoreLifecycleStreamConsumerService.evaluateContinuationForTerminalRun`.

- [ ] **Step 1: Extend `TerminalProjectionDeps` with the new repository**

In `apps/kanban/src/core/core-lifecycle-stream-terminal-projection.types.ts`, add the import and field:

```ts
import type { KanbanWorkItemRunCostRepository } from "../database/repositories/kanban-work-item-run-cost.repository";
```

and add to `TerminalProjectionDeps`:

```ts
export interface TerminalProjectionDeps {
  readonly logger: Logger;
  readonly orchestrationService: OrchestrationService;
  readonly workItems: KanbanWorkItemRepository;
  readonly workItemRunCosts: KanbanWorkItemRunCostRepository;
}
```

- [ ] **Step 2: Write the failing helper test**

Add to `apps/kanban/src/core/core-lifecycle-stream-terminal-projection.helpers.spec.ts` (find the existing `describe` block for `accrueWorkItemTokenSpend` and add a sibling block):

```ts
describe("recordWorkItemRunCostAttempt", () => {
  const baseDeps = () => ({
    logger: { warn: vi.fn() } as unknown as Logger,
    orchestrationService: {} as never,
    workItems: {
      findByProjectAndId: vi.fn(),
    } as never,
    workItemRunCosts: {
      recordAttempt: vi.fn().mockResolvedValue({ inserted: true }),
    } as never,
  });

  it("records a per-attempt row using the work item's current type/points/priority and the payload's model breakdown", async () => {
    const deps = baseDeps();
    (
      deps.workItems.findByProjectAndId as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      id: "wi-1",
      type: "task",
      story_points: 3,
      priority: "p2",
    });

    await recordWorkItemRunCostAttempt(deps, {
      projectId: "proj-1",
      workItemId: "wi-1",
      workflowId: "wf-1",
      runId: "run-1",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "COMPLETED",
        usage: {
          total_tokens: 1234,
          input_tokens: 1000,
          output_tokens: 234,
          estimated_cost_cents: 12,
          model_breakdown: [
            {
              model_id: "model-1",
              provider_name: "anthropic",
              model_name: "claude-sonnet-5",
              input_tokens: 1000,
              output_tokens: 234,
              cost_cents: 12,
            },
          ],
        },
      } as never,
    });

    expect(deps.workItemRunCosts.recordAttempt).toHaveBeenCalledWith({
      work_item_id: "wi-1",
      run_id: "run-1",
      workflow_id: "wf-1",
      type: "task",
      story_points: 3,
      priority: "p2",
      model_breakdown: [
        {
          model_id: "model-1",
          provider_name: "anthropic",
          model_name: "claude-sonnet-5",
          input_tokens: 1000,
          output_tokens: 234,
          cost_cents: 12,
        },
      ],
      total_input_tokens: 1000,
      total_output_tokens: 234,
      total_cost_cents: 12,
      started_at: null,
      completed_at: null,
    });
  });

  it("is a no-op when there is no total cost recorded (crashed/incomplete attempt)", async () => {
    const deps = baseDeps();

    await recordWorkItemRunCostAttempt(deps, {
      projectId: "proj-1",
      workItemId: "wi-1",
      workflowId: "wf-1",
      runId: "run-1",
      payload: {
        run_id: "run-1",
        workflow_id: "wf-1",
        status: "FAILED",
        usage: null,
      } as never,
    });

    expect(deps.workItemRunCosts.recordAttempt).not.toHaveBeenCalled();
  });

  it("is a no-op for a synthetic/non-work-item id", async () => {
    const deps = baseDeps();

    await recordWorkItemRunCostAttempt(deps, {
      projectId: "proj-1",
      workItemId: "__orchestration_lifecycle__",
      workflowId: "wf-1",
      runId: "run-1",
      payload: { usage: { estimated_cost_cents: 12 } } as never,
    });

    expect(deps.workItemRunCosts.recordAttempt).not.toHaveBeenCalled();
  });
});
```

Add `import { recordWorkItemRunCostAttempt } from "./core-lifecycle-stream-terminal-projection.helpers";` (or extend the existing import line) at the top of the spec file, alongside `vi` from vitest and `Logger` from `@nestjs/common` if not already imported.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- core-lifecycle-stream-terminal-projection.helpers.spec.ts`
Expected: FAIL — `recordWorkItemRunCostAttempt is not a function`

- [ ] **Step 4: Implement `recordWorkItemRunCostAttempt`**

In `apps/kanban/src/core/core-lifecycle-stream-terminal-projection.helpers.ts`, add after `accrueWorkItemTokenSpend` (after line 90):

```ts
/**
 * Records a per-attempt cost-history row for a terminal work-item run,
 * snapshotting the work item's type/story_points/priority *as they are right
 * now* (they can change later; bucket stats need the value that was true
 * when the work happened). No-op when there is no positive total cost (a
 * crashed/incomplete attempt should not deflate bucket averages with a $0
 * sample) or when the payload carries no work item id.
 */
export async function recordWorkItemRunCostAttempt(
  deps: TerminalProjectionDeps,
  params: {
    projectId: string;
    workItemId: string | undefined;
    workflowId: string | null;
    runId: string;
    payload: CoreWorkflowEventEnvelopeV1Shape["payload"];
  },
): Promise<void> {
  if (!isRealWorkItemId(params.workItemId)) {
    return;
  }

  const costCents = readUsageEstimatedCostCents(params.payload);
  if (costCents <= 0) {
    return;
  }

  try {
    const workItem = await deps.workItems.findByProjectAndId(
      params.projectId,
      params.workItemId,
    );
    if (!workItem) {
      return;
    }

    const usage =
      "usage" in params.payload && params.payload.usage
        ? params.payload.usage
        : null;

    await deps.workItemRunCosts.recordAttempt({
      work_item_id: params.workItemId,
      run_id: params.runId,
      workflow_id: params.workflowId,
      type: workItem.type,
      story_points: workItem.story_points,
      priority: workItem.priority,
      model_breakdown: usage?.model_breakdown ?? [],
      total_input_tokens: usage?.input_tokens ?? 0,
      total_output_tokens: usage?.output_tokens ?? 0,
      total_cost_cents: costCents,
      started_at: null,
      completed_at: null,
    });
  } catch (error) {
    deps.logger.warn(
      `Failed to record run cost attempt for work item ${params.workItemId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- core-lifecycle-stream-terminal-projection.helpers.spec.ts`
Expected: PASS

- [ ] **Step 6: Wire the new helper into the consumer**

In `apps/kanban/src/core/core-lifecycle-stream.consumer.ts`:

- Add import: `import { KanbanWorkItemRunCostRepository } from "../database/repositories/kanban-work-item-run-cost.repository";`
- Add `recordWorkItemRunCostAttempt` to the existing import from `"./core-lifecycle-stream-terminal-projection.helpers"` (line 28-33)
- Add constructor param: `private readonly workItemRunCosts: KanbanWorkItemRunCostRepository,` (alongside `workItems`, around line 74)
- Update the `terminalProjectionDeps` getter (lines 89-95) to include it:

```ts
  private get terminalProjectionDeps() {
    return {
      logger: this.logger,
      orchestrationService: this.orchestrationService,
      workItems: this.workItems,
      workItemRunCosts: this.workItemRunCosts,
    };
  }
```

- In `evaluateContinuationForTerminalRun` (around line 433), add the call right after the existing `accrueWorkItemTokenSpend` call:

```ts
await accrueWorkItemTokenSpend(this.terminalProjectionDeps, {
  projectId,
  workItemId,
  payload: envelope.payload,
});

await recordWorkItemRunCostAttempt(this.terminalProjectionDeps, {
  projectId,
  workItemId,
  workflowId: envelope.payload.workflow_id ?? null,
  runId: workflowRunId,
  payload: envelope.payload,
});
```

- [ ] **Step 7: Update the consumer spec's constructor call and terminal-run test**

In `apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts`, find where `CoreLifecycleStreamConsumerService` is instantiated (constructor args mirror `core-lifecycle-stream.consumer.ts:68-85`) and add a `workItemRunCosts` fake with a `recordAttempt: vi.fn().mockResolvedValue({ inserted: true })` mock, threaded into the constructor call in the same argument position as `workItemRunCosts` above (right after `workItems`).

- [ ] **Step 8: Run the consumer spec**

Run: `npm run test --workspace=apps/kanban -- core-lifecycle-stream.consumer.spec.ts`
Expected: PASS — update the fixture until the constructor argument list matches; this step has no separate "make it fail first" cycle since it's wiring an already-tested helper into an existing service.

- [ ] **Step 9: Register the repository provider in `CoreIntegrationModule`**

`KanbanWorkItemRunCostRepository` is already exported globally by `DatabaseModule` (per `adding-entity-migration` conventions — `@Global()` module), so `CoreLifecycleStreamConsumerService`'s constructor injection resolves without any change to `apps/kanban/src/core/core-integration.module.ts`. Skip this step if `npm run build --workspace=apps/kanban` succeeds without it (verify in Step 10).

- [ ] **Step 10: Build and run the full kanban suite**

Run: `npm run build --workspace=apps/kanban && npm run test:kanban`
Expected: build succeeds, all tests pass

- [ ] **Step 11: Commit**

```bash
git add apps/kanban/src/core/core-lifecycle-stream-terminal-projection.types.ts apps/kanban/src/core/core-lifecycle-stream-terminal-projection.helpers.ts apps/kanban/src/core/core-lifecycle-stream-terminal-projection.helpers.spec.ts apps/kanban/src/core/core-lifecycle-stream.consumer.ts apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts
git commit -m "feat(kanban): record per-attempt cost history row on terminal work-item runs"
```

---

### Task 4: Internal API endpoint exposing model pricing rates

**Files:**

- Create: `apps/api/src/ai-config/controllers/models-internal.controller.ts`
- Create: `apps/api/src/ai-config/controllers/models-internal.controller.spec.ts`
- Modify: `apps/api/src/ai-config/controllers/index.ts`
- Modify: `apps/api/src/ai-config/ai-config-admin.service.ts`
- Modify: `apps/api/src/ai-config/ai-config-admin.service.spec.ts`
- Modify: `apps/api/src/ai-config/ai-config.module.ts`

**Interfaces:**

- Produces: `AiConfigAdminService.getActiveModelRates(): Promise<Array<{ modelId: string; providerName: string | null; modelName: string; inputTokenCentsPerMillion: number | null; outputTokenCentsPerMillion: number | null }>>`.
- Produces: `GET /internal/models/rates`, gated by `InternalServiceScopeGuard` + `JwtAuthGuard` + `PermissionsGuard`, requiring `RequirePermission('agents:read')` and `@InternalServiceScopes('core.models:read')`. Consumed by Task 5's `CoreModelPricingClientService`.

- [ ] **Step 1: Write the failing service test**

Add to `apps/api/src/ai-config/ai-config-admin.service.spec.ts` (find the `describe` block and existing mock for `llmModelRepo`/`ModelCrudService`, add alongside):

```ts
it("getActiveModelRates returns only active models mapped to id/provider/name/rates", async () => {
  llmModelRepo.findAll.mockResolvedValue([
    {
      id: "model-1",
      name: "claude-sonnet-5",
      provider_name: "anthropic",
      input_token_cents_per_million: 300,
      output_token_cents_per_million: 1500,
      is_active: true,
    },
    {
      id: "model-2",
      name: "retired-model",
      provider_name: "openai",
      input_token_cents_per_million: 100,
      output_token_cents_per_million: 200,
      is_active: false,
    },
  ]);

  const result = await service.getActiveModelRates();

  expect(result).toEqual([
    {
      modelId: "model-1",
      providerName: "anthropic",
      modelName: "claude-sonnet-5",
      inputTokenCentsPerMillion: 300,
      outputTokenCentsPerMillion: 1500,
    },
  ]);
});
```

(If `llmModelRepo` is not already a mock in scope in this spec file, add `findAll: vi.fn()` to whatever mock object backs `LlmModelRepository` in the existing test setup, matching however the surrounding tests already inject it into `AiConfigAdminService`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- ai-config-admin.service.spec.ts`
Expected: FAIL — `service.getActiveModelRates is not a function`

- [ ] **Step 3: Implement `getActiveModelRates`**

In `apps/api/src/ai-config/ai-config-admin.service.ts`, add a method (near `listModelsPaginated` at line 180):

```ts
  async getActiveModelRates(): Promise<
    Array<{
      modelId: string;
      providerName: string | null;
      modelName: string;
      inputTokenCentsPerMillion: number | null;
      outputTokenCentsPerMillion: number | null;
    }>
  > {
    const models = await this.llmModelRepo.findAll();
    return models
      .filter((model) => model.is_active)
      .map((model) => ({
        modelId: model.id,
        providerName: model.provider_name ?? null,
        modelName: model.name,
        inputTokenCentsPerMillion: model.input_token_cents_per_million ?? null,
        outputTokenCentsPerMillion:
          model.output_token_cents_per_million ?? null,
      }));
  }
```

(Reference whatever the constructor's existing field name is for the injected `LlmModelRepository` in this class — follow the same property name already used by `listModelsPaginated`/neighboring methods, e.g. `this.llmModelRepo` if that's the established name.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- ai-config-admin.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Add the new internal service scope**

In `apps/kanban/src/core/kanban-core-auth-token.provider.ts`, add `"core.models:read"` to `KANBAN_CORE_SERVICE_SCOPES` (lines 5-11):

```ts
export const KANBAN_CORE_SERVICE_SCOPES = [
  "core.events:write",
  "core.domain-events:write",
  "core.workflow-runs:read",
  "core.workflow-runs:write",
  "core.secrets:read",
  "core.models:read",
] as const;
```

- [ ] **Step 6: Write the failing controller test**

Create `apps/api/src/ai-config/controllers/models-internal.controller.spec.ts`, mirroring `secrets-internal.controller.spec.ts`'s structure but scoped to this controller:

```ts
import { describe, expect, it, vi } from "vitest";
import { ModelsInternalController } from "./models-internal.controller";
import type { AiConfigAdminService } from "../ai-config-admin.service";

describe("ModelsInternalController", () => {
  it("getRates returns the admin service's active model rates", async () => {
    const rates = [
      {
        modelId: "model-1",
        providerName: "anthropic",
        modelName: "claude-sonnet-5",
        inputTokenCentsPerMillion: 300,
        outputTokenCentsPerMillion: 1500,
      },
    ];
    const aiConfigAdmin = {
      getActiveModelRates: vi.fn().mockResolvedValue(rates),
    } as unknown as AiConfigAdminService;
    const controller = new ModelsInternalController(aiConfigAdmin);

    await expect(controller.getRates()).resolves.toEqual({ rates });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- models-internal.controller.spec.ts`
Expected: FAIL — module `./models-internal.controller` does not exist

- [ ] **Step 8: Implement the controller**

Create `apps/api/src/ai-config/controllers/models-internal.controller.ts`, following the `SecretsInternalController` pattern exactly:

```ts
import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { InternalServiceScopeGuard } from "../../auth/internal-service-scope.guard";
import { InternalServiceScopes } from "../../auth/internal-service-scopes.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/authorization/permissions.guard";
import { RequirePermission } from "../../auth/authorization/require-permission.decorator";
import { AiConfigAdminService } from "../ai-config-admin.service";

@ApiTags("internal")
@Controller("internal/models")
@UseGuards(InternalServiceScopeGuard, JwtAuthGuard, PermissionsGuard)
@RequirePermission("agents:read")
export class ModelsInternalController {
  constructor(private readonly aiConfigAdmin: AiConfigAdminService) {}

  @Get("rates")
  @InternalServiceScopes("core.models:read")
  @ApiOperation({
    summary:
      "List active model pricing rates for service-to-service cost estimation (internal use only)",
  })
  async getRates() {
    return { rates: await this.aiConfigAdmin.getActiveModelRates() };
  }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- models-internal.controller.spec.ts`
Expected: PASS

- [ ] **Step 10: Register the controller**

In `apps/api/src/ai-config/controllers/index.ts`, add: `export * from './models-internal.controller';`

In `apps/api/src/ai-config/ai-config.module.ts`:

- Add `ModelsInternalController` to the destructured import from `./controllers` (line 11-20)
- Add `ModelsInternalController` to the `controllers` array (line 70-79)

- [ ] **Step 11: Build and run the ai-config suite**

Run: `npm run build:api && npm run test --workspace=apps/api -- ai-config`
Expected: build succeeds, all ai-config tests pass

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/ai-config/controllers/models-internal.controller.ts apps/api/src/ai-config/controllers/models-internal.controller.spec.ts apps/api/src/ai-config/controllers/index.ts apps/api/src/ai-config/ai-config-admin.service.ts apps/api/src/ai-config/ai-config-admin.service.spec.ts apps/api/src/ai-config/ai-config.module.ts apps/kanban/src/core/kanban-core-auth-token.provider.ts
git commit -m "feat(ai-config): add internal model-rates endpoint for service-to-service pricing sync"
```

---

### Task 5: `kanban_model_pricing_cache` table + background sync from the internal endpoint

**Files:**

- Create: `apps/kanban/src/database/migrations/20260707100000-create-model-pricing-cache.ts`
- Create: `apps/kanban/src/database/entities/kanban-model-pricing-cache.entity.ts`
- Create: `apps/kanban/src/database/repositories/kanban-model-pricing-cache.repository.ts`
- Create: `apps/kanban/src/database/repositories/kanban-model-pricing-cache.repository.spec.ts`
- Create: `apps/kanban/src/core/core-model-pricing-client.service.ts`
- Create: `apps/kanban/src/core/core-model-pricing-client.service.spec.ts`
- Create: `apps/kanban/src/core/model-pricing-cache-sync.service.ts`
- Create: `apps/kanban/src/core/model-pricing-cache-sync.service.spec.ts`
- Modify: `apps/kanban/src/database/database.module.ts`
- Modify: `apps/kanban/src/core/core-integration.module.ts`

**Interfaces:**

- Produces: `KanbanModelPricingCacheRepository.upsertRates(rates): Promise<void>`, `.findAll(): Promise<KanbanModelPricingCacheEntity[]>`. Consumed by Task 7 (estimation service).
- Produces: `CoreModelPricingClientService.fetchActiveModelRates(): Promise<Array<{ modelId: string; providerName: string | null; modelName: string; inputTokenCentsPerMillion: number | null; outputTokenCentsPerMillion: number | null }>>`.
- Produces: `ModelPricingCacheSyncService` (`OnModuleInit`/`OnModuleDestroy`, `setInterval`-based, mirrors `CoreLifecycleStreamConsumerService`'s polling pattern).

- [ ] **Step 1: Write the entity**

Create `apps/kanban/src/database/entities/kanban-model-pricing-cache.entity.ts`:

```ts
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_model_pricing_cache")
export class KanbanModelPricingCacheEntity {
  @PrimaryColumn({ type: "varchar" })
  model_id!: string;

  @Column({ type: "varchar", nullable: true })
  provider_name!: string | null;

  @Column({ type: "varchar" })
  model_name!: string;

  @Column({ type: "integer", nullable: true })
  input_token_cents_per_million!: number | null;

  @Column({ type: "integer", nullable: true })
  output_token_cents_per_million!: number | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ name: "synced_at", type: "timestamp" })
  synced_at!: Date;
}
```

- [ ] **Step 2: Write the migration**

Create `apps/kanban/src/database/migrations/20260707100000-create-model-pricing-cache.ts`:

```ts
import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateModelPricingCache20260707100000 implements MigrationInterface {
  name = "CreateModelPricingCache20260707100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_model_pricing_cache (
        model_id character varying PRIMARY KEY,
        provider_name character varying NULL,
        model_name character varying NOT NULL,
        input_token_cents_per_million integer NULL,
        output_token_cents_per_million integer NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        synced_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS kanban_model_pricing_cache");
  }
}
```

- [ ] **Step 3: Write the failing repository test**

Create `apps/kanban/src/database/repositories/kanban-model-pricing-cache.repository.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { KanbanModelPricingCacheEntity } from "../entities/kanban-model-pricing-cache.entity";
import { KanbanModelPricingCacheRepository } from "./kanban-model-pricing-cache.repository";

describe("KanbanModelPricingCacheRepository", () => {
  let repo: KanbanModelPricingCacheRepository;
  let mockRepo: {
    upsert: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    mockRepo = {
      upsert: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockResolvedValue([]),
    };

    const module = await Test.createTestingModule({
      providers: [
        KanbanModelPricingCacheRepository,
        {
          provide: getRepositoryToken(KanbanModelPricingCacheEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repo = module.get(KanbanModelPricingCacheRepository);
  });

  it("upsertRates writes each rate keyed by model_id", async () => {
    await repo.upsertRates([
      {
        modelId: "model-1",
        providerName: "anthropic",
        modelName: "claude-sonnet-5",
        inputTokenCentsPerMillion: 300,
        outputTokenCentsPerMillion: 1500,
      },
    ]);

    expect(mockRepo.upsert).toHaveBeenCalledWith(
      [
        {
          model_id: "model-1",
          provider_name: "anthropic",
          model_name: "claude-sonnet-5",
          input_token_cents_per_million: 300,
          output_token_cents_per_million: 1500,
        },
      ],
      ["model_id"],
    );
  });

  it("upsertRates is a no-op for an empty list", async () => {
    await repo.upsertRates([]);
    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- kanban-model-pricing-cache.repository.spec.ts`
Expected: FAIL — module does not exist

- [ ] **Step 5: Implement the repository**

Create `apps/kanban/src/database/repositories/kanban-model-pricing-cache.repository.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanModelPricingCacheEntity } from "../entities/kanban-model-pricing-cache.entity";

export interface ModelRateInput {
  modelId: string;
  providerName: string | null;
  modelName: string;
  inputTokenCentsPerMillion: number | null;
  outputTokenCentsPerMillion: number | null;
}

@Injectable()
export class KanbanModelPricingCacheRepository {
  constructor(
    @InjectRepository(KanbanModelPricingCacheEntity)
    private readonly repository: Repository<KanbanModelPricingCacheEntity>,
  ) {}

  async upsertRates(rates: ModelRateInput[]): Promise<void> {
    if (rates.length === 0) {
      return;
    }

    await this.repository.upsert(
      rates.map((rate) => ({
        model_id: rate.modelId,
        provider_name: rate.providerName,
        model_name: rate.modelName,
        input_token_cents_per_million: rate.inputTokenCentsPerMillion,
        output_token_cents_per_million: rate.outputTokenCentsPerMillion,
      })),
      ["model_id"],
    );
  }

  findAll(): Promise<KanbanModelPricingCacheEntity[]> {
    return this.repository.find();
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- kanban-model-pricing-cache.repository.spec.ts`
Expected: PASS

- [ ] **Step 7: Write the failing pricing-client test**

Create `apps/kanban/src/core/core-model-pricing-client.service.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { CoreModelPricingClientService } from "./core-model-pricing-client.service";

describe("CoreModelPricingClientService", () => {
  it("fetchActiveModelRates GETs /internal/models/rates and returns the rates array", async () => {
    const httpClient = {
      getJson: vi.fn().mockResolvedValue({
        rates: [
          {
            modelId: "model-1",
            providerName: "anthropic",
            modelName: "claude-sonnet-5",
            inputTokenCentsPerMillion: 300,
            outputTokenCentsPerMillion: 1500,
          },
        ],
      }),
    };
    const service = new CoreModelPricingClientService(httpClient as never);

    const result = await service.fetchActiveModelRates();

    expect(httpClient.getJson).toHaveBeenCalledWith(
      "/internal/models/rates",
      "fetch active model rates",
    );
    expect(result).toEqual([
      {
        modelId: "model-1",
        providerName: "anthropic",
        modelName: "claude-sonnet-5",
        inputTokenCentsPerMillion: 300,
        outputTokenCentsPerMillion: 1500,
      },
    ]);
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- core-model-pricing-client.service.spec.ts`
Expected: FAIL — module does not exist

- [ ] **Step 9: Implement the pricing client**

Create `apps/kanban/src/core/core-model-pricing-client.service.ts`, following `core-secret-client.service.ts`'s pattern but injected the same way `CoreScopeClientService` builds its own `KanbanCoreHttpClient` (so it needs no separate wiring for base URL/auth):

```ts
import { Inject, Injectable } from "@nestjs/common";
import type { ServiceClientHttpOptions } from "@nexus/core";
import { KanbanCoreAuthTokenProvider } from "./kanban-core-auth-token.provider";
import { KanbanCoreHttpClient } from "./kanban-core-http-client";

const DEFAULT_CORE_BASE_URL = "http://localhost:3010/api";

export interface ModelRate {
  modelId: string;
  providerName: string | null;
  modelName: string;
  inputTokenCentsPerMillion: number | null;
  outputTokenCentsPerMillion: number | null;
}

@Injectable()
export class CoreModelPricingClientService {
  private readonly httpClient: KanbanCoreHttpClient;

  constructor(
    @Inject(KanbanCoreAuthTokenProvider)
    private readonly authTokenProvider: KanbanCoreAuthTokenProvider,
  ) {
    const coreBaseUrl =
      this.readOptionalEnv("KANBAN_CORE_BASE_URL") ?? DEFAULT_CORE_BASE_URL;
    this.httpClient = new KanbanCoreHttpClient(
      coreBaseUrl,
      this.resolveHttpOptions(coreBaseUrl),
    );
  }

  async fetchActiveModelRates(): Promise<ModelRate[]> {
    const response = await this.httpClient.getJson<{ rates: ModelRate[] }>(
      "/internal/models/rates",
      "fetch active model rates",
    );
    return response.rates;
  }

  private resolveHttpOptions(baseUrl: string): ServiceClientHttpOptions {
    return {
      baseUrl,
      authorizationHeaderResolver: () =>
        this.authTokenProvider.resolveAuthorizationHeader(),
    };
  }

  private readOptionalEnv(key: string): string | null {
    const value = process.env[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
```

Note: the test in Step 7 constructs the service with a fake `httpClient` directly (`new CoreModelPricingClientService(httpClient as never)`), which only works if the constructor takes the http client directly rather than building it internally. Revise the constructor to accept `KanbanCoreHttpClient` as a constructor-injected dependency instead of building it inline, matching the test:

```ts
import { Injectable } from "@nestjs/common";
import { KanbanCoreHttpClient } from "./kanban-core-http-client";

export interface ModelRate {
  modelId: string;
  providerName: string | null;
  modelName: string;
  inputTokenCentsPerMillion: number | null;
  outputTokenCentsPerMillion: number | null;
}

@Injectable()
export class CoreModelPricingClientService {
  constructor(private readonly httpClient: KanbanCoreHttpClient) {}

  async fetchActiveModelRates(): Promise<ModelRate[]> {
    const response = await this.httpClient.getJson<{ rates: ModelRate[] }>(
      "/internal/models/rates",
      "fetch active model rates",
    );
    return response.rates;
  }
}
```

This mirrors `CoreSecretClientService`'s exact shape (constructor takes `KanbanCoreHttpClient` directly); the module wiring in Step 13 provides that dependency via a factory, the same way `CoreScopeClientService`/`CoreSecretClientService` are wired elsewhere in `core-integration.module.ts` (check that module for the existing `KanbanCoreHttpClient` factory-provider pattern before adding a new one — reuse it rather than constructing a second client instance if one is already provided at module scope).

- [ ] **Step 10: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- core-model-pricing-client.service.spec.ts`
Expected: PASS

- [ ] **Step 11: Write the failing sync-service test**

Create `apps/kanban/src/core/model-pricing-cache-sync.service.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ModelPricingCacheSyncService } from "./model-pricing-cache-sync.service";

describe("ModelPricingCacheSyncService", () => {
  it("syncOnce fetches active rates and upserts them into the cache", async () => {
    const rates = [
      {
        modelId: "model-1",
        providerName: "anthropic",
        modelName: "claude-sonnet-5",
        inputTokenCentsPerMillion: 300,
        outputTokenCentsPerMillion: 1500,
      },
    ];
    const pricingClient = {
      fetchActiveModelRates: vi.fn().mockResolvedValue(rates),
    };
    const cache = { upsertRates: vi.fn().mockResolvedValue(undefined) };
    const service = new ModelPricingCacheSyncService(
      pricingClient as never,
      cache as never,
    );

    await service.syncOnce();

    expect(cache.upsertRates).toHaveBeenCalledWith(rates);
  });

  it("syncOnce swallows fetch errors so a transient API outage does not crash the timer", async () => {
    const pricingClient = {
      fetchActiveModelRates: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const cache = { upsertRates: vi.fn() };
    const service = new ModelPricingCacheSyncService(
      pricingClient as never,
      cache as never,
    );

    await expect(service.syncOnce()).resolves.toBeUndefined();
    expect(cache.upsertRates).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 12: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- model-pricing-cache-sync.service.spec.ts`
Expected: FAIL — module does not exist

- [ ] **Step 13: Implement the sync service**

Create `apps/kanban/src/core/model-pricing-cache-sync.service.ts`, following the `setInterval`/`OnModuleInit`/`OnModuleDestroy` pattern already established by `CoreLifecycleStreamConsumerService`:

```ts
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { CoreModelPricingClientService } from "./core-model-pricing-client.service";
import { KanbanModelPricingCacheRepository } from "../database/repositories/kanban-model-pricing-cache.repository";

const DEFAULT_SYNC_INTERVAL_MS = 15 * 60 * 1000;
type PollTimer = ReturnType<typeof setInterval>;

@Injectable()
export class ModelPricingCacheSyncService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ModelPricingCacheSyncService.name);
  private timer: PollTimer | null = null;

  constructor(
    private readonly pricingClient: CoreModelPricingClientService,
    private readonly cache: KanbanModelPricingCacheRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncOnce();
    this.timer = setInterval(() => {
      void this.syncOnce();
    }, this.readIntervalMs());
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async syncOnce(): Promise<void> {
    try {
      const rates = await this.pricingClient.fetchActiveModelRates();
      await this.cache.upsertRates(rates);
    } catch (error) {
      this.logger.warn(
        `Failed to sync model pricing cache: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private readIntervalMs(): number {
    const raw = process.env.KANBAN_MODEL_PRICING_SYNC_INTERVAL_MS;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_SYNC_INTERVAL_MS;
  }
}
```

- [ ] **Step 14: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- model-pricing-cache-sync.service.spec.ts`
Expected: PASS

- [ ] **Step 15: Register everything in `DatabaseModule` and `CoreIntegrationModule`**

In `apps/kanban/src/database/database.module.ts`: add `KanbanModelPricingCacheEntity` to `entities`, `KanbanModelPricingCacheRepository` to `repositories`, and `CreateModelPricingCache20260707100000` at the top of `migrations` (above `CreateWorkItemRunCosts20260707090000` from Task 2, since it's a later timestamp).

In `apps/kanban/src/core/core-integration.module.ts`, add `CoreModelPricingClientService` and `ModelPricingCacheSyncService` to `providers` (find the existing `KanbanCoreHttpClient` provider factory this module already uses for `CoreSecretClientService`/similar and reuse it for `CoreModelPricingClientService`'s injection — do not construct a second raw `KanbanCoreHttpClient` inline).

- [ ] **Step 16: Build and run the full kanban suite**

Run: `npm run build --workspace=apps/kanban && npm run test:kanban`
Expected: build succeeds, all tests pass

- [ ] **Step 17: Commit**

```bash
git add apps/kanban/src/database/entities/kanban-model-pricing-cache.entity.ts apps/kanban/src/database/repositories/kanban-model-pricing-cache.repository.ts apps/kanban/src/database/repositories/kanban-model-pricing-cache.repository.spec.ts apps/kanban/src/database/migrations/20260707100000-create-model-pricing-cache.ts apps/kanban/src/core/core-model-pricing-client.service.ts apps/kanban/src/core/core-model-pricing-client.service.spec.ts apps/kanban/src/core/model-pricing-cache-sync.service.ts apps/kanban/src/core/model-pricing-cache-sync.service.spec.ts apps/kanban/src/database/database.module.ts apps/kanban/src/core/core-integration.module.ts
git commit -m "feat(kanban): sync model pricing into a local cache on a background timer"
```

---

### Task 6: `kanban_work_item_cost_bucket_stats` table + background aggregation

**Files:**

- Create: `apps/kanban/src/database/migrations/20260707110000-create-work-item-cost-bucket-stats.ts`
- Create: `apps/kanban/src/database/entities/kanban-work-item-cost-bucket-stat.entity.ts`
- Create: `apps/kanban/src/database/repositories/kanban-work-item-cost-bucket-stat.repository.ts`
- Create: `apps/kanban/src/database/repositories/kanban-work-item-cost-bucket-stat.repository.spec.ts`
- Create: `apps/kanban/src/work-item/cost-estimation/bucket-tiers.ts`
- Create: `apps/kanban/src/work-item/cost-estimation/bucket-tiers.spec.ts`
- Create: `apps/kanban/src/work-item/cost-estimation/work-item-cost-bucket-stats-refresh.service.ts`
- Create: `apps/kanban/src/work-item/cost-estimation/work-item-cost-bucket-stats-refresh.service.spec.ts`
- Modify: `apps/kanban/src/database/database.module.ts`

**Interfaces:**

- Produces: `BUCKET_TIERS: BucketTierConfig[]` (the "config, not hardcoded query logic" extensibility point from the spec) and `computeTokenDistribution(samples: number[]): { n: number; mean: number; p25: number; p75: number }`, both from `bucket-tiers.ts`. Consumed by Task 7.
- Produces: `KanbanWorkItemCostBucketStatEntity` (table `kanban_work_item_cost_bucket_stats`), `KanbanWorkItemCostBucketStatRepository.upsertBucket(...)`, `.findBestFit(params): Promise<KanbanWorkItemCostBucketStatEntity | null>` (walks `BUCKET_TIERS` in order, first tier with `n >= minSampleSize` wins). Consumed by Task 7.

- [ ] **Step 1: Write the failing bucket-tier config test**

Create `apps/kanban/src/work-item/cost-estimation/bucket-tiers.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { BUCKET_TIERS, computeTokenDistribution } from "./bucket-tiers";

describe("BUCKET_TIERS", () => {
  it("orders tiers from most to least specific, ending in global", () => {
    expect(BUCKET_TIERS.map((tier) => tier.name)).toEqual([
      "workflow_type_points",
      "workflow_type",
      "global",
    ]);
  });

  it("each tier declares its own minimum sample size", () => {
    for (const tier of BUCKET_TIERS) {
      expect(tier.minSampleSize).toBeGreaterThan(0);
    }
  });
});

describe("computeTokenDistribution", () => {
  it("computes n, mean, p25, p75 over a sample of token counts", () => {
    const result = computeTokenDistribution([100, 200, 300, 400, 500]);

    expect(result.n).toBe(5);
    expect(result.mean).toBe(300);
    expect(result.p25).toBe(200);
    expect(result.p75).toBe(400);
  });

  it("returns n=0 and zeroed stats for an empty sample", () => {
    expect(computeTokenDistribution([])).toEqual({
      n: 0,
      mean: 0,
      p25: 0,
      p75: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- bucket-tiers.spec.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement `bucket-tiers.ts`**

Create `apps/kanban/src/work-item/cost-estimation/bucket-tiers.ts`:

```ts
export interface BucketTierConfig {
  name: "workflow_type_points" | "workflow_type" | "global";
  minSampleSize: number;
  /** Which dimensions this tier groups by; `false` means "ignore this dimension". */
  usesWorkflow: boolean;
  usesStoryPoints: boolean;
}

/**
 * Ordered most-specific-first. `findBestFit` (Task 6's repository) walks this
 * list and returns the first tier whose sample count meets its
 * `minSampleSize`, falling back to the next entry otherwise. This list is the
 * single place bucketing dimensions are declared — adding a new dimension
 * (e.g. agent profile, project/scope) means adding an entry here plus a
 * column on `kanban_work_item_cost_bucket_stats`, not touching the
 * aggregation or estimation logic.
 */
export const BUCKET_TIERS: BucketTierConfig[] = [
  {
    name: "workflow_type_points",
    minSampleSize: 5,
    usesWorkflow: true,
    usesStoryPoints: true,
  },
  {
    name: "workflow_type",
    minSampleSize: 5,
    usesWorkflow: true,
    usesStoryPoints: false,
  },
  {
    name: "global",
    minSampleSize: 1,
    usesWorkflow: false,
    usesStoryPoints: false,
  },
];

export interface TokenDistribution {
  n: number;
  mean: number;
  p25: number;
  p75: number;
}

function percentile(sorted: number[], fraction: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.floor(fraction * sorted.length),
  );
  return sorted[index];
}

export function computeTokenDistribution(samples: number[]): TokenDistribution {
  if (samples.length === 0) {
    return { n: 0, mean: 0, p25: 0, p75: 0 };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;

  return {
    n: sorted.length,
    mean,
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- bucket-tiers.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the entity**

Create `apps/kanban/src/database/entities/kanban-work-item-cost-bucket-stat.entity.ts`:

```ts
import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_work_item_cost_bucket_stats")
@Index(
  "idx_kanban_cost_bucket_stats_key",
  ["tier", "workflow_id", "type", "story_points"],
  { unique: true },
)
export class KanbanWorkItemCostBucketStatEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 32 })
  tier!: string;

  @Column({ type: "varchar", nullable: true })
  workflow_id!: string | null;

  @Column({ type: "varchar", length: 16 })
  type!: string;

  @Column({ type: "smallint", nullable: true })
  story_points!: number | null;

  @Column({ type: "integer" })
  sample_count!: number;

  @Column({ type: "double precision" })
  mean_input_tokens!: number;

  @Column({ type: "double precision" })
  p25_input_tokens!: number;

  @Column({ type: "double precision" })
  p75_input_tokens!: number;

  @Column({ type: "double precision" })
  mean_output_tokens!: number;

  @Column({ type: "double precision" })
  p25_output_tokens!: number;

  @Column({ type: "double precision" })
  p75_output_tokens!: number;

  @UpdateDateColumn({ type: "timestamp" })
  computed_at!: Date;
}
```

- [ ] **Step 6: Write the migration**

Create `apps/kanban/src/database/migrations/20260707110000-create-work-item-cost-bucket-stats.ts`:

```ts
import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWorkItemCostBucketStats20260707110000 implements MigrationInterface {
  name = "CreateWorkItemCostBucketStats20260707110000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_work_item_cost_bucket_stats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tier character varying(32) NOT NULL,
        workflow_id character varying NULL,
        type character varying(16) NOT NULL,
        story_points smallint NULL,
        sample_count integer NOT NULL,
        mean_input_tokens double precision NOT NULL,
        p25_input_tokens double precision NOT NULL,
        p75_input_tokens double precision NOT NULL,
        mean_output_tokens double precision NOT NULL,
        p25_output_tokens double precision NOT NULL,
        p75_output_tokens double precision NOT NULL,
        computed_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_cost_bucket_stats_key
      ON kanban_work_item_cost_bucket_stats(
        tier,
        COALESCE(workflow_id, ''),
        type,
        COALESCE(story_points, -1)
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_work_item_cost_bucket_stats",
    );
  }
}
```

- [ ] **Step 7: Write the failing repository test**

Create `apps/kanban/src/database/repositories/kanban-work-item-cost-bucket-stat.repository.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { KanbanWorkItemCostBucketStatEntity } from "../entities/kanban-work-item-cost-bucket-stat.entity";
import { KanbanWorkItemCostBucketStatRepository } from "./kanban-work-item-cost-bucket-stat.repository";

describe("KanbanWorkItemCostBucketStatRepository", () => {
  let repo: KanbanWorkItemCostBucketStatRepository;
  let mockRepo: {
    upsert: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getOne: vi.fn().mockResolvedValue(null),
    };
    mockRepo = {
      upsert: vi.fn().mockResolvedValue(undefined),
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    };

    const module = await Test.createTestingModule({
      providers: [
        KanbanWorkItemCostBucketStatRepository,
        {
          provide: getRepositoryToken(KanbanWorkItemCostBucketStatEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    repo = module.get(KanbanWorkItemCostBucketStatRepository);
  });

  it("findByKey looks up a bucket by tier/workflow/type/points, handling null workflow/points", async () => {
    const queryBuilder = mockRepo.createQueryBuilder();
    queryBuilder.getOne.mockResolvedValue({
      tier: "global",
      sample_count: 12,
    });

    const result = await repo.findByKey({
      tier: "global",
      workflowId: null,
      type: "task",
      storyPoints: null,
    });

    expect(queryBuilder.where).toHaveBeenCalledWith("s.tier = :tier", {
      tier: "global",
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith("s.workflow_id IS NULL");
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "s.story_points IS NULL",
    );
    expect(result).toEqual({ tier: "global", sample_count: 12 });
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- kanban-work-item-cost-bucket-stat.repository.spec.ts`
Expected: FAIL — module does not exist

- [ ] **Step 9: Implement the repository**

Create `apps/kanban/src/database/repositories/kanban-work-item-cost-bucket-stat.repository.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KanbanWorkItemCostBucketStatEntity } from "../entities/kanban-work-item-cost-bucket-stat.entity";

export interface BucketKey {
  tier: string;
  workflowId: string | null;
  type: string;
  storyPoints: number | null;
}

export interface UpsertBucketInput extends BucketKey {
  sampleCount: number;
  meanInputTokens: number;
  p25InputTokens: number;
  p75InputTokens: number;
  meanOutputTokens: number;
  p25OutputTokens: number;
  p75OutputTokens: number;
}

@Injectable()
export class KanbanWorkItemCostBucketStatRepository {
  constructor(
    @InjectRepository(KanbanWorkItemCostBucketStatEntity)
    private readonly repository: Repository<KanbanWorkItemCostBucketStatEntity>,
  ) {}

  async upsertBucket(input: UpsertBucketInput): Promise<void> {
    await this.repository.upsert(
      {
        tier: input.tier,
        workflow_id: input.workflowId,
        type: input.type,
        story_points: input.storyPoints,
        sample_count: input.sampleCount,
        mean_input_tokens: input.meanInputTokens,
        p25_input_tokens: input.p25InputTokens,
        p75_input_tokens: input.p75InputTokens,
        mean_output_tokens: input.meanOutputTokens,
        p25_output_tokens: input.p25OutputTokens,
        p75_output_tokens: input.p75OutputTokens,
      },
      ["tier", "workflow_id", "type", "story_points"],
    );
  }

  findByKey(
    key: BucketKey,
  ): Promise<KanbanWorkItemCostBucketStatEntity | null> {
    const qb = this.repository
      .createQueryBuilder("s")
      .where("s.tier = :tier", { tier: key.tier })
      .andWhere("s.type = :type", { type: key.type });

    if (key.workflowId === null) {
      qb.andWhere("s.workflow_id IS NULL");
    } else {
      qb.andWhere("s.workflow_id = :workflowId", {
        workflowId: key.workflowId,
      });
    }

    if (key.storyPoints === null) {
      qb.andWhere("s.story_points IS NULL");
    } else {
      qb.andWhere("s.story_points = :storyPoints", {
        storyPoints: key.storyPoints,
      });
    }

    return qb.getOne();
  }
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- kanban-work-item-cost-bucket-stat.repository.spec.ts`
Expected: PASS

- [ ] **Step 11: Write the failing refresh-service test**

Create `apps/kanban/src/work-item/cost-estimation/work-item-cost-bucket-stats-refresh.service.spec.ts`. Per the design spec's retry handling, a work item retried across multiple attempts must contribute **one** summed sample to a bucket (cost-to-completion), not one sample per attempt — otherwise a heavily-retried item silently drags bucket averages up by being overweighted:

```ts
import { describe, it, expect, vi } from "vitest";
import { WorkItemCostBucketStatsRefreshService } from "./work-item-cost-bucket-stats-refresh.service";

describe("WorkItemCostBucketStatsRefreshService", () => {
  it("sums retried attempts per work item, then groups the per-work-item totals by every configured tier", async () => {
    const attempts = [
      // wi-1: single attempt
      {
        work_item_id: "wi-1",
        workflow_id: "wf-1",
        type: "task",
        story_points: 3,
        total_input_tokens: 100,
        total_output_tokens: 20,
      },
      // wi-2: two attempts (a retry) that must be summed into one sample of
      // 200/40 before entering the bucket, not counted as two samples
      {
        work_item_id: "wi-2",
        workflow_id: "wf-1",
        type: "task",
        story_points: 3,
        total_input_tokens: 150,
        total_output_tokens: 30,
      },
      {
        work_item_id: "wi-2",
        workflow_id: "wf-1",
        type: "task",
        story_points: 3,
        total_input_tokens: 50,
        total_output_tokens: 10,
      },
      // wi-3: single attempt, different bucket
      {
        work_item_id: "wi-3",
        workflow_id: "wf-2",
        type: "bug",
        story_points: null,
        total_input_tokens: 50,
        total_output_tokens: 10,
      },
    ];
    const runCosts = {
      findAllForBucketAggregation: vi.fn().mockResolvedValue(attempts),
    };
    const bucketStats = { upsertBucket: vi.fn().mockResolvedValue(undefined) };
    const service = new WorkItemCostBucketStatsRefreshService(
      runCosts as never,
      bucketStats as never,
    );

    await service.refreshOnce();

    // workflow_type_points tier: (wf-1, task, 3) has 2 samples — wi-1's 100
    // and wi-2's summed 200 (150+50), NOT 3 samples from 3 attempt rows
    expect(bucketStats.upsertBucket).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "workflow_type_points",
        workflowId: "wf-1",
        type: "task",
        storyPoints: 3,
        sampleCount: 2,
        meanInputTokens: 150,
      }),
    );
    // global tier: 3 samples (one per work item), ignoring workflow/type/points
    expect(bucketStats.upsertBucket).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "global",
        workflowId: null,
        type: "__all__",
        storyPoints: null,
        sampleCount: 3,
      }),
    );
  });
});
```

- [ ] **Step 12: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item-cost-bucket-stats-refresh.service.spec.ts`
Expected: FAIL — module does not exist

- [ ] **Step 13: Implement the refresh service**

Create `apps/kanban/src/work-item/cost-estimation/work-item-cost-bucket-stats-refresh.service.ts`:

```ts
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { KanbanWorkItemRunCostRepository } from "../../database/repositories/kanban-work-item-run-cost.repository";
import { KanbanWorkItemCostBucketStatRepository } from "../../database/repositories/kanban-work-item-cost-bucket-stat.repository";
import { BUCKET_TIERS, computeTokenDistribution } from "./bucket-tiers";

const DEFAULT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
/** Sentinel `type` for the global tier, which ignores type/workflow/points. */
const GLOBAL_TYPE_KEY = "__all__";
type PollTimer = ReturnType<typeof setInterval>;

interface BucketAccumulator {
  workflowId: string | null;
  type: string;
  storyPoints: number | null;
  inputTokens: number[];
  outputTokens: number[];
}

interface WorkItemTotal {
  workflowId: string | null;
  type: string;
  storyPoints: number | null;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/**
 * Sums every attempt's tokens onto its work item before bucketing, so a
 * work item retried N times contributes exactly one "cost-to-completion"
 * sample — matching what a user actually cares about (total cost to get
 * the work done) rather than overweighting retried items by counting each
 * attempt separately.
 */
function sumAttemptsPerWorkItem(
  attempts: Array<{
    work_item_id: string;
    workflow_id: string | null;
    type: string;
    story_points: number | null;
    total_input_tokens: number;
    total_output_tokens: number;
  }>,
): WorkItemTotal[] {
  const totals = new Map<string, WorkItemTotal>();

  for (const attempt of attempts) {
    const existing = totals.get(attempt.work_item_id);
    if (existing) {
      existing.totalInputTokens += attempt.total_input_tokens;
      existing.totalOutputTokens += attempt.total_output_tokens;
      continue;
    }
    totals.set(attempt.work_item_id, {
      workflowId: attempt.workflow_id,
      type: attempt.type,
      storyPoints: attempt.story_points,
      totalInputTokens: attempt.total_input_tokens,
      totalOutputTokens: attempt.total_output_tokens,
    });
  }

  return Array.from(totals.values());
}

@Injectable()
export class WorkItemCostBucketStatsRefreshService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    WorkItemCostBucketStatsRefreshService.name,
  );
  private timer: PollTimer | null = null;

  constructor(
    private readonly runCosts: KanbanWorkItemRunCostRepository,
    private readonly bucketStats: KanbanWorkItemCostBucketStatRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshOnce();
    this.timer = setInterval(() => {
      void this.refreshOnce();
    }, this.readIntervalMs());
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async refreshOnce(): Promise<void> {
    try {
      const attempts = await this.runCosts.findAllForBucketAggregation();
      const perWorkItemTotals = sumAttemptsPerWorkItem(attempts);

      for (const tier of BUCKET_TIERS) {
        const groups = new Map<string, BucketAccumulator>();

        for (const total of perWorkItemTotals) {
          const workflowId = tier.usesWorkflow ? total.workflowId : null;
          const type = tier.name === "global" ? GLOBAL_TYPE_KEY : total.type;
          const storyPoints = tier.usesStoryPoints ? total.storyPoints : null;
          const key = `${workflowId ?? ""}::${type}::${storyPoints ?? ""}`;

          const group = groups.get(key) ?? {
            workflowId,
            type,
            storyPoints,
            inputTokens: [],
            outputTokens: [],
          };
          group.inputTokens.push(total.totalInputTokens);
          group.outputTokens.push(total.totalOutputTokens);
          groups.set(key, group);
        }

        for (const group of groups.values()) {
          const inputDist = computeTokenDistribution(group.inputTokens);
          const outputDist = computeTokenDistribution(group.outputTokens);

          await this.bucketStats.upsertBucket({
            tier: tier.name,
            workflowId: group.workflowId,
            type: group.type,
            storyPoints: group.storyPoints,
            sampleCount: inputDist.n,
            meanInputTokens: inputDist.mean,
            p25InputTokens: inputDist.p25,
            p75InputTokens: inputDist.p75,
            meanOutputTokens: outputDist.mean,
            p25OutputTokens: outputDist.p25,
            p75OutputTokens: outputDist.p75,
          });
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to refresh work item cost bucket stats: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private readIntervalMs(): number {
    const raw = process.env.KANBAN_COST_BUCKET_REFRESH_INTERVAL_MS;
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_REFRESH_INTERVAL_MS;
  }
}
```

Export `sumAttemptsPerWorkItem` and `WorkItemTotal` from this file (add `export` to both) — Task 9's `getCostEstimateAccuracy` reuses it so accuracy is computed against the same per-work-item cost-to-completion totals as the bucket stats, not raw per-attempt rows.

- [ ] **Step 14: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- work-item-cost-bucket-stats-refresh.service.spec.ts`
Expected: PASS

- [ ] **Step 15: Register everything in `DatabaseModule` and create a `CostEstimationModule`**

In `apps/kanban/src/database/database.module.ts`: add `KanbanWorkItemCostBucketStatEntity` to `entities`, `KanbanWorkItemCostBucketStatRepository` to `repositories`, and `CreateWorkItemCostBucketStats20260707110000` at the top of `migrations`.

Create `apps/kanban/src/work-item/cost-estimation/cost-estimation.module.ts`:

```ts
import { forwardRef, Module } from "@nestjs/common";
import { WorkItemCostBucketStatsRefreshService } from "./work-item-cost-bucket-stats-refresh.service";
import { WorkItemModule } from "../work-item.module";

@Module({
  imports: [forwardRef(() => WorkItemModule)],
  providers: [WorkItemCostBucketStatsRefreshService],
  exports: [WorkItemCostBucketStatsRefreshService],
})
export class CostEstimationModule {
  protected readonly moduleName = CostEstimationModule.name;
}
```

(This module is deliberately separate from `WorkItemModule` itself, and will also host Task 7's estimation service and Task 8's controller — kept in its own `cost-estimation/` subdirectory under `work-item/` since it's a distinct concern from CRUD/lifecycle.)

- [ ] **Step 16: Build and run the full kanban suite**

Run: `npm run build --workspace=apps/kanban && npm run test:kanban`
Expected: build succeeds, all tests pass

- [ ] **Step 17: Commit**

```bash
git add apps/kanban/src/database/entities/kanban-work-item-cost-bucket-stat.entity.ts apps/kanban/src/database/repositories/kanban-work-item-cost-bucket-stat.repository.ts apps/kanban/src/database/repositories/kanban-work-item-cost-bucket-stat.repository.spec.ts apps/kanban/src/database/migrations/20260707110000-create-work-item-cost-bucket-stats.ts apps/kanban/src/work-item/cost-estimation/ apps/kanban/src/database/database.module.ts
git commit -m "feat(kanban): materialize bucketed token-distribution stats on a background timer"
```

---

### Task 7: `WorkItemCostEstimationService` — bucket lookup + pricing math

**Files:**

- Create: `apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.service.ts`
- Create: `apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.service.spec.ts`
- Create: `apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.types.ts`
- Modify: `apps/kanban/src/work-item/cost-estimation/cost-estimation.module.ts`

**Interfaces:**

- Consumes: `KanbanWorkItemCostBucketStatRepository.findByKey` (Task 6), `KanbanModelPricingCacheRepository.findAll` (Task 5), `BUCKET_TIERS` (Task 6).
- Produces: `WorkItemCostEstimationService.estimate(input: CostEstimateInput): Promise<CostEstimateResult>`, the stable contract consumed by Task 8's controller and Task 12's UI. Both types live in `work-item-cost-estimation.types.ts`.

- [ ] **Step 1: Define the contract types**

Create `apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.types.ts`:

```ts
export interface CostEstimateInput {
  workflowId: string | null;
  type: string;
  storyPoints: number | null;
  /** The model the estimate should be primarily expressed in. */
  modelId: string | null;
}

export interface CostEstimateWhatIf {
  modelId: string;
  modelName: string;
  providerName: string | null;
  estimatedCostCents: number;
}

export interface CostEstimateResult {
  available: boolean;
  bucketTier: string | null;
  sampleCount: number;
  estimatedCostCents: number | null;
  lowCostCents: number | null;
  highCostCents: number | null;
  whatIf: CostEstimateWhatIf[];
}
```

- [ ] **Step 2: Write the failing service test**

Create `apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.service.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { WorkItemCostEstimationService } from "./work-item-cost-estimation.service";

const PRICING_CACHE = [
  {
    model_id: "model-1",
    model_name: "claude-sonnet-5",
    provider_name: "anthropic",
    input_token_cents_per_million: 300,
    output_token_cents_per_million: 1500,
  },
  {
    model_id: "model-2",
    model_name: "gpt-5-mini",
    provider_name: "openai",
    input_token_cents_per_million: 100,
    output_token_cents_per_million: 400,
  },
];

describe("WorkItemCostEstimationService", () => {
  it("returns unavailable when no bucket tier has any samples", async () => {
    const bucketStats = { findByKey: vi.fn().mockResolvedValue(null) };
    const pricingCache = { findAll: vi.fn().mockResolvedValue(PRICING_CACHE) };
    const service = new WorkItemCostEstimationService(
      bucketStats as never,
      pricingCache as never,
    );

    const result = await service.estimate({
      workflowId: "wf-1",
      type: "task",
      storyPoints: 3,
      modelId: "model-1",
    });

    expect(result.available).toBe(false);
    expect(result.whatIf).toEqual([]);
  });

  it("falls back to a coarser tier and computes the estimate + what-if list from cached pricing", async () => {
    const bucketStats = {
      findByKey: vi
        .fn()
        // workflow_type_points: no data
        .mockResolvedValueOnce(null)
        // workflow_type: has data
        .mockResolvedValueOnce({
          tier: "workflow_type",
          sample_count: 8,
          mean_input_tokens: 1000,
          p25_input_tokens: 800,
          p75_input_tokens: 1200,
          mean_output_tokens: 200,
          p25_output_tokens: 150,
          p75_output_tokens: 250,
        }),
    };
    const pricingCache = { findAll: vi.fn().mockResolvedValue(PRICING_CACHE) };
    const service = new WorkItemCostEstimationService(
      bucketStats as never,
      pricingCache as never,
    );

    const result = await service.estimate({
      workflowId: "wf-1",
      type: "task",
      storyPoints: 3,
      modelId: "model-1",
    });

    expect(result.available).toBe(true);
    expect(result.bucketTier).toBe("workflow_type");
    expect(result.sampleCount).toBe(8);
    // primary estimate: 1000 input @ 300c/M + 200 output @ 1500c/M
    // = (1000*300 + 200*1500) / 1_000_000 cents = 0.3 + 0.3 = 0.6 -> ceil -> 1
    expect(result.estimatedCostCents).toBe(1);
    expect(result.whatIf).toEqual([
      {
        modelId: "model-2",
        modelName: "gpt-5-mini",
        providerName: "openai",
        // 1000*100 + 200*400 = 180000 / 1_000_000 = 0.18 -> ceil -> 1
        estimatedCostCents: 1,
      },
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item-cost-estimation.service.spec.ts`
Expected: FAIL — module does not exist

- [ ] **Step 4: Implement the estimation service**

Create `apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { KanbanWorkItemCostBucketStatRepository } from "../../database/repositories/kanban-work-item-cost-bucket-stat.repository";
import { KanbanModelPricingCacheRepository } from "../../database/repositories/kanban-model-pricing-cache.repository";
import { BUCKET_TIERS } from "./bucket-tiers";
import type {
  CostEstimateInput,
  CostEstimateResult,
  CostEstimateWhatIf,
} from "./work-item-cost-estimation.types";

const GLOBAL_TYPE_KEY = "__all__";

function tokensToCents(
  inputTokens: number,
  outputTokens: number,
  inputCentsPerMillion: number | null,
  outputCentsPerMillion: number | null,
): number | null {
  if (inputCentsPerMillion === null || outputCentsPerMillion === null) {
    return null;
  }
  return Math.ceil(
    (inputTokens * inputCentsPerMillion +
      outputTokens * outputCentsPerMillion) /
      1_000_000,
  );
}

@Injectable()
export class WorkItemCostEstimationService {
  constructor(
    private readonly bucketStats: KanbanWorkItemCostBucketStatRepository,
    private readonly pricingCache: KanbanModelPricingCacheRepository,
  ) {}

  async estimate(input: CostEstimateInput): Promise<CostEstimateResult> {
    const bucket = await this.findBestFitBucket(input);
    if (!bucket) {
      return {
        available: false,
        bucketTier: null,
        sampleCount: 0,
        estimatedCostCents: null,
        lowCostCents: null,
        highCostCents: null,
        whatIf: [],
      };
    }

    const rates = await this.pricingCache.findAll();
    const primaryRate = rates.find((rate) => rate.model_id === input.modelId);

    const estimatedCostCents = primaryRate
      ? tokensToCents(
          bucket.mean_input_tokens,
          bucket.mean_output_tokens,
          primaryRate.input_token_cents_per_million,
          primaryRate.output_token_cents_per_million,
        )
      : null;
    const lowCostCents = primaryRate
      ? tokensToCents(
          bucket.p25_input_tokens,
          bucket.p25_output_tokens,
          primaryRate.input_token_cents_per_million,
          primaryRate.output_token_cents_per_million,
        )
      : null;
    const highCostCents = primaryRate
      ? tokensToCents(
          bucket.p75_input_tokens,
          bucket.p75_output_tokens,
          primaryRate.input_token_cents_per_million,
          primaryRate.output_token_cents_per_million,
        )
      : null;

    const whatIf: CostEstimateWhatIf[] = rates
      .filter((rate) => rate.model_id !== input.modelId)
      .map((rate) => {
        const cents = tokensToCents(
          bucket.mean_input_tokens,
          bucket.mean_output_tokens,
          rate.input_token_cents_per_million,
          rate.output_token_cents_per_million,
        );
        return cents === null
          ? null
          : {
              modelId: rate.model_id,
              modelName: rate.model_name,
              providerName: rate.provider_name,
              estimatedCostCents: cents,
            };
      })
      .filter((row): row is CostEstimateWhatIf => row !== null);

    return {
      available: true,
      bucketTier: bucket.tier,
      sampleCount: bucket.sample_count,
      estimatedCostCents,
      lowCostCents,
      highCostCents,
      whatIf,
    };
  }

  private async findBestFitBucket(input: CostEstimateInput) {
    for (const tier of BUCKET_TIERS) {
      const bucket = await this.bucketStats.findByKey({
        tier: tier.name,
        workflowId: tier.usesWorkflow ? input.workflowId : null,
        type: tier.name === "global" ? GLOBAL_TYPE_KEY : input.type,
        storyPoints: tier.usesStoryPoints ? input.storyPoints : null,
      });
      if (bucket && bucket.sample_count >= tier.minSampleSize) {
        return bucket;
      }
    }
    return null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- work-item-cost-estimation.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Register in `CostEstimationModule`**

In `apps/kanban/src/work-item/cost-estimation/cost-estimation.module.ts`, add `WorkItemCostEstimationService` to `providers` and `exports`.

- [ ] **Step 7: Build and run the full kanban suite**

Run: `npm run build --workspace=apps/kanban && npm run test:kanban`
Expected: build succeeds, all tests pass

- [ ] **Step 8: Commit**

```bash
git add apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.service.ts apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.service.spec.ts apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.types.ts apps/kanban/src/work-item/cost-estimation/cost-estimation.module.ts
git commit -m "feat(kanban): compute pre-execution cost estimates with model what-if comparisons"
```

---

### Task 8: Cost-estimate REST endpoints

**Files:**

- Create: `apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.controller.ts`
- Create: `apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.controller.spec.ts`
- Modify: `apps/kanban/src/work-item/cost-estimation/cost-estimation.module.ts`
- Modify: `apps/kanban/src/work-item/work-item.module.ts`

**Interfaces:**

- Consumes: `WorkItemCostEstimationService.estimate` (Task 7), `WorkItemService`/`KanbanWorkItemRepository.findByProjectAndId` (existing, `apps/kanban/src/database/repositories/kanban-work-item.repository.ts:247-257`) for looking up an existing work item's `type`/`story_points`/`workflow` and configured model.
- Produces: `GET /work-items/:projectId/:id/cost-estimate`, `POST /work-items/cost-estimate/preview`.

- [ ] **Step 1: Write the failing controller test**

Create `apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.controller.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { WorkItemCostEstimationController } from "./work-item-cost-estimation.controller";

describe("WorkItemCostEstimationController", () => {
  it("preview delegates the request body straight to the estimation service", async () => {
    const estimationResult = {
      available: true,
      bucketTier: "global",
      sampleCount: 3,
      estimatedCostCents: 100,
      lowCostCents: 80,
      highCostCents: 120,
      whatIf: [],
    };
    const estimationService = {
      estimate: vi.fn().mockResolvedValue(estimationResult),
    };
    const workItems = { findByProjectAndId: vi.fn() };
    const controller = new WorkItemCostEstimationController(
      estimationService as never,
      workItems as never,
    );

    const result = await controller.preview({
      workflowId: "wf-1",
      type: "task",
      storyPoints: 3,
      modelId: "model-1",
    });

    expect(estimationService.estimate).toHaveBeenCalledWith({
      workflowId: "wf-1",
      type: "task",
      storyPoints: 3,
      modelId: "model-1",
    });
    expect(result).toEqual({ success: true, data: estimationResult });
  });

  it("getForWorkItem resolves the work item's current type/points/workflow/model before estimating", async () => {
    const estimationResult = {
      available: true,
      bucketTier: "global",
      sampleCount: 1,
      estimatedCostCents: 50,
      lowCostCents: 40,
      highCostCents: 60,
      whatIf: [],
    };
    const estimationService = {
      estimate: vi.fn().mockResolvedValue(estimationResult),
    };
    const workItems = {
      findByProjectAndId: vi.fn().mockResolvedValue({
        id: "wi-1",
        project_id: "proj-1",
        type: "bug",
        story_points: 5,
        execution_config: { model: "model-2", workflowId: "wf-2" },
      }),
    };
    const controller = new WorkItemCostEstimationController(
      estimationService as never,
      workItems as never,
    );

    const result = await controller.getForWorkItem("proj-1", "wi-1");

    expect(estimationService.estimate).toHaveBeenCalledWith({
      workflowId: "wf-2",
      type: "bug",
      storyPoints: 5,
      modelId: "model-2",
    });
    expect(result).toEqual({ success: true, data: estimationResult });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item-cost-estimation.controller.spec.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement the controller**

Create `apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { WorkItemCostEstimationService } from "./work-item-cost-estimation.service";
import { KanbanWorkItemRepository } from "../../database/repositories/kanban-work-item.repository";
import type { CostEstimateInput } from "./work-item-cost-estimation.types";

@Controller("work-items")
export class WorkItemCostEstimationController {
  constructor(
    private readonly estimationService: WorkItemCostEstimationService,
    private readonly workItems: KanbanWorkItemRepository,
  ) {}

  @Post("cost-estimate/preview")
  async preview(@Body() body: CostEstimateInput) {
    return { success: true, data: await this.estimationService.estimate(body) };
  }

  @Get(":projectId/:id/cost-estimate")
  async getForWorkItem(
    @Param("projectId") projectId: string,
    @Param("id") id: string,
  ) {
    const item = await this.workItems.findByProjectAndId(projectId, id);
    if (!item) {
      throw new NotFoundException(`Work item ${id} not found`);
    }

    const executionConfig = (item.execution_config ?? {}) as {
      model?: string;
      workflowId?: string;
    };

    const data = await this.estimationService.estimate({
      workflowId: executionConfig.workflowId ?? null,
      type: item.type,
      storyPoints: item.story_points,
      modelId: executionConfig.model ?? null,
    });
    return { success: true, data };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- work-item-cost-estimation.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Register the controller**

In `apps/kanban/src/work-item/cost-estimation/cost-estimation.module.ts`, add `controllers: [WorkItemCostEstimationController]` and import `KanbanWorkItemRepository`'s owning concern is already `@Global()` from `DatabaseModule`, so it resolves without extra wiring.

In `apps/kanban/src/work-item/work-item.module.ts`, add `CostEstimationModule` (with `forwardRef`, matching the existing import style at lines 19-22) to `imports` so `WorkItemModule`'s own controllers/services can later inject `WorkItemCostEstimationService` if needed (Task 9).

- [ ] **Step 6: Build and run the full kanban suite**

Run: `npm run build --workspace=apps/kanban && npm run test:kanban`
Expected: build succeeds, all tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.controller.ts apps/kanban/src/work-item/cost-estimation/work-item-cost-estimation.controller.spec.ts apps/kanban/src/work-item/cost-estimation/cost-estimation.module.ts apps/kanban/src/work-item/work-item.module.ts
git commit -m "feat(kanban): expose pre-execution cost-estimate REST endpoints"
```

---

### Task 9: Predicted-vs-actual in cost-summary + calibration accuracy endpoint

**Files:**

- Modify: `apps/kanban/src/work-item/work-item.service.ts:157-` (the `getWorkItemCostSummary` method)
- Modify: `apps/kanban/src/work-item/work-item.service.spec.ts` (or wherever `getWorkItemCostSummary` is already tested)
- Modify: `apps/kanban/src/work-item/work-item-global.controller.ts`
- Modify: `apps/kanban/src/work-item/work-item-global.controller.spec.ts`
- Modify: `apps/kanban/src/work-item/work-item.module.ts`

**Interfaces:**

- Consumes: `WorkItemCostEstimationService.estimate` (Task 7), `KanbanWorkItemRepository.findTopByCostDesc` (existing).
- Produces: `WorkItemService.getWorkItemCostSummary` return type gains `predictedCostCents: number | null` per item; new `WorkItemService.getCostEstimateAccuracy(): Promise<{ sampleCount: number; meanAbsoluteErrorCents: number; meanAbsolutePercentageError: number | null }>`; new `GET /work-items/cost-estimate/accuracy`.

- [ ] **Step 1: Write the failing service test for predicted cost in the summary**

Find the existing test for `getWorkItemCostSummary` (grep `apps/kanban/src/work-item` for a spec exercising it — likely inline in `work-item.service.spec.ts` or `work-item.service.query.spec.ts`) and add a case asserting the new field, following whatever mocking convention that file already uses for `KanbanWorkItemRepository.findTopByCostDesc` — e.g.:

```ts
it("getWorkItemCostSummary includes a predicted cost per item from the estimation service", async () => {
  workItems.findTopByCostDesc.mockResolvedValue([
    {
      id: "wi-1",
      project_id: "proj-1",
      title: "Fix bug",
      status: "done",
      cost_cents: 120,
      token_spend: 4000,
      type: "bug",
      story_points: 3,
      execution_config: { model: "model-1", workflowId: "wf-1" },
    },
  ]);
  estimationService.estimate.mockResolvedValue({
    available: true,
    bucketTier: "global",
    sampleCount: 10,
    estimatedCostCents: 90,
    lowCostCents: 70,
    highCostCents: 110,
    whatIf: [],
  });

  const result = await service.getWorkItemCostSummary({ limit: 20 });

  expect(result[0]).toEqual(
    expect.objectContaining({ id: "wi-1", predictedCostCents: 90 }),
  );
});
```

(Add an `estimationService` mock with an `estimate: vi.fn()` to the test file's existing `WorkItemService` construction, threaded into whichever constructor position the implementation step below adds it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/kanban -- work-item.service`
Expected: FAIL — `predictedCostCents` is `undefined` on the returned row

- [ ] **Step 3: Wire `WorkItemCostEstimationService` into `WorkItemService.getWorkItemCostSummary`**

In `apps/kanban/src/work-item/work-item.service.ts`, add `WorkItemCostEstimationService` as a constructor dependency (alongside the existing repository dependencies), then update `getWorkItemCostSummary` (the body starting at line 170, after `const items = await this.workItems.findTopByCostDesc(...)`) to map each item through the estimation service:

```ts
  async getWorkItemCostSummary(params: {
    limit?: number;
    projectId?: string;
  }): Promise<
    {
      id: string;
      project_id: string;
      title: string;
      status: string;
      costCents: number;
      tokenSpend: number;
      predictedCostCents: number | null;
    }[]
  > {
    const items = await this.workItems.findTopByCostDesc({
      limit: params.limit ?? 20,
      projectId: params.projectId,
    });

    return Promise.all(
      items.map(async (item) => {
        const executionConfig = (item.execution_config ?? {}) as {
          model?: string;
          workflowId?: string;
        };
        const estimate = await this.costEstimation.estimate({
          workflowId: executionConfig.workflowId ?? null,
          type: item.type,
          storyPoints: item.story_points,
          modelId: executionConfig.model ?? null,
        });

        return {
          id: item.id,
          project_id: item.project_id,
          title: item.title,
          status: item.status,
          costCents: item.cost_cents,
          tokenSpend: item.token_spend,
          predictedCostCents: estimate.available
            ? estimate.estimatedCostCents
            : null,
        };
      }),
    );
  }
```

(`findTopByCostDesc`'s selected columns at `kanban-work-item.repository.ts:159-166` currently omit `type`/`story_points`/`execution_config` — extend that `.select([...])` list to include `w.type`, `w.story_points`, `w.execution_config` so this mapping has the fields it needs.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- work-item.service`
Expected: PASS

- [ ] **Step 5: Write the failing accuracy-method test**

Add to the same spec file. Actual cost must be the **summed cost-to-completion per work item** (matching Task 6's `sumAttemptsPerWorkItem`), not a raw per-attempt row — otherwise a retried work item's cost gets compared against the estimate multiple times and its retry overhead is split across those comparisons instead of counted once:

```ts
it("getCostEstimateAccuracy sums retried attempts per work item, then computes MAE against each item's single predicted-vs-actual pair", async () => {
  runCosts.findAllForBucketAggregation.mockResolvedValue([
    {
      work_item_id: "wi-1",
      workflow_id: "wf-1",
      type: "task",
      story_points: 3,
      total_cost_cents: 100,
    },
    // wi-2 retried once: actual cost-to-completion is 150+50=200, not two
    // separate 150/50 comparisons
    {
      work_item_id: "wi-2",
      workflow_id: "wf-1",
      type: "task",
      story_points: 3,
      total_cost_cents: 150,
    },
    {
      work_item_id: "wi-2",
      workflow_id: "wf-1",
      type: "task",
      story_points: 3,
      total_cost_cents: 50,
    },
  ]);
  estimationService.estimate
    .mockResolvedValueOnce({ available: true, estimatedCostCents: 90 })
    .mockResolvedValueOnce({ available: true, estimatedCostCents: 220 });

  const result = await service.getCostEstimateAccuracy();

  expect(estimationService.estimate).toHaveBeenCalledTimes(2);
  expect(result.sampleCount).toBe(2);
  // wi-1: |100-90| = 10, wi-2: |200-220| = 20 -> mean = 15
  expect(result.meanAbsoluteErrorCents).toBe(15);
  // wi-1: |100-90|/100 = 0.1, wi-2: |200-220|/200 = 0.1 -> mean = 0.1
  expect(result.meanAbsolutePercentageError).toBeCloseTo(0.1);
});

it("getCostEstimateAccuracy excludes a zero-actual-cost item from MAPE (division by zero) but keeps it in MAE", async () => {
  runCosts.findAllForBucketAggregation.mockResolvedValue([
    {
      work_item_id: "wi-1",
      workflow_id: "wf-1",
      type: "task",
      story_points: 3,
      total_cost_cents: 0,
    },
  ]);
  estimationService.estimate.mockResolvedValueOnce({
    available: true,
    estimatedCostCents: 10,
  });

  const result = await service.getCostEstimateAccuracy();

  expect(result.meanAbsoluteErrorCents).toBe(10);
  expect(result.meanAbsolutePercentageError).toBeNull();
});
```

- [ ] **Step 6: Implement `getCostEstimateAccuracy`**

In `apps/kanban/src/work-item/work-item.service.ts`, add (using `KanbanWorkItemRunCostRepository` — already available via `DatabaseModule`'s global exports — as a new constructor dependency, and reusing `sumAttemptsPerWorkItem` exported from `cost-estimation/work-item-cost-bucket-stats-refresh.service.ts` in Task 6):

```ts
  async getCostEstimateAccuracy(): Promise<{
    sampleCount: number;
    meanAbsoluteErrorCents: number;
    meanAbsolutePercentageError: number | null;
  }> {
    const attempts = await this.runCosts.findAllForBucketAggregation();
    const perWorkItemTotals = sumAttemptsPerWorkItemWithCost(attempts);
    if (perWorkItemTotals.length === 0) {
      return {
        sampleCount: 0,
        meanAbsoluteErrorCents: 0,
        meanAbsolutePercentageError: null,
      };
    }

    const absoluteErrors: number[] = [];
    const percentageErrors: number[] = [];
    for (const total of perWorkItemTotals) {
      const estimate = await this.costEstimation.estimate({
        workflowId: total.workflowId,
        type: total.type,
        storyPoints: total.storyPoints,
        modelId: null,
      });
      if (!estimate.available || estimate.estimatedCostCents === null) {
        continue;
      }
      const absoluteError = Math.abs(
        total.totalCostCents - estimate.estimatedCostCents,
      );
      absoluteErrors.push(absoluteError);
      // MAPE is undefined when the actual cost is zero (division by zero);
      // such items still count toward MAE above, just not this ratio.
      if (total.totalCostCents > 0) {
        percentageErrors.push(absoluteError / total.totalCostCents);
      }
    }

    const meanAbsoluteErrorCents =
      absoluteErrors.length > 0
        ? absoluteErrors.reduce((sum, value) => sum + value, 0) /
          absoluteErrors.length
        : 0;
    const meanAbsolutePercentageError =
      percentageErrors.length > 0
        ? percentageErrors.reduce((sum, value) => sum + value, 0) /
          percentageErrors.length
        : null;

    return {
      sampleCount: absoluteErrors.length,
      meanAbsoluteErrorCents,
      meanAbsolutePercentageError,
    };
  }
```

`sumAttemptsPerWorkItemWithCost` is a small local helper in this file (accuracy needs `total_cost_cents` summed per work item, whereas Task 6's exported `sumAttemptsPerWorkItem` sums token counts) — add it near the top of `work-item.service.ts`:

```ts
function sumAttemptsPerWorkItemWithCost(
  attempts: Array<{
    work_item_id: string;
    workflow_id: string | null;
    type: string;
    story_points: number | null;
    total_cost_cents: number;
  }>,
): Array<{
  workflowId: string | null;
  type: string;
  storyPoints: number | null;
  totalCostCents: number;
}> {
  const totals = new Map<
    string,
    {
      workflowId: string | null;
      type: string;
      storyPoints: number | null;
      totalCostCents: number;
    }
  >();

  for (const attempt of attempts) {
    const existing = totals.get(attempt.work_item_id);
    if (existing) {
      existing.totalCostCents += attempt.total_cost_cents;
      continue;
    }
    totals.set(attempt.work_item_id, {
      workflowId: attempt.workflow_id,
      type: attempt.type,
      storyPoints: attempt.story_points,
      totalCostCents: attempt.total_cost_cents,
    });
  }

  return Array.from(totals.values());
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test --workspace=apps/kanban -- work-item.service`
Expected: PASS

- [ ] **Step 8: Add the accuracy endpoint**

In `apps/kanban/src/work-item/work-item-global.controller.ts`, add after `getCostSummary` (after line 38):

```ts
  @Get("cost-estimate/accuracy")
  async getCostEstimateAccuracy() {
    const data = await this.workItems.getCostEstimateAccuracy();
    return { success: true, data };
  }
```

Add a matching test to `work-item-global.controller.spec.ts` mirroring the existing `getCostSummary` test's shape.

- [ ] **Step 9: Wire the new constructor dependencies through `WorkItemModule`**

In `apps/kanban/src/work-item/work-item.module.ts`, `WorkItemService` already resolves `WorkItemCostEstimationService` and `KanbanWorkItemRunCostRepository` as long as `CostEstimationModule` (imported per Task 8, Step 5) is in `imports` and both are exported from their respective modules — no further module wiring should be needed. Verify via the build in the next step rather than adding speculative providers.

- [ ] **Step 10: Build and run the full kanban suite**

Run: `npm run build --workspace=apps/kanban && npm run test:kanban`
Expected: build succeeds, all tests pass

- [ ] **Step 11: Commit**

```bash
git add apps/kanban/src/work-item/work-item.service.ts apps/kanban/src/work-item/work-item.service.spec.ts apps/kanban/src/work-item/work-item-global.controller.ts apps/kanban/src/work-item/work-item-global.controller.spec.ts apps/kanban/src/work-item/work-item.module.ts apps/kanban/src/database/repositories/kanban-work-item.repository.ts
git commit -m "feat(kanban): add predicted-cost and calibration accuracy to cost reporting"
```

---

### Task 10: Backfill migration for historical `kanban_work_item_run_costs`

**Files:**

- Create: `apps/kanban/src/database/migrations/20260707120000-backfill-work-item-run-costs.ts`
- Modify: `apps/kanban/src/database/database.module.ts`

**Interfaces:**

- None — this is a one-time data migration, no new code surface.

- [ ] **Step 1: Write the migration**

Create `apps/kanban/src/database/migrations/20260707120000-backfill-work-item-run-costs.ts`, mirroring `20260619090000-backfill-work-item-token-spend.ts`'s guard style, joining `kanban_core_run_projections` to `budget_usage_events` per already-terminal run, and using each work item's **current** type/story_points/priority as the snapshot (the known limitation documented in the spec: pre-existing history can only be reconstructed where the run→work-item link is still resolvable):

```ts
import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One-time backfill of `kanban_work_item_run_costs` from already-terminal
 * runs recorded before this feature existed. Only reconstructable where
 * `kanban_core_run_projections` still links a run to a work item — see
 * docs/superpowers/specs/2026-07-07-work-item-cost-prediction-design.md
 * ("Known limitation") for why older, already-reconciled work items may not
 * backfill. Uses each work item's *current* type/story_points/priority as
 * the historical snapshot, since the true value at execution time is not
 * recoverable from `budget_usage_events` alone.
 *
 * Idempotent: `run_id` is unique on `kanban_work_item_run_costs`, so
 * `INSERT ... ON CONFLICT (run_id) DO NOTHING` makes re-running safe and
 * never clobbers a row the forward-accrual path has since written.
 */
export class BackfillWorkItemRunCosts20260707120000 implements MigrationInterface {
  name = "BackfillWorkItemRunCosts20260707120000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasWorkItems = await queryRunner.hasTable("kanban_work_items");
    const hasProjections = await queryRunner.hasTable(
      "kanban_core_run_projections",
    );
    const hasUsageEvents = await queryRunner.hasTable("budget_usage_events");
    const hasRunCosts = await queryRunner.hasTable(
      "kanban_work_item_run_costs",
    );
    if (!hasWorkItems || !hasProjections || !hasUsageEvents || !hasRunCosts) {
      return;
    }

    await queryRunner.query(`
      INSERT INTO kanban_work_item_run_costs (
        work_item_id, run_id, workflow_id, type, story_points, priority,
        attempt_number, is_retry, model_breakdown,
        total_input_tokens, total_output_tokens, total_cost_cents
      )
      SELECT
        wi.id,
        p.run_id,
        p.workflow_id,
        wi.type,
        wi.story_points,
        wi.priority,
        1,
        false,
        '[]'::jsonb,
        COALESCE(agg.input_tokens, 0),
        COALESCE(agg.output_tokens, 0),
        COALESCE(agg.cost_cents, 0)
      FROM kanban_core_run_projections p
      JOIN kanban_work_items wi ON wi.id::text = p.work_item_id
      JOIN (
        SELECT context_id,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(estimated_cost_cents) AS cost_cents
        FROM budget_usage_events
        GROUP BY context_id
      ) agg ON agg.context_id = p.run_id
      WHERE p.work_item_id IS NOT NULL
        AND p.work_item_id <> '__orchestration_lifecycle__'
        AND p.status IN ('COMPLETED', 'FAILED', 'CANCELLED')
        AND COALESCE(agg.cost_cents, 0) > 0
      ON CONFLICT (run_id) DO NOTHING
    `);
  }

  public async down(): Promise<void> {
    // No-op: reversing would delete rows the forward-accrual path may have
    // since written for the same run_ids; not distinguishable from this
    // migration's own inserts. Safe to leave as a no-op, matching the
    // precedent in 20260619090000-backfill-work-item-token-spend.ts.
  }
}
```

- [ ] **Step 2: Register the migration**

In `apps/kanban/src/database/database.module.ts`, add the import and place `BackfillWorkItemRunCosts20260707120000` at the **top** of the `migrations` array (it must run after Task 2's `CreateWorkItemRunCosts20260707090000`, so being newest-timestamped and listed first in the array is correct given the array is processed in the order TypeORM's runner expects — verify against how the existing `BackfillWorkItemTokenSpend20260619090000` entry is ordered relative to its own dependency in the current array, and match that convention exactly).

- [ ] **Step 3: Verify against a local database**

Run: `npm run test:kanban` (existing migration-adjacent tests should still pass; this migration has no dedicated spec since it mirrors the untested precedent `20260619090000-backfill-work-item-token-spend.ts`, which likewise has no unit test — consistent with existing convention for one-time SQL backfills)

Run: `npm run build --workspace=apps/kanban`
Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add apps/kanban/src/database/migrations/20260707120000-backfill-work-item-run-costs.ts apps/kanban/src/database/database.module.ts
git commit -m "feat(kanban): backfill historical work item run costs where run-to-item linkage survives"
```

---

### Task 11: Web — cost-estimate hook + panel on the work item detail view

**Files:**

- Modify: `apps/web/src/lib/api/client.projects.ts` (add `getWorkItemCostEstimate`)
- Modify: `apps/web/src/lib/api/client.projects.types.ts` (add request/response types)
- Modify: `apps/web/src/lib/queryKeys.ts`
- Create: `apps/web/src/hooks/useWorkItemCostEstimate.ts`
- Create: `apps/web/src/components/budget/WorkItemCostEstimatePanel.tsx`
- Create: `apps/web/src/components/budget/WorkItemCostEstimatePanel.spec.tsx`
- Modify: `apps/web/src/pages/kanban/WorkItemDetailSheetContent.tsx`

**Interfaces:**

- Consumes: `GET /work-items/:projectId/:id/cost-estimate` (Task 8).
- Produces: `useWorkItemCostEstimate(projectId: string, workItemId: string)` hook; `<WorkItemCostEstimatePanel item={item} />` component, rendered inside `WorkItemReadOnlyContent` in `WorkItemDetailSheetContent.tsx`.

- [ ] **Step 1: Add the API client method and types**

In `apps/web/src/lib/api/client.projects.types.ts`, add:

```ts
export interface WorkItemCostEstimateWhatIf {
  modelId: string;
  modelName: string;
  providerName: string | null;
  estimatedCostCents: number;
}

export interface WorkItemCostEstimate {
  available: boolean;
  bucketTier: string | null;
  sampleCount: number;
  estimatedCostCents: number | null;
  lowCostCents: number | null;
  highCostCents: number | null;
  whatIf: WorkItemCostEstimateWhatIf[];
}
```

In `apps/web/src/lib/api/client.projects.ts`, add after `getWorkItemCostSummary` (after line 462):

```ts
  async getWorkItemCostEstimate(projectId, workItemId) {
    return this.get<WorkItemCostEstimate>(
      `/work-items/${projectId}/${workItemId}/cost-estimate`,
    );
  },
```

(Add the corresponding method signature to whichever interface/type declares the `api` client's shape in this file, matching how `getWorkItemCostSummary` is declared there — same file, same pattern.)

- [ ] **Step 2: Add the query key**

In `apps/web/src/lib/queryKeys.ts`, add under `budget:` (near `workItemCostSummary`, if present, or alongside `summary`):

```ts
    workItemCostEstimate: (projectId: string, workItemId: string) =>
      ["work-item-cost-estimate", projectId, workItemId] as const,
```

- [ ] **Step 3: Write the hook**

Create `apps/web/src/hooks/useWorkItemCostEstimate.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";

export function useWorkItemCostEstimate(
  projectId: string | undefined,
  workItemId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.budget.workItemCostEstimate(
      projectId ?? "",
      workItemId ?? "",
    ),
    queryFn: () => api.getWorkItemCostEstimate(projectId!, workItemId!),
    enabled: Boolean(projectId) && Boolean(workItemId),
  });
}
```

- [ ] **Step 4: Write the failing panel test**

Create `apps/web/src/components/budget/WorkItemCostEstimatePanel.spec.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkItemCostEstimatePanel } from "./WorkItemCostEstimatePanel";
import * as hookModule from "@/hooks/useWorkItemCostEstimate";

describe("WorkItemCostEstimatePanel", () => {
  it("shows the point estimate, confidence note, and what-if list when available", () => {
    vi.spyOn(hookModule, "useWorkItemCostEstimate").mockReturnValue({
      data: {
        available: true,
        bucketTier: "workflow_type",
        sampleCount: 8,
        estimatedCostCents: 500,
        lowCostCents: 400,
        highCostCents: 600,
        whatIf: [
          {
            modelId: "model-2",
            modelName: "gpt-5-mini",
            providerName: "openai",
            estimatedCostCents: 300,
          },
        ],
      },
      isLoading: false,
    } as never);

    render(<WorkItemCostEstimatePanel projectId="proj-1" workItemId="wi-1" />);

    expect(screen.getByText("$5.00")).toBeInTheDocument();
    expect(screen.getByText(/based on 8/i)).toBeInTheDocument();
    expect(screen.getByText("gpt-5-mini")).toBeInTheDocument();
    expect(screen.getByText("$3.00")).toBeInTheDocument();
  });

  it("shows an insufficient-data message when no estimate is available", () => {
    vi.spyOn(hookModule, "useWorkItemCostEstimate").mockReturnValue({
      data: { available: false, whatIf: [] },
      isLoading: false,
    } as never);

    render(<WorkItemCostEstimatePanel projectId="proj-1" workItemId="wi-1" />);

    expect(screen.getByText(/not enough history/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm run test:unit:web -- WorkItemCostEstimatePanel`
Expected: FAIL — module `./WorkItemCostEstimatePanel` does not exist

- [ ] **Step 6: Implement the panel**

Create `apps/web/src/components/budget/WorkItemCostEstimatePanel.tsx`:

```tsx
import { useWorkItemCostEstimate } from "@/hooks/useWorkItemCostEstimate";
import { Label } from "@/components/ui/label";
import { formatCentsToDollars } from "./budget-format-utils";

export function WorkItemCostEstimatePanel({
  projectId,
  workItemId,
}: Readonly<{ projectId: string; workItemId: string }>) {
  const { data, isLoading } = useWorkItemCostEstimate(projectId, workItemId);

  if (isLoading || !data) {
    return null;
  }

  if (!data.available) {
    return (
      <div>
        <Label className="text-muted-foreground">Cost Estimate</Label>
        <p className="mt-1 text-sm text-muted-foreground">
          Not enough history yet to estimate this work item's cost.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Label className="text-muted-foreground">Cost Estimate</Label>
      <p className="mt-1 text-lg font-medium">
        {formatCentsToDollars(data.estimatedCostCents ?? 0)}
      </p>
      {data.lowCostCents !== null && data.highCostCents !== null && (
        <p className="text-xs text-muted-foreground">
          Range: {formatCentsToDollars(data.lowCostCents)} -{" "}
          {formatCentsToDollars(data.highCostCents)}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Based on {data.sampleCount} similar work item
        {data.sampleCount === 1 ? "" : "s"} ({data.bucketTier})
      </p>
      {data.whatIf.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {data.whatIf.map((row) => (
            <li key={row.modelId} className="flex justify-between gap-2">
              <span>{row.modelName}</span>
              <span className="tabular-nums">
                {formatCentsToDollars(row.estimatedCostCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm run test:unit:web -- WorkItemCostEstimatePanel`
Expected: PASS

- [ ] **Step 8: Wire the panel into the work item detail view**

In `apps/web/src/pages/kanban/WorkItemDetailSheetContent.tsx`, add the import:

```tsx
import { WorkItemCostEstimatePanel } from "@/components/budget/WorkItemCostEstimatePanel";
```

and render it inside `WorkItemReadOnlyContent`, right after the existing "Token Spend"/"Estimated Cost" block (after line 409, before `{item.executionConfig?.implementationPlan ? (`):

```tsx
<WorkItemCostEstimatePanel projectId={item.projectId} workItemId={item.id} />
```

(Confirm the exact prop name the `WorkItem` type uses for its project id — e.g. `item.projectId` vs `item.project_id` — against `apps/web/src/lib/api/types.ts` before finalizing; match whatever casing convention the rest of `WorkItemDetailSheetContent.tsx` already uses for `item.*` fields.)

- [ ] **Step 9: Run the full web unit suite**

Run: `npm run test:unit:web`
Expected: all tests pass

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/api/client.projects.ts apps/web/src/lib/api/client.projects.types.ts apps/web/src/lib/queryKeys.ts apps/web/src/hooks/useWorkItemCostEstimate.ts apps/web/src/components/budget/WorkItemCostEstimatePanel.tsx apps/web/src/components/budget/WorkItemCostEstimatePanel.spec.tsx apps/web/src/pages/kanban/WorkItemDetailSheetContent.tsx
git commit -m "feat(web): show pre-execution cost estimate and model what-if on the work item detail view"
```

---

### Task 12: Web — predicted-vs-actual column in the budget dashboard

**Files:**

- Modify: `apps/web/src/lib/api/client.projects.types.ts` (extend `WorkItemCostSummaryItem`)
- Modify: `apps/web/src/components/budget/BudgetWorkItemsTab.tsx`
- Create/Modify: `apps/web/src/components/budget/BudgetWorkItemsTab.spec.tsx` (add a case if a spec file already exists; otherwise create one)

**Interfaces:**

- Consumes: `predictedCostCents` field added to the `cost-summary` response (Task 9).

- [ ] **Step 1: Extend the `WorkItemCostSummaryItem` type**

In `apps/web/src/lib/api/client.projects.types.ts`, find `WorkItemCostSummaryItem` and add:

```ts
predictedCostCents: number | null;
```

- [ ] **Step 2: Write the failing test**

If `apps/web/src/components/budget/BudgetWorkItemsTab.spec.tsx` does not already exist, create it; otherwise add this case to it:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BudgetWorkItemsTab } from "./BudgetWorkItemsTab";
import * as hookModule from "@/hooks/useWorkItemCostSummary";

describe("BudgetWorkItemsTab", () => {
  it("renders a predicted-cost column alongside the actual cost", () => {
    vi.spyOn(hookModule, "useWorkItemCostSummary").mockReturnValue({
      data: [
        {
          id: "wi-1",
          title: "Fix bug",
          status: "done",
          tokenSpend: 4000,
          costCents: 120,
          predictedCostCents: 90,
        },
      ],
      isLoading: false,
    } as never);

    render(<BudgetWorkItemsTab />);

    expect(screen.getByText("$1.20")).toBeInTheDocument();
    expect(screen.getByText("$0.90")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit:web -- BudgetWorkItemsTab`
Expected: FAIL — predicted cost column not rendered

- [ ] **Step 4: Add the predicted-cost column**

In `apps/web/src/components/budget/BudgetWorkItemsTab.tsx`, add a header cell after `<th className="pb-2 text-right font-medium">Est. Cost</th>` (line 31):

```tsx
<th className="pb-2 text-right font-medium">Predicted</th>
```

and a body cell after the `Est. Cost` `<td>` (after line 50):

```tsx
<td className="py-2 text-right tabular-nums text-muted-foreground">
  {item.predictedCostCents !== null
    ? formatCentsToDollars(item.predictedCostCents)
    : "-"}
</td>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit:web -- BudgetWorkItemsTab`
Expected: PASS

- [ ] **Step 6: Run the full web unit suite**

Run: `npm run test:unit:web`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/api/client.projects.types.ts apps/web/src/components/budget/BudgetWorkItemsTab.tsx apps/web/src/components/budget/BudgetWorkItemsTab.spec.tsx
git commit -m "feat(web): show predicted-vs-actual cost in the budget work items dashboard"
```

---

## Post-implementation verification

After all tasks:

```bash
npm run build --workspace=packages/core
npm run build:api
npm run build:kanban
npm run build:web
npm run lint
npm run test:api
npm run test:kanban
npm run test:unit:web
```

Then, on a running local stack (`docker compose up -d --build`), manually verify: create a work item with a workflow/type/story-points combination that already has completed history, open its detail view, and confirm the Cost Estimate panel renders a point estimate, range, and at least one what-if row (requires the pricing-cache sync and bucket-stats refresh background jobs to have run at least once — restart the `kanban` container or wait for their `onModuleInit` pass).
