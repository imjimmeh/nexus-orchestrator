# Learning Tab Backend Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Learning Candidates and Skill Proposals backend list endpoints onto the shared paginated-list-query convention (`applyPagination`/`applySort`/`applySearch`/`buildPaginatedResponse`), and add the missing candidate reject/archive lifecycle actions (single + bulk, transactional) plus proposal bulk approve/reject — all as specified in `docs/superpowers/specs/2026-07-01-learning-tab-redesign-design.md`.

**Architecture:** Follows the existing repository → service → controller layering already used by `LlmModelRepository`/`SkillProposalService` in this codebase. One migration adds 6 nullable audit columns to `learning_candidates`. A new `LearningCandidateDecisionService` owns the new candidate reject/archive/bulk-reject/bulk-archive actions (kept separate from the already-complex `LearningPromotionService` state machine); `LearningPromotionService` itself gains a `bulkPromote` method that loops the existing single-item claim-based `promoteCandidate` flow rather than a raw SQL transaction, because promotion has external side effects (memory segment creation, event emission) that a single DB transaction can't safely wrap.

**Tech Stack:** NestJS, TypeORM, Zod (`@nexus/core` schemas), Vitest.

## Global Constraints

- Never use `eslint-disable`, `@ts-ignore`, or `@ts-nocheck` — fix findings in code (CLAUDE.md lint policy).
- Controllers handle transport only; services own domain logic; repositories own persistence (API quality gate).
- Keep `apps/api/src` and `packages/core/src` Kanban-neutral — this plan touches neither Kanban domain code nor identifiers.
- TDD: write the failing test before the implementation for every step that changes behavior.
- Run `npm run test --workspace=apps/api` (or a scoped `vitest run <path>`) after each task; run `npm run build --workspace=packages/core` after core schema changes since `apps/api` imports `@nexus/core` by package reference.

---

### Task 1: Migration — add candidate decision audit columns

**Files:**

- Create: `apps/api/src/database/migrations/20260711000000-add-learning-candidate-decision-columns.ts`
- Create: `apps/api/src/database/migrations/20260711000000-add-learning-candidate-decision-columns.spec.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts`
- Modify: `apps/api/src/memory/database/entities/learning-candidate.entity.ts`

**Interfaces:**

- Produces: 6 new nullable columns on `learning_candidates` — `rejected_by varchar(128)`, `rejected_at timestamptz`, `rejection_reason text`, `archived_by varchar(128)`, `archived_at timestamptz`, `archive_reason text` — and matching properties on the `LearningCandidate` entity (`rejected_by: string | null`, `rejected_at: Date | null`, `rejection_reason: string | null`, `archived_by: string | null`, `archived_at: Date | null`, `archive_reason: string | null`). All later tasks that read/write these columns depend on this shape.

- [ ] **Step 1: Write the failing migration test**

```typescript
// apps/api/src/database/migrations/20260711000000-add-learning-candidate-decision-columns.spec.ts
import { describe, expect, it, vi } from "vitest";
import { AddLearningCandidateDecisionColumns20260711000000 } from "./20260711000000-add-learning-candidate-decision-columns";

describe("AddLearningCandidateDecisionColumns migration", () => {
  it("adds the reject and archive audit columns", async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new AddLearningCandidateDecisionColumns20260711000000().up({
      query,
    } as never);

    const sql = query.mock.calls.map((call) => call[0] as string).join("\n");
    expect(sql).toContain("rejected_by");
    expect(sql).toContain("rejected_at");
    expect(sql).toContain("rejection_reason");
    expect(sql).toContain("archived_by");
    expect(sql).toContain("archived_at");
    expect(sql).toContain("archive_reason");
  });

  it("drops the reject and archive audit columns in down()", async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new AddLearningCandidateDecisionColumns20260711000000().down({
      query,
    } as never);

    const sql = query.mock.calls.map((call) => call[0] as string).join("\n");
    expect(sql).toContain("DROP COLUMN IF EXISTS rejected_by");
    expect(sql).toContain("DROP COLUMN IF EXISTS archive_reason");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/database/migrations/20260711000000-add-learning-candidate-decision-columns.spec.ts`
Expected: FAIL — cannot find module `./20260711000000-add-learning-candidate-decision-columns`

- [ ] **Step 3: Write the migration**

```typescript
// apps/api/src/database/migrations/20260711000000-add-learning-candidate-decision-columns.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLearningCandidateDecisionColumns20260711000000 implements MigrationInterface {
  name = "AddLearningCandidateDecisionColumns20260711000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE learning_candidates
      ADD COLUMN IF NOT EXISTS rejected_by character varying(128),
      ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
      ADD COLUMN IF NOT EXISTS archived_by character varying(128),
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS archive_reason TEXT;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE learning_candidates
      DROP COLUMN IF EXISTS archive_reason,
      DROP COLUMN IF EXISTS archived_at,
      DROP COLUMN IF EXISTS archived_by,
      DROP COLUMN IF EXISTS rejection_reason,
      DROP COLUMN IF EXISTS rejected_at,
      DROP COLUMN IF EXISTS rejected_by;
    `);
  }
}
```

- [ ] **Step 4: Register the migration**

In `apps/api/src/database/migrations/registered-migrations.ts`, add the import as the first line and the class as the first entry of the exported array (this file lists migrations newest-first):

```typescript
import { AddLearningCandidateDecisionColumns20260711000000 } from "./20260711000000-add-learning-candidate-decision-columns";
import { AddExecutionLeaseColumns20260710000000 } from "./20260710000000-add-execution-lease-columns";
// ...rest of existing imports unchanged
```

```typescript
export const registeredMigrations = [
  AddLearningCandidateDecisionColumns20260711000000,
  AddExecutionLeaseColumns20260710000000,
  // ...rest of existing array entries unchanged
];
```

(Use the actual exported array name already in the file — copy the existing name; do not rename it.)

- [ ] **Step 5: Run migration tests to verify they pass**

Run: `npx vitest run apps/api/src/database/migrations/20260711000000-add-learning-candidate-decision-columns.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Add the columns to the `LearningCandidate` entity**

In `apps/api/src/memory/database/entities/learning-candidate.entity.ts`, add after the existing `human_approved_at` column (line 98) and before `first_seen_at`:

```typescript
  @Column({ type: 'varchar', length: 128, nullable: true })
  rejected_by!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  rejected_at!: Date | null;

  @Column({ type: 'text', nullable: true })
  rejection_reason!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  archived_by!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  archived_at!: Date | null;

  @Column({ type: 'text', nullable: true })
  archive_reason!: string | null;
```

- [ ] **Step 7: Update the entity test fixture**

In `apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts`, the `createCandidate()` helper (bottom of file) builds a full `LearningCandidate` object. Add the 6 new fields so it stays a complete fixture:

```typescript
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    archived_by: null,
    archived_at: null,
    archive_reason: null,
```

(Insert alongside the existing `promoted_at`/`human_approved_at`-style null fields, before `first_seen_at`.)

- [ ] **Step 8: Run the full repository test file to verify nothing broke**

Run: `npx vitest run apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts`
Expected: PASS (all existing tests still pass — the fixture just has 6 more null fields)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/database/migrations/20260711000000-add-learning-candidate-decision-columns.ts apps/api/src/database/migrations/20260711000000-add-learning-candidate-decision-columns.spec.ts apps/api/src/database/migrations/registered-migrations.ts apps/api/src/memory/database/entities/learning-candidate.entity.ts apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts
git commit -m "feat(memory): add learning candidate reject/archive audit columns"
```

---

### Task 2: Shared `BulkActionError`

**Files:**

- Create: `apps/api/src/common/errors/bulk-action.error.ts`
- Create: `apps/api/src/common/errors/bulk-action.error.spec.ts`

**Interfaces:**

- Produces: `BulkActionError` class with `code: 'not_found' | 'invalid_status'` and `ids: string[]` properties, extending `Error`. Used by Task 7 (candidate bulk repo methods), Task 9 (proposal bulk repo methods), Task 11 (candidate decision service), and Task 13 (proposal service) to signal a bulk-action transaction rollback with which IDs failed and why.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/common/errors/bulk-action.error.spec.ts
import { describe, expect, it } from "vitest";
import { BulkActionError } from "./bulk-action.error";

describe("BulkActionError", () => {
  it("carries the failure code and offending ids", () => {
    const error = new BulkActionError("invalid_status", ["a", "b"]);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BulkActionError");
    expect(error.code).toBe("invalid_status");
    expect(error.ids).toEqual(["a", "b"]);
    expect(error.message).toContain("a");
    expect(error.message).toContain("b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/common/errors/bulk-action.error.spec.ts`
Expected: FAIL — cannot find module `./bulk-action.error`

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/common/errors/bulk-action.error.ts
export type BulkActionErrorCode = "not_found" | "invalid_status";

export class BulkActionError extends Error {
  public readonly code: BulkActionErrorCode;
  public readonly ids: string[];

  constructor(code: BulkActionErrorCode, ids: string[]) {
    super(`Bulk action failed (${code}) for id(s): ${ids.join(", ")}`);
    this.name = "BulkActionError";
    this.code = code;
    this.ids = ids;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/api/src/common/errors/bulk-action.error.spec.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/errors/bulk-action.error.ts apps/api/src/common/errors/bulk-action.error.spec.ts
git commit -m "feat(api): add shared BulkActionError for transactional bulk endpoints"
```

---

### Task 3: Core schemas — rewrite list query contracts

**Files:**

- Modify: `packages/core/src/schemas/memory/learning-contracts.schema.ts`
- Modify: `packages/core/src/schemas/memory/learning-contracts.schema.spec.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `listLearningCandidatesSchema` now infers to `{ status?: string[]; candidate_type?: string[]; scope_type?: string; scope_id?: string; search?: string; min_score?: number; created_from?: Date; created_to?: Date; page: number; limit: number; sortBy?: string; sortDir?: 'asc' | 'desc' }`. `listSkillImprovementProposalsSchema` now infers to `{ status?: string[]; search?: string; created_from?: Date; created_to?: Date; page: number; limit: number; sortBy?: string; sortDir?: 'asc' | 'desc' }`. Both drop `offset`. Types `ListLearningCandidatesRequest`/`ListSkillImprovementProposalsRequest` (already exported) reflect the new shape — Tasks 6, 8, 13, 14 consume these types directly.

- [ ] **Step 1: Write the failing tests**

Replace the two existing pagination-default tests and the two status-enum tests in `packages/core/src/schemas/memory/learning-contracts.schema.spec.ts` (the ones asserting `{ limit: 25, offset: 0 }` and single-status parsing) with:

```typescript
it("defaults candidate list pagination to page 1", () => {
  expect(listLearningCandidatesSchema.parse({})).toMatchObject({
    page: 1,
    limit: 25,
  });
});

it("does not expose unknown filters", () => {
  const parsed = listLearningCandidatesSchema.parse({
    status: "pending",
    unsupported_filter: "forbidden",
  });

  expect(parsed).not.toHaveProperty("unsupported_filter");
});

it("strips unknown candidate list keys", () => {
  const parsed = listLearningCandidatesSchema.parse({
    status: "pending",
    unknown: "extra",
  });

  expect(parsed).not.toHaveProperty("unknown");
});

it("parses a comma-separated candidate status filter into an array", () => {
  expect(
    listLearningCandidatesSchema.parse({ status: "pending,promoted" }).status,
  ).toEqual(["pending", "promoted"]);
});

it("parses a single candidate status into a one-element array", () => {
  expect(
    listLearningCandidatesSchema.parse({ status: "pending" }).status,
  ).toEqual(["pending"]);
});

it("rejects an invalid learning candidate status in the list", () => {
  expect(() =>
    listLearningCandidatesSchema.parse({ status: "invalid" }),
  ).toThrow();
});

it("parses candidate_type as a comma-separated array", () => {
  expect(
    listLearningCandidatesSchema.parse({
      candidate_type: "agent_capture,runtime_learning",
    }).candidate_type,
  ).toEqual(["agent_capture", "runtime_learning"]);
});

it("coerces min_score to a number", () => {
  expect(
    listLearningCandidatesSchema.parse({ min_score: "0.5" }).min_score,
  ).toBe(0.5);
});

it("coerces created_from/created_to to dates", () => {
  const parsed = listLearningCandidatesSchema.parse({
    created_from: "2026-06-01T00:00:00.000Z",
    created_to: "2026-06-30T00:00:00.000Z",
  });
  expect(parsed.created_from).toBeInstanceOf(Date);
  expect(parsed.created_to).toBeInstanceOf(Date);
});

it("accepts search, sortBy and sortDir for candidates", () => {
  expect(
    listLearningCandidatesSchema.parse({
      search: "flaky",
      sortBy: "score",
      sortDir: "asc",
    }),
  ).toMatchObject({ search: "flaky", sortBy: "score", sortDir: "asc" });
});

it("defaults proposal list pagination to page 1", () => {
  expect(listSkillImprovementProposalsSchema.parse({})).toMatchObject({
    page: 1,
    limit: 25,
  });
});

it("strips unknown proposal list keys", () => {
  const parsed = listSkillImprovementProposalsSchema.parse({
    limit: 40,
    unknown: "extra",
  });

  expect(parsed).not.toHaveProperty("unknown");
});

it("parses a comma-separated proposal status filter into an array", () => {
  expect(
    listSkillImprovementProposalsSchema.parse({ status: "approved,applied" })
      .status,
  ).toEqual(["approved", "applied"]);
});

it("rejects invalid proposal status in the list", () => {
  expect(() =>
    listSkillImprovementProposalsSchema.parse({ status: "invalid" }),
  ).toThrow();
});

it("accepts search and date range for proposals", () => {
  const parsed = listSkillImprovementProposalsSchema.parse({
    search: "retry",
    created_from: "2026-06-01T00:00:00.000Z",
  });
  expect(parsed.search).toBe("retry");
  expect(parsed.created_from).toBeInstanceOf(Date);
});
```

Remove the two old tests `"defaults pagination"` and `"defaults proposal list pagination"` (they assert the now-removed `offset` field) and the two `it.each(LEARNING_CANDIDATE_STATUSES)`/`it.each(SKILL_IMPROVEMENT_PROPOSAL_STATUSES)` blocks that assert `.status` equals the bare string (status is now an array) — replace each with:

```typescript
it.each(LEARNING_CANDIDATE_STATUSES)(
  "validates allowed learning status %s",
  (status) => {
    expect(listLearningCandidatesSchema.parse({ status }).status).toEqual([
      status,
    ]);
  },
);
```

```typescript
it.each(SKILL_IMPROVEMENT_PROPOSAL_STATUSES)(
  "validates allowed proposal status %s",
  (status) => {
    expect(
      listSkillImprovementProposalsSchema.parse({ status }).status,
    ).toEqual([status]);
  },
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/schemas/memory/learning-contracts.schema.spec.ts`
Expected: FAIL — `listLearningCandidatesSchema`/`listSkillImprovementProposalsSchema` still use the old `status`/`offset` shape

- [ ] **Step 3: Rewrite the schemas**

In `packages/core/src/schemas/memory/learning-contracts.schema.ts`, add a shared CSV-to-array preprocessor near the top (after the `opaqueScopeIdSchema` declaration) and replace `listLearningCandidatesSchema`/`listSkillImprovementProposalsSchema`:

```typescript
function csvToArray(value: unknown): string[] | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

export const listLearningCandidatesSchema = z
  .object({
    status: z.preprocess(
      csvToArray,
      z.array(z.enum(LEARNING_CANDIDATE_STATUSES)).optional(),
    ),
    candidate_type: z.preprocess(
      csvToArray,
      z.array(z.string().trim().min(1).max(64)).optional(),
    ),
    scope_type: opaqueScopeTypeSchema.optional(),
    scope_id: opaqueScopeIdSchema.optional(),
    search: z.string().trim().min(1).max(200).optional(),
    min_score: z.coerce.number().min(0).max(1).optional(),
    created_from: z.coerce.date().optional(),
    created_to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    sortBy: z.string().trim().min(1).max(64).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .strip();

export const listSkillImprovementProposalsSchema = z
  .object({
    status: z.preprocess(
      csvToArray,
      z.array(z.enum(SKILL_IMPROVEMENT_PROPOSAL_STATUSES)).optional(),
    ),
    search: z.string().trim().min(1).max(200).optional(),
    created_from: z.coerce.date().optional(),
    created_to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
    sortBy: z.string().trim().min(1).max(64).optional(),
    sortDir: z.enum(["asc", "desc"]).optional(),
  })
  .strip();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/schemas/memory/learning-contracts.schema.spec.ts`
Expected: PASS

- [ ] **Step 5: Build packages/core**

Run: `npm run build --workspace=packages/core`
Expected: build succeeds (this surfaces any downstream `apps/api` type errors from the shape change immediately as TS diagnostics if you also run `apps/api`'s typecheck; those are fixed in Tasks 6/8/13/14 below).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas/memory/learning-contracts.schema.ts packages/core/src/schemas/memory/learning-contracts.schema.spec.ts
git commit -m "feat(core): rewrite learning list-query schemas onto page/search/sort/multi-status"
```

---

### Task 4: Core schemas — reject/archive + bulk action request schemas

**Files:**

- Modify: `packages/core/src/schemas/memory/learning-contracts.schema.ts`
- Modify: `packages/core/src/schemas/memory/learning-contracts.schema.spec.ts`

**Interfaces:**

- Produces: `rejectLearningCandidateSchema` (`{ reason: string; rejected_by?: string }`), `archiveLearningCandidateSchema` (`{ reason?: string; archived_by?: string }`), `bulkRejectLearningCandidatesSchema` (`{ candidate_ids: string[]; reason: string; rejected_by?: string }`), `bulkArchiveLearningCandidatesSchema` (`{ candidate_ids: string[]; reason?: string; archived_by?: string }`), `bulkPromoteLearningCandidatesSchema` (`{ candidate_ids: string[]; requested_by?: string }`), `bulkApproveSkillImprovementProposalsSchema` (`{ proposal_ids: string[]; approved_by?: string }`), `bulkRejectSkillImprovementProposalsSchema` (`{ proposal_ids: string[]; reason: string; rejected_by?: string }`), and their inferred `*Request` types. Consumed directly by Task 11 (`LearningCandidateDecisionService`), Task 12 (`LearningPromotionService.bulkPromote`), Task 13 (`SkillProposalService`), Task 15 (`LearningController`), Task 16 (`SkillProposalsController`).

- [ ] **Step 1: Write the failing tests**

Add to `packages/core/src/schemas/memory/learning-contracts.schema.spec.ts`:

```typescript
describe("candidate reject/archive schemas", () => {
  it("requires a reason to reject a candidate", () => {
    expect(() => rejectLearningCandidateSchema.parse({ reason: "" })).toThrow();
  });

  it("accepts an optional rejecting actor", () => {
    expect(
      rejectLearningCandidateSchema.parse({
        reason: "Not useful",
        rejected_by: "reviewer-1",
      }),
    ).toEqual({ reason: "Not useful", rejected_by: "reviewer-1" });
  });

  it("allows archiving without a reason", () => {
    expect(archiveLearningCandidateSchema.parse({})).toEqual({});
  });

  it("accepts an optional archive reason and actor", () => {
    expect(
      archiveLearningCandidateSchema.parse({
        reason: "Superseded",
        archived_by: "reviewer-1",
      }),
    ).toEqual({ reason: "Superseded", archived_by: "reviewer-1" });
  });

  it("requires at least one id to bulk reject candidates", () => {
    expect(() =>
      bulkRejectLearningCandidatesSchema.parse({
        candidate_ids: [],
        reason: "stale",
      }),
    ).toThrow();
  });

  it("requires a reason to bulk reject candidates", () => {
    expect(() =>
      bulkRejectLearningCandidatesSchema.parse({
        candidate_ids: ["00000000-0000-4000-8000-000000000001"],
        reason: "",
      }),
    ).toThrow();
  });

  it("caps bulk candidate ids at 100", () => {
    const ids = Array.from(
      { length: 101 },
      () => "00000000-0000-4000-8000-000000000001",
    );
    expect(() =>
      bulkRejectLearningCandidatesSchema.parse({
        candidate_ids: ids,
        reason: "stale",
      }),
    ).toThrow();
  });

  it("allows bulk archiving candidates without a reason", () => {
    expect(
      bulkArchiveLearningCandidatesSchema.parse({
        candidate_ids: ["00000000-0000-4000-8000-000000000001"],
      }),
    ).toEqual({ candidate_ids: ["00000000-0000-4000-8000-000000000001"] });
  });

  it("accepts a bulk promote request", () => {
    expect(
      bulkPromoteLearningCandidatesSchema.parse({
        candidate_ids: ["00000000-0000-4000-8000-000000000001"],
        requested_by: "reviewer-1",
      }),
    ).toEqual({
      candidate_ids: ["00000000-0000-4000-8000-000000000001"],
      requested_by: "reviewer-1",
    });
  });
});

describe("proposal bulk action schemas", () => {
  it("accepts a bulk approve request", () => {
    expect(
      bulkApproveSkillImprovementProposalsSchema.parse({
        proposal_ids: ["00000000-0000-4000-8000-000000000001"],
        approved_by: "reviewer-1",
      }),
    ).toEqual({
      proposal_ids: ["00000000-0000-4000-8000-000000000001"],
      approved_by: "reviewer-1",
    });
  });

  it("requires a reason to bulk reject proposals", () => {
    expect(() =>
      bulkRejectSkillImprovementProposalsSchema.parse({
        proposal_ids: ["00000000-0000-4000-8000-000000000001"],
        reason: "",
      }),
    ).toThrow();
  });
});
```

Add the new schema/type names to the top `import` block of the spec file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/schemas/memory/learning-contracts.schema.spec.ts`
Expected: FAIL — new schemas do not exist yet

- [ ] **Step 3: Implement the schemas**

Append to `packages/core/src/schemas/memory/learning-contracts.schema.ts` (after `rejectSkillImprovementProposalSchema`):

```typescript
export const rejectLearningCandidateSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000),
    rejected_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();

export const archiveLearningCandidateSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000).optional(),
    archived_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();

const bulkCandidateIdsSchema = z.array(z.uuid()).min(1).max(100);
const bulkProposalIdsSchema = z.array(z.uuid()).min(1).max(100);

export const bulkRejectLearningCandidatesSchema = z
  .object({
    candidate_ids: bulkCandidateIdsSchema,
    reason: z.string().trim().min(1).max(2000),
    rejected_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();

export const bulkArchiveLearningCandidatesSchema = z
  .object({
    candidate_ids: bulkCandidateIdsSchema,
    reason: z.string().trim().min(1).max(2000).optional(),
    archived_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();

export const bulkPromoteLearningCandidatesSchema = z
  .object({
    candidate_ids: bulkCandidateIdsSchema,
    requested_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();

export const bulkApproveSkillImprovementProposalsSchema = z
  .object({
    proposal_ids: bulkProposalIdsSchema,
    approved_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();

export const bulkRejectSkillImprovementProposalsSchema = z
  .object({
    proposal_ids: bulkProposalIdsSchema,
    reason: z.string().trim().min(1).max(2000),
    rejected_by: z.string().trim().min(1).max(128).optional(),
  })
  .strip();
```

And at the bottom, alongside the existing `export type ...Request` block:

```typescript
export type RejectLearningCandidateRequest = z.infer<
  typeof rejectLearningCandidateSchema
>;
export type ArchiveLearningCandidateRequest = z.infer<
  typeof archiveLearningCandidateSchema
>;
export type BulkRejectLearningCandidatesRequest = z.infer<
  typeof bulkRejectLearningCandidatesSchema
>;
export type BulkArchiveLearningCandidatesRequest = z.infer<
  typeof bulkArchiveLearningCandidatesSchema
>;
export type BulkPromoteLearningCandidatesRequest = z.infer<
  typeof bulkPromoteLearningCandidatesSchema
>;
export type BulkApproveSkillImprovementProposalsRequest = z.infer<
  typeof bulkApproveSkillImprovementProposalsSchema
>;
export type BulkRejectSkillImprovementProposalsRequest = z.infer<
  typeof bulkRejectSkillImprovementProposalsSchema
>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/schemas/memory/learning-contracts.schema.spec.ts`
Expected: PASS

- [ ] **Step 5: Build packages/core**

Run: `npm run build --workspace=packages/core`
Expected: build succeeds

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas/memory/learning-contracts.schema.ts packages/core/src/schemas/memory/learning-contracts.schema.spec.ts
git commit -m "feat(core): add candidate reject/archive and bulk action request schemas"
```

---

### Task 5: Event names — candidate rejected/archived

**Files:**

- Modify: `apps/api/src/observability/autonomy-observability.types.ts`

**Interfaces:**

- Produces: `AUTONOMY_EVENT_NAMES.learningCandidateRejected = 'memory.learning.candidate_rejected'` and `AUTONOMY_EVENT_NAMES.learningCandidateArchived = 'memory.learning.candidate_archived'`. Consumed by Task 11 (`LearningCandidateDecisionService`).

This file has no dedicated spec file today (it's a plain constant object with no branching logic), so this task has no new test — it's a pure additive constant, verified by the calling code's tests in Task 11.

- [ ] **Step 1: Add the two event name constants**

In `apps/api/src/observability/autonomy-observability.types.ts`, add after `skillProposalRejected: 'memory.learning.skill_proposal_rejected',`:

```typescript
  learningCandidateRejected: 'memory.learning.candidate_rejected',
  learningCandidateArchived: 'memory.learning.candidate_archived',
```

- [ ] **Step 2: Typecheck**

Run: `npm run build --workspace=apps/api` (or the project's typecheck script if faster — check `apps/api/package.json` for a `typecheck` script and prefer it)
Expected: no new errors (this is a pure additive object literal change)

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/observability/autonomy-observability.types.ts
git commit -m "feat(observability): add learning candidate rejected/archived event names"
```

---

### Task 6: `LearningCandidateRepository.list()` — query-helpers rewrite

**Files:**

- Modify: `apps/api/src/memory/database/repositories/learning-candidate.repository.ts`
- Modify: `apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts`

**Interfaces:**

- Consumes: `applyPagination`, `applySearch`, `applySort` from `apps/api/src/common/utils/query-helpers.ts` (existing, unmodified).
- Produces: `LearningCandidateRepository.list(params: ListLearningCandidatesParams): Promise<{ data: LearningCandidate[]; total: number }>` where `ListLearningCandidatesParams` gains `search?: string`, `candidateTypes?: string[]`, `minScore?: number`, `createdFrom?: Date`, `createdTo?: Date`, `page: number` (replacing `offset: number`), `sortBy?: string`, `sortDir?: 'asc' | 'desc'`. Consumed by Task 14 (`LearningService.listCandidates`).

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts`, update `createMockCandidateQueryBuilder` to also stub `getCount`/`getMany`/`skip`/`take` (the new helpers call these instead of `getManyAndCount`/`offset`/`limit`):

```typescript
type MockCandidateQueryBuilder = {
  orderBy: ReturnType<typeof vi.fn>;
  addOrderBy: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  skip: ReturnType<typeof vi.fn>;
  take: ReturnType<typeof vi.fn>;
  getCount: ReturnType<typeof vi.fn>;
  getMany: ReturnType<typeof vi.fn>;
};

const createMockCandidateQueryBuilder = (): MockCandidateQueryBuilder => ({
  orderBy: vi.fn().mockReturnThis(),
  addOrderBy: vi.fn().mockReturnThis(),
  andWhere: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
  take: vi.fn().mockReturnThis(),
  getCount: vi.fn().mockResolvedValue(0),
  getMany: vi.fn().mockResolvedValue([]),
});
```

Update every existing `it('...list...')`-style test in the `describe('LearningCandidateRepository')` block that calls `repository.list({...})` to pass `page: 1` instead of `offset: 0` (the three tests: `'filters candidates by neutral scope'`, `'does not exclude merged candidates by default'`, `'excludes merged candidates only when excludeMerged is set'`). Then add:

```typescript
it("sorts by score descending by default", async () => {
  const qb = createMockCandidateQueryBuilder();
  const repository = createRepository(qb);

  await repository.list({ page: 1, limit: 25 });

  expect(qb.orderBy).toHaveBeenCalledWith("candidate.score", "DESC");
});

it("sorts by an allowed column when requested", async () => {
  const qb = createMockCandidateQueryBuilder();
  const repository = createRepository(qb);

  await repository.list({
    page: 1,
    limit: 25,
    sortBy: "created_at",
    sortDir: "asc",
  });

  expect(qb.orderBy).toHaveBeenCalledWith("candidate.created_at", "ASC");
});

it("ignores a sort column outside the allowlist", async () => {
  const qb = createMockCandidateQueryBuilder();
  const repository = createRepository(qb);

  await repository.list({ page: 1, limit: 25, sortBy: "signals_json" });

  expect(qb.orderBy).toHaveBeenCalledWith("candidate.score", "DESC");
});

it("applies the shared search clause across title and summary", async () => {
  const qb = createMockCandidateQueryBuilder();
  const repository = createRepository(qb);

  await repository.list({ page: 1, limit: 25, search: "flaky test" });

  expect(qb.andWhere).toHaveBeenCalledWith(
    "(candidate.title ILIKE :searchTerm OR candidate.summary ILIKE :searchTerm)",
    { searchTerm: "%flaky test%" },
  );
});

it("filters by candidate_type", async () => {
  const qb = createMockCandidateQueryBuilder();
  const repository = createRepository(qb);

  await repository.list({
    page: 1,
    limit: 25,
    candidateTypes: ["agent_capture", "runtime_learning"],
  });

  expect(qb.andWhere).toHaveBeenCalledWith(
    "candidate.candidate_type IN (:...candidateTypes)",
    { candidateTypes: ["agent_capture", "runtime_learning"] },
  );
});

it("filters by a minimum score", async () => {
  const qb = createMockCandidateQueryBuilder();
  const repository = createRepository(qb);

  await repository.list({ page: 1, limit: 25, minScore: 0.6 });

  expect(qb.andWhere).toHaveBeenCalledWith("candidate.score >= :minScore", {
    minScore: 0.6,
  });
});

it("filters by a created_at date range", async () => {
  const qb = createMockCandidateQueryBuilder();
  const repository = createRepository(qb);
  const from = new Date("2026-06-01T00:00:00.000Z");
  const to = new Date("2026-06-30T00:00:00.000Z");

  await repository.list({
    page: 1,
    limit: 25,
    createdFrom: from,
    createdTo: to,
  });

  expect(qb.andWhere).toHaveBeenCalledWith(
    "candidate.created_at >= :createdFrom",
    {
      createdFrom: from,
    },
  );
  expect(qb.andWhere).toHaveBeenCalledWith(
    "candidate.created_at <= :createdTo",
    {
      createdTo: to,
    },
  );
});

it("clamps page size and computes the offset via applyPagination", async () => {
  const qb = createMockCandidateQueryBuilder();
  const repository = createRepository(qb);

  await repository.list({ page: 3, limit: 500 });

  expect(qb.take).toHaveBeenCalledWith(100);
  expect(qb.skip).toHaveBeenCalledWith(200);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts`
Expected: FAIL — `list()` still uses `.offset()`/`.limit()`/`getManyAndCount()` and ignores the new params

- [ ] **Step 3: Rewrite `list()`**

In `apps/api/src/memory/database/repositories/learning-candidate.repository.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, LessThan, Repository } from "typeorm";
import { LearningCandidate } from "../entities/learning-candidate.entity";
import {
  applyPagination,
  applySearch,
  applySort,
} from "../../../common/utils/query-helpers";

interface ListLearningCandidatesParams {
  statuses?: string[];
  candidateTypes?: string[];
  scopeType?: string;
  scopeId?: string;
  excludeMerged?: boolean;
  search?: string;
  minScore?: number;
  createdFrom?: Date;
  createdTo?: Date;
  page: number;
  limit: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

const MERGED_STATUS = "merged";

const PROMOTION_IN_PROGRESS_STATUS = "promotion_in_progress";

const CANDIDATE_ALLOWED_SORTS = [
  "score",
  "created_at",
  "updated_at",
  "first_seen_at",
  "last_seen_at",
  "promoted_at",
];

const CANDIDATE_SEARCHABLE_COLUMNS = ["title", "summary"];
```

Replace the `list()` method body:

```typescript
  async list(
    params: ListLearningCandidatesParams,
  ): Promise<{ data: LearningCandidate[]; total: number }> {
    const qb = this.repository.createQueryBuilder('candidate');

    applySearch(qb, params.search, CANDIDATE_SEARCHABLE_COLUMNS);

    if (params.statuses && params.statuses.length > 0) {
      qb.andWhere('candidate.status IN (:...statuses)', {
        statuses: params.statuses,
      });
    }

    if (params.excludeMerged) {
      // Opt-in: hide clustering duplicates; they are counted separately
      qb.andWhere('candidate.status != :merged', { merged: MERGED_STATUS });
    }

    if (params.candidateTypes && params.candidateTypes.length > 0) {
      qb.andWhere('candidate.candidate_type IN (:...candidateTypes)', {
        candidateTypes: params.candidateTypes,
      });
    }

    if (params.scopeType) {
      qb.andWhere('candidate.scope_type = :scopeType', {
        scopeType: params.scopeType,
      });
    }

    if (params.scopeId) {
      qb.andWhere('candidate.scope_id = :scopeId', { scopeId: params.scopeId });
    }

    if (params.minScore !== undefined) {
      qb.andWhere('candidate.score >= :minScore', { minScore: params.minScore });
    }

    if (params.createdFrom) {
      qb.andWhere('candidate.created_at >= :createdFrom', {
        createdFrom: params.createdFrom,
      });
    }

    if (params.createdTo) {
      qb.andWhere('candidate.created_at <= :createdTo', {
        createdTo: params.createdTo,
      });
    }

    const total = await qb.getCount();

    applySort(qb, params.sortBy, params.sortDir, CANDIDATE_ALLOWED_SORTS, 'score', 'desc');
    applyPagination(qb, params.page, params.limit);

    const data = await qb.getMany();
    return { data, total };
  }
```

Note: `applySort`'s default sort direction parameter is `'desc'` and its 3rd positional arg is the allowlist — the existing `applySort` signature (`qb, sortBy, sortDir, allowedColumns, defaultSort, defaultDir, entityAlias`) already matches this call.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts`
Expected: PASS (all tests, old and new)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/memory/database/repositories/learning-candidate.repository.ts apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts
git commit -m "feat(memory): rewrite LearningCandidateRepository.list onto shared query helpers"
```

---

### Task 7: `LearningCandidateRepository` — reject/archive + bulk methods

**Files:**

- Modify: `apps/api/src/memory/database/repositories/learning-candidate.repository.ts`
- Modify: `apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts`

**Interfaces:**

- Consumes: `BulkActionError` from `apps/api/src/common/errors/bulk-action.error.ts` (Task 2).
- Produces: `rejectById(id: string, data: { rejectedBy: string | null; reason: string }): Promise<LearningCandidate | null>`, `archiveById(id: string, data: { archivedBy: string | null; reason: string | null }): Promise<LearningCandidate | null>`, `bulkReject(ids: string[], data: { rejectedBy: string | null; reason: string }): Promise<LearningCandidate[]>` (throws `BulkActionError` on invalid input), `bulkArchive(ids: string[], data: { archivedBy: string | null; reason: string | null }): Promise<LearningCandidate[]>` (throws `BulkActionError`). Consumed by Task 11 (`LearningCandidateDecisionService`).

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts`:

```typescript
it("rejects a pending candidate and stamps the audit fields", async () => {
  const qb = createMockCandidateQueryBuilder();
  const rejected = createCandidate({ status: "rejected" });
  const typeormRepository = {
    createQueryBuilder: vi.fn().mockReturnValue(qb),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    findOne: vi.fn().mockResolvedValue(rejected),
  };
  const repository = createRepository(qb, typeormRepository);

  const result = await repository.rejectById("candidate-1", {
    rejectedBy: "reviewer-1",
    reason: "Not useful",
  });

  expect(typeormRepository.update).toHaveBeenCalledWith(
    { id: "candidate-1", status: "pending" },
    expect.objectContaining({
      status: "rejected",
      rejected_by: "reviewer-1",
      rejection_reason: "Not useful",
    }),
  );
  expect(result).toBe(rejected);
});

it("returns null rejecting a candidate that is not pending", async () => {
  const qb = createMockCandidateQueryBuilder();
  const typeormRepository = {
    createQueryBuilder: vi.fn().mockReturnValue(qb),
    update: vi.fn().mockResolvedValue({ affected: 0 }),
    findOne: vi.fn(),
  };
  const repository = createRepository(qb, typeormRepository);

  const result = await repository.rejectById("candidate-1", {
    rejectedBy: null,
    reason: "Not useful",
  });

  expect(result).toBeNull();
  expect(typeormRepository.findOne).not.toHaveBeenCalled();
});

it("archives a pending candidate with an optional reason", async () => {
  const qb = createMockCandidateQueryBuilder();
  const archived = createCandidate({ status: "archived" });
  const typeormRepository = {
    createQueryBuilder: vi.fn().mockReturnValue(qb),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
    findOne: vi.fn().mockResolvedValue(archived),
  };
  const repository = createRepository(qb, typeormRepository);

  const result = await repository.archiveById("candidate-1", {
    archivedBy: "reviewer-1",
    reason: null,
  });

  expect(typeormRepository.update).toHaveBeenCalledWith(
    { id: "candidate-1", status: "pending" },
    expect.objectContaining({ status: "archived", archived_by: "reviewer-1" }),
  );
  expect(result).toBe(archived);
});

it("bulk rejects candidates transactionally", async () => {
  const pending = [
    createCandidate({ id: "c1", status: "pending" }),
    createCandidate({ id: "c2", status: "pending" }),
  ];
  const manager = {
    find: vi.fn().mockResolvedValue(pending),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const repository = new LearningCandidateRepository({
    manager: {
      transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
    },
  } as unknown as Repository<LearningCandidate>);

  const result = await repository.bulkReject(["c1", "c2"], {
    rejectedBy: "reviewer-1",
    reason: "stale batch",
  });

  expect(manager.update).toHaveBeenCalledWith(
    LearningCandidate,
    { id: expect.anything() },
    expect.objectContaining({
      status: "rejected",
      rejection_reason: "stale batch",
    }),
  );
  expect(result).toBe(pending);
});

it('throws BulkActionError("not_found") when a bulk-reject id does not exist', async () => {
  const manager = {
    find: vi
      .fn()
      .mockResolvedValue([createCandidate({ id: "c1", status: "pending" })]),
    update: vi.fn(),
  };
  const repository = new LearningCandidateRepository({
    manager: {
      transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
    },
  } as unknown as Repository<LearningCandidate>);

  await expect(
    repository.bulkReject(["c1", "c2"], { rejectedBy: null, reason: "x" }),
  ).rejects.toMatchObject({ code: "not_found", ids: ["c2"] });
  expect(manager.update).not.toHaveBeenCalled();
});

it('throws BulkActionError("invalid_status") when a bulk-reject candidate is not pending', async () => {
  const manager = {
    find: vi
      .fn()
      .mockResolvedValue([createCandidate({ id: "c1", status: "promoted" })]),
    update: vi.fn(),
  };
  const repository = new LearningCandidateRepository({
    manager: {
      transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
    },
  } as unknown as Repository<LearningCandidate>);

  await expect(
    repository.bulkReject(["c1"], { rejectedBy: null, reason: "x" }),
  ).rejects.toMatchObject({ code: "invalid_status", ids: ["c1"] });
  expect(manager.update).not.toHaveBeenCalled();
});

it("bulk archives candidates transactionally", async () => {
  const pending = [createCandidate({ id: "c1", status: "pending" })];
  const manager = {
    find: vi.fn().mockResolvedValue(pending),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const repository = new LearningCandidateRepository({
    manager: {
      transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
    },
  } as unknown as Repository<LearningCandidate>);

  const result = await repository.bulkArchive(["c1"], {
    archivedBy: null,
    reason: "superseded",
  });

  expect(manager.update).toHaveBeenCalledWith(
    LearningCandidate,
    { id: expect.anything() },
    expect.objectContaining({
      status: "archived",
      archive_reason: "superseded",
    }),
  );
  expect(result).toBe(pending);
});
```

These four bulk-method tests construct `LearningCandidateRepository` directly (not via the file's existing `createRepository` helper), because the helper's `MockLearningCandidateRepository` type (a `Pick` of only `createQueryBuilder`/`findOne`/`update`/`count`) doesn't include `manager` — passing a `manager` key through `createRepository`'s `overrides` parameter would be a TypeScript excess-property error. The direct `new LearningCandidateRepository({...} as unknown as Repository<LearningCandidate>)` construction (same double-cast style already used by `createRepository` internally) sidesteps that cleanly. Import `LearningCandidate` and `Repository` are already present at the top of the spec file (`Repository` from `'typeorm'`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts`
Expected: FAIL — `rejectById`/`archiveById`/`bulkReject`/`bulkArchive` do not exist yet

- [ ] **Step 3: Implement the methods**

In `apps/api/src/memory/database/repositories/learning-candidate.repository.ts`, add the import:

```typescript
import { BulkActionError } from "../../../common/errors/bulk-action.error";
```

Add these methods (after `findByFingerprint`, before `list`):

```typescript
  async rejectById(
    id: string,
    data: { rejectedBy: string | null; reason: string },
  ): Promise<LearningCandidate | null> {
    const result = await this.repository.update(
      { id, status: 'pending' },
      {
        status: 'rejected',
        rejected_by: data.rejectedBy,
        rejected_at: new Date(),
        rejection_reason: data.reason,
      },
    );

    if (!result.affected) {
      return null;
    }

    return this.findById(id);
  }

  async archiveById(
    id: string,
    data: { archivedBy: string | null; reason: string | null },
  ): Promise<LearningCandidate | null> {
    const result = await this.repository.update(
      { id, status: 'pending' },
      {
        status: 'archived',
        archived_by: data.archivedBy,
        archived_at: new Date(),
        archive_reason: data.reason,
      },
    );

    if (!result.affected) {
      return null;
    }

    return this.findById(id);
  }

  async bulkReject(
    ids: string[],
    data: { rejectedBy: string | null; reason: string },
  ): Promise<LearningCandidate[]> {
    return this.repository.manager.transaction(async (manager) => {
      const found = await this.verifyPendingBatch(manager, ids);

      await manager.update(
        LearningCandidate,
        { id: In(ids) },
        {
          status: 'rejected',
          rejected_by: data.rejectedBy,
          rejected_at: new Date(),
          rejection_reason: data.reason,
        },
      );

      return found;
    });
  }

  async bulkArchive(
    ids: string[],
    data: { archivedBy: string | null; reason: string | null },
  ): Promise<LearningCandidate[]> {
    return this.repository.manager.transaction(async (manager) => {
      const found = await this.verifyPendingBatch(manager, ids);

      await manager.update(
        LearningCandidate,
        { id: In(ids) },
        {
          status: 'archived',
          archived_by: data.archivedBy,
          archived_at: new Date(),
          archive_reason: data.reason,
        },
      );

      return found;
    });
  }

  /**
   * Load the target rows inside the transaction and verify every id exists
   * and is `pending` before any write happens — throws {@link BulkActionError}
   * (which rolls back the transaction) identifying the offending ids otherwise.
   */
  private async verifyPendingBatch(
    manager: { find: Repository<LearningCandidate>['find'] },
    ids: string[],
  ): Promise<LearningCandidate[]> {
    const found = await manager.find(LearningCandidate, {
      where: { id: In(ids) },
    });
    const foundIds = new Set(found.map((candidate) => candidate.id));
    const missingIds = ids.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new BulkActionError('not_found', missingIds);
    }

    const invalidIds = found
      .filter((candidate) => candidate.status !== 'pending')
      .map((candidate) => candidate.id);
    if (invalidIds.length > 0) {
      throw new BulkActionError('invalid_status', invalidIds);
    }

    return found;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/memory/database/repositories/learning-candidate.repository.ts apps/api/src/memory/database/repositories/learning-candidate.repository.spec.ts
git commit -m "feat(memory): add candidate reject/archive and transactional bulk methods"
```

---

### Task 8: `SkillImprovementProposalRepository.list()` — query-helpers rewrite

**Files:**

- Modify: `apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.ts`
- Modify: `apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.spec.ts`

**Interfaces:**

- Produces: `SkillImprovementProposalRepository.list(params)` where `ListSkillImprovementProposalsParams` gains `search?: string`, `createdFrom?: Date`, `createdTo?: Date`, `page: number` (replacing `offset`), `sortBy?: string`, `sortDir?: 'asc' | 'desc'`. Consumed by Task 13 (`SkillProposalService.list`).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.spec.ts` today only tests `updatePendingById` via a plain `typeormRepo = { update: vi.fn(), findOne: vi.fn() }` built once in a top-level `beforeEach` — it has no query-builder mock yet, since `list()` was never tested. Extend that `beforeEach` to also provide a `createQueryBuilder` mock, and add a new `describe('list', ...)` block. Replace the full file with:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import { SkillImprovementProposal } from "../entities/skill-improvement-proposal.entity";
import { SkillImprovementProposalRepository } from "./skill-improvement-proposal.repository";

type MockQueryBuilder = {
  andWhere: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  skip: ReturnType<typeof vi.fn>;
  take: ReturnType<typeof vi.fn>;
  getCount: ReturnType<typeof vi.fn>;
  getMany: ReturnType<typeof vi.fn>;
};

type MockTypeormRepository = Pick<
  Repository<SkillImprovementProposal>,
  "update" | "findOne" | "createQueryBuilder"
>;

describe("SkillImprovementProposalRepository", () => {
  let repository: SkillImprovementProposalRepository;
  let typeormRepo: MockTypeormRepository;
  let qb: MockQueryBuilder;

  beforeEach(() => {
    qb = {
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getCount: vi.fn().mockResolvedValue(0),
      getMany: vi.fn().mockResolvedValue([]),
    };
    typeormRepo = {
      update: vi.fn(),
      findOne: vi.fn(),
      createQueryBuilder: vi.fn().mockReturnValue(qb),
    };

    repository = new SkillImprovementProposalRepository(
      typeormRepo as Repository<SkillImprovementProposal>,
    );
  });

  it("updates proposals only when they are still pending", async () => {
    const updated = {
      id: "proposal-1",
      status: "approved",
    } as SkillImprovementProposal;
    vi.mocked(typeormRepo.update).mockResolvedValue({ affected: 1 });
    vi.mocked(typeormRepo.findOne).mockResolvedValue(updated);

    const result = await repository.updatePendingById("proposal-1", {
      status: "approved",
    });

    expect(typeormRepo.update).toHaveBeenCalledWith(
      { id: "proposal-1", status: "pending" },
      { status: "approved" },
    );
    expect(result).toBe(updated);
  });

  it("returns null without reloading when no pending proposal was updated", async () => {
    vi.mocked(typeormRepo.update).mockResolvedValue({ affected: 0 });

    const result = await repository.updatePendingById("proposal-1", {
      status: "approved",
    });

    expect(result).toBeNull();
    expect(typeormRepo.findOne).not.toHaveBeenCalled();
  });

  it("returns null when the updated proposal cannot be reloaded", async () => {
    vi.mocked(typeormRepo.update).mockResolvedValue({ affected: 1 });
    vi.mocked(typeormRepo.findOne).mockResolvedValue(null);

    const result = await repository.updatePendingById("proposal-1", {
      status: "approved",
    });

    expect(result).toBeNull();
    expect(typeormRepo.findOne).toHaveBeenCalledWith({
      where: { id: "proposal-1" },
    });
  });

  describe("list", () => {
    it("sorts by created_at descending by default", async () => {
      await repository.list({ page: 1, limit: 25 });

      expect(qb.orderBy).toHaveBeenCalledWith("proposal.created_at", "DESC");
    });

    it("sorts by an allowed column when requested", async () => {
      await repository.list({
        page: 1,
        limit: 25,
        sortBy: "approved_at",
        sortDir: "asc",
      });

      expect(qb.orderBy).toHaveBeenCalledWith("proposal.approved_at", "ASC");
    });

    it("ignores a sort column outside the allowlist", async () => {
      await repository.list({ page: 1, limit: 25, sortBy: "patch_markdown" });

      expect(qb.orderBy).toHaveBeenCalledWith("proposal.created_at", "DESC");
    });

    it("applies the shared search clause across title/summary/skill name", async () => {
      await repository.list({ page: 1, limit: 25, search: "retry" });

      expect(qb.andWhere).toHaveBeenCalledWith(
        "(proposal.target_skill_name ILIKE :searchTerm OR proposal.proposal_title ILIKE :searchTerm OR proposal.proposal_summary ILIKE :searchTerm)",
        { searchTerm: "%retry%" },
      );
    });

    it("filters by status", async () => {
      await repository.list({
        page: 1,
        limit: 25,
        statuses: ["pending", "approved"],
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        "proposal.status IN (:...statuses)",
        {
          statuses: ["pending", "approved"],
        },
      );
    });

    it("filters by a created_at date range", async () => {
      const from = new Date("2026-06-01T00:00:00.000Z");
      const to = new Date("2026-06-30T00:00:00.000Z");

      await repository.list({
        page: 1,
        limit: 25,
        createdFrom: from,
        createdTo: to,
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        "proposal.created_at >= :createdFrom",
        {
          createdFrom: from,
        },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        "proposal.created_at <= :createdTo",
        {
          createdTo: to,
        },
      );
    });

    it("clamps page size and computes the offset via applyPagination", async () => {
      await repository.list({ page: 3, limit: 500 });

      expect(qb.take).toHaveBeenCalledWith(100);
      expect(qb.skip).toHaveBeenCalledWith(200);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.spec.ts`
Expected: FAIL

- [ ] **Step 3: Rewrite `list()`**

In `apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.ts`, add the import and constants:

```typescript
import {
  applyPagination,
  applySearch,
  applySort,
} from "../../../common/utils/query-helpers";

const PROPOSAL_ALLOWED_SORTS = [
  "created_at",
  "approved_at",
  "rejected_at",
  "applied_at",
];

const PROPOSAL_SEARCHABLE_COLUMNS = [
  "target_skill_name",
  "proposal_title",
  "proposal_summary",
];
```

Update `ListSkillImprovementProposalsParams` and `list()`:

```typescript
interface ListSkillImprovementProposalsParams {
  statuses?: string[];
  search?: string;
  createdFrom?: Date;
  createdTo?: Date;
  page: number;
  limit: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}
```

```typescript
  async list(
    params: ListSkillImprovementProposalsParams,
  ): Promise<{ data: SkillImprovementProposal[]; total: number }> {
    const qb = this.repository.createQueryBuilder('proposal');

    applySearch(qb, params.search, PROPOSAL_SEARCHABLE_COLUMNS);

    if (params.statuses && params.statuses.length > 0) {
      qb.andWhere('proposal.status IN (:...statuses)', {
        statuses: params.statuses,
      });
    }

    if (params.createdFrom) {
      qb.andWhere('proposal.created_at >= :createdFrom', {
        createdFrom: params.createdFrom,
      });
    }

    if (params.createdTo) {
      qb.andWhere('proposal.created_at <= :createdTo', {
        createdTo: params.createdTo,
      });
    }

    const total = await qb.getCount();

    applySort(qb, params.sortBy, params.sortDir, PROPOSAL_ALLOWED_SORTS, 'created_at', 'desc');
    applyPagination(qb, params.page, params.limit);

    const data = await qb.getMany();
    return { data, total };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.ts apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.spec.ts
git commit -m "feat(memory): rewrite SkillImprovementProposalRepository.list onto shared query helpers"
```

---

### Task 9: `SkillImprovementProposalRepository` — bulk approve/reject methods

**Files:**

- Modify: `apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.ts`
- Modify: `apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.spec.ts`

**Interfaces:**

- Consumes: `BulkActionError` (Task 2).
- Produces: `bulkApprove(ids: string[], data: { approvedBy: string | null }): Promise<SkillImprovementProposal[]>`, `bulkReject(ids: string[], data: { rejectedBy: string | null; reason: string }): Promise<SkillImprovementProposal[]>`. Both throw `BulkActionError`. Consumed by Task 13 (`SkillProposalService`).

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.spec.ts` (as rewritten by Task 8), add a `createProposal` fixture helper below the `describe('SkillImprovementProposalRepository', ...)` block (after its closing `});`, mirroring `learning-candidate.repository.spec.ts`'s `createCandidate` helper), and add a new `describe('bulk actions', ...)` block **inside** the existing `describe('SkillImprovementProposalRepository', ...)` block, alongside `describe('list', ...)` (i.e. before that describe block's own final closing `});`, not appended after the whole file):

```typescript
function createProposal(
  overrides: Partial<SkillImprovementProposal> = {},
): SkillImprovementProposal {
  return {
    id: "proposal-1",
    learning_candidate_id: null,
    learning_candidate: null,
    target_skill_name: "skill",
    proposal_title: "title",
    proposal_summary: "summary",
    patch_markdown: "patch",
    rationale: null,
    status: "pending",
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    applied_at: null,
    error_message: null,
    diagnostics_json: null,
    generated_from_run_id: null,
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    updated_at: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  } as SkillImprovementProposal;
}
```

```typescript
describe("bulk actions", () => {
  it("bulk approves pending proposals transactionally", async () => {
    const pending = [createProposal({ id: "p1", status: "pending" })];
    const manager = {
      find: vi.fn().mockResolvedValue(pending),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const repository = new SkillImprovementProposalRepository({
      manager: {
        transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
      },
    } as unknown as Repository<SkillImprovementProposal>);

    const result = await repository.bulkApprove(["p1"], {
      approvedBy: "reviewer-1",
    });

    expect(manager.update).toHaveBeenCalledWith(
      SkillImprovementProposal,
      { id: expect.anything() },
      expect.objectContaining({
        status: "approved",
        approved_by: "reviewer-1",
      }),
    );
    expect(result).toBe(pending);
  });

  it('throws BulkActionError("invalid_status") bulk-approving a non-pending proposal', async () => {
    const manager = {
      find: vi
        .fn()
        .mockResolvedValue([createProposal({ id: "p1", status: "approved" })]),
      update: vi.fn(),
    };
    const repository = new SkillImprovementProposalRepository({
      manager: {
        transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
      },
    } as unknown as Repository<SkillImprovementProposal>);

    await expect(
      repository.bulkApprove(["p1"], { approvedBy: null }),
    ).rejects.toMatchObject({ code: "invalid_status", ids: ["p1"] });
    expect(manager.update).not.toHaveBeenCalled();
  });

  it("bulk rejects pending proposals transactionally", async () => {
    const pending = [createProposal({ id: "p1", status: "pending" })];
    const manager = {
      find: vi.fn().mockResolvedValue(pending),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const repository = new SkillImprovementProposalRepository({
      manager: {
        transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
      },
    } as unknown as Repository<SkillImprovementProposal>);

    const result = await repository.bulkReject(["p1"], {
      rejectedBy: null,
      reason: "duplicate batch",
    });

    expect(manager.update).toHaveBeenCalledWith(
      SkillImprovementProposal,
      { id: expect.anything() },
      expect.objectContaining({
        status: "rejected",
        rejection_reason: "duplicate batch",
      }),
    );
    expect(result).toBe(pending);
  });

  it('throws BulkActionError("not_found") bulk-rejecting an unknown proposal id', async () => {
    const manager = {
      find: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    };
    const repository = new SkillImprovementProposalRepository({
      manager: {
        transaction: vi.fn((fn: (m: unknown) => unknown) => fn(manager)),
      },
    } as unknown as Repository<SkillImprovementProposal>);

    await expect(
      repository.bulkReject(["missing"], { rejectedBy: null, reason: "x" }),
    ).rejects.toMatchObject({ code: "not_found", ids: ["missing"] });
  });
});
```

These four tests construct `SkillImprovementProposalRepository` directly with a double-cast (`as unknown as Repository<SkillImprovementProposal>`) rather than via the shared `beforeEach`-built `repository`, since the transaction-based `manager` isn't part of the `beforeEach`'s `typeormRepo` shape — each test builds its own minimal repository instance instead of using the outer `repository`/`typeormRepo` variables. `SkillImprovementProposal` is already imported as a value (not type-only) from Task 8's rewrite, since `manager.update(...)`'s assertions above reference it as a runtime value.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.spec.ts`
Expected: FAIL — `bulkApprove`/`bulkReject` do not exist yet

- [ ] **Step 3: Implement the methods**

Add the import:

```typescript
import { BulkActionError } from "../../../common/errors/bulk-action.error";
```

Add these methods (after `updatePendingById`):

```typescript
  async bulkApprove(
    ids: string[],
    data: { approvedBy: string | null },
  ): Promise<SkillImprovementProposal[]> {
    return this.repository.manager.transaction(async (manager) => {
      const found = await this.verifyPendingBatch(manager, ids);

      await manager.update(
        SkillImprovementProposal,
        { id: In(ids) },
        { status: 'approved', approved_by: data.approvedBy, approved_at: new Date() },
      );

      return found;
    });
  }

  async bulkReject(
    ids: string[],
    data: { rejectedBy: string | null; reason: string },
  ): Promise<SkillImprovementProposal[]> {
    return this.repository.manager.transaction(async (manager) => {
      const found = await this.verifyPendingBatch(manager, ids);

      await manager.update(
        SkillImprovementProposal,
        { id: In(ids) },
        {
          status: 'rejected',
          rejected_by: data.rejectedBy,
          rejected_at: new Date(),
          rejection_reason: data.reason,
        },
      );

      return found;
    });
  }

  private async verifyPendingBatch(
    manager: { find: Repository<SkillImprovementProposal>['find'] },
    ids: string[],
  ): Promise<SkillImprovementProposal[]> {
    const found = await manager.find(SkillImprovementProposal, {
      where: { id: In(ids) },
    });
    const foundIds = new Set(found.map((proposal) => proposal.id));
    const missingIds = ids.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new BulkActionError('not_found', missingIds);
    }

    const invalidIds = found
      .filter((proposal) => proposal.status !== 'pending')
      .map((proposal) => proposal.id);
    if (invalidIds.length > 0) {
      throw new BulkActionError('invalid_status', invalidIds);
    }

    return found;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.ts apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.spec.ts
git commit -m "feat(memory): add transactional bulk approve/reject to SkillImprovementProposalRepository"
```

---

### Task 10: Response envelope + surfaced fields — mapper and types

**Files:**

- Modify: `apps/api/src/memory/learning/learning.types.ts`
- Modify: `apps/api/src/memory/learning/learning.mapper.ts`
- Create: `apps/api/src/memory/learning/learning.mapper.spec.ts`

**Interfaces:**

- Produces: `LearningCandidateListItem` gains `promoted_at: string | null`, `human_approved_at: string | null`, `first_seen_at: string`, `last_seen_at: string`, `rejected_at: string | null`, `rejected_by: string | null`, `rejection_reason: string | null`, `archived_at: string | null`, `archived_by: string | null`, `archive_reason: string | null`. `SkillProposalListItem` gains `approved_at: string | null`, `approved_by: string | null`, `rejected_at: string | null`, `rejected_by: string | null`, `rejection_reason: string | null`. `LearningCandidateListResponse`/new `SkillProposalListResponse` switch from `{items, total, limit, offset}` to `{data, meta: {pagination: {total, page, limit, totalPages}}}` (candidates additionally keep `meta.suppressedCount`). Consumed by Task 13 (`SkillProposalService.list`) and Task 14 (`LearningService.listCandidates`).

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/memory/learning/learning.mapper.spec.ts
import { describe, expect, it } from "vitest";
import type { LearningCandidate } from "../database/entities/learning-candidate.entity";
import type { SkillImprovementProposal } from "../database/entities/skill-improvement-proposal.entity";
import {
  toLearningCandidateListItem,
  toSkillProposalListItem,
} from "./learning.mapper";

function baseCandidate(): LearningCandidate {
  return {
    id: "candidate-1",
    scope_type: "global",
    scopeId: null,
    candidate_type: "runtime_learning",
    title: "title",
    summary: "summary",
    fingerprint: "fp",
    signals_json: {},
    score: 0.5,
    confidence: 0.5,
    recurrence_count: 1,
    stage_diversity_count: 1,
    failure_reduction_relevance: 0,
    recency_decay: 1,
    source_quality_confidence: 0,
    status: "pending",
    diagnostics_json: null,
    routing_target: null,
    promoted_memory_segment_id: null,
    promoted_at: null,
    human_approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    archived_by: null,
    archived_at: null,
    archive_reason: null,
    first_seen_at: new Date("2026-06-01T00:00:00.000Z"),
    last_seen_at: new Date("2026-06-02T00:00:00.000Z"),
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    updated_at: new Date("2026-06-02T00:00:00.000Z"),
  };
}

function baseProposal(): SkillImprovementProposal {
  return {
    id: "proposal-1",
    learning_candidate_id: null,
    learning_candidate: null,
    target_skill_name: "skill",
    proposal_title: "title",
    proposal_summary: "summary",
    patch_markdown: "patch",
    rationale: null,
    status: "pending",
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    applied_at: null,
    error_message: null,
    diagnostics_json: null,
    generated_from_run_id: null,
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    updated_at: new Date("2026-06-02T00:00:00.000Z"),
  };
}

describe("toLearningCandidateListItem", () => {
  it("surfaces the promotion, decision, and recurrence timestamps", () => {
    const candidate = {
      ...baseCandidate(),
      promoted_at: new Date("2026-06-03T00:00:00.000Z"),
      human_approved_at: new Date("2026-06-01T12:00:00.000Z"),
      rejected_at: new Date("2026-06-04T00:00:00.000Z"),
      rejected_by: "reviewer-1",
      rejection_reason: "Not useful",
      archived_at: new Date("2026-06-05T00:00:00.000Z"),
      archived_by: "reviewer-2",
      archive_reason: "Stale",
    };

    const item = toLearningCandidateListItem(candidate);

    expect(item.promoted_at).toBe("2026-06-03T00:00:00.000Z");
    expect(item.human_approved_at).toBe("2026-06-01T12:00:00.000Z");
    expect(item.first_seen_at).toBe("2026-06-01T00:00:00.000Z");
    expect(item.last_seen_at).toBe("2026-06-02T00:00:00.000Z");
    expect(item.rejected_at).toBe("2026-06-04T00:00:00.000Z");
    expect(item.rejected_by).toBe("reviewer-1");
    expect(item.rejection_reason).toBe("Not useful");
    expect(item.archived_at).toBe("2026-06-05T00:00:00.000Z");
    expect(item.archived_by).toBe("reviewer-2");
    expect(item.archive_reason).toBe("Stale");
  });

  it("surfaces null timestamps as null, not throwing", () => {
    const item = toLearningCandidateListItem(baseCandidate());

    expect(item.promoted_at).toBeNull();
    expect(item.rejected_at).toBeNull();
    expect(item.archived_at).toBeNull();
  });
});

describe("toSkillProposalListItem", () => {
  it("surfaces the approval/rejection audit fields", () => {
    const proposal = {
      ...baseProposal(),
      approved_at: new Date("2026-06-05T00:00:00.000Z"),
      approved_by: "reviewer-1",
      rejected_at: new Date("2026-06-06T00:00:00.000Z"),
      rejected_by: "reviewer-2",
      rejection_reason: "Needs more evidence",
    };

    const item = toSkillProposalListItem(proposal);

    expect(item.approved_at).toBe("2026-06-05T00:00:00.000Z");
    expect(item.approved_by).toBe("reviewer-1");
    expect(item.rejected_at).toBe("2026-06-06T00:00:00.000Z");
    expect(item.rejected_by).toBe("reviewer-2");
    expect(item.rejection_reason).toBe("Needs more evidence");
  });

  it("surfaces null approval/rejection fields as null", () => {
    const item = toSkillProposalListItem(baseProposal());

    expect(item.approved_at).toBeNull();
    expect(item.rejected_at).toBeNull();
    expect(item.rejection_reason).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/api/src/memory/learning/learning.mapper.spec.ts`
Expected: FAIL — the mapped items don't have these fields yet

- [ ] **Step 3: Update `learning.types.ts`**

```typescript
export interface LearningCandidateListItem {
  id: string;
  scope_type: string;
  scope_id: string | null;
  candidate_type: string;
  title: string;
  summary: string;
  fingerprint: string;
  status: string;
  score: number;
  confidence: number;
  recurrence_count: number;
  signals_json: Record<string, unknown>;
  promoted_at: string | null;
  human_approved_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface LearningCandidateListResponse {
  data: LearningCandidateListItem[];
  meta: {
    pagination: PaginationMeta;
    suppressedCount: number;
  };
}
```

Add `approved_at: string | null`, `approved_by: string | null`, `rejected_at: string | null`, `rejected_by: string | null`, `rejection_reason: string | null` to `SkillProposalListItem`, and add:

```typescript
export interface SkillProposalListResponse {
  data: SkillProposalListItem[];
  meta: {
    pagination: PaginationMeta;
  };
}
```

- [ ] **Step 4: Update `learning.mapper.ts`**

```typescript
export function toLearningCandidateListItem(
  candidate: LearningCandidate,
): LearningCandidateListItem {
  return {
    id: candidate.id,
    scope_type: candidate.scope_type,
    scope_id: candidate.scopeId,
    candidate_type: candidate.candidate_type,
    title: candidate.title,
    summary: candidate.summary,
    fingerprint: candidate.fingerprint,
    status: toPublicLearningCandidateStatus(candidate.status),
    score: candidate.score,
    confidence: candidate.confidence,
    recurrence_count: candidate.recurrence_count,
    signals_json: candidate.signals_json,
    promoted_at: candidate.promoted_at?.toISOString() ?? null,
    human_approved_at: candidate.human_approved_at?.toISOString() ?? null,
    first_seen_at: candidate.first_seen_at.toISOString(),
    last_seen_at: candidate.last_seen_at.toISOString(),
    rejected_at: candidate.rejected_at?.toISOString() ?? null,
    rejected_by: candidate.rejected_by,
    rejection_reason: candidate.rejection_reason,
    archived_at: candidate.archived_at?.toISOString() ?? null,
    archived_by: candidate.archived_by,
    archive_reason: candidate.archive_reason,
    created_at: candidate.created_at.toISOString(),
    updated_at: candidate.updated_at.toISOString(),
  };
}
```

```typescript
export function toSkillProposalListItem(
  proposal: SkillImprovementProposal,
): SkillProposalListItem {
  return {
    id: proposal.id,
    learning_candidate_id: proposal.learning_candidate_id,
    target_skill_name: proposal.target_skill_name,
    proposal_title: proposal.proposal_title,
    proposal_summary: proposal.proposal_summary,
    status: proposal.status,
    generated_from_run_id: proposal.generated_from_run_id,
    approved_at: proposal.approved_at?.toISOString() ?? null,
    approved_by: proposal.approved_by,
    rejected_at: proposal.rejected_at?.toISOString() ?? null,
    rejected_by: proposal.rejected_by,
    rejection_reason: proposal.rejection_reason,
    applied_at: proposal.applied_at?.toISOString() ?? null,
    scope_confirmation: extractScopeConfirmation(proposal.diagnostics_json),
    created_at: proposal.created_at.toISOString(),
    updated_at: proposal.updated_at.toISOString(),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/api/src/memory/learning/learning.mapper.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/memory/learning/learning.types.ts apps/api/src/memory/learning/learning.mapper.ts apps/api/src/memory/learning/learning.mapper.spec.ts
git commit -m "feat(memory): surface candidate/proposal decision timestamps and paginated response envelope"
```

---

### Task 11: `LearningCandidateDecisionService`

**Files:**

- Create: `apps/api/src/memory/learning/learning-candidate-decision.service.ts`
- Create: `apps/api/src/memory/learning/learning-candidate-decision.service.spec.ts`

**Interfaces:**

- Consumes: `LearningCandidateRepository.rejectById/archiveById/bulkReject/bulkArchive` (Task 7), `BulkActionError` (Task 2), `EventLedgerService.emitBestEffort` (existing), `AUTONOMY_EVENT_NAMES.learningCandidateRejected/learningCandidateArchived` (Task 5), `toLearningCandidateListItem` (Task 10), `RejectLearningCandidateRequest`/`ArchiveLearningCandidateRequest`/`BulkRejectLearningCandidatesRequest`/`BulkArchiveLearningCandidatesRequest` (Task 4).
- Produces: `reject(id, dto): Promise<LearningCandidateListItem>`, `archive(id, dto): Promise<LearningCandidateListItem>`, `bulkReject(dto): Promise<LearningCandidateListItem[]>`, `bulkArchive(dto): Promise<LearningCandidateListItem[]>`. Throws `NotFoundException` when the candidate doesn't exist, `ConflictException` when it isn't `pending` (single actions) or when a `BulkActionError` bubbles from the repository (bulk actions). Consumed by Task 15 (`LearningController`).

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/memory/learning/learning-candidate-decision.service.spec.ts
import { ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BulkActionError } from "../../common/errors/bulk-action.error";
import { LearningCandidateDecisionService } from "./learning-candidate-decision.service";
import type { LearningCandidateRepository } from "../database/repositories/learning-candidate.repository";
import type { EventLedgerService } from "../../observability/event-ledger.service";

function createCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidate-1",
    scope_type: "global",
    scopeId: null,
    candidate_type: "runtime_learning",
    title: "t",
    summary: "s",
    fingerprint: "fp",
    signals_json: {},
    score: 0.5,
    confidence: 0.5,
    recurrence_count: 1,
    status: "rejected",
    promoted_at: null,
    human_approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    archived_by: null,
    archived_at: null,
    archive_reason: null,
    first_seen_at: new Date("2026-06-01T00:00:00.000Z"),
    last_seen_at: new Date("2026-06-01T00:00:00.000Z"),
    created_at: new Date("2026-06-01T00:00:00.000Z"),
    updated_at: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("LearningCandidateDecisionService", () => {
  const rejectById = vi.fn();
  const archiveById = vi.fn();
  const bulkReject = vi.fn();
  const bulkArchive = vi.fn();
  const findById = vi.fn();
  const emitBestEffort = vi.fn().mockResolvedValue(undefined);

  let service: LearningCandidateDecisionService;

  beforeEach(() => {
    vi.clearAllMocks();
    emitBestEffort.mockResolvedValue(undefined);
    service = new LearningCandidateDecisionService(
      {
        rejectById,
        archiveById,
        bulkReject,
        bulkArchive,
        findById,
      } as unknown as LearningCandidateRepository,
      { emitBestEffort } as unknown as EventLedgerService,
    );
  });

  it("rejects a pending candidate", async () => {
    const rejected = createCandidate({
      rejected_by: "reviewer-1",
      rejection_reason: "x",
    });
    rejectById.mockResolvedValue(rejected);

    const result = await service.reject("candidate-1", {
      reason: "x",
      rejected_by: "reviewer-1",
    });

    expect(rejectById).toHaveBeenCalledWith("candidate-1", {
      rejectedBy: "reviewer-1",
      reason: "x",
    });
    expect(result.status).toBe("rejected");
    expect(emitBestEffort).toHaveBeenCalled();
  });

  it("throws NotFoundException rejecting a missing candidate", async () => {
    rejectById.mockResolvedValue(null);
    findById.mockResolvedValue(null);

    await expect(service.reject("missing", { reason: "x" })).rejects.toThrow(
      NotFoundException,
    );
  });

  it("throws ConflictException rejecting a non-pending candidate", async () => {
    rejectById.mockResolvedValue(null);
    findById.mockResolvedValue(createCandidate({ status: "promoted" }));

    await expect(
      service.reject("candidate-1", { reason: "x" }),
    ).rejects.toThrow(ConflictException);
  });

  it("archives a pending candidate", async () => {
    const archived = createCandidate({
      status: "archived",
      archived_by: "reviewer-2",
    });
    archiveById.mockResolvedValue(archived);

    const result = await service.archive("candidate-1", {
      archived_by: "reviewer-2",
    });

    expect(archiveById).toHaveBeenCalledWith("candidate-1", {
      archivedBy: "reviewer-2",
      reason: null,
    });
    expect(result.status).toBe("archived");
  });

  it("bulk rejects candidates", async () => {
    const rejected = [createCandidate()];
    bulkReject.mockResolvedValue(rejected);

    const result = await service.bulkReject({
      candidate_ids: ["candidate-1"],
      reason: "batch reason",
    });

    expect(bulkReject).toHaveBeenCalledWith(["candidate-1"], {
      rejectedBy: null,
      reason: "batch reason",
    });
    expect(result).toHaveLength(1);
  });

  it("translates BulkActionError into ConflictException on bulk reject", async () => {
    bulkReject.mockRejectedValue(
      new BulkActionError("invalid_status", ["candidate-1"]),
    );

    await expect(
      service.bulkReject({ candidate_ids: ["candidate-1"], reason: "x" }),
    ).rejects.toThrow(ConflictException);
  });

  it("bulk archives candidates", async () => {
    const archived = [createCandidate({ status: "archived" })];
    bulkArchive.mockResolvedValue(archived);

    const result = await service.bulkArchive({
      candidate_ids: ["candidate-1"],
    });

    expect(bulkArchive).toHaveBeenCalledWith(["candidate-1"], {
      archivedBy: null,
      reason: null,
    });
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/api/src/memory/learning/learning-candidate-decision.service.spec.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement the service**

```typescript
// apps/api/src/memory/learning/learning-candidate-decision.service.ts
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ArchiveLearningCandidateRequest,
  BulkArchiveLearningCandidatesRequest,
  BulkRejectLearningCandidatesRequest,
  RejectLearningCandidateRequest,
} from "@nexus/core";
import { LearningCandidateRepository } from "../database/repositories/learning-candidate.repository";
import { BulkActionError } from "../../common/errors/bulk-action.error";
import { AUTONOMY_EVENT_NAMES } from "../../observability/autonomy-observability.types";
import { EventLedgerService } from "../../observability/event-ledger.service";
import { toLearningCandidateListItem } from "./learning.mapper";
import type { LearningCandidateListItem } from "./learning.types";

@Injectable()
export class LearningCandidateDecisionService {
  constructor(
    private readonly candidates: LearningCandidateRepository,
    private readonly eventLedger: EventLedgerService,
  ) {}

  async reject(
    id: string,
    dto: RejectLearningCandidateRequest,
  ): Promise<LearningCandidateListItem> {
    const rejectedBy = dto.rejected_by ?? null;
    const updated = await this.candidates.rejectById(id, {
      rejectedBy,
      reason: dto.reason,
    });

    if (!updated) {
      return this.throwDecisionMiss(id);
    }

    await this.eventLedger.emitBestEffort({
      domain: "memory",
      eventName: AUTONOMY_EVENT_NAMES.learningCandidateRejected,
      outcome: "success",
      payload: { candidateId: updated.id, rejected_by: updated.rejected_by },
    });

    return toLearningCandidateListItem(updated);
  }

  async archive(
    id: string,
    dto: ArchiveLearningCandidateRequest,
  ): Promise<LearningCandidateListItem> {
    const archivedBy = dto.archived_by ?? null;
    const updated = await this.candidates.archiveById(id, {
      archivedBy,
      reason: dto.reason ?? null,
    });

    if (!updated) {
      return this.throwDecisionMiss(id);
    }

    await this.eventLedger.emitBestEffort({
      domain: "memory",
      eventName: AUTONOMY_EVENT_NAMES.learningCandidateArchived,
      outcome: "success",
      payload: { candidateId: updated.id, archived_by: updated.archived_by },
    });

    return toLearningCandidateListItem(updated);
  }

  async bulkReject(
    dto: BulkRejectLearningCandidatesRequest,
  ): Promise<LearningCandidateListItem[]> {
    const rejectedBy = dto.rejected_by ?? null;
    const updated = await this.runBulk(() =>
      this.candidates.bulkReject(dto.candidate_ids, {
        rejectedBy,
        reason: dto.reason,
      }),
    );

    await this.eventLedger.emitBestEffort({
      domain: "memory",
      eventName: AUTONOMY_EVENT_NAMES.learningCandidateRejected,
      outcome: "success",
      payload: {
        candidateIds: dto.candidate_ids,
        rejected_by: rejectedBy,
        bulk: true,
      },
    });

    return updated.map((candidate) => toLearningCandidateListItem(candidate));
  }

  async bulkArchive(
    dto: BulkArchiveLearningCandidatesRequest,
  ): Promise<LearningCandidateListItem[]> {
    const archivedBy = dto.archived_by ?? null;
    const updated = await this.runBulk(() =>
      this.candidates.bulkArchive(dto.candidate_ids, {
        archivedBy,
        reason: dto.reason ?? null,
      }),
    );

    await this.eventLedger.emitBestEffort({
      domain: "memory",
      eventName: AUTONOMY_EVENT_NAMES.learningCandidateArchived,
      outcome: "success",
      payload: {
        candidateIds: dto.candidate_ids,
        archived_by: archivedBy,
        bulk: true,
      },
    });

    return updated.map((candidate) => toLearningCandidateListItem(candidate));
  }

  private async runBulk<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof BulkActionError) {
        throw new ConflictException(
          `Bulk action failed (${error.code}) for candidate(s): ${error.ids.join(", ")}`,
        );
      }
      throw error;
    }
  }

  private async throwDecisionMiss(id: string): Promise<never> {
    const candidate = await this.candidates.findById(id);
    if (!candidate) {
      throw new NotFoundException(`Learning candidate ${id} not found`);
    }

    throw new ConflictException(`Learning candidate ${id} is not pending`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/api/src/memory/learning/learning-candidate-decision.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/memory/learning/learning-candidate-decision.service.ts apps/api/src/memory/learning/learning-candidate-decision.service.spec.ts
git commit -m "feat(memory): add LearningCandidateDecisionService for reject/archive actions"
```

---

### Task 12: `LearningPromotionService.bulkPromote`

**Files:**

- Modify: `apps/api/src/memory/learning/learning-promotion.service.ts`
- Modify: `apps/api/src/memory/learning/learning-promotion.service.spec.ts` (or create it if it doesn't exist yet — check first)

**Interfaces:**

- Consumes: `this.promoteCandidate` (existing, unmodified).
- Produces: `bulkPromote(candidateIds: string[], options?: LearningPromotionOptions): Promise<Array<{ candidateId: string; result?: LearningPromotionResult; error?: string }>>`. Iterates sequentially and reports per-item success/failure — **not** a single DB transaction, because `promoteCandidate` already has its own claim-based concurrency guard and creates external memory-segment side effects that can't be safely rolled back as one SQL transaction. Consumed by Task 15 (`LearningController`).

- [ ] **Step 1: Write the failing test**

Check whether `apps/api/src/memory/learning/learning-promotion.service.spec.ts` exists.

**If it exists:** add the `describe('bulkPromote', ...)` block below into it, reusing whatever `service` instance its existing top-level `beforeEach` already constructs (that instance already has real or mocked constructor dependencies wired up — `vi.spyOn` on the instance method works regardless of what the other dependencies are).

**If it does not exist:** create it with exactly this content — `promoteCandidate` is spied on directly, so all 10 positional constructor dependencies can be empty objects cast `as never` since `bulkPromote` never touches them itself:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LearningPromotionService } from "./learning-promotion.service";

describe("LearningPromotionService", () => {
  let service: LearningPromotionService;

  beforeEach(() => {
    service = new LearningPromotionService(
      {} as never, // candidates
      {} as never, // memorySegments
      {} as never, // memoryManager
      {} as never, // policy
      {} as never, // eventLedger
      {} as never, // settings
      {} as never, // memoryMetrics
      {} as never, // metrics
      {} as never, // governancePolicy
      {} as never, // skillProposals
    );
  });

  describe("bulkPromote", () => {
    it("promotes each candidate independently and reports per-item results", async () => {
      const promoteCandidate = vi
        .spyOn(service, "promoteCandidate")
        .mockResolvedValueOnce({
          candidate_id: "c1",
          memory_segment_id: "m1",
          status: "promoted",
        } as never)
        .mockRejectedValueOnce(new Error("claim conflict"));

      const results = await service.bulkPromote(["c1", "c2"], {
        requestedBy: "reviewer-1",
      });

      expect(promoteCandidate).toHaveBeenNthCalledWith(1, "c1", {
        requestedBy: "reviewer-1",
      });
      expect(promoteCandidate).toHaveBeenNthCalledWith(2, "c2", {
        requestedBy: "reviewer-1",
      });
      expect(results[0]).toMatchObject({
        candidateId: "c1",
        result: { candidate_id: "c1" },
      });
      expect(results[1]).toMatchObject({
        candidateId: "c2",
        error: "claim conflict",
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/memory/learning/learning-promotion.service.spec.ts -t bulkPromote`
Expected: FAIL — `bulkPromote` does not exist

- [ ] **Step 3: Implement `bulkPromote`**

Add to `apps/api/src/memory/learning/learning-promotion.service.ts` (public method, alongside `promoteCandidate`):

```typescript
  /**
   * Promote each candidate independently via the existing claim-based
   * {@link promoteCandidate} flow, sequentially, reporting a per-item result.
   * Not a single DB transaction: promotion creates external memory-segment
   * side effects and already has its own per-candidate concurrency guard
   * (`claimPendingPromotion`), so partial success across the batch is the
   * correct semantics, not all-or-nothing.
   */
  async bulkPromote(
    candidateIds: string[],
    options: LearningPromotionOptions = {},
  ): Promise<
    Array<{ candidateId: string; result?: LearningPromotionResult; error?: string }>
  > {
    const results: Array<{
      candidateId: string;
      result?: LearningPromotionResult;
      error?: string;
    }> = [];

    for (const candidateId of candidateIds) {
      try {
        const result = await this.promoteCandidate(candidateId, options);
        results.push({ candidateId, result });
      } catch (error) {
        results.push({
          candidateId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/api/src/memory/learning/learning-promotion.service.spec.ts -t bulkPromote`
Expected: PASS

- [ ] **Step 5: Run the full promotion service test file to verify nothing broke**

Run: `npx vitest run apps/api/src/memory/learning/learning-promotion.service.spec.ts`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/memory/learning/learning-promotion.service.ts apps/api/src/memory/learning/learning-promotion.service.spec.ts
git commit -m "feat(memory): add LearningPromotionService.bulkPromote"
```

---

### Task 13: `SkillProposalService` — new list shape + bulk approve/reject

**Files:**

- Modify: `apps/api/src/memory/learning/skill-proposal.service.ts`
- Modify: `apps/api/src/memory/learning/skill-proposal.service.spec.ts`

**Interfaces:**

- Consumes: `SkillImprovementProposalRepository.list/bulkApprove/bulkReject` (Tasks 8, 9), `BulkActionError` (Task 2), `buildPaginatedResponse` from `apps/api/src/common/utils/query-helpers.ts`, `BulkApproveSkillImprovementProposalsRequest`/`BulkRejectSkillImprovementProposalsRequest` (Task 4).
- Produces: `list(query: ListSkillImprovementProposalsRequest): Promise<SkillProposalListResponse>` (new envelope shape), `bulkApprove(dto): Promise<SkillProposalListItem[]>`, `bulkReject(dto): Promise<SkillProposalListItem[]>`. Consumed by Task 16 (`SkillProposalsController`).

- [ ] **Step 1: Write the failing tests**

In `apps/api/src/memory/learning/skill-proposal.service.spec.ts`, find the existing `describe('list', ...)` block (or add one) and replace/add:

```typescript
describe("list", () => {
  it("passes the new query shape through to the repository and returns the paginated envelope", async () => {
    const proposal = createProposal({ id: "p1" });
    proposals.list.mockResolvedValue({ data: [proposal], total: 1 });

    const result = await service.list({
      status: ["pending"],
      search: "retry",
      page: 2,
      limit: 10,
      sortBy: "approved_at",
      sortDir: "asc",
    });

    expect(proposals.list).toHaveBeenCalledWith({
      statuses: ["pending"],
      search: "retry",
      createdFrom: undefined,
      createdTo: undefined,
      page: 2,
      limit: 10,
      sortBy: "approved_at",
      sortDir: "asc",
    });
    expect(result).toEqual({
      data: [expect.objectContaining({ id: "p1" })],
      meta: { pagination: { total: 1, page: 2, limit: 10, totalPages: 1 } },
    });
  });
});

describe("bulkApprove", () => {
  it("bulk approves and maps results to list items", async () => {
    const proposal = createProposal({ id: "p1", status: "approved" });
    proposals.bulkApprove.mockResolvedValue([proposal]);

    const result = await service.bulkApprove({
      proposal_ids: ["p1"],
      approved_by: "reviewer-1",
    });

    expect(proposals.bulkApprove).toHaveBeenCalledWith(["p1"], {
      approvedBy: "reviewer-1",
    });
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("approved");
  });

  it("translates BulkActionError into ConflictException", async () => {
    proposals.bulkApprove.mockRejectedValue(
      new BulkActionError("invalid_status", ["p1"]),
    );

    await expect(service.bulkApprove({ proposal_ids: ["p1"] })).rejects.toThrow(
      ConflictException,
    );
  });
});

describe("bulkReject", () => {
  it("bulk rejects and maps results to list items", async () => {
    const proposal = createProposal({ id: "p1", status: "rejected" });
    proposals.bulkReject.mockResolvedValue([proposal]);

    const result = await service.bulkReject({
      proposal_ids: ["p1"],
      reason: "duplicate batch",
    });

    expect(proposals.bulkReject).toHaveBeenCalledWith(["p1"], {
      rejectedBy: null,
      reason: "duplicate batch",
    });
    expect(result).toHaveLength(1);
  });
});
```

Add `import { ConflictException } from '@nestjs/common';` and `import { BulkActionError } from '../../common/errors/bulk-action.error';` to the spec file's imports if not already present, and ensure the mocked `proposals` repository object used to construct `service` includes `list: vi.fn()`, `bulkApprove: vi.fn()`, `bulkReject: vi.fn()` (read the existing `beforeEach` setup in this spec file first and extend it — do not replace the whole file).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/api/src/memory/learning/skill-proposal.service.spec.ts`
Expected: FAIL — `bulkApprove`/`bulkReject` don't exist, `list()` still returns the old `{items,total,limit,offset}` shape and calls the repository with the old params

- [ ] **Step 3: Implement**

In `apps/api/src/memory/learning/skill-proposal.service.ts`, add imports:

```typescript
import type {
  ApproveSkillImprovementProposalRequest,
  BulkApproveSkillImprovementProposalsRequest,
  BulkRejectSkillImprovementProposalsRequest,
  ConfirmSkillProposalScopeRequest,
  ListSkillImprovementProposalsRequest,
  RejectSkillImprovementProposalRequest,
} from "@nexus/core";
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { BulkActionError } from "../../common/errors/bulk-action.error";
import { buildPaginatedResponse } from "../../common/utils/query-helpers";
import type { SkillProposalListResponse } from "./learning.types";
```

Replace `list()`:

```typescript
  async list(
    query: ListSkillImprovementProposalsRequest,
  ): Promise<SkillProposalListResponse> {
    const { data, total } = await this.proposals.list({
      statuses: query.status,
      search: query.search,
      createdFrom: query.created_from,
      createdTo: query.created_to,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });

    return buildPaginatedResponse(
      data.map((proposal) => toSkillProposalListItem(proposal)),
      total,
      query.page,
      query.limit,
    );
  }
```

Add after `reject()`:

```typescript
  async bulkApprove(
    dto: BulkApproveSkillImprovementProposalsRequest,
  ): Promise<SkillProposalListItem[]> {
    const approvedBy = dto.approved_by ?? null;
    const updated = await this.runBulk(() =>
      this.proposals.bulkApprove(dto.proposal_ids, { approvedBy }),
    );

    return updated.map((proposal) => toSkillProposalListItem(proposal));
  }

  async bulkReject(
    dto: BulkRejectSkillImprovementProposalsRequest,
  ): Promise<SkillProposalListItem[]> {
    const rejectedBy = dto.rejected_by ?? null;
    const updated = await this.runBulk(() =>
      this.proposals.bulkReject(dto.proposal_ids, {
        rejectedBy,
        reason: dto.reason,
      }),
    );

    return updated.map((proposal) => toSkillProposalListItem(proposal));
  }

  private async runBulk<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof BulkActionError) {
        throw new ConflictException(
          `Bulk action failed (${error.code}) for proposal(s): ${error.ids.join(', ')}`,
        );
      }
      throw error;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/api/src/memory/learning/skill-proposal.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/memory/learning/skill-proposal.service.ts apps/api/src/memory/learning/skill-proposal.service.spec.ts
git commit -m "feat(memory): rewrite SkillProposalService.list onto paginated envelope, add bulk approve/reject"
```

---

### Task 14: `LearningService.listCandidates` — new params + response shape

**Files:**

- Modify: `apps/api/src/memory/learning/learning.service.ts`
- Modify: `apps/api/src/memory/learning/learning.service.spec.ts` (check whether it exists first; create if not)

**Interfaces:**

- Consumes: `LearningCandidateRepository.list` (Task 6), `buildPaginatedResponse` (existing helper).
- Produces: `listCandidates(query: ListLearningCandidatesRequest): Promise<LearningCandidateListResponse>` (new envelope shape with `meta.suppressedCount`). Consumed by Task 15 (`LearningController`).

- [ ] **Step 1: Write the failing test**

Check for an existing `apps/api/src/memory/learning/learning.service.spec.ts`; if present, find its `listCandidates` test(s) and replace them, otherwise add a minimal new describe block constructing `LearningService` with mocked constructor dependencies (`candidates`, `proposals`, `eventLedger`, `workflowEngine`, `persistence` — all `vi.fn()`-based mocks; only `candidates.list`/`candidates.countMerged` are exercised here):

```typescript
describe("listCandidates", () => {
  it("passes the full filter set through to the repository and returns the paginated envelope", async () => {
    const candidate = createCandidate({ id: "c1" });
    candidatesRepo.list.mockResolvedValue({ data: [candidate], total: 1 });
    candidatesRepo.countMerged.mockResolvedValue(3);

    const result = await service.listCandidates({
      status: ["pending", "promoted"],
      candidate_type: ["agent_capture"],
      scope_type: "global",
      search: "flaky",
      min_score: 0.4,
      page: 1,
      limit: 25,
      sortBy: "score",
      sortDir: "desc",
    });

    expect(candidatesRepo.list).toHaveBeenCalledWith({
      statuses: ["pending", "promoted"],
      candidateTypes: ["agent_capture"],
      scopeType: "global",
      scopeId: undefined,
      excludeMerged: true,
      search: "flaky",
      minScore: 0.4,
      createdFrom: undefined,
      createdTo: undefined,
      page: 1,
      limit: 25,
      sortBy: "score",
      sortDir: "desc",
    });
    expect(result).toEqual({
      data: [expect.objectContaining({ id: "c1" })],
      meta: {
        pagination: { total: 1, page: 1, limit: 25, totalPages: 1 },
        suppressedCount: 3,
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/memory/learning/learning.service.spec.ts -t listCandidates`
Expected: FAIL — `listCandidates` still calls the repository with `{statuses, scopeType, scopeId, excludeMerged, limit, offset}` and returns `{items,total,limit,offset,suppressed_count}`

- [ ] **Step 3: Implement**

In `apps/api/src/memory/learning/learning.service.ts`, add the import:

```typescript
import { buildPaginatedMeta } from "../../common/utils/query-helpers";
```

Replace `listCandidates()`:

```typescript
  async listCandidates(
    query: ListLearningCandidatesRequest,
  ): Promise<LearningCandidateListResponse> {
    const [{ data, total }, suppressedCount] = await Promise.all([
      this.candidates.list({
        statuses: query.status,
        candidateTypes: query.candidate_type,
        scopeType: query.scope_type,
        scopeId: query.scope_id,
        excludeMerged: true,
        search: query.search,
        minScore: query.min_score,
        createdFrom: query.created_from,
        createdTo: query.created_to,
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      }),
      this.candidates.countMerged(),
    ]);

    return {
      data: data.map((candidate) => toLearningCandidateListItem(candidate)),
      meta: {
        ...buildPaginatedMeta(total, query.page, query.limit),
        suppressedCount,
      },
    };
  }
```

Add `import type { LearningCandidateListResponse } from './learning.types';` to the top import block.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/api/src/memory/learning/learning.service.spec.ts -t listCandidates`
Expected: PASS

- [ ] **Step 5: Run the full service test file to verify nothing broke**

Run: `npx vitest run apps/api/src/memory/learning/learning.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/memory/learning/learning.service.ts apps/api/src/memory/learning/learning.service.spec.ts
git commit -m "feat(memory): rewrite LearningService.listCandidates onto paginated envelope"
```

---

### Task 15: `LearningController` — new endpoints + module registration

**Files:**

- Modify: `apps/api/src/memory/learning/learning.controller.ts`
- Modify: `apps/api/src/memory/learning/learning.controller.spec.ts` (check whether it exists first; create if not, following the `SkillProposalsController` spec pattern from Task-context)
- Modify: `apps/api/src/memory/learning/learning.module.ts`

**Interfaces:**

- Consumes: `LearningCandidateDecisionService.reject/archive/bulkReject/bulkArchive` (Task 11), `LearningPromotionService.bulkPromote` (Task 12), the reject/archive/bulk schemas (Task 4).
- Produces: `POST /memory/learning/candidates/:id/reject`, `POST /memory/learning/candidates/:id/archive`, `POST /memory/learning/candidates/bulk-reject`, `POST /memory/learning/candidates/bulk-archive`, `POST /memory/learning/candidates/bulk-promote`.

- [ ] **Step 1: Write the failing tests**

Create/extend `apps/api/src/memory/learning/learning.controller.spec.ts` following the exact direct-instantiation pattern used by `skill-proposals.controller.spec.ts`:

```typescript
import type {
  ArchiveLearningCandidateRequest,
  BulkArchiveLearningCandidatesRequest,
  BulkPromoteLearningCandidatesRequest,
  BulkRejectLearningCandidatesRequest,
  RejectLearningCandidateRequest,
} from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningService } from "./learning.service";
import type { LearningPromotionService } from "./learning-promotion.service";
import type { LearningCandidateDecisionService } from "./learning-candidate-decision.service";
import { LearningController } from "./learning.controller";

describe("LearningController", () => {
  const listCandidates = vi.fn();
  const promote = vi.fn();
  const bulkPromote = vi.fn();
  const reject = vi.fn();
  const archive = vi.fn();
  const bulkReject = vi.fn();
  const bulkArchive = vi.fn();

  let controller: LearningController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new LearningController(
      { listCandidates } as unknown as LearningService,
      {
        promoteCandidate: promote,
        bulkPromote,
      } as unknown as LearningPromotionService,
      {
        reject,
        archive,
        bulkReject,
        bulkArchive,
      } as unknown as LearningCandidateDecisionService,
    );
  });

  it("rejects a candidate", async () => {
    const id = "6f3e2e48-b8a9-4e30-890a-995acbaac768";
    const body: RejectLearningCandidateRequest = { reason: "Not useful" };
    const candidate = { id, status: "rejected" };
    reject.mockResolvedValue(candidate);

    const response = await controller.reject(id, body);

    expect(reject).toHaveBeenCalledWith(id, body);
    expect(response).toEqual({ success: true, data: candidate });
  });

  it("archives a candidate", async () => {
    const id = "6f3e2e48-b8a9-4e30-890a-995acbaac768";
    const body: ArchiveLearningCandidateRequest = {};
    const candidate = { id, status: "archived" };
    archive.mockResolvedValue(candidate);

    const response = await controller.archive(id, body);

    expect(archive).toHaveBeenCalledWith(id, body);
    expect(response).toEqual({ success: true, data: candidate });
  });

  it("bulk rejects candidates", async () => {
    const body: BulkRejectLearningCandidatesRequest = {
      candidate_ids: ["c1"],
      reason: "stale batch",
    };
    bulkReject.mockResolvedValue([{ id: "c1", status: "rejected" }]);

    const response = await controller.bulkReject(body);

    expect(bulkReject).toHaveBeenCalledWith(body);
    expect(response.success).toBe(true);
    expect(response.data).toHaveLength(1);
  });

  it("bulk archives candidates", async () => {
    const body: BulkArchiveLearningCandidatesRequest = {
      candidate_ids: ["c1"],
    };
    bulkArchive.mockResolvedValue([{ id: "c1", status: "archived" }]);

    const response = await controller.bulkArchive(body);

    expect(bulkArchive).toHaveBeenCalledWith(body);
    expect(response.data).toHaveLength(1);
  });

  it("bulk promotes candidates", async () => {
    const body: BulkPromoteLearningCandidatesRequest = {
      candidate_ids: ["c1"],
    };
    bulkPromote.mockResolvedValue([
      { candidateId: "c1", result: { status: "promoted" } },
    ]);

    const response = await controller.bulkPromote(body);

    expect(bulkPromote).toHaveBeenCalledWith(["c1"], {
      requestedBy: undefined,
    });
    expect(response.data).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/api/src/memory/learning/learning.controller.spec.ts`
Expected: FAIL — `reject`/`archive`/`bulkReject`/`bulkArchive`/`bulkPromote` don't exist on the controller, and the constructor doesn't accept a `LearningCandidateDecisionService`

- [ ] **Step 3: Implement**

In `apps/api/src/memory/learning/learning.controller.ts`:

```typescript
import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  archiveLearningCandidateSchema,
  bulkArchiveLearningCandidatesSchema,
  bulkPromoteLearningCandidatesSchema,
  bulkRejectLearningCandidatesSchema,
  listLearningCandidatesSchema,
  promoteLearningCandidateSchema,
  rejectLearningCandidateSchema,
} from "@nexus/core";
import type {
  ArchiveLearningCandidateRequest,
  BulkArchiveLearningCandidatesRequest,
  BulkPromoteLearningCandidatesRequest,
  BulkRejectLearningCandidatesRequest,
  ListLearningCandidatesRequest,
  PromoteLearningCandidateRequest,
  RejectLearningCandidateRequest,
} from "@nexus/core";
import { z } from "zod";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/authorization/permissions.guard";
import { RequirePermission } from "../../auth/authorization/require-permission.decorator";
import { ZodBody } from "../../common/decorators/zod-body.decorator";
import { ZodParam } from "../../common/decorators/zod-param.decorator";
import { ZodQuery } from "../../common/decorators/zod-query.decorator";
import { LearningCandidateDecisionService } from "./learning-candidate-decision.service";
import { LearningPromotionService } from "./learning-promotion.service";
import { LearningService } from "./learning.service";

const candidateIdSchema = z.uuid();

type ListLearningCandidatesDto = ListLearningCandidatesRequest;
type PromoteLearningCandidateDto = PromoteLearningCandidateRequest;
type RejectLearningCandidateDto = RejectLearningCandidateRequest;
type ArchiveLearningCandidateDto = ArchiveLearningCandidateRequest;
type BulkRejectLearningCandidatesDto = BulkRejectLearningCandidatesRequest;
type BulkArchiveLearningCandidatesDto = BulkArchiveLearningCandidatesRequest;
type BulkPromoteLearningCandidatesDto = BulkPromoteLearningCandidatesRequest;
type LearningPromotionSparseResponse = Pick<
  Awaited<ReturnType<LearningPromotionService["promoteCandidate"]>>,
  "candidate_id" | "memory_segment_id" | "status" | "policy_decision"
>;

@ApiTags("memory-learning")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("memory/learning")
export class LearningController {
  constructor(
    private readonly learningService: LearningService,
    private readonly learningPromotionService: LearningPromotionService,
    private readonly candidateDecisionService: LearningCandidateDecisionService,
  ) {}

  // ...existing getStatus/runManualSweep/listCandidates/promote methods unchanged...

  @Post("candidates/:id/reject")
  @RequirePermission("memory:manage")
  @ApiOperation({ summary: "Reject a learning candidate" })
  async reject(
    @ZodParam("id", candidateIdSchema) id: string,
    @ZodBody(rejectLearningCandidateSchema) body: RejectLearningCandidateDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<LearningCandidateDecisionService["reject"]>>;
  }> {
    const data = await this.candidateDecisionService.reject(id, body);
    return { success: true, data };
  }

  @Post("candidates/:id/archive")
  @RequirePermission("memory:manage")
  @ApiOperation({ summary: "Archive a learning candidate" })
  async archive(
    @ZodParam("id", candidateIdSchema) id: string,
    @ZodBody(archiveLearningCandidateSchema) body: ArchiveLearningCandidateDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<LearningCandidateDecisionService["archive"]>>;
  }> {
    const data = await this.candidateDecisionService.archive(id, body);
    return { success: true, data };
  }

  @Post("candidates/bulk-reject")
  @RequirePermission("memory:manage")
  @ApiOperation({ summary: "Bulk reject learning candidates" })
  async bulkReject(
    @ZodBody(bulkRejectLearningCandidatesSchema)
    body: BulkRejectLearningCandidatesDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<LearningCandidateDecisionService["bulkReject"]>>;
  }> {
    const data = await this.candidateDecisionService.bulkReject(body);
    return { success: true, data };
  }

  @Post("candidates/bulk-archive")
  @RequirePermission("memory:manage")
  @ApiOperation({ summary: "Bulk archive learning candidates" })
  async bulkArchive(
    @ZodBody(bulkArchiveLearningCandidatesSchema)
    body: BulkArchiveLearningCandidatesDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<LearningCandidateDecisionService["bulkArchive"]>>;
  }> {
    const data = await this.candidateDecisionService.bulkArchive(body);
    return { success: true, data };
  }

  @Post("candidates/bulk-promote")
  @RequirePermission("memory:manage")
  @ApiOperation({ summary: "Bulk promote learning candidates" })
  async bulkPromote(
    @ZodBody(bulkPromoteLearningCandidatesSchema)
    body: BulkPromoteLearningCandidatesDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<LearningPromotionService["bulkPromote"]>>;
  }> {
    const data = await this.learningPromotionService.bulkPromote(
      body.candidate_ids,
      { requestedBy: body.requested_by },
    );
    return { success: true, data };
  }
}
```

Keep the existing `getStatus`, `runManualSweep`, `listCandidates` (route `Get('candidates')`), and `promote` (route `Post('promote')`) methods exactly as they are today — only the constructor and the new methods above are added. Note the new candidate routes live under `candidates/:id/...` and `candidates/bulk-...`; the existing `@Get('candidates')` list route and `@Post('promote')` route are unchanged and unaffected by this nesting since NestJS matches literal segments (`bulk-reject` etc.) before the `:id` param route only if declared in the right order — **declare the two `candidates/bulk-*` routes above `candidates/:id/...` is not required here since the id routes use `candidates/:id/reject`/`candidates/:id/archive` with a trailing literal segment, which cannot collide with `candidates/bulk-reject`'s single-segment-after-`candidates/` shape — but double check by running the controller test suite and, if you see a routing collision, move the `bulk-*` `@Post` decorators above the `:id` ones in the class body.**

- [ ] **Step 4: Register `LearningCandidateDecisionService` in the module**

In `apps/api/src/memory/learning/learning.module.ts`, add the import and provider:

```typescript
import { LearningCandidateDecisionService } from "./learning-candidate-decision.service";
```

```typescript
  providers: [
    LearningService,
    SkillProposalService,
    RecordLearningService,
    LearningCandidateProposalListener,
    SkillProposalApprovedListener,
    SkillProposalCompletionListener,
    LearningPromotionPolicyService,
    LearningPromotionService,
    PromotionGovernancePolicyService,
    LearningCandidateDecisionService,
  ],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/api/src/memory/learning/learning.controller.spec.ts`
Expected: PASS

- [ ] **Step 6: Run the full apps/api test suite for the memory/learning directory**

Run: `npx vitest run apps/api/src/memory/learning`
Expected: PASS (all files)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/memory/learning/learning.controller.ts apps/api/src/memory/learning/learning.controller.spec.ts apps/api/src/memory/learning/learning.module.ts
git commit -m "feat(memory): add candidate reject/archive/bulk endpoints to LearningController"
```

---

### Task 16: `SkillProposalsController` — new bulk endpoints

**Files:**

- Modify: `apps/api/src/memory/learning/skill-proposals.controller.ts`
- Modify: `apps/api/src/memory/learning/skill-proposals.controller.spec.ts`

**Interfaces:**

- Consumes: `SkillProposalService.bulkApprove/bulkReject` (Task 13), the bulk schemas (Task 4).
- Produces: `POST /skills/proposals/bulk-approve`, `POST /skills/proposals/bulk-reject`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/src/memory/learning/skill-proposals.controller.spec.ts` (extend the existing `list`/`getPreview`/`approve`/`reject` mock set with `bulkApprove`/`bulkReject`):

```typescript
const bulkApprove = vi.fn();
const bulkReject = vi.fn();
```

(add to the top `const` block, and to the object passed into `new SkillProposalsController({...})` in `beforeEach`)

```typescript
it("bulk approves proposals", async () => {
  const body: BulkApproveSkillImprovementProposalsRequest = {
    proposal_ids: ["p1"],
    approved_by: "reviewer-1",
  };
  bulkApprove.mockResolvedValue([{ id: "p1", status: "approved" }]);

  const response = await controller.bulkApprove(body);

  expect(bulkApprove).toHaveBeenCalledWith(body);
  expect(response).toEqual({
    success: true,
    data: [{ id: "p1", status: "approved" }],
  });
});

it("bulk rejects proposals", async () => {
  const body: BulkRejectSkillImprovementProposalsRequest = {
    proposal_ids: ["p1"],
    reason: "duplicate batch",
  };
  bulkReject.mockResolvedValue([{ id: "p1", status: "rejected" }]);

  const response = await controller.bulkReject(body);

  expect(bulkReject).toHaveBeenCalledWith(body);
  expect(response).toEqual({
    success: true,
    data: [{ id: "p1", status: "rejected" }],
  });
});
```

Add `BulkApproveSkillImprovementProposalsRequest`/`BulkRejectSkillImprovementProposalsRequest` to the spec file's top `import type { ... } from '@nexus/core'` block.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/api/src/memory/learning/skill-proposals.controller.spec.ts`
Expected: FAIL — `bulkApprove`/`bulkReject` don't exist on the controller

- [ ] **Step 3: Implement**

In `apps/api/src/memory/learning/skill-proposals.controller.ts`, add to the imports:

```typescript
import {
  approveSkillImprovementProposalSchema,
  bulkApproveSkillImprovementProposalsSchema,
  bulkRejectSkillImprovementProposalsSchema,
  confirmSkillProposalScopeSchema,
  listSkillImprovementProposalsSchema,
  rejectSkillImprovementProposalSchema,
} from "@nexus/core";
import type {
  ApproveSkillImprovementProposalRequest,
  BulkApproveSkillImprovementProposalsRequest,
  BulkRejectSkillImprovementProposalsRequest,
  ConfirmSkillProposalScopeRequest,
  ListSkillImprovementProposalsRequest,
  RejectSkillImprovementProposalRequest,
} from "@nexus/core";
```

Add the DTO type aliases and the two new endpoints (after `reject`, before `confirmScope`):

```typescript
type BulkApproveSkillImprovementProposalsDto =
  BulkApproveSkillImprovementProposalsRequest;
type BulkRejectSkillImprovementProposalsDto =
  BulkRejectSkillImprovementProposalsRequest;
```

```typescript
  @Post('bulk-approve')
  @RequirePermission('skills:create')
  @ApiOperation({ summary: 'Bulk approve skill improvement proposals' })
  async bulkApprove(
    @ZodBody(bulkApproveSkillImprovementProposalsSchema)
    body: BulkApproveSkillImprovementProposalsDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<SkillProposalService['bulkApprove']>>;
  }> {
    const data = await this.skillProposalService.bulkApprove(body);
    return { success: true, data };
  }

  @Post('bulk-reject')
  @RequirePermission('skills:create')
  @ApiOperation({ summary: 'Bulk reject skill improvement proposals' })
  async bulkReject(
    @ZodBody(bulkRejectSkillImprovementProposalsSchema)
    body: BulkRejectSkillImprovementProposalsDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<SkillProposalService['bulkReject']>>;
  }> {
    const data = await this.skillProposalService.bulkReject(body);
    return { success: true, data };
  }
```

Note: NestJS matches the literal `bulk-approve`/`bulk-reject` segments fine alongside the existing `:id/approve`/`:id/reject` routes since they differ in path depth (`bulk-approve` has no second segment, `:id/approve` does) — no route ordering changes needed here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/api/src/memory/learning/skill-proposals.controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/memory/learning/skill-proposals.controller.ts apps/api/src/memory/learning/skill-proposals.controller.spec.ts
git commit -m "feat(memory): add bulk approve/reject endpoints to SkillProposalsController"
```

---

### Task 17: Full backend verification + docs update

**Files:**

- Modify: a `docs/guide` file documenting the learning/retrospective candidate lifecycle (search for the EPIC-212 reference first — likely under `docs/guide/` per the repo's documentation map; add a short note rather than guessing a new file path)

**Interfaces:** none new — this task verifies everything built in Tasks 1–16 together and documents the outcome.

- [ ] **Step 1: Run the full apps/api test suite**

Run: `npm run test:api`
Expected: PASS (all tests, not just the ones touched by this plan)

- [ ] **Step 2: Run the API lint**

Run: `npm run lint:api`
Expected: no errors

- [ ] **Step 3: Build packages/core and apps/api**

Run:

```bash
npm run build --workspace=packages/core
npm run build:api
```

Expected: both succeed

- [ ] **Step 4: Find and update the EPIC-212 learning lifecycle doc**

Run: `grep -rl "EPIC-212" docs/guide` (or search `docs/guide` for "learning candidate" / "skill proposal" lifecycle content) to find the right file. Add a short subsection documenting:

- The new `reject`/`archive` candidate actions and their permanence semantics (rejection never auto-resurfaces, matching `docs/superpowers/specs/2026-07-01-learning-tab-redesign-design.md`'s Decisions log).
- The new bulk endpoints (`bulk-reject`, `bulk-archive`, `bulk-promote` for candidates; `bulk-approve`, `bulk-reject` for proposals) and that promotion's bulk variant is best-effort/per-item, not transactional, unlike the others.
- The new list query parameters (`page`, `search`, `sortBy`/`sortDir`, multi-value `status`, `candidate_type`, `min_score`, `created_from`/`created_to`) replacing the old `offset`-based shape.

- [ ] **Step 5: Commit the docs update**

```bash
git add docs/guide
git commit -m "docs: document learning candidate reject/archive and bulk action endpoints"
```

---

## Summary

This plan delivers the entire **Backend** section of the design spec (schema/repository/controller rewrite, new candidate lifecycle actions, transactional bulk endpoints) as 17 independently-testable, committed tasks. A follow-up plan (`2026-07-01-learning-tab-frontend-redesign.md`, written separately) covers the shared `DataTable` enhancements and the Learning tab's frontend migration onto this new API contract.
