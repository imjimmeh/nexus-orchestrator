# Durable User-Question Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ask_user_questions` interactions durable so a user's answer always reaches the agent — surviving API restarts, container death, and arbitrarily long waits — and make every recovery path act on the _correct_ job.

**Architecture:** Mirror the existing `agent_await` park-and-resume pattern: persist a `user_question_awaits` row when a question is posed (run, job, step, questions). Answer delivery becomes persist → WS fast-path → resume-the-recorded-job, with `awaiting_input` cleared only on confirmed delivery. Recovery paths (resume, stale-run watchdog) derive the target job from `state_variables._internal` instead of the unreliable `current_step_id`. The broken null-placeholder DI for `TELEMETRY_GATEWAY` is removed so the WS fast path works at all.

**Tech Stack:** NestJS 10, TypeORM (PostgreSQL), BullMQ, Vitest (+SWC decorator metadata), socket.io, npm workspaces.

**Background (incident `1afb9630-ee8b-4b4b-9676-571a4b87b96e`, 2026-06-12):** Agent asked a question; API was restarted; user answered; the WS delivery crashed on a null `TELEMETRY_GATEWAY` token (`SharedKernelModule` provides it as `useValue: null` — NestJS does not "override" duplicate string tokens); the fallback resumed `capture_charter` (stale `current_step_id`) instead of `refine_charter`, discarding the answer; the container died unobserved; the stale-run watchdog now retries the wrong job forever. Five defects, fixed by Tasks 1–8 below.

**Out of scope (separate plan):** wiring `workflow_step` containers into the unified execution lifecycle (`executions` table heartbeats / `container_lost`) — see `docs/specs/SDD-unified-execution-lifecycle.md`.

---

## File Map

| File                                                                                    | Action     | Responsibility                                                                      |
| --------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| `apps/api/src/shared/shared-kernel.module.ts`                                           | **Delete** | Null-placeholder providers (the DI bug)                                             |
| `apps/api/src/telemetry/telemetry.module.ts`                                            | Modify     | Drop `SharedKernelModule` import                                                    |
| `apps/api/src/session/session.module.ts`                                                | Modify     | Drop `SharedKernelModule` import                                                    |
| `apps/api/src/workflow/workflow-run-operations/workflow-run-steering.service.ts`        | Modify     | Fail-fast gateway resolution; rewrite `submitQuestionAnswers`                       |
| `apps/api/src/session/session-hydration.service.ts`                                     | Modify     | Fail-fast gateway resolution                                                        |
| `apps/api/src/workflow/database/entities/user-question-await.entity.ts`                 | Create     | Durable pending-question record                                                     |
| `apps/api/src/workflow/database/repositories/user-question-await.repository.ts`         | Create     | Persistence for the record                                                          |
| `apps/api/src/database/migrations/20260616000000-create-user-question-awaits.ts`        | Create     | Table migration (timestamp sorts after existing `20260615000000-create-executions`) |
| `apps/api/src/workflow/workflow-run-operations/user-question-await.service.ts`          | Create     | Record lifecycle: posed / answered / superseded / cancelled                         |
| `apps/api/src/workflow/workflow-run-operations/workflow-run-awaiting-input.listener.ts` | Modify     | Delegate posed-event handling to the new service                                    |
| `apps/api/src/telemetry/telemetry-gateway-runtime.helpers.ts`                           | Modify     | Include `stepId`/`containerId` in the posed event                                   |
| `apps/api/src/workflow/workflow-job-message-queue.service.ts`                           | Modify     | `resumeJobWithMessage` options + correct job default                                |
| `apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts`                      | Modify     | Port signature                                                                      |
| `apps/api/src/workflow/workflow-engine.service.ts`                                      | Modify     | Delegation signature                                                                |
| `apps/api/src/workflow/workflow-await/dependency-parent-resume.service.ts`              | Modify     | Caller update                                                                       |
| `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts`  | Modify     | Per-job stale recovery + pending-question guard                                     |
| `apps/api/src/workflow/workflow-run-operations/stalled-job-resolution.helpers.ts`       | Create     | Pure helper: which jobs are actually stalled                                        |
| `apps/api/src/workflow/workflow-run-operations/question-idle-container.listener.ts`     | Create     | Wire `QuestionIdleTrackerService` callbacks (stop/remove container)                 |
| `packages/harness-runtime/src/kernel.ts`                                                | Modify     | Stop fabricating a fake "timed out" answer                                          |
| `docs/guide/*` + `apps/api/README.md`                                                   | Modify     | Document the new flow                                                               |

---

### Task 1: Remove the null-placeholder DI and fail fast on gateway resolution

The `TELEMETRY_GATEWAY` / `SESSION_HYDRATION_SERVICE` string tokens are each registered twice: real providers in `@Global()` `TelemetryModule` / `SessionModule`, and `useValue: null` placeholders in `SharedKernelModule`. `moduleRef.get(token, {strict: false})` resolves nondeterministically and returned the null in production. Because both real modules are `@Global()`, the placeholders are unnecessary — delete the module. Keep the _lazy_ `moduleRef.get` pattern (it exists to dodge an instantiation cycle between the workflow and telemetry graphs) but make a missing/null resolution loud.

**Files:**

- Delete: `apps/api/src/shared/shared-kernel.module.ts`
- Modify: `apps/api/src/telemetry/telemetry.module.ts`
- Modify: `apps/api/src/session/session.module.ts`
- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-steering.service.ts:53-57`
- Modify: `apps/api/src/session/session-hydration.service.ts:52-57`
- Test: `apps/api/src/workflow/workflow-run-operations/workflow-run-steering.service.spec.ts`

- [ ] **Step 1: Write the failing test**

In `workflow-run-steering.service.spec.ts`, find how the existing suite constructs the service (it builds the service directly with `vi.fn()` mocks; `moduleRef` is one of the constructor params). Add:

```typescript
describe("telemetryGateway resolution", () => {
  it("throws a descriptive error when the gateway token resolves to null", () => {
    const service = buildService({
      moduleRef: { get: vi.fn().mockReturnValue(null) },
    });

    expect(() => service["telemetryGateway"]).toThrow(
      /TELEMETRY_GATEWAY resolved to null/,
    );
  });

  it("returns the gateway when resolution succeeds", () => {
    const gateway = { sendQuestionResponseCommand: vi.fn() };
    const service = buildService({
      moduleRef: { get: vi.fn().mockReturnValue(gateway) },
    });

    expect(service["telemetryGateway"]).toBe(gateway);
  });
});
```

(`buildService` = whatever construction helper the spec already uses; pass the overridden `moduleRef` mock through it. If the spec constructs inline, mirror that style.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/workflow-run-operations/workflow-run-steering.service.spec.ts` (from `apps/api`)
Expected: FAIL — current getter returns null without throwing.

- [ ] **Step 3: Implement the fail-fast getter**

In `workflow-run-steering.service.ts` replace the getter (lines 53–57):

```typescript
  private get telemetryGateway(): ITelemetryGateway {
    const gateway = this.moduleRef.get<ITelemetryGateway>(TELEMETRY_GATEWAY, {
      strict: false,
    });
    if (!gateway) {
      throw new Error(
        'TELEMETRY_GATEWAY resolved to null — TelemetryModule must provide the real gateway',
      );
    }
    return gateway;
  }
```

Apply the identical guard to the equivalent getter in `session-hydration.service.ts:52-57` (same shape, same error message pattern).

- [ ] **Step 4: Delete the placeholder module**

1. Delete `apps/api/src/shared/shared-kernel.module.ts`.
2. In `apps/api/src/telemetry/telemetry.module.ts`: remove the `SharedKernelModule` import line and its entry in `imports: []`.
3. In `apps/api/src/session/session.module.ts`: remove the `SharedKernelModule` import line and its entry in `imports: []`.
4. Search for any other references: `grep -r "SharedKernelModule" apps/api/src` — must return nothing. (The interface files `shared/interfaces/telemetry-gateway.interface.ts` and `shared/interfaces/session-hydration.interface.ts` stay — only the module dies.)

- [ ] **Step 5: Run tests and boot check**

Run: `npx vitest run src/workflow/workflow-run-operations/workflow-run-steering.service.spec.ts` — PASS.
Run: `npm run build:api` (repo root) — compiles.
Run: `docker compose up -d --build api` then `docker logs nexus-api --tail 50` — boots with no `UnknownDependenciesException` / circular-dependency errors. If a circular-dependency boot error appears, the lazy getter approach above is unaffected — the error would come from somewhere else; investigate before proceeding.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api/src
git commit -m "fix(workflow): remove null TELEMETRY_GATEWAY placeholder that broke question answer delivery

SharedKernelModule registered TELEMETRY_GATEWAY and SESSION_HYDRATION_SERVICE
as useValue:null 'overridden elsewhere' — NestJS does not override duplicate
string tokens, so moduleRef.get(strict:false) nondeterministically resolved
the null and question_response WS delivery crashed. Both real modules are
@Global, so the placeholders were unnecessary. Resolution now fails fast."
```

---

### Task 2: `user_question_awaits` entity, repository, migration

Durable record of a posed question, modeled on `agent_await`. Workflow domain owns it.

**Files:**

- Create: `apps/api/src/workflow/database/entities/user-question-await.entity.ts`
- Create: `apps/api/src/workflow/database/repositories/user-question-await.repository.ts`
- Modify: `apps/api/src/workflow/database/entities/index.ts`
- Modify: `apps/api/src/workflow/database/repositories/index.ts`
- Modify: `apps/api/src/database/database.module.ts`
- Create: `apps/api/src/database/migrations/20260616000000-create-user-question-awaits.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts`
- Test: `apps/api/src/workflow/database/repositories/user-question-await.repository.spec.ts`

- [ ] **Step 1: Create the entity**

```typescript
// apps/api/src/workflow/database/entities/user-question-await.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export type UserQuestionAwaitStatus =
  | "pending"
  | "answered"
  | "failed_delivery"
  | "superseded"
  | "cancelled";

export type UserQuestionDeliveryChannel = "ws" | "resume";

export interface PostedQuestion {
  question: string;
  options?: string[];
}

export interface SubmittedAnswer {
  questionIndex: number;
  selectedOption: string | null;
  freeTextAnswer: string | null;
}

/**
 * Durable record of an ask_user_questions interaction. The agent blocks (or
 * its container is torn down) while this row is `pending`; answer delivery is
 * keyed off this row — never off in-memory or socket state — so the
 * interaction survives API restarts and container death.
 */
@Entity("user_question_awaits")
export class UserQuestionAwait {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column({ type: "uuid" })
  workflow_run_id: string;

  /** Job that posed the question — the job to resume on fallback delivery. */
  @Column({ type: "varchar", length: 255 })
  job_id: string;

  /** Step that posed the question — targets the WS fast path. */
  @Column({ type: "varchar", length: 255 })
  step_id: string;

  @Column({ type: "jsonb" })
  questions: PostedQuestion[];

  @Column({ type: "jsonb", nullable: true })
  answers: SubmittedAnswer[] | null;

  @Column({ type: "varchar", length: 32, default: "pending" })
  status: UserQuestionAwaitStatus;

  @Column({ type: "varchar", length: 16, nullable: true })
  delivered_via: UserQuestionDeliveryChannel | null;

  @Column({ type: "timestamp", nullable: true })
  answered_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
```

- [ ] **Step 2: Create the repository**

```typescript
// apps/api/src/workflow/database/repositories/user-question-await.repository.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import {
  UserQuestionAwait,
  PostedQuestion,
  SubmittedAnswer,
  UserQuestionDeliveryChannel,
} from "../entities/user-question-await.entity";

@Injectable()
export class UserQuestionAwaitRepository {
  constructor(
    @InjectRepository(UserQuestionAwait)
    private readonly repo: Repository<UserQuestionAwait>,
  ) {}

  async createPosed(input: {
    workflowRunId: string;
    jobId: string;
    stepId: string;
    questions: PostedQuestion[];
  }): Promise<UserQuestionAwait> {
    await this.repo.update(
      { workflow_run_id: input.workflowRunId, status: "pending" },
      { status: "superseded" },
    );
    return this.repo.save({
      workflow_run_id: input.workflowRunId,
      job_id: input.jobId,
      step_id: input.stepId,
      questions: input.questions,
      status: "pending",
    });
  }

  /** Latest row still owed an answer (pending, or a prior failed delivery). */
  findOpenByRunId(workflowRunId: string): Promise<UserQuestionAwait | null> {
    return this.repo.findOne({
      where: {
        workflow_run_id: workflowRunId,
        status: In(["pending", "failed_delivery"]),
      },
      order: { created_at: "DESC" },
    });
  }

  async markAnswered(
    id: string,
    answers: SubmittedAnswer[],
    deliveredVia: UserQuestionDeliveryChannel,
  ): Promise<void> {
    await this.repo.update(id, {
      answers,
      status: "answered",
      delivered_via: deliveredVia,
      answered_at: new Date(),
    });
  }

  async markFailedDelivery(
    id: string,
    answers: SubmittedAnswer[],
  ): Promise<void> {
    await this.repo.update(id, { answers, status: "failed_delivery" });
  }

  async cancelOpenForRun(workflowRunId: string): Promise<void> {
    await this.repo.update(
      {
        workflow_run_id: workflowRunId,
        status: In(["pending", "failed_delivery"]),
      },
      { status: "cancelled" },
    );
  }

  async findRunIdsWithOpenQuestions(): Promise<Set<string>> {
    const rows = await this.repo.find({
      select: { workflow_run_id: true },
      where: { status: In(["pending", "failed_delivery"]) },
    });
    return new Set(rows.map((row) => row.workflow_run_id));
  }
}
```

- [ ] **Step 3: Barrel exports + DatabaseModule registration**

1. `apps/api/src/workflow/database/entities/index.ts` — add `export * from './user-question-await.entity';`
2. `apps/api/src/workflow/database/repositories/index.ts` — add `export * from './user-question-await.repository';`
3. `apps/api/src/database/database.module.ts` — import both from their domain paths, add `UserQuestionAwait` to the `entities` array and `UserQuestionAwaitRepository` to the `repositories` array. (Root barrels `apps/api/src/database/entities/index.ts` / `repositories/index.ts` already re-export `../../workflow/database/...` — verify, add only if missing.)

- [ ] **Step 4: Migration**

```typescript
// apps/api/src/database/migrations/20260616000000-create-user-question-awaits.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUserQuestionAwaits20260616000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_question_awaits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_run_id UUID NOT NULL,
        job_id character varying(255) NOT NULL,
        step_id character varying(255) NOT NULL,
        questions jsonb NOT NULL,
        answers jsonb,
        status character varying(32) NOT NULL DEFAULT 'pending',
        delivered_via character varying(16),
        answered_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_question_awaits_run_status
      ON user_question_awaits(workflow_run_id, status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS user_question_awaits");
  }
}
```

Register in `registered-migrations.ts`: import `CreateUserQuestionAwaits20260616000000` and add at the **top** of the array (newest first). The `20260616` timestamp deliberately sorts after the existing future-dated `20260615000000-create-executions`.

- [ ] **Step 5: Repository spec**

Mirror an existing repository spec in `apps/api/src/workflow/database/repositories/` for mock style (TypeORM `Repository` mocked with `vi.fn()`):

```typescript
// apps/api/src/workflow/database/repositories/user-question-await.repository.spec.ts
import { describe, expect, it, vi } from "vitest";
import { In } from "typeorm";
import { UserQuestionAwaitRepository } from "./user-question-await.repository";

function buildRepo() {
  const typeormRepo = {
    update: vi.fn().mockResolvedValue(undefined),
    save: vi
      .fn()
      .mockImplementation((row) => Promise.resolve({ id: "q-1", ...row })),
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockResolvedValue([]),
  };
  return {
    repo: new UserQuestionAwaitRepository(typeormRepo as never),
    typeormRepo,
  };
}

describe("UserQuestionAwaitRepository", () => {
  it("supersedes prior pending rows when a new question is posed", async () => {
    const { repo, typeormRepo } = buildRepo();

    await repo.createPosed({
      workflowRunId: "run-1",
      jobId: "refine_charter",
      stepId: "refine",
      questions: [{ question: "What is the vision?" }],
    });

    expect(typeormRepo.update).toHaveBeenCalledWith(
      { workflow_run_id: "run-1", status: "pending" },
      { status: "superseded" },
    );
    expect(typeormRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: "refine_charter", status: "pending" }),
    );
  });

  it("markAnswered stores answers, channel, and timestamp", async () => {
    const { repo, typeormRepo } = buildRepo();

    await repo.markAnswered(
      "q-1",
      [{ questionIndex: 0, selectedOption: null, freeTextAnswer: "Ship it" }],
      "resume",
    );

    expect(typeormRepo.update).toHaveBeenCalledWith(
      "q-1",
      expect.objectContaining({
        status: "answered",
        delivered_via: "resume",
        answered_at: expect.any(Date),
      }),
    );
  });

  it("findOpenByRunId includes failed_delivery rows", async () => {
    const { repo, typeormRepo } = buildRepo();

    await repo.findOpenByRunId("run-1");

    expect(typeormRepo.findOne).toHaveBeenCalledWith({
      where: {
        workflow_run_id: "run-1",
        status: In(["pending", "failed_delivery"]),
      },
      order: { created_at: "DESC" },
    });
  });
});
```

- [ ] **Step 6: Run and verify**

Run: `npx vitest run src/workflow/database/repositories/user-question-await.repository.spec.ts` — PASS.
Run: `npm run build:api` — compiles (catches missing DatabaseModule registration).

- [ ] **Step 7: Commit**

```bash
git add -A apps/api/src
git commit -m "feat(workflow): durable user_question_awaits record for ask_user_questions

Models the agent_await park-and-resume pattern: a posed question is persisted
with its run/job/step so answer delivery survives API restarts and container
death, and fallback resume targets the job that actually asked."
```

---

### Task 3: Persist the record when a question is posed

The runner emits `user_questions_posed` over WS; the gateway helper re-emits `workflow.user_questions.posed` in-process with only `workflowRunId`. Extend the payload with `stepId` (from the authenticated socket) and create the durable row in a new `UserQuestionAwaitService`, which the existing `WorkflowRunAwaitingInputListener` delegates to. The `jobId` is resolved from `state_variables._internal.current_job_id` (authoritative — set by the step executor when the job starts).

**Files:**

- Modify: `apps/api/src/telemetry/telemetry-gateway-runtime.helpers.ts:566-569`
- Create: `apps/api/src/workflow/workflow-run-operations/user-question-await.service.ts`
- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-awaiting-input.listener.ts`
- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-operations.module.ts` (add `UserQuestionAwaitService` to providers/exports)
- Test: `apps/api/src/workflow/workflow-run-operations/user-question-await.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/workflow/workflow-run-operations/user-question-await.service.spec.ts
import { describe, expect, it, vi } from "vitest";
import { UserQuestionAwaitService } from "./user-question-await.service";

function buildService(overrides?: { run?: Record<string, unknown> | null }) {
  const awaitRepo = {
    createPosed: vi.fn().mockResolvedValue({ id: "q-1" }),
    cancelOpenForRun: vi.fn().mockResolvedValue(undefined),
  };
  const runRepo = {
    findById: vi.fn().mockResolvedValue(
      overrides?.run !== undefined
        ? overrides.run
        : {
            id: "run-1",
            current_step_id: "capture_charter",
            state_variables: {
              _internal: { current_job_id: "refine_charter" },
            },
          },
    ),
  };
  return {
    service: new UserQuestionAwaitService(awaitRepo as never, runRepo as never),
    awaitRepo,
    runRepo,
  };
}

describe("UserQuestionAwaitService.recordPosed", () => {
  it("persists the question with the job from _internal.current_job_id, not current_step_id", async () => {
    const { service, awaitRepo } = buildService();

    await service.recordPosed({
      workflowRunId: "run-1",
      stepId: "refine",
      questions: [{ question: "What is the vision?" }],
    });

    expect(awaitRepo.createPosed).toHaveBeenCalledWith({
      workflowRunId: "run-1",
      jobId: "refine_charter",
      stepId: "refine",
      questions: [{ question: "What is the vision?" }],
    });
  });

  it("falls back to current_step_id when _internal.current_job_id is absent", async () => {
    const { service, awaitRepo } = buildService({
      run: {
        id: "run-1",
        current_step_id: "only_job",
        state_variables: {},
      },
    });

    await service.recordPosed({
      workflowRunId: "run-1",
      stepId: "main",
      questions: [{ question: "Q?" }],
    });

    expect(awaitRepo.createPosed).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "only_job" }),
    );
  });

  it("does nothing when the run does not exist", async () => {
    const { service, awaitRepo } = buildService({ run: null });

    await service.recordPosed({
      workflowRunId: "gone",
      stepId: "s",
      questions: [],
    });

    expect(awaitRepo.createPosed).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/workflow-run-operations/user-question-await.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```typescript
// apps/api/src/workflow/workflow-run-operations/user-question-await.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { UserQuestionAwaitRepository } from "../database/repositories/user-question-await.repository";
import { WorkflowRunRepository } from "../database/repositories/workflow-run.repository";
import type { PostedQuestion } from "../database/entities/user-question-await.entity";

interface InternalState {
  current_job_id?: string;
}

/**
 * Owns the durable lifecycle of ask_user_questions interactions. The job id
 * is captured at pose time from `_internal.current_job_id` because
 * `current_step_id` only reflects the first/last *advanced* job and is wrong
 * for parallel-job workflows.
 */
@Injectable()
export class UserQuestionAwaitService {
  private readonly logger = new Logger(UserQuestionAwaitService.name);

  constructor(
    private readonly awaitRepo: UserQuestionAwaitRepository,
    private readonly runRepo: WorkflowRunRepository,
  ) {}

  async recordPosed(input: {
    workflowRunId: string;
    stepId: string;
    questions: PostedQuestion[];
  }): Promise<void> {
    const run = await this.runRepo.findById(input.workflowRunId);
    if (!run) {
      this.logger.warn(
        `Questions posed for unknown run ${input.workflowRunId}; not persisting`,
      );
      return;
    }

    const internal = (run.state_variables?._internal ?? {}) as InternalState;
    const jobId = internal.current_job_id ?? run.current_step_id;
    if (!jobId) {
      this.logger.warn(
        `Cannot resolve posing job for run ${input.workflowRunId}; not persisting`,
      );
      return;
    }

    await this.awaitRepo.createPosed({
      workflowRunId: input.workflowRunId,
      jobId,
      stepId: input.stepId,
      questions: input.questions,
    });
  }

  async cancelForRun(workflowRunId: string): Promise<void> {
    await this.awaitRepo.cancelOpenForRun(workflowRunId);
  }
}
```

- [ ] **Step 4: Extend the posed event payload and wire the listener**

1. In `telemetry-gateway-runtime.helpers.ts` (the `handleUserQuestionsPosedGatewayCompat` function ending around line 570), extend the in-process emit:

```typescript
eventEmitter?.emit(USER_QUESTIONS_POSED_EVENT, {
  workflowRunId: client.workflowRunId,
  stepId: client.stepId,
  questions: payload.questions,
});
```

(`client.stepId` exists on the authenticated agent socket — same field `findAgentSocket` matches on.)

2. In `workflow-run-awaiting-input.listener.ts`, inject `UserQuestionAwaitService` and delegate:

```typescript
  constructor(
    private readonly runRepo: WorkflowRunRepository,
    private readonly questionAwaits: UserQuestionAwaitService,
  ) {}

  @OnEvent(USER_QUESTIONS_POSED_EVENT)
  async handleQuestionsPosed(payload: {
    workflowRunId?: string;
    stepId?: string;
    questions?: Array<{ question: string; options?: string[] }>;
  }): Promise<void> {
    await this.setAwaitingInput(payload?.workflowRunId, true);

    if (payload?.workflowRunId && payload?.stepId) {
      try {
        await this.questionAwaits.recordPosed({
          workflowRunId: payload.workflowRunId,
          stepId: payload.stepId,
          questions: payload.questions ?? [],
        });
      } catch (error) {
        this.logger.warn(
          `Failed to persist posed questions for run ${payload.workflowRunId}: ${(error as Error).message}`,
        );
      }
    }
  }
```

(Leave `handleQuestionsAnswered` as-is — Task 5 changes _when_ the answered event is emitted, not this listener.)

3. Register `UserQuestionAwaitService` in `workflow-run-operations.module.ts` `providers` and `exports`.

- [ ] **Step 5: Update listener spec and run**

Extend the existing listener spec (or create one) asserting `recordPosed` is called with the payload fields. Run:
`npx vitest run src/workflow/workflow-run-operations/` — all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api/src
git commit -m "feat(workflow): persist posed user questions with their owning job and step

The posed-event payload now carries the agent socket's stepId; the listener
records a durable user_question_awaits row resolving the job from
_internal.current_job_id at pose time."
```

---

### Task 4: `resumeJobWithMessage` targets the correct job

`resumeJobWithMessage` currently guesses the job from `run.current_step_id` — frozen at the _first_ job for parallel-job workflows (this resumed `capture_charter` instead of `refine_charter` in the incident). Accept an explicit `jobId` and improve the default to `_internal.current_job_id`.

**Files:**

- Modify: `apps/api/src/workflow/workflow-job-message-queue.service.ts:29-73`
- Modify: `apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts:41`
- Modify: `apps/api/src/workflow/workflow-engine.service.ts:458-465`
- Modify: `apps/api/src/workflow/workflow-await/dependency-parent-resume.service.ts:97-102`
- Test: `apps/api/src/workflow/workflow-job-message-queue.service.spec.ts` (create if absent)
- Update specs: `apps/api/src/workflow/kernel/workflow-kernel.spec.ts`, `workflow-engine.service.spec.ts`, `workflow-await/__tests__/dependency-parent-resume.service.spec.ts`, `workflow-await/__tests__/agent-await.integration.spec.ts`, `workflow-run-operations/workflow-run-steering.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/workflow/workflow-job-message-queue.service.spec.ts
import { describe, expect, it, vi } from "vitest";
import { WorkflowJobMessageQueueService } from "./workflow-job-message-queue.service";

const DEF = {
  jobs: [
    { id: "capture_charter" },
    { id: "capture_charter_brownfield" },
    { id: "refine_charter" },
  ],
};

function buildService(run: Record<string, unknown>) {
  const workflowRepo = {
    findById: vi.fn().mockResolvedValue({ yaml_definition: "yaml" }),
  };
  const runRepo = {
    findById: vi.fn().mockResolvedValue(run),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const parser = { parseWorkflow: vi.fn().mockReturnValue(DEF) };
  const promptLoader = {
    resolveWorkflowPromptsWithRetry: vi.fn().mockResolvedValue(DEF),
  };
  const stepQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const service = new WorkflowJobMessageQueueService(
    workflowRepo as never,
    runRepo as never,
    parser as never,
    promptLoader as never,
    stepQueue as never,
  );
  return { service, stepQueue };
}

describe("resumeJobWithMessage job selection", () => {
  const baseRun = {
    id: "run-1",
    workflow_id: "wf-1",
    current_step_id: "capture_charter",
    state_variables: { _internal: { current_job_id: "refine_charter" } },
  };

  it("uses an explicitly provided jobId", async () => {
    const { service, stepQueue } = buildService(baseRun);

    const jobId = await service.resumeJobWithMessage(
      "run-1",
      "tree-1",
      "answers",
      { jobId: "refine_charter" },
    );

    expect(jobId).toBe("refine_charter");
    expect(stepQueue.add).toHaveBeenCalledWith(
      "execute-job",
      expect.objectContaining({ jobId: "refine_charter" }),
      expect.anything(),
    );
  });

  it("defaults to _internal.current_job_id over the stale current_step_id", async () => {
    const { service } = buildService(baseRun);

    const jobId = await service.resumeJobWithMessage("run-1", "tree-1", "msg");

    expect(jobId).toBe("refine_charter");
  });

  it("falls back to current_step_id when internal state is empty", async () => {
    const { service } = buildService({
      ...baseRun,
      state_variables: {},
    });

    const jobId = await service.resumeJobWithMessage("run-1", "tree-1", "msg");

    expect(jobId).toBe("capture_charter");
  });

  it("rejects an explicit jobId that is not in the workflow definition", async () => {
    const { service } = buildService(baseRun);

    await expect(
      service.resumeJobWithMessage("run-1", "tree-1", "msg", {
        jobId: "nope",
      }),
    ).rejects.toThrow(/Cannot determine which job to resume/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/workflow-job-message-queue.service.spec.ts`
Expected: FAIL — 4th argument is currently `resumeSessionRef`, and the default ignores `_internal.current_job_id`.

- [ ] **Step 3: Implement**

Replace the signature and job selection in `workflow-job-message-queue.service.ts`:

```typescript
export interface ResumeJobOptions {
  /** Explicit job to resume (e.g. from a user_question_awaits row). */
  jobId?: string;
  resumeSessionRef?: HarnessSessionRef;
}

  async resumeJobWithMessage(
    workflowRunId: string,
    sessionTreeId: string,
    userMessage: string,
    options?: ResumeJobOptions,
  ): Promise<string> {
    const run = await this.runRepo.findById(workflowRunId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${workflowRunId} not found`);
    }

    const def = await this.loadWorkflowDefinition(run.workflow_id);

    const internal = (run.state_variables?._internal ?? {}) as {
      current_job_id?: string;
    };
    const targetJobId =
      options?.jobId ??
      internal.current_job_id ??
      run.current_step_id ??
      def.jobs?.at(-1)?.id;
    const job = def.jobs?.find((candidate) => candidate.id === targetJobId);
    if (!job) {
      throw new NotFoundException('Cannot determine which job to resume');
    }

    await this.runRepo.update(workflowRunId, {
      status: WorkflowStatus.RUNNING,
    });

    await this.stepQueue.add(
      'execute-job',
      {
        workflowRunId,
        jobId: job.id,
        job,
        workflowPermissions: def.permissions || undefined,
        resumeSessionTreeId: sessionTreeId,
        userMessage,
        ...(options?.resumeSessionRef
          ? { resumeSessionRef: options.resumeSessionRef }
          : {}),
      },
      {
        attempts: 1,
      },
    );

    this.logger.log(
      `Enqueued resumed job ${job.id} for run ${workflowRunId} with session tree ${sessionTreeId}`,
    );

    return job.id;
  }
```

- [ ] **Step 4: Update the port, the engine wrapper, and all callers**

1. `workflow-kernel.ports.ts:41` — change the interface method to:
   ```typescript
   resumeJobWithMessage(
     workflowRunId: string,
     sessionTreeId: string,
     userMessage: string,
     options?: { jobId?: string; resumeSessionRef?: HarnessSessionRef },
   ): Promise<string>;
   ```
2. `workflow-engine.service.ts:458` — pass `options` through verbatim.
3. `dependency-parent-resume.service.ts:97` — replace the positional 4th argument:
   ```typescript
   await this.jobQueue.resumeJobWithMessage(
     awaitRecord.parent_run_id,
     sessionTreeId,
     joinMessage,
     awaitRecord.parent_session_ref
       ? { resumeSessionRef: awaitRecord.parent_session_ref }
       : undefined,
   );
   ```
4. Fix compile/spec fallout in the listed spec files: assertions on the 4th argument change from a bare `HarnessSessionRef` to `{ resumeSessionRef: ... }`. Run `npm run build:api` to find every site — do not leave any positional callers.

- [ ] **Step 5: Run the affected suites**

Run: `npx vitest run src/workflow/workflow-job-message-queue.service.spec.ts src/workflow/workflow-await src/workflow/kernel src/workflow/workflow-engine.service.spec.ts` — all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api/src
git commit -m "fix(workflow): resume the job that is actually running, not current_step_id

current_step_id is frozen at the first job for parallel-job workflows, so
session resumes targeted the wrong (skip-conditioned) job and silently
discarded the user's message. resumeJobWithMessage now accepts an explicit
jobId and defaults to _internal.current_job_id."
```

---

### Task 5: Rewrite answer delivery: persist → fast path → resume recorded job → honest failure

`submitQuestionAnswers` must: load the durable row; persist answers first; try the WS fast path against the row's `step_id`; otherwise kill any lingering container and resume the row's `job_id`; emit the answered event (which clears `awaiting_input`) **only after successful delivery**; and surface failure instead of `acknowledged: true`. Also cancel open questions on `abort`.

**Files:**

- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-steering.service.ts`
- Test: `apps/api/src/workflow/workflow-run-operations/workflow-run-steering.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to the steering spec (using its existing construction helper; add mocks for the two new constructor deps `UserQuestionAwaitRepository` and `QuestionIdleTrackerService`):

```typescript
describe("submitQuestionAnswers (durable flow)", () => {
  const ANSWERS = [
    { questionIndex: 0, selectedOption: null, freeTextAnswer: "Ship it" },
  ];
  const OPEN_ROW = {
    id: "q-1",
    workflow_run_id: "run-1",
    job_id: "refine_charter",
    step_id: "refine",
    status: "pending",
  };

  it("delivers over WS to the recorded step and marks the row answered", async () => {
    const { service, mocks } = buildService();
    mocks.questionAwaitRepo.findOpenByRunId.mockResolvedValue(OPEN_ROW);
    mocks.telemetryGateway.hasActiveAgentSocket.mockReturnValue(true);

    await service.submitQuestionAnswers("run-1", ANSWERS);

    expect(
      mocks.telemetryGateway.sendQuestionResponseCommand,
    ).toHaveBeenCalledWith("run-1", "refine", ANSWERS);
    expect(mocks.questionAwaitRepo.markAnswered).toHaveBeenCalledWith(
      "q-1",
      ANSWERS,
      "ws",
    );
    expect(mocks.eventEmitter.emit).toHaveBeenCalledWith(
      "workflow.user_questions.answered",
      { workflowRunId: "run-1" },
    );
  });

  it("resumes the recorded job when no agent socket exists", async () => {
    const { service, mocks } = buildService();
    mocks.questionAwaitRepo.findOpenByRunId.mockResolvedValue(OPEN_ROW);
    mocks.telemetryGateway.hasActiveAgentSocket.mockReturnValue(false);
    mocks.sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValue({
      id: "tree-1",
    });

    await service.submitQuestionAnswers("run-1", ANSWERS);

    expect(mocks.workflowEngine.resumeJobWithMessage).toHaveBeenCalledWith(
      "run-1",
      "tree-1",
      expect.stringContaining("Ship it"),
      { jobId: "refine_charter" },
    );
    expect(mocks.questionAwaitRepo.markAnswered).toHaveBeenCalledWith(
      "q-1",
      ANSWERS,
      "resume",
    );
  });

  it("does NOT emit the answered event (keeps awaiting_input) and throws when delivery fails entirely", async () => {
    const { service, mocks } = buildService();
    mocks.questionAwaitRepo.findOpenByRunId.mockResolvedValue(OPEN_ROW);
    mocks.telemetryGateway.hasActiveAgentSocket.mockReturnValue(false);
    mocks.sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValue(
      null,
    );

    await expect(
      service.submitQuestionAnswers("run-1", ANSWERS),
    ).rejects.toThrow(ConflictException);

    expect(mocks.questionAwaitRepo.markFailedDelivery).toHaveBeenCalledWith(
      "q-1",
      ANSWERS,
    );
    expect(mocks.eventEmitter.emit).not.toHaveBeenCalledWith(
      "workflow.user_questions.answered",
      expect.anything(),
    );
  });

  it("falls back to legacy container-label delivery when no row exists", async () => {
    const { service, mocks } = buildService();
    mocks.questionAwaitRepo.findOpenByRunId.mockResolvedValue(null);
    // legacy path: running container with nexus.step_id label
    mocks.docker.listContainers.mockResolvedValue([
      legacyContainer({ "nexus.step_id": "refine" }),
    ]);

    await service.submitQuestionAnswers("run-1", ANSWERS);

    expect(
      mocks.telemetryGateway.sendQuestionResponseCommand,
    ).toHaveBeenCalledWith("run-1", "refine", ANSWERS);
  });
});

describe("abort cancels open questions", () => {
  it("cancels open user_question_awaits rows", async () => {
    const { service, mocks } = buildService();

    await service.abort("run-1");

    expect(mocks.questionAwaitRepo.cancelOpenForRun).toHaveBeenCalledWith(
      "run-1",
    );
  });
});
```

(`legacyContainer` = small fixture helper returning a `Docker.ContainerInfo`-shaped object with `State: 'running'`, `Labels`, `Created`. The gateway mock now needs `hasActiveAgentSocket` — it exists on the real `TelemetryGateway` at `telemetry.gateway.ts:383`; add it to `ITelemetryGateway` if the interface lacks it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/workflow/workflow-run-operations/workflow-run-steering.service.spec.ts`
Expected: FAIL — current implementation has no row lookup, emits answered unconditionally, never throws.

- [ ] **Step 3: Implement**

In `workflow-run-steering.service.ts`:

1. Inject the new dependencies:

```typescript
    private readonly questionAwaitRepo: UserQuestionAwaitRepository,
    private readonly questionIdleTracker: QuestionIdleTrackerService,
```

2. If `ITelemetryGateway` (in `shared/interfaces/telemetry-gateway.interface.ts`) lacks `hasActiveAgentSocket(workflowRunId: string, stepId?: string): boolean`, add it (the concrete gateway already implements it).

3. Replace `submitQuestionAnswers`:

```typescript
  /**
   * Deliver user answers for an ask_user_questions interaction.
   *
   * Order matters: answers are persisted on the durable await row BEFORE any
   * delivery attempt (they can never be lost), and the answered event — which
   * clears awaiting_input and un-parks the run — fires only after a delivery
   * path has succeeded.
   */
  async submitQuestionAnswers(
    workflowRunId: string,
    answers: Array<{
      questionIndex: number;
      selectedOption: string | null;
      freeTextAnswer: string | null;
    }>,
  ): Promise<{ acknowledged: true; deliveredVia: 'ws' | 'resume' }> {
    await this.workflowPersistence.getWorkflowRun(workflowRunId);

    await this.publishEvent(workflowRunId, {
      event_type: 'user_question_answers',
      payload: { workflowRunId, answers },
      timestamp: new Date().toISOString(),
    });

    const openQuestion =
      await this.questionAwaitRepo.findOpenByRunId(workflowRunId);
    const stepId =
      openQuestion?.step_id ?? (await this.findRunningStepId(workflowRunId));

    const deliveredVia = await this.deliverAnswers(
      workflowRunId,
      stepId,
      openQuestion?.job_id,
      answers,
    );

    if (!deliveredVia) {
      if (openQuestion) {
        await this.questionAwaitRepo.markFailedDelivery(
          openQuestion.id,
          answers,
        );
      }
      await this.workflowEventLog.appendBestEffort({
        workflowRunId,
        eventType: 'user_questions.delivery_failed',
        payload: { answerCount: answers.length },
      });
      throw new ConflictException(
        `Unable to deliver question answers for workflow run ${workflowRunId}: ` +
          'no agent socket and no saved session to resume. The answers are ' +
          'saved; retry once the run has a saved session.',
      );
    }

    if (openQuestion) {
      await this.questionAwaitRepo.markAnswered(
        openQuestion.id,
        answers,
        deliveredVia,
      );
    }
    this.questionIdleTracker.clearTracking(workflowRunId);

    this.eventEmitter.emit(USER_QUESTIONS_ANSWERED_EVENT, { workflowRunId });
    await this.workflowEventLog.appendBestEffort({
      workflowRunId,
      eventType: 'user_questions.answered',
      payload: { answerCount: answers.length, deliveredVia },
    });

    return { acknowledged: true, deliveredVia };
  }

  /** Try WS fast path, then session resume. Returns the channel used, or null. */
  private async deliverAnswers(
    workflowRunId: string,
    stepId: string | null,
    jobId: string | undefined,
    answers: Array<{
      questionIndex: number;
      selectedOption: string | null;
      freeTextAnswer: string | null;
    }>,
  ): Promise<'ws' | 'resume' | null> {
    if (stepId) {
      try {
        if (this.telemetryGateway.hasActiveAgentSocket(workflowRunId, stepId)) {
          await this.telemetryGateway.sendQuestionResponseCommand(
            workflowRunId,
            stepId,
            answers,
          );
          return 'ws';
        }
      } catch (error) {
        this.logger.warn(
          `WS question delivery failed for ${workflowRunId}/${stepId}: ` +
            `${(error as Error).message}. Falling through to session resume.`,
        );
      }
    }

    const sessionTree =
      await this.sessionHydration.findSessionTreeByWorkflowRunId(workflowRunId);
    if (!sessionTree) {
      return null;
    }

    // The old executor (if any) cannot receive the answer; kill it so the
    // resumed job is the only executor for this run.
    await this.killLingeringContainer(workflowRunId);

    await this.workflowEngine.resumeJobWithMessage(
      workflowRunId,
      sessionTree.id,
      this.buildQuestionAnswerFollowUpMessage(answers),
      jobId ? { jobId } : undefined,
    );
    return 'resume';
  }

  private async findRunningStepId(
    workflowRunId: string,
  ): Promise<string | null> {
    const container = await this.findRunningContainer(workflowRunId);
    return container ? this.extractStepId(container) : null;
  }

  private async killLingeringContainer(workflowRunId: string): Promise<void> {
    const container = await this.findRunningContainer(workflowRunId);
    if (!container) {
      return;
    }
    try {
      await this.docker.getContainer(container.Id).kill();
      this.logger.log(
        `Killed lingering container ${container.Id} for ${workflowRunId} before resume`,
      );
    } catch {
      // container already gone
    }
  }
```

4. In `abort()`, after `cancelWorkflowRun`, add:

```typescript
await this.questionAwaitRepo.cancelOpenForRun(workflowRunId);
this.questionIdleTracker.clearTracking(workflowRunId);
```

5. Delete any now-unused code in the old `submitQuestionAnswers` body. The follow-up-message builder is reused as-is.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run src/workflow/workflow-run-operations/workflow-run-steering.service.spec.ts` — all PASS (including pre-existing tests; update any that asserted the old unconditional-acknowledge behavior — they describe the bug, rewrite them to the new contract).

- [ ] **Step 5: Verify the web UI handles the new 409**

The UI already renders submit errors (commit `a4a064b0` fixed frozen buttons on error). Search `apps/web/src` for the `question-answers` API call and confirm a non-2xx response shows an error state rather than clearing the question panel. If it clears optimistically, fix it to stay open on error.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api/src apps/web/src
git commit -m "feat(workflow): answer delivery is persist-first, targets the recorded job, and fails honestly

Answers are stored on the durable await row before delivery; WS fast path
targets the recorded step; fallback resumes the recorded job after killing
any lingering executor; awaiting_input is cleared only on confirmed delivery;
total delivery failure returns 409 instead of a false acknowledgement."
```

---

### Task 6: Reconciliation recovers the right jobs and respects open questions

The stale-run watchdog currently calls `handleJobFailed(run.current_step_id)` — the wrong job — producing an infinite skip/stale/retry loop. Recover per-job from `state_variables`, and treat a run with an open question row as parked even if the `awaiting_input` flag has drifted.

**Files:**

- Create: `apps/api/src/workflow/workflow-run-operations/stalled-job-resolution.helpers.ts`
- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-reconciliation.service.ts:201-254`
- Test: `apps/api/src/workflow/workflow-run-operations/stalled-job-resolution.helpers.spec.ts`
- Test: existing `workflow-run-reconciliation.service.spec.ts` (extend)

- [ ] **Step 1: Write the failing helper test**

```typescript
// apps/api/src/workflow/workflow-run-operations/stalled-job-resolution.helpers.spec.ts
import { describe, expect, it } from "vitest";
import { resolveStalledJobIds } from "./stalled-job-resolution.helpers";

describe("resolveStalledJobIds", () => {
  it("returns started-but-incomplete jobs (the incident shape)", () => {
    const run = {
      current_step_id: "capture_charter",
      state_variables: {
        jobs: {
          refine_charter: { steps: { refine: { status: "running" } } },
          capture_charter: { result: "skipped" },
          capture_charter_brownfield: { result: "skipped" },
        },
        _internal: {
          current_job_id: "refine_charter",
          completed_jobs: {
            capture_charter: true,
            capture_charter_brownfield: true,
          },
        },
      },
    };

    expect(resolveStalledJobIds(run as never)).toEqual(["refine_charter"]);
  });

  it("falls back to _internal.current_job_id when the jobs map is empty", () => {
    const run = {
      current_step_id: "first_job",
      state_variables: { _internal: { current_job_id: "second_job" } },
    };

    expect(resolveStalledJobIds(run as never)).toEqual(["second_job"]);
  });

  it("falls back to current_step_id when state is bare", () => {
    const run = { current_step_id: "first_job", state_variables: {} };

    expect(resolveStalledJobIds(run as never)).toEqual(["first_job"]);
  });

  it("returns empty when nothing is resolvable", () => {
    const run = { current_step_id: undefined, state_variables: undefined };

    expect(resolveStalledJobIds(run as never)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/workflow-run-operations/stalled-job-resolution.helpers.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```typescript
// apps/api/src/workflow/workflow-run-operations/stalled-job-resolution.helpers.ts
import type { WorkflowRun } from "../database/entities/workflow-run.entity";

interface InternalState {
  current_job_id?: string;
  completed_jobs?: Record<string, boolean>;
}

/**
 * Which jobs should the stale-run watchdog act on?
 *
 * `current_step_id` is frozen at the first job for parallel-job workflows, so
 * recovery must derive targets from per-job state: every job that has started
 * (has an entry in `state_variables.jobs`) but is not marked completed.
 */
export function resolveStalledJobIds(run: WorkflowRun): string[] {
  const state = (run.state_variables ?? {}) as Record<string, unknown>;
  const internal = (state._internal ?? {}) as InternalState;
  const jobs = (state.jobs ?? {}) as Record<string, unknown>;
  const completed = internal.completed_jobs ?? {};

  const stalled = Object.keys(jobs).filter((jobId) => !completed[jobId]);
  if (stalled.length > 0) {
    return stalled;
  }
  if (internal.current_job_id) {
    return [internal.current_job_id];
  }
  return run.current_step_id ? [run.current_step_id] : [];
}
```

- [ ] **Step 4: Use it in reconciliation + add the open-question guard**

In `workflow-run-reconciliation.service.ts`:

1. Inject `UserQuestionAwaitRepository` (constructor) and import `resolveStalledJobIds`.
2. In `reconcileStaleRunningRuns`, fetch the guard set once before the loop:

```typescript
const runsWithOpenQuestions =
  await this.questionAwaitRepo.findRunIdsWithOpenQuestions();
```

3. Extend the skip condition inside the loop:

```typescript
if (
  run.awaiting_input ||
  run.wait_reason ||
  liveRunIds.has(run.id) ||
  failedRunIds.has(run.id) ||
  runsWithOpenQuestions.has(run.id)
) {
  continue;
}
```

4. Replace the single-job recovery body (the `const stepId = run.current_step_id; ... handleJobFailed(run.id, stepId, ...)` block) with:

```typescript
const stalledJobIds = resolveStalledJobIds(run);
if (stalledJobIds.length === 0) {
  this.logger.warn(
    `Stale RUNNING run ${run.id} has no resolvable stalled job; cannot recover automatically (${source})`,
  );
  continue;
}

try {
  for (const jobId of stalledJobIds) {
    await this.runExecution.handleJobFailed(run.id, jobId, STALE_RUN_REASON);
  }
  recoveredCount += 1;
} catch (error) {
  this.logger.error(
    `Failed to recover stale RUNNING run ${run.id} (${source}): ${(error as Error).message}`,
  );
}
```

(`handleJobFailed` already owns the retry budget via `_internal.auto_retry.{jobId}` and fails the run when exhausted — retrying the _correct_ job makes that budget meaningful again.)

- [ ] **Step 5: Extend the reconciliation spec and run**

Add to `workflow-run-reconciliation.service.spec.ts`: (a) a stale run whose state matches the incident shape → `handleJobFailed` called with `refine_charter`, not `capture_charter`; (b) a stale run present in `findRunIdsWithOpenQuestions` → `handleJobFailed` not called. Run:
`npx vitest run src/workflow/workflow-run-operations/` — all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A apps/api/src
git commit -m "fix(workflow): stale-run watchdog recovers per-job state and respects open questions

Recovery now targets started-but-incomplete jobs from state_variables instead
of the frozen current_step_id (which looped retrying a skip-conditioned job
forever), and skips runs that still have an open user question row."
```

---

### Task 7: Wire the question idle tracker (currently dead code) and re-arm after restart

`QuestionIdleTrackerService` arms stop/remove timers when questions are posed, but `registerCallbacks` is never called — the timers fire into `this.callbacks?.` and silently no-op. Wire callbacks that stop, then remove, the waiting container (the durable row + resume path make a dead container safe), and re-arm timers from open rows at boot so an API restart doesn't leak containers.

**Files:**

- Create: `apps/api/src/workflow/workflow-run-operations/question-idle-container.listener.ts`
- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-run-operations.module.ts` (provider registration; `DockerModule` import if `DOCKER_CLIENT` isn't already resolvable here — steering already injects it, so it is)
- Test: `apps/api/src/workflow/workflow-run-operations/question-idle-container.listener.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/workflow/workflow-run-operations/question-idle-container.listener.spec.ts
import { describe, expect, it, vi } from "vitest";
import { QuestionIdleContainerListener } from "./question-idle-container.listener";

function buildListener(overrides?: { openRuns?: string[] }) {
  const tracker = {
    registerCallbacks: vi.fn(),
    trackQuestionsPosed: vi.fn().mockResolvedValue(undefined),
    isTracking: vi.fn().mockReturnValue(false),
  };
  const container = {
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  const docker = {
    getContainer: vi.fn().mockReturnValue(container),
    listContainers: vi.fn().mockResolvedValue([
      {
        Id: "c-1",
        State: "running",
        Labels: { "nexus.workflow_run_id": "run-1" },
        Created: 1,
      },
    ]),
  };
  const questionAwaitRepo = {
    findRunIdsWithOpenQuestions: vi
      .fn()
      .mockResolvedValue(new Set(overrides?.openRuns ?? [])),
  };
  const listener = new QuestionIdleContainerListener(
    tracker as never,
    docker as never,
    questionAwaitRepo as never,
  );
  return { listener, tracker, docker, container };
}

describe("QuestionIdleContainerListener", () => {
  it("registers stop/remove callbacks on module init", () => {
    const { listener, tracker } = buildListener();

    listener.onModuleInit();

    expect(tracker.registerCallbacks).toHaveBeenCalledWith({
      onStop: expect.any(Function),
      onRemove: expect.any(Function),
    });
  });

  it("onStop stops the waiting container", async () => {
    const { listener, tracker, container } = buildListener();
    listener.onModuleInit();
    const callbacks = tracker.registerCallbacks.mock.calls[0][0];

    await callbacks.onStop("run-1", "c-1");

    expect(container.stop).toHaveBeenCalled();
  });

  it("re-arms tracking for runs with open questions on bootstrap", async () => {
    const { listener, tracker } = buildListener({ openRuns: ["run-1"] });

    await listener.onApplicationBootstrap();

    expect(tracker.trackQuestionsPosed).toHaveBeenCalledWith("run-1", "c-1");
  });

  it("does not re-arm runs without open questions", async () => {
    const { listener, tracker } = buildListener({ openRuns: [] });

    await listener.onApplicationBootstrap();

    expect(tracker.trackQuestionsPosed).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workflow/workflow-run-operations/question-idle-container.listener.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/workflow/workflow-run-operations/question-idle-container.listener.ts
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleInit,
} from "@nestjs/common";
import Docker from "dockerode";
import { DOCKER_CLIENT } from "../../docker/docker.constants";
import { QuestionIdleTrackerService } from "./question-idle-tracker.service";
import { UserQuestionAwaitRepository } from "../database/repositories/user-question-await.repository";

/**
 * Container lifecycle for runs parked on a user question.
 *
 * A parked run does not need a live container: the question and its owning
 * job are durable (user_question_awaits) and the answer path resumes from the
 * persisted session tree. So after the idle thresholds we stop, then remove,
 * the waiting container to free heavy-tier capacity. Timers are in-memory;
 * onApplicationBootstrap re-arms them from open rows after a restart.
 */
@Injectable()
export class QuestionIdleContainerListener
  implements OnModuleInit, OnApplicationBootstrap
{
  private readonly logger = new Logger(QuestionIdleContainerListener.name);

  constructor(
    private readonly tracker: QuestionIdleTrackerService,
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
    private readonly questionAwaitRepo: UserQuestionAwaitRepository,
  ) {}

  onModuleInit(): void {
    this.tracker.registerCallbacks({
      onStop: (workflowRunId, containerId) =>
        this.stopContainer(workflowRunId, containerId),
      onRemove: (workflowRunId, containerId) =>
        this.removeContainer(workflowRunId, containerId),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    const openRuns = await this.questionAwaitRepo.findRunIdsWithOpenQuestions();
    if (openRuns.size === 0) {
      return;
    }

    const containers = await this.docker.listContainers({
      all: false,
      filters: { label: ["nexus.managed=true"], status: ["running"] },
    });
    for (const container of containers) {
      const runId = container.Labels?.["nexus.workflow_run_id"];
      if (runId && openRuns.has(runId) && !this.tracker.isTracking(runId)) {
        this.logger.log(
          `Re-arming question idle tracking for run ${runId} (container ${container.Id})`,
        );
        await this.tracker.trackQuestionsPosed(runId, container.Id);
      }
    }
  }

  private async stopContainer(
    workflowRunId: string,
    containerId: string,
  ): Promise<void> {
    try {
      await this.docker.getContainer(containerId).stop();
      this.logger.log(
        `Stopped question-idle container ${containerId} for run ${workflowRunId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to stop question-idle container ${containerId}: ${(error as Error).message}`,
      );
    }
  }

  private async removeContainer(
    workflowRunId: string,
    containerId: string,
  ): Promise<void> {
    try {
      await this.docker.getContainer(containerId).remove({ force: true });
      this.logger.log(
        `Removed question-idle container ${containerId} for run ${workflowRunId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to remove question-idle container ${containerId}: ${(error as Error).message}`,
      );
    }
  }
}
```

Register `QuestionIdleContainerListener` in `workflow-run-operations.module.ts` providers.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/workflow/workflow-run-operations/question-idle-container.listener.spec.ts` — PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/api/src
git commit -m "feat(workflow): wire question idle tracker to stop/remove parked containers

registerCallbacks was never called, so the stop/remove timers were dead code.
Parked runs no longer need a live container (durable row + session resume),
so the callbacks free heavy-tier capacity; bootstrap re-arms timers from open
question rows after an API restart."
```

---

### Task 8: Runner stops fabricating a fake "timed out" answer

`packages/harness-runtime/src/kernel.ts:149-159` returns a synthetic "Timed out waiting for user response" tool result after 30 minutes (or on a rejected wait), letting the agent continue down the wrong path without the answer. The orchestrator now owns the wait: keep waiting; the container's lifecycle (stop/remove on idle, resume on answer) is managed API-side.

**Files:**

- Modify: `packages/harness-runtime/src/kernel.ts:120-159`
- Test: `packages/harness-runtime/src/kernel.spec.ts` (extend or create alongside existing harness-runtime tests — check `packages/harness-runtime/src/**/*.spec.ts` for the runner's test setup)

- [ ] **Step 1: Write the failing test**

In the harness-runtime test suite (mirror its existing mock style for the orchestrator client):

```typescript
describe("ask_user_questions wait behavior", () => {
  it("keeps waiting after a wait timeout instead of fabricating an answer", async () => {
    const client = buildMockClient();
    client.waitForCommand
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        type: "question_response",
        answers: [
          { questionIndex: 0, selectedOption: null, freeTextAnswer: "Yes" },
        ],
      });
    const handler = buildRunnerLocalHandler(client);

    const result = await handler("ask_user_questions", {
      questions: [{ question: "Proceed?" }],
    });

    expect(client.waitForCommand).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).toContain("Yes");
    expect(JSON.stringify(result)).not.toContain("Timed out");
  });
});
```

(`buildMockClient` / `buildRunnerLocalHandler` — follow how the existing kernel tests construct the client and reach `runnerLocalHandler`; if the handler is not exported, export it as a named function for testability.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/kernel.spec.ts` (from `packages/harness-runtime`)
Expected: FAIL — first rejection currently returns the fabricated timeout result.

- [ ] **Step 3: Implement**

Replace the wait block in `kernel.ts`:

```typescript
  const QUESTION_WAIT_RETRY_MS = 30 * 60 * 1000;

  const runnerLocalHandler: RunnerLocalToolHandler = async (
    toolName,
    params,
  ) => {
    if (toolName === "ask_user_questions") {
      const questions =
        (params.questions as Array<{ question: string; options?: string[] }>) ??
        [];
      client.emit("user_questions_posed", { questions });

      // Wait indefinitely. The orchestrator owns this interaction: the
      // question is durable server-side, idle containers are stopped/removed
      // by the question idle tracker, and late answers resume the session.
      // Fabricating a timeout answer would let the agent continue without
      // the user's input — never do that.
      for (;;) {
        try {
          const response = await client.waitForCommand(
            "question_response",
            QUESTION_WAIT_RETRY_MS,
          );
          const answers = response.answers ?? [];
          const formatted = questions
            .map((q, i) => {
              const answer = answers[i];
              const answerText =
                answer?.freeTextAnswer ?? answer?.selectedOption ?? "(no answer)";
              return `Q: ${q.question}\nA: ${answerText}`;
            })
            .join("\n\n");
          return {
            content: [{ type: "text", text: formatted }],
            details: { ok: true, answers },
          };
        } catch {
          // Wait window elapsed without an answer — re-arm and keep waiting.
        }
      }
    }
    // ... existing unsupported-tool fallthrough unchanged
```

(Keep the success-path formatting identical to the current implementation — only the timeout branch changes. Delete the old `QUESTION_RESPONSE_TIMEOUT_MS` constant and the fabricated-timeout return.)

- [ ] **Step 4: Run tests and build**

Run: `npx vitest run` (from `packages/harness-runtime`) — PASS.
Run: `npm run build --workspace=packages/harness-runtime` — compiles.
Rebuild execution images (kernel ships inside them): `docker compose build` for `nexus-light:latest` / `nexus-heavy:latest` per the repo's image build setup.

- [ ] **Step 5: Commit**

```bash
git add -A packages/harness-runtime
git commit -m "fix(harness-runtime): never fabricate a timed-out answer for ask_user_questions

The orchestrator owns the interaction lifecycle (durable question row, idle
container teardown, resume-on-answer); a synthetic timeout result let the
agent proceed without the user's input."
```

---

### Task 9: Full gates, docs, incident verification

**Files:**

- Modify: `docs/guide/07-workflow-step-execution.md` (or the closest guide section covering steering/questions — check `docs/guide/README.md` index)
- Modify: `apps/api/README.md` (if it documents the question-answer endpoint contract)

- [ ] **Step 1: Document the new flow**

Add/replace the ask_user_questions section in the guide with: durable `user_question_awaits` lifecycle (pending → answered / failed_delivery / superseded / cancelled), delivery order (persist → WS fast path → resume recorded job), `awaiting_input` semantics (cleared only on confirmed delivery), idle container stop/remove thresholds (`question_idle_stop_seconds` default 300, `question_idle_remove_seconds` default 3600), and the 409 contract for failed delivery.

- [ ] **Step 2: Run the full quality gates**

```bash
npm run build --workspace=packages/core
npm run build:api
npm run build --workspace=packages/harness-runtime
npm run lint:summary
npm run test:api
```

Expected: all green. Fix anything red before proceeding — no suppressions (strict lint policy).

- [ ] **Step 3: Live incident re-verification**

```bash
docker compose up -d --build
```

1. Launch a charter session from the web UI (`http://localhost:3120`).
2. Wait for the agent to pose a question; verify a `user_question_awaits` row exists: `docker exec nexus-postgres psql -U nexus -d nexus_orchestrator -c "SELECT job_id, step_id, status FROM user_question_awaits ORDER BY created_at DESC LIMIT 1;"` — status `pending`, `job_id` = the asking job.
3. **Restart the API mid-wait:** `docker compose restart api`.
4. Answer the question in the UI.
5. Verify: the row flips to `answered` with `delivered_via` set; the run resumes the _asking_ job (event ledger shows activity for it, not a skip-conditioned sibling); the agent's next turn references the answer; the run completes.
6. Negative path: abort a run with a pending question → row becomes `cancelled`.

- [ ] **Step 4: Commit and push**

```bash
git add -A docs apps/api/README.md
git commit -m "docs: durable user-question delivery flow and operational thresholds"
git pull --rebase
git push
git status   # must report up to date with origin
```

---

## Self-Review Notes

- **Spec coverage:** Root causes 1–5 → Tasks 1 (null DI), 2+3 (no durable record), 4+5 (wrong-job resume / answer loss / dishonest ack), 6 (watchdog wrong-job loop + flag-drift guard), 7 (dead idle-tracker code, restart-safe teardown), 8 (runner fake answer). Execution-lifecycle wiring (`executions` stuck `pending`) is explicitly out of scope — separate plan against the existing SDD.
- **Known judgment calls:**
  - Lazy `moduleRef.get` is retained (with fail-fast) rather than constructor injection, to avoid disturbing whatever instantiation cycle motivated it. If boot proves cycle-free, a follow-up can constructor-inject.
  - `dependency-parent-resume` still relies on the improved default job resolution rather than an explicit `jobId` (its `parent_step_id` is a step, not a job). The improved default (`_internal.current_job_id`) covers its single-parked-parent case.
  - WS delivery has no application-level ack; `hasActiveAgentSocket` + emit is treated as delivered. The durable row plus the Task 6 guard bound the damage of a lost emit; adding a socket.io ack is a possible follow-up.
- **Type consistency check:** `SubmittedAnswer` matches the existing controller DTO shape (`questionIndex`/`selectedOption`/`freeTextAnswer`); `resumeJobWithMessage` options type is identical across queue service, port, engine, and callers; repository method names used in Tasks 5–7 (`findOpenByRunId`, `markAnswered`, `markFailedDelivery`, `cancelOpenForRun`, `findRunIdsWithOpenQuestions`) all exist in Task 2.
