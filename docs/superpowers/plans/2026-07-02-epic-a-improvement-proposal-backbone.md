# Epic A — Improvement Proposal Backbone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the unified `ImprovementModule` — one `improvement_proposals` table, one governance policy, one applier registry, one REST API, and a web queue — and migrate the existing skill-proposal path onto it as the first (`skill_create`) applier.

**Architecture:** A new NestJS module at `apps/api/src/improvement/` owns a generalized proposal entity that replaces `skill_improvement_proposals`. Producers call `ImprovementProposalService.submitProposal(draft)`; a pure `ImprovementGovernancePolicyService.resolveAction()` maps `(kind, evidenceClass, confidence)` to `auto_apply | propose | drop` under a configurable mode; approved/auto-applied proposals are executed by an `IImprovementApplier` resolved from the `IMPROVEMENT_APPLIERS` DI registry (modeled on the special-step handler registry). Epic A ships only the `SkillCreateApplier`, which ports today's approved→`create_skill`-workflow→completion behavior verbatim.

**Tech Stack:** NestJS 10, TypeORM (Postgres), Zod, Vitest + SWC decorator metadata, React + Vite + Tailwind (web), `@nexus/core` shared contracts.

## Global Constraints

- **TDD mandatory** — every task is red → green → refactor; write the failing test first and run it to confirm it fails before implementing.
- **Build with `nest build`**, never `tsc` — run `npm run build --workspace=packages/core` before building/testing the API (core is a build dependency).
- **No lint suppression** — never add `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- **No legacy re-exports** — the old `SkillImprovementProposal` entity/repository/service/controller/listeners are DELETED and every reference updated to the new module; no compatibility shims.
- **eslint `max-lines` 500** on services — keep pure decision logic in `*.helpers.ts` / `*.constants.ts` files (mirror `promotion-governance-policy.service.ts` splitting `decideGovernance` out as a pure function).
- **Scoped test runs during tasks:** `npx vitest run <path> --root apps/api` (the API `test:api` script is Vitest). Full suite is `npm run test:api`.
- **Core/Kanban boundary** — no kanban/work-item vocabulary in `apps/api` or `packages/core`. Epic A introduces none; keep it that way.
- **Migrations** follow the repo pattern: `apps/api/src/database/migrations/<UTC-timestamp>-<name>.ts` implementing `MigrationInterface` with idempotent `IF EXISTS/IF NOT EXISTS` SQL, plus registration in `registered-migrations.ts`.

---

## Task 1: Core shared types for the improvement pipeline

**Files:**

- Create: `packages/core/src/improvement/improvement-proposal.types.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./improvement/improvement-proposal.types";`)
- Test: `packages/core/src/improvement/improvement-proposal.types.spec.ts`

**Interfaces:**

- Produces (consumed by every later task and by Epics B–E):
  - `type ImprovementProposalKind = 'skill_create' | 'skill_assignment' | 'workflow_definition_change' | 'agent_profile_change' | 'code_change'`
  - `type ImprovementProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'failed' | 'rolled_back'`
  - `type GovernanceMode = 'tiered' | 'manual' | 'autonomous'`
  - `type GovernanceAction = 'auto_apply' | 'propose' | 'drop'`
  - `type ImprovementEvidenceClass = 'struggle_backed' | 'inference'`
  - `type AgentProfileAssignmentTarget = { type: 'agent_profile'; profileName: string }`
  - `type WorkflowStepAssignmentTarget = { type: 'workflow_step'; workflowName: string; stepId?: string }`
  - `type AssignmentTarget = AgentProfileAssignmentTarget | WorkflowStepAssignmentTarget`
  - `const IMPROVEMENT_PROPOSAL_KINDS: readonly ImprovementProposalKind[]`
  - `const IMPROVEMENT_PROPOSAL_STATUSES: readonly ImprovementProposalStatus[]`
  - `const GOVERNANCE_MODES: readonly GovernanceMode[]`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/improvement/improvement-proposal.types.spec.ts
import { describe, expect, it } from "vitest";
import {
  IMPROVEMENT_PROPOSAL_KINDS,
  IMPROVEMENT_PROPOSAL_STATUSES,
  GOVERNANCE_MODES,
} from "./improvement-proposal.types";

describe("improvement proposal type constants", () => {
  it("enumerates the five proposal kinds", () => {
    expect([...IMPROVEMENT_PROPOSAL_KINDS]).toEqual([
      "skill_create",
      "skill_assignment",
      "workflow_definition_change",
      "agent_profile_change",
      "code_change",
    ]);
  });

  it("enumerates the six statuses", () => {
    expect([...IMPROVEMENT_PROPOSAL_STATUSES]).toEqual([
      "pending",
      "approved",
      "rejected",
      "applied",
      "failed",
      "rolled_back",
    ]);
  });

  it("enumerates the three governance modes", () => {
    expect([...GOVERNANCE_MODES]).toEqual(["tiered", "manual", "autonomous"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/improvement/improvement-proposal.types.spec.ts --root packages/core`
Expected: FAIL — cannot resolve `./improvement-proposal.types`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/improvement/improvement-proposal.types.ts

export type ImprovementProposalKind =
  | "skill_create"
  | "skill_assignment"
  | "workflow_definition_change"
  | "agent_profile_change"
  | "code_change";

export type ImprovementProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "applied"
  | "failed"
  | "rolled_back";

export type GovernanceMode = "tiered" | "manual" | "autonomous";

export type GovernanceAction = "auto_apply" | "propose" | "drop";

export type ImprovementEvidenceClass = "struggle_backed" | "inference";

export interface AgentProfileAssignmentTarget {
  type: "agent_profile";
  profileName: string;
}

export interface WorkflowStepAssignmentTarget {
  type: "workflow_step";
  workflowName: string;
  stepId?: string;
}

export type AssignmentTarget =
  | AgentProfileAssignmentTarget
  | WorkflowStepAssignmentTarget;

export const IMPROVEMENT_PROPOSAL_KINDS: readonly ImprovementProposalKind[] = [
  "skill_create",
  "skill_assignment",
  "workflow_definition_change",
  "agent_profile_change",
  "code_change",
] as const;

export const IMPROVEMENT_PROPOSAL_STATUSES: readonly ImprovementProposalStatus[] =
  [
    "pending",
    "approved",
    "rejected",
    "applied",
    "failed",
    "rolled_back",
  ] as const;

export const GOVERNANCE_MODES: readonly GovernanceMode[] = [
  "tiered",
  "manual",
  "autonomous",
] as const;
```

Then add to `packages/core/src/index.ts` after the other block exports:

```ts
export * from "./improvement/improvement-proposal.types";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/improvement/improvement-proposal.types.spec.ts --root packages/core`
Expected: PASS (3 tests).

- [ ] **Step 5: Rebuild core so the API workspace resolves the new exports**

Run: `npm run build --workspace=packages/core`
Expected: build succeeds; `@nexus/core` now exports the new symbols.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/improvement/ packages/core/src/index.ts
git commit -m "feat(core): add improvement-proposal shared types" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: `ImprovementProposal` entity + migration + repository

**Files:**

- Create: `apps/api/src/improvement/database/entities/improvement-proposal.entity.ts`
- Create: `apps/api/src/improvement/database/repositories/improvement-proposal.repository.ts`
- Create: `apps/api/src/database/migrations/20260703000000-create-improvement-proposals.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts` (register the new migration)
- Test: `apps/api/src/improvement/database/repositories/improvement-proposal.repository.spec.ts`

**Interfaces:**

- Consumes: `ImprovementProposalKind`, `ImprovementProposalStatus`, `AssignmentTarget` from `@nexus/core`.
- Produces:
  - Entity `ImprovementProposal` (`@Entity('improvement_proposals')`): `id: string`, `kind: ImprovementProposalKind`, `status: ImprovementProposalStatus`, `payload: Record<string, unknown>`, `evidence: ImprovementEvidencePayload`, `confidence: number`, `rollback_data: Record<string, unknown> | null`, `occurrence_count: number`, `provenance: Record<string, unknown>`, `applied_at: Date | null`, `rolled_back_at: Date | null`, `created_at: Date`, `updated_at: Date`.
  - `interface ImprovementEvidencePayload { evidenceClass: ImprovementEvidenceClass; runIds?: string[]; failureClasses?: string[]; ledgerRefs?: string[] }` (exported from the entity file for reuse).
  - `class ImprovementProposalRepository` with: `create(input): Promise<ImprovementProposal>`, `findById(id): Promise<ImprovementProposal | null>`, `list(filter: { kinds?; statuses?; page?; limit? }): Promise<{ data; total }>`, `updateById(id, patch): Promise<ImprovementProposal | null>`, `updatePendingById(id, patch): Promise<ImprovementProposal | null>` (only updates a row still in `pending`), `bumpOccurrence(id): Promise<ImprovementProposal | null>`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/improvement/database/repositories/improvement-proposal.repository.spec.ts
import { describe, expect, it, vi } from "vitest";
import { ImprovementProposalRepository } from "./improvement-proposal.repository";

function makeRepoStub() {
  const rows: any[] = [];
  const typeorm = {
    create: (v: any) => ({ ...v }),
    save: vi.fn(async (v: any) => {
      const row = { id: v.id ?? `id-${rows.length + 1}`, ...v };
      rows.push(row);
      return row;
    }),
    findOne: vi.fn(
      async ({ where: { id } }: any) => rows.find((r) => r.id === id) ?? null,
    ),
  };
  return { typeorm, rows };
}

describe("ImprovementProposalRepository", () => {
  it("creates a pending proposal with occurrence_count defaulting to 1", async () => {
    const { typeorm } = makeRepoStub();
    const repo = new ImprovementProposalRepository(typeorm as any);
    const created = await repo.create({
      kind: "skill_create",
      status: "pending",
      payload: { target_skill_name: "x" },
      evidence: { evidenceClass: "inference" },
      confidence: 0.4,
      provenance: { source: "test" },
    });
    expect(created.kind).toBe("skill_create");
    expect(created.status).toBe("pending");
    expect(created.occurrence_count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/improvement/database/repositories/improvement-proposal.repository.spec.ts --root apps/api`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the entity**

```ts
// apps/api/src/improvement/database/entities/improvement-proposal.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type {
  ImprovementEvidenceClass,
  ImprovementProposalKind,
  ImprovementProposalStatus,
} from "@nexus/core";

export interface ImprovementEvidencePayload {
  evidenceClass: ImprovementEvidenceClass;
  runIds?: string[];
  failureClasses?: string[];
  ledgerRefs?: string[];
}

@Entity("improvement_proposals")
@Index("idx_improvement_proposals_kind_status", ["kind", "status"])
@Index("idx_improvement_proposals_status_created_at", ["status", "created_at"])
export class ImprovementProposal {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 48 })
  kind!: ImprovementProposalKind;

  @Column({ type: "varchar", length: 32, default: "pending" })
  status!: ImprovementProposalStatus;

  @Column({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: "jsonb" })
  evidence!: ImprovementEvidencePayload;

  @Column({ type: "double precision", default: 0 })
  confidence!: number;

  @Column({ type: "jsonb", nullable: true })
  rollback_data!: Record<string, unknown> | null;

  @Column({ type: "integer", default: 1 })
  occurrence_count!: number;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  provenance!: Record<string, unknown>;

  @Column({ type: "timestamptz", nullable: true })
  applied_at!: Date | null;

  @Column({ type: "timestamptz", nullable: true })
  rolled_back_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
```

- [ ] **Step 4: Write the repository**

Follow the injectable-repository pattern used by `SkillImprovementProposalRepository` (constructor-injected TypeORM `Repository<ImprovementProposal>` via `@InjectRepository`). Provide the methods in the Interfaces block. `create` sets `status:'pending'` and `occurrence_count:1` when not supplied; `updatePendingById` returns `null` if the row is not currently `pending` (guard against double-apply).

```ts
// apps/api/src/improvement/database/repositories/improvement-proposal.repository.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type {
  ImprovementProposalKind,
  ImprovementProposalStatus,
} from "@nexus/core";
import { ImprovementProposal } from "../entities/improvement-proposal.entity";

export interface ListImprovementProposalsFilter {
  kinds?: ImprovementProposalKind[];
  statuses?: ImprovementProposalStatus[];
  page?: number;
  limit?: number;
}

@Injectable()
export class ImprovementProposalRepository {
  constructor(
    @InjectRepository(ImprovementProposal)
    private readonly repo: Repository<ImprovementProposal>,
  ) {}

  async create(
    input: Partial<ImprovementProposal>,
  ): Promise<ImprovementProposal> {
    const entity = this.repo.create({
      status: "pending",
      occurrence_count: 1,
      provenance: {},
      rollback_data: null,
      applied_at: null,
      rolled_back_at: null,
      ...input,
    });
    return this.repo.save(entity);
  }

  async findById(id: string): Promise<ImprovementProposal | null> {
    return this.repo.findOne({ where: { id } });
  }

  async list(
    filter: ListImprovementProposalsFilter,
  ): Promise<{ data: ImprovementProposal[]; total: number }> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 50;
    const qb = this.repo
      .createQueryBuilder("p")
      .orderBy("p.created_at", "DESC")
      .skip((page - 1) * limit)
      .take(limit);
    if (filter.kinds?.length) {
      qb.andWhere("p.kind IN (:...kinds)", { kinds: filter.kinds });
    }
    if (filter.statuses?.length) {
      qb.andWhere("p.status IN (:...statuses)", { statuses: filter.statuses });
    }
    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async updateById(
    id: string,
    patch: Partial<ImprovementProposal>,
  ): Promise<ImprovementProposal | null> {
    await this.repo.update({ id }, patch);
    return this.findById(id);
  }

  async updatePendingById(
    id: string,
    patch: Partial<ImprovementProposal>,
  ): Promise<ImprovementProposal | null> {
    const result = await this.repo.update({ id, status: "pending" }, patch);
    if (!result.affected) {
      return null;
    }
    return this.findById(id);
  }

  async bumpOccurrence(id: string): Promise<ImprovementProposal | null> {
    await this.repo.increment({ id }, "occurrence_count", 1);
    return this.findById(id);
  }
}
```

> The spec test in Step 1 constructs the repository with a hand-rolled stub exposing `create/save/findOne`; make the constructor accept the injected `Repository` and ensure `create`/`findById` route through it. Adjust the stub in the test if your final method surface differs — keep the assertion that a created proposal defaults `occurrence_count` to 1.

- [ ] **Step 5: Write the migration**

```ts
// apps/api/src/database/migrations/20260703000000-create-improvement-proposals.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateImprovementProposals20260703000000 implements MigrationInterface {
  name = "CreateImprovementProposals20260703000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS improvement_proposals (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        kind character varying(48) NOT NULL,
        status character varying(32) NOT NULL DEFAULT 'pending',
        payload jsonb NOT NULL,
        evidence jsonb NOT NULL,
        confidence double precision NOT NULL DEFAULT 0,
        rollback_data jsonb,
        occurrence_count integer NOT NULL DEFAULT 1,
        provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
        applied_at TIMESTAMPTZ,
        rolled_back_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_improvement_proposals PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_improvement_proposals_kind_status
        ON improvement_proposals (kind, status);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_improvement_proposals_status_created_at
        ON improvement_proposals (status, created_at);
    `);

    // Migrate existing skill_improvement_proposals rows into the new table as
    // kind='skill_create', mapping legacy columns into the generic payload.
    await queryRunner.query(`
      INSERT INTO improvement_proposals
        (id, kind, status, payload, evidence, confidence, provenance, applied_at, created_at, updated_at)
      SELECT
        sip.id,
        'skill_create',
        CASE WHEN sip.status IN ('pending','approved','rejected','applied','failed') THEN sip.status ELSE 'pending' END,
        jsonb_build_object(
          'target_skill_name', sip.target_skill_name,
          'proposal_title', sip.proposal_title,
          'proposal_summary', sip.proposal_summary,
          'patch_markdown', sip.patch_markdown,
          'rationale', sip.rationale,
          'assignment_targets', '[]'::jsonb
        ),
        jsonb_build_object('evidenceClass', 'inference'),
        0,
        jsonb_build_object(
          'migrated_from', 'skill_improvement_proposals',
          'learning_candidate_id', sip.learning_candidate_id,
          'generated_from_run_id', sip.generated_from_run_id,
          'diagnostics', sip.diagnostics_json
        ),
        sip.applied_at,
        sip.created_at,
        sip.updated_at
      FROM skill_improvement_proposals sip
      ON CONFLICT (id) DO NOTHING;
    `);

    await queryRunner.query(
      `DROP TABLE IF EXISTS skill_improvement_proposals;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Irreversible data migration: recreating the legacy table is out of scope.
    await queryRunner.query(`DROP TABLE IF EXISTS improvement_proposals;`);
  }
}
```

Then register it in `registered-migrations.ts` (append to the exported array, matching the existing import/registration style in that file).

- [ ] **Step 6: Run repository test to verify pass**

Run: `npx vitest run src/improvement/database/repositories/improvement-proposal.repository.spec.ts --root apps/api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/improvement/database apps/api/src/database/migrations/20260703000000-create-improvement-proposals.ts apps/api/src/database/migrations/registered-migrations.ts
git commit -m "feat(api): add improvement_proposals entity, migration (with skill-proposal backfill), and repository" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Governance policy service + settings

**Files:**

- Create: `apps/api/src/improvement/governance/improvement-governance.settings.constants.ts`
- Create: `apps/api/src/improvement/governance/improvement-governance-policy.service.ts`
- Create: `apps/api/src/improvement/governance/improvement-governance-policy.helpers.ts` (pure `decideGovernanceAction`)
- Modify: `apps/api/src/settings/system-settings.defaults.ts` (spread in the new settings-defaults fragment — mirror how `RETROSPECTIVE_ENABLED_SYSTEM_SETTING_DEFAULTS` is spread)
- Test: `apps/api/src/improvement/governance/improvement-governance-policy.helpers.spec.ts`

**Interfaces:**

- Consumes: `GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR` from `apps/api/src/memory/learning/governance.settings.constants.ts` (0.5 floor — single source, do not redefine); `RETROSPECTIVE_ROUTER_SETTING_DEFAULTS` from `apps/api/src/workflow/workflow-retrospective/retrospective-router.settings.constants.ts` (struggle cap 0.7 / inference cap 0.45); `GovernanceMode`, `GovernanceAction`, `ImprovementProposalKind`, `ImprovementEvidenceClass` from `@nexus/core`.
- Produces:
  - Settings keys: `IMPROVEMENT_GOVERNANCE_MODE_KEY = 'improvement_governance_mode'` (default `'tiered'`), `IMPROVEMENT_GOVERNANCE_OVERRIDES_KEY = 'improvement_governance_overrides'` (default `{}`), plus `IMPROVEMENT_GOVERNANCE_SYSTEM_SETTING_DEFAULTS`.
  - Pure `decideGovernanceAction(input: { kind; evidenceClass; confidence; mode; overrides }): GovernanceAction`.
  - `class ImprovementGovernancePolicyService` with `async resolveAction(input: { kind: ImprovementProposalKind; evidenceClass: ImprovementEvidenceClass; confidence: number }): Promise<GovernanceAction>` (reads mode + overrides from `SystemSettingsService`, fail-soft to defaults, delegates to `decideGovernanceAction`).

**Decision rules** (implemented in `decideGovernanceAction`):

1. Effective mode = `overrides[kind] ?? mode`.
2. Defensive cap: `capped = min(confidence, evidenceClass === 'struggle_backed' ? 0.7 : 0.45)` — caps enforced in _every_ mode (even a producer that mis-reports high confidence for an inference finding cannot exceed 0.45).
3. `drop` floor: if `capped < INFERENCE_CAP` **and** the proposal is below a minimum-signal threshold — for Epic A, only drop when `capped <= 0` (no positive evidence). (Kinds never carry negative confidence; a genuine drop path is exercised by producers, not this policy — keep the rule simple and covered by a test.)
4. `manual` → `propose` (anything not dropped).
5. `tiered` → `skill_assignment` = `auto_apply`; all other kinds = `propose`.
6. `autonomous` → `capped >= 0.5` (`GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR`) → `auto_apply`; else `propose`.

- [ ] **Step 1: Write the failing exhaustive table test**

```ts
// apps/api/src/improvement/governance/improvement-governance-policy.helpers.spec.ts
import { describe, expect, it } from "vitest";
import { decideGovernanceAction } from "./improvement-governance-policy.helpers";
import type {
  GovernanceMode,
  ImprovementEvidenceClass,
  ImprovementProposalKind,
} from "@nexus/core";

const KINDS: ImprovementProposalKind[] = [
  "skill_create",
  "skill_assignment",
  "workflow_definition_change",
  "agent_profile_change",
  "code_change",
];
const CLASSES: ImprovementEvidenceClass[] = ["struggle_backed", "inference"];
const MODES: GovernanceMode[] = ["tiered", "manual", "autonomous"];

describe("decideGovernanceAction", () => {
  it("manual mode always proposes (given positive confidence)", () => {
    for (const kind of KINDS) {
      for (const evidenceClass of CLASSES) {
        expect(
          decideGovernanceAction({
            kind,
            evidenceClass,
            confidence: 0.9,
            mode: "manual",
            overrides: {},
          }),
        ).toBe("propose");
      }
    }
  });

  it("tiered mode auto-applies only skill_assignment", () => {
    for (const kind of KINDS) {
      const action = decideGovernanceAction({
        kind,
        evidenceClass: "struggle_backed",
        confidence: 0.7,
        mode: "tiered",
        overrides: {},
      });
      expect(action).toBe(
        kind === "skill_assignment" ? "auto_apply" : "propose",
      );
    }
  });

  it("autonomous struggle_backed at 0.7 auto-applies (>= 0.5 floor)", () => {
    expect(
      decideGovernanceAction({
        kind: "workflow_definition_change",
        evidenceClass: "struggle_backed",
        confidence: 0.7,
        mode: "autonomous",
        overrides: {},
      }),
    ).toBe("auto_apply");
  });

  it("autonomous inference can never reach the 0.5 floor (capped at 0.45)", () => {
    expect(
      decideGovernanceAction({
        kind: "code_change",
        evidenceClass: "inference",
        confidence: 0.99,
        mode: "autonomous",
        overrides: {},
      }),
    ).toBe("propose");
  });

  it("per-kind override beats the global mode", () => {
    expect(
      decideGovernanceAction({
        kind: "workflow_definition_change",
        evidenceClass: "struggle_backed",
        confidence: 0.7,
        mode: "autonomous",
        overrides: { workflow_definition_change: "manual" },
      }),
    ).toBe("propose");
  });

  it("zero confidence drops", () => {
    expect(
      decideGovernanceAction({
        kind: "skill_create",
        evidenceClass: "inference",
        confidence: 0,
        mode: "autonomous",
        overrides: {},
      }),
    ).toBe("drop");
  });

  it("covers the full mode × kind × class × confidence grid without throwing", () => {
    for (const mode of MODES) {
      for (const kind of KINDS) {
        for (const evidenceClass of CLASSES) {
          for (const confidence of [0, 0.3, 0.45, 0.5, 0.7, 1]) {
            const action = decideGovernanceAction({
              kind,
              evidenceClass,
              confidence,
              mode,
              overrides: {},
            });
            expect(["auto_apply", "propose", "drop"]).toContain(action);
          }
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/improvement/governance/improvement-governance-policy.helpers.spec.ts --root apps/api`
Expected: FAIL — helper not found.

- [ ] **Step 3: Write the constants**

```ts
// apps/api/src/improvement/governance/improvement-governance.settings.constants.ts
import type { GovernanceMode } from "@nexus/core";

export const IMPROVEMENT_GOVERNANCE_MODE_KEY = "improvement_governance_mode";
export const IMPROVEMENT_GOVERNANCE_MODE_DEFAULT: GovernanceMode = "tiered";

export const IMPROVEMENT_GOVERNANCE_OVERRIDES_KEY =
  "improvement_governance_overrides";
export const IMPROVEMENT_GOVERNANCE_OVERRIDES_DEFAULT: Record<string, never> =
  {};

export const IMPROVEMENT_GOVERNANCE_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  [IMPROVEMENT_GOVERNANCE_MODE_KEY]: {
    value: IMPROVEMENT_GOVERNANCE_MODE_DEFAULT,
    description:
      "Global autonomy posture for the self-improvement pipeline: `tiered` (low-risk auto-applies, others propose), `manual` (everything queues for approval), or `autonomous` (auto-apply above the 0.5 confidence floor; evidence-class caps still apply).",
  },
  [IMPROVEMENT_GOVERNANCE_OVERRIDES_KEY]: {
    value: IMPROVEMENT_GOVERNANCE_OVERRIDES_DEFAULT,
    description:
      'Per-kind governance-mode overrides, e.g. {"workflow_definition_change":"manual"}. A kind present here uses its override mode instead of the global mode.',
  },
};
```

- [ ] **Step 4: Write the pure helper**

```ts
// apps/api/src/improvement/governance/improvement-governance-policy.helpers.ts
import type {
  GovernanceAction,
  GovernanceMode,
  ImprovementEvidenceClass,
  ImprovementProposalKind,
} from "@nexus/core";
import { GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR } from "../../memory/learning/governance.settings.constants";
import { RETROSPECTIVE_ROUTER_SETTING_DEFAULTS } from "../../workflow/workflow-retrospective/retrospective-router.settings.constants";

export interface GovernanceDecisionInput {
  kind: ImprovementProposalKind;
  evidenceClass: ImprovementEvidenceClass;
  confidence: number;
  mode: GovernanceMode;
  overrides: Partial<Record<ImprovementProposalKind, GovernanceMode>>;
}

const TIERED_AUTO_APPLY_KINDS: ReadonlySet<ImprovementProposalKind> = new Set([
  "skill_assignment",
]);

export function decideGovernanceAction(
  input: GovernanceDecisionInput,
): GovernanceAction {
  const cap =
    input.evidenceClass === "struggle_backed"
      ? RETROSPECTIVE_ROUTER_SETTING_DEFAULTS.struggleCap
      : RETROSPECTIVE_ROUTER_SETTING_DEFAULTS.inferenceCap;
  const capped = Math.max(0, Math.min(input.confidence, cap));

  if (capped <= 0) {
    return "drop";
  }

  const mode = input.overrides[input.kind] ?? input.mode;

  if (mode === "manual") {
    return "propose";
  }
  if (mode === "tiered") {
    return TIERED_AUTO_APPLY_KINDS.has(input.kind) ? "auto_apply" : "propose";
  }
  // autonomous
  return capped >= GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR
    ? "auto_apply"
    : "propose";
}
```

- [ ] **Step 5: Write the service**

```ts
// apps/api/src/improvement/governance/improvement-governance-policy.service.ts
import { Injectable, Logger } from "@nestjs/common";
import type {
  GovernanceAction,
  GovernanceMode,
  ImprovementEvidenceClass,
  ImprovementProposalKind,
} from "@nexus/core";
import { SystemSettingsService } from "../../settings/system-settings.service";
import {
  IMPROVEMENT_GOVERNANCE_MODE_DEFAULT,
  IMPROVEMENT_GOVERNANCE_MODE_KEY,
  IMPROVEMENT_GOVERNANCE_OVERRIDES_DEFAULT,
  IMPROVEMENT_GOVERNANCE_OVERRIDES_KEY,
} from "./improvement-governance.settings.constants";
import { decideGovernanceAction } from "./improvement-governance-policy.helpers";

@Injectable()
export class ImprovementGovernancePolicyService {
  private readonly logger = new Logger(ImprovementGovernancePolicyService.name);

  constructor(private readonly settings: SystemSettingsService) {}

  async resolveAction(input: {
    kind: ImprovementProposalKind;
    evidenceClass: ImprovementEvidenceClass;
    confidence: number;
  }): Promise<GovernanceAction> {
    const mode = await this.readMode();
    const overrides = await this.readOverrides();
    return decideGovernanceAction({ ...input, mode, overrides });
  }

  private async readMode(): Promise<GovernanceMode> {
    try {
      const raw = await this.settings.get<GovernanceMode>(
        IMPROVEMENT_GOVERNANCE_MODE_KEY,
        IMPROVEMENT_GOVERNANCE_MODE_DEFAULT,
      );
      return raw === "manual" || raw === "autonomous" || raw === "tiered"
        ? raw
        : IMPROVEMENT_GOVERNANCE_MODE_DEFAULT;
    } catch (error) {
      this.logger.warn(
        `governance mode read failed; defaulting to ${IMPROVEMENT_GOVERNANCE_MODE_DEFAULT}: ${String(error)}`,
      );
      return IMPROVEMENT_GOVERNANCE_MODE_DEFAULT;
    }
  }

  private async readOverrides(): Promise<
    Partial<Record<ImprovementProposalKind, GovernanceMode>>
  > {
    try {
      const raw = await this.settings.get<Record<string, GovernanceMode>>(
        IMPROVEMENT_GOVERNANCE_OVERRIDES_KEY,
        IMPROVEMENT_GOVERNANCE_OVERRIDES_DEFAULT,
      );
      return raw && typeof raw === "object" ? raw : {};
    } catch (error) {
      this.logger.warn(`governance overrides read failed: ${String(error)}`);
      return {};
    }
  }
}
```

Then spread `IMPROVEMENT_GOVERNANCE_SYSTEM_SETTING_DEFAULTS` into `SYSTEM_SETTING_DEFAULTS` in `system-settings.defaults.ts` (locate the existing spreads of `RETROSPECTIVE_ENABLED_SYSTEM_SETTING_DEFAULTS` / `GOVERNANCE_SYSTEM_SETTING_DEFAULTS` and add the new fragment alongside).

- [ ] **Step 6: Run test to verify pass**

Run: `npx vitest run src/improvement/governance/improvement-governance-policy.helpers.spec.ts --root apps/api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/improvement/governance apps/api/src/settings/system-settings.defaults.ts
git commit -m "feat(api): add improvement governance policy + configurable mode settings" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Applier interface + registry

**Files:**

- Create: `apps/api/src/improvement/appliers/improvement-applier.interface.ts`
- Create: `apps/api/src/improvement/appliers/improvement-applier.registry.ts`
- Test: `apps/api/src/improvement/appliers/improvement-applier.registry.spec.ts`

**Interfaces:**

- Produces:
  - `interface ImprovementApplyResult { ok: boolean; detail?: string; unrouted?: boolean }`
  - `interface IImprovementApplier { readonly kind: ImprovementProposalKind; apply(proposal: ImprovementProposal): Promise<ImprovementApplyResult>; rollback?(proposal: ImprovementProposal): Promise<void> }`
  - `const IMPROVEMENT_APPLIERS = Symbol('IMPROVEMENT_APPLIERS')` (DI multi-provider token)
  - `class ImprovementApplierRegistry` with `get(kind): IImprovementApplier | undefined` and `require(kind): IImprovementApplier` (throws if none registered). Constructor injects `@Inject(IMPROVEMENT_APPLIERS) appliers: IImprovementApplier[]` and indexes by `kind`.

(Model on the special-step handler registry in `apps/api/src/workflow/workflow-special-steps/` — same "inject array, index by discriminant" shape.)

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/improvement/appliers/improvement-applier.registry.spec.ts
import { describe, expect, it } from "vitest";
import { ImprovementApplierRegistry } from "./improvement-applier.registry";
import type { IImprovementApplier } from "./improvement-applier.interface";

const fakeApplier = (kind: any): IImprovementApplier => ({
  kind,
  apply: async () => ({ ok: true }),
});

describe("ImprovementApplierRegistry", () => {
  it("resolves an applier by kind", () => {
    const registry = new ImprovementApplierRegistry([
      fakeApplier("skill_create"),
    ]);
    expect(registry.get("skill_create")?.kind).toBe("skill_create");
    expect(registry.get("code_change")).toBeUndefined();
  });

  it("require throws for an unregistered kind", () => {
    const registry = new ImprovementApplierRegistry([]);
    expect(() => registry.require("skill_create")).toThrow(
      /no applier registered/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/improvement/appliers/improvement-applier.registry.spec.ts --root apps/api`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the interface + registry**

```ts
// apps/api/src/improvement/appliers/improvement-applier.interface.ts
import type { ImprovementProposalKind } from "@nexus/core";
import type { ImprovementProposal } from "../database/entities/improvement-proposal.entity";

export interface ImprovementApplyResult {
  ok: boolean;
  detail?: string;
  unrouted?: boolean;
}

export interface IImprovementApplier {
  readonly kind: ImprovementProposalKind;
  apply(proposal: ImprovementProposal): Promise<ImprovementApplyResult>;
  rollback?(proposal: ImprovementProposal): Promise<void>;
}

export const IMPROVEMENT_APPLIERS = Symbol("IMPROVEMENT_APPLIERS");
```

```ts
// apps/api/src/improvement/appliers/improvement-applier.registry.ts
import { Inject, Injectable } from "@nestjs/common";
import type { ImprovementProposalKind } from "@nexus/core";
import {
  IMPROVEMENT_APPLIERS,
  type IImprovementApplier,
} from "./improvement-applier.interface";

@Injectable()
export class ImprovementApplierRegistry {
  private readonly byKind = new Map<
    ImprovementProposalKind,
    IImprovementApplier
  >();

  constructor(@Inject(IMPROVEMENT_APPLIERS) appliers: IImprovementApplier[]) {
    for (const applier of appliers) {
      this.byKind.set(applier.kind, applier);
    }
  }

  get(kind: ImprovementProposalKind): IImprovementApplier | undefined {
    return this.byKind.get(kind);
  }

  require(kind: ImprovementProposalKind): IImprovementApplier {
    const applier = this.byKind.get(kind);
    if (!applier) {
      throw new Error(`no applier registered for kind '${kind}'`);
    }
    return applier;
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/improvement/appliers/improvement-applier.registry.spec.ts --root apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/improvement/appliers
git commit -m "feat(api): add improvement applier interface and DI registry" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: `ImprovementProposalService` (submit / approve / reject / rollback)

**Files:**

- Create: `apps/api/src/improvement/improvement-proposal.service.ts`
- Create: `apps/api/src/improvement/improvement-proposal.audit.ts` (event-ledger emission helper)
- Test: `apps/api/src/improvement/improvement-proposal.service.spec.ts`

**Interfaces:**

- Consumes: `ImprovementProposalRepository`, `ImprovementGovernancePolicyService`, `ImprovementApplierRegistry`, `EventLedgerService` (`apps/api/src/observability/event-ledger.service.ts` — use `emitBestEffort`).
- Produces:
  - `interface ImprovementProposalDraft { kind: ImprovementProposalKind; payload: Record<string, unknown>; evidence: ImprovementEvidencePayload; confidence: number; provenance?: Record<string, unknown> }`
  - `interface SubmitProposalResult { outcome: 'auto_applied' | 'proposed' | 'dropped' | 'apply_failed'; proposal: ImprovementProposal | null }`
  - `class ImprovementProposalService` with:
    - `submitProposal(draft): Promise<SubmitProposalResult>` — resolves governance action: `drop` → not persisted, ledger-log only, returns `{outcome:'dropped', proposal:null}`; `propose` → persist `pending`, returns `{outcome:'proposed'}`; `auto_apply` → persist `pending` then immediately run `applyProposal` and return `auto_applied`/`apply_failed`.
    - `approve(id): Promise<ImprovementProposal>` — moves `pending`→`approved` (via `updatePendingById`; throw `ConflictException` if not pending) then runs `applyProposal`.
    - `reject(id): Promise<ImprovementProposal>` — `pending`→`rejected`.
    - `rollback(id): Promise<ImprovementProposal>` — only for `applied` rows whose applier defines `rollback`; calls it, sets `status:'rolled_back'`, `rolled_back_at`, ledger entry.
    - private `applyProposal(proposal)` — resolves applier via registry; on `ok` sets `status:'applied'`, `applied_at`; on failure sets `status:'failed'` and records the error under `provenance.apply_error`; emits ledger `applied`/`failed` accordingly.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/improvement/improvement-proposal.service.spec.ts
import { describe, expect, it, vi } from "vitest";
import { ImprovementProposalService } from "./improvement-proposal.service";

function makeDeps(action: "auto_apply" | "propose" | "drop") {
  const rows = new Map<string, any>();
  let seq = 0;
  const repo = {
    create: vi.fn(async (input: any) => {
      const id = `p${++seq}`;
      const row = { id, occurrence_count: 1, provenance: {}, ...input };
      rows.set(id, row);
      return row;
    }),
    findById: vi.fn(async (id: string) => rows.get(id) ?? null),
    updateById: vi.fn(async (id: string, patch: any) => {
      const row = { ...rows.get(id), ...patch };
      rows.set(id, row);
      return row;
    }),
    updatePendingById: vi.fn(async (id: string, patch: any) => {
      const row = rows.get(id);
      if (!row || row.status !== "pending") return null;
      const next = { ...row, ...patch };
      rows.set(id, next);
      return next;
    }),
  };
  const governance = { resolveAction: vi.fn(async () => action) };
  const applier = {
    kind: "skill_create",
    apply: vi.fn(async () => ({ ok: true })),
  };
  const registry = { get: () => applier, require: () => applier };
  const ledger = { emitBestEffort: vi.fn(async () => undefined) };
  return { repo, governance, registry, ledger, applier, rows };
}

const draft = {
  kind: "skill_create" as const,
  payload: { target_skill_name: "x" },
  evidence: { evidenceClass: "inference" as const },
  confidence: 0.4,
};

describe("ImprovementProposalService.submitProposal", () => {
  it("drops without persisting when governance says drop", async () => {
    const d = makeDeps("drop");
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(result.outcome).toBe("dropped");
    expect(result.proposal).toBeNull();
    expect(d.repo.create).not.toHaveBeenCalled();
  });

  it("persists pending when governance says propose", async () => {
    const d = makeDeps("propose");
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(result.outcome).toBe("proposed");
    expect(result.proposal?.status).toBe("pending");
    expect(d.applier.apply).not.toHaveBeenCalled();
  });

  it("applies immediately when governance says auto_apply", async () => {
    const d = makeDeps("auto_apply");
    const svc = new ImprovementProposalService(
      d.repo as any,
      d.governance as any,
      d.registry as any,
      d.ledger as any,
    );
    const result = await svc.submitProposal(draft);
    expect(result.outcome).toBe("auto_applied");
    expect(d.applier.apply).toHaveBeenCalledOnce();
    expect(result.proposal?.status).toBe("applied");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/improvement/improvement-proposal.service.spec.ts --root apps/api`
Expected: FAIL — service not found.

- [ ] **Step 3: Write the audit helper + service**

Implement `improvement-proposal.audit.ts` exporting `emitImprovementAudit(ledger, { eventName, proposalId, outcome, payload })` that wraps `ledger.emitBestEffort({ domain: 'improvement', eventName, outcome, payload })`. Then write the service per the Interfaces block. Keep `applyProposal` and the governance-branch logic small; if the file approaches 500 lines, extract a pure `resolveSubmitOutcome` helper. Full skeleton:

```ts
// apps/api/src/improvement/improvement-proposal.service.ts
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { ImprovementProposalKind } from "@nexus/core";
import { ImprovementProposalRepository } from "./database/repositories/improvement-proposal.repository";
import type {
  ImprovementEvidencePayload,
  ImprovementProposal,
} from "./database/entities/improvement-proposal.entity";
import { ImprovementGovernancePolicyService } from "./governance/improvement-governance-policy.service";
import { ImprovementApplierRegistry } from "./appliers/improvement-applier.registry";
import { EventLedgerService } from "../observability/event-ledger.service";
import { emitImprovementAudit } from "./improvement-proposal.audit";

export interface ImprovementProposalDraft {
  kind: ImprovementProposalKind;
  payload: Record<string, unknown>;
  evidence: ImprovementEvidencePayload;
  confidence: number;
  provenance?: Record<string, unknown>;
}

export interface SubmitProposalResult {
  outcome: "auto_applied" | "proposed" | "dropped" | "apply_failed";
  proposal: ImprovementProposal | null;
}

@Injectable()
export class ImprovementProposalService {
  private readonly logger = new Logger(ImprovementProposalService.name);

  constructor(
    private readonly proposals: ImprovementProposalRepository,
    private readonly governance: ImprovementGovernancePolicyService,
    private readonly appliers: ImprovementApplierRegistry,
    private readonly ledger: EventLedgerService,
  ) {}

  async submitProposal(
    draft: ImprovementProposalDraft,
  ): Promise<SubmitProposalResult> {
    const action = await this.governance.resolveAction({
      kind: draft.kind,
      evidenceClass: draft.evidence.evidenceClass,
      confidence: draft.confidence,
    });

    if (action === "drop") {
      await emitImprovementAudit(this.ledger, {
        eventName: "improvement.proposal.dropped",
        proposalId: null,
        outcome: "success",
        payload: { kind: draft.kind, confidence: draft.confidence },
      });
      return { outcome: "dropped", proposal: null };
    }

    const proposal = await this.proposals.create({
      kind: draft.kind,
      status: "pending",
      payload: draft.payload,
      evidence: draft.evidence,
      confidence: draft.confidence,
      provenance: draft.provenance ?? {},
    });

    await emitImprovementAudit(this.ledger, {
      eventName: "improvement.proposal.created",
      proposalId: proposal.id,
      outcome: "success",
      payload: { kind: proposal.kind, action },
    });

    if (action === "propose") {
      return { outcome: "proposed", proposal };
    }

    const applied = await this.applyProposal(proposal);
    return {
      outcome: applied.status === "applied" ? "auto_applied" : "apply_failed",
      proposal: applied,
    };
  }

  async approve(id: string): Promise<ImprovementProposal> {
    const approved = await this.proposals.updatePendingById(id, {
      status: "approved",
    });
    if (!approved) {
      const existing = await this.proposals.findById(id);
      if (!existing) throw new NotFoundException(`Proposal ${id} not found`);
      throw new ConflictException(`Proposal ${id} is not pending`);
    }
    return this.applyProposal(approved);
  }

  async reject(id: string): Promise<ImprovementProposal> {
    const rejected = await this.proposals.updatePendingById(id, {
      status: "rejected",
    });
    if (!rejected) {
      const existing = await this.proposals.findById(id);
      if (!existing) throw new NotFoundException(`Proposal ${id} not found`);
      throw new ConflictException(`Proposal ${id} is not pending`);
    }
    await emitImprovementAudit(this.ledger, {
      eventName: "improvement.proposal.rejected",
      proposalId: id,
      outcome: "success",
      payload: { kind: rejected.kind },
    });
    return rejected;
  }

  async rollback(id: string): Promise<ImprovementProposal> {
    const proposal = await this.proposals.findById(id);
    if (!proposal) throw new NotFoundException(`Proposal ${id} not found`);
    if (proposal.status !== "applied") {
      throw new ConflictException(
        `Proposal ${id} is not applied (current: ${proposal.status})`,
      );
    }
    const applier = this.appliers.require(proposal.kind);
    if (!applier.rollback) {
      throw new ConflictException(
        `Applier for kind '${proposal.kind}' does not support rollback`,
      );
    }
    await applier.rollback(proposal);
    const updated = await this.proposals.updateById(id, {
      status: "rolled_back",
      rolled_back_at: new Date(),
    });
    await emitImprovementAudit(this.ledger, {
      eventName: "improvement.proposal.rolled_back",
      proposalId: id,
      outcome: "success",
      payload: { kind: proposal.kind },
    });
    return updated ?? proposal;
  }

  private async applyProposal(
    proposal: ImprovementProposal,
  ): Promise<ImprovementProposal> {
    const applier = this.appliers.require(proposal.kind);
    try {
      const result = await applier.apply(proposal);
      if (result.ok) {
        const updated = await this.proposals.updateById(proposal.id, {
          status: "applied",
          applied_at: new Date(),
          provenance: {
            ...proposal.provenance,
            apply_detail: result.detail ?? null,
            unrouted: result.unrouted ?? false,
          },
        });
        await emitImprovementAudit(this.ledger, {
          eventName: "improvement.proposal.applied",
          proposalId: proposal.id,
          outcome: "success",
          payload: { kind: proposal.kind, unrouted: result.unrouted ?? false },
        });
        return updated ?? proposal;
      }
      return this.markFailed(
        proposal,
        result.detail ?? "applier returned ok:false",
      );
    } catch (error) {
      return this.markFailed(proposal, String(error));
    }
  }

  private async markFailed(
    proposal: ImprovementProposal,
    reason: string,
  ): Promise<ImprovementProposal> {
    const updated = await this.proposals.updateById(proposal.id, {
      status: "failed",
      provenance: { ...proposal.provenance, apply_error: reason },
    });
    await emitImprovementAudit(this.ledger, {
      eventName: "improvement.proposal.failed",
      proposalId: proposal.id,
      outcome: "failure",
      payload: { kind: proposal.kind, reason },
    });
    return updated ?? proposal;
  }
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/improvement/improvement-proposal.service.spec.ts --root apps/api`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/improvement/improvement-proposal.service.ts apps/api/src/improvement/improvement-proposal.audit.ts apps/api/src/improvement/improvement-proposal.service.spec.ts
git commit -m "feat(api): add ImprovementProposalService (submit/approve/reject/rollback + ledger audit)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: `SkillCreateApplier` + delete the legacy skill-proposal path

**Files:**

- Create: `apps/api/src/improvement/appliers/skill-create.applier.ts`
- Create: `apps/api/src/improvement/skill-create-completion.listener.ts` (ports `skill-proposal-completion.listener.ts`)
- Delete: `apps/api/src/memory/database/entities/skill-improvement-proposal.entity.ts`, `apps/api/src/memory/database/repositories/skill-improvement-proposal.repository.ts` (+ its `.spec.ts`), `apps/api/src/memory/learning/skill-proposal.service.ts` (+ spec), `apps/api/src/memory/learning/skill-proposals.controller.ts` (+ spec), `apps/api/src/memory/learning/skill-proposal-approved.listener.ts` (+ spec), `apps/api/src/memory/learning/skill-proposal-completion.listener.ts` (+ spec)
- Modify: `apps/api/src/memory/learning/learning.module.ts` and `apps/api/src/memory/memory.module.ts` (remove deleted providers/entities), `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.ts` (its `skill_proposal` branch now calls `ImprovementProposalService.submitProposal` with `kind:'skill_create'` — see note), any `TypeOrmModule.forFeature([... SkillImprovementProposal ...])` registrations
- Test: `apps/api/src/improvement/appliers/skill-create.applier.spec.ts`

**Interfaces:**

- Consumes: `WorkflowEngineService.startWorkflow('create_skill', {...})` (same call the old approved-listener made); `ImprovementProposalRepository`; `AgentSkillsService`.
- Produces: `class SkillCreateApplier implements IImprovementApplier` with `kind = 'skill_create'`. `apply(proposal)` reads `proposal.payload.{target_skill_name, patch_markdown, proposal_summary}`, starts the `create_skill` workflow with `source_proposal_id: proposal.id`, and returns `{ ok: true, detail: 'materialization dispatched' }` (materialization completes asynchronously; the completion listener flips the proposal to its terminal detail). **`assignment_targets` in the payload are ignored in Epic A** — Epic B extends this applier to apply them after materialization.

> Note on completion: today the proposal is only marked `applied` once the `create_skill` run completes (the completion listener checks `author_skill.output.materialized`). Preserve that: `apply()` returns `ok:true` to signal "dispatch accepted", which sets the proposal `status:'applied'` optimistically at dispatch — but keep the completion listener to (a) downgrade to `failed` if the run reports `materialized:false`, and (b) carry the recommended-scope auto-apply. Port the completion listener to key off `trigger.source_proposal_id` against the new `ImprovementProposalRepository`, updating `provenance.materialization` rather than the old `diagnostics_json`. If you prefer strict semantics (proposal stays `pending`/`approved` until materialized), that is acceptable but must be reflected consistently in the completion listener and the service — pick one and cover it with the test below.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/improvement/appliers/skill-create.applier.spec.ts
import { describe, expect, it, vi } from "vitest";
import { SkillCreateApplier } from "./skill-create.applier";

describe("SkillCreateApplier", () => {
  it("dispatches the create_skill workflow with the proposal id", async () => {
    const engine = { startWorkflow: vi.fn(async () => "run-1") };
    const applier = new SkillCreateApplier(engine as any);
    const result = await applier.apply({
      id: "p1",
      kind: "skill_create",
      payload: {
        target_skill_name: "merge-doctor",
        patch_markdown: "# body",
        proposal_summary: "summary",
      },
      provenance: {},
    } as any);
    expect(result.ok).toBe(true);
    expect(engine.startWorkflow).toHaveBeenCalledWith(
      "create_skill",
      expect.objectContaining({
        target_skill_name: "merge-doctor",
        source_proposal_id: "p1",
      }),
    );
  });

  it("fails when the workflow could not be started", async () => {
    const engine = { startWorkflow: vi.fn(async () => null) };
    const applier = new SkillCreateApplier(engine as any);
    const result = await applier.apply({
      id: "p2",
      kind: "skill_create",
      payload: {
        target_skill_name: "x",
        patch_markdown: "b",
        proposal_summary: "s",
      },
      provenance: {},
    } as any);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/improvement/appliers/skill-create.applier.spec.ts --root apps/api`
Expected: FAIL — applier not found.

- [ ] **Step 3: Write the applier**

```ts
// apps/api/src/improvement/appliers/skill-create.applier.ts
import { Injectable } from "@nestjs/common";
import { WorkflowEngineService } from "../../workflow/workflow-engine.service";
import type { ImprovementProposal } from "../database/entities/improvement-proposal.entity";
import {
  type IImprovementApplier,
  type ImprovementApplyResult,
} from "./improvement-applier.interface";

@Injectable()
export class SkillCreateApplier implements IImprovementApplier {
  readonly kind = "skill_create" as const;

  constructor(private readonly workflowEngine: WorkflowEngineService) {}

  async apply(proposal: ImprovementProposal): Promise<ImprovementApplyResult> {
    const payload = proposal.payload as {
      target_skill_name?: string;
      patch_markdown?: string;
      proposal_summary?: string;
    };
    const runId = await this.workflowEngine.startWorkflow("create_skill", {
      target_skill_name: payload.target_skill_name ?? "",
      patch_markdown: payload.patch_markdown ?? "",
      proposal_summary: payload.proposal_summary ?? "",
      source_proposal_id: proposal.id,
      scope_id: readScopeId(proposal.provenance) ?? "",
    });
    if (!runId) {
      return { ok: false, detail: "failed to start create_skill workflow" };
    }
    return { ok: true, detail: `materialization dispatched (run ${runId})` };
  }
}

function readScopeId(provenance: Record<string, unknown>): string | undefined {
  const scope = provenance?.scope_id;
  return typeof scope === "string" && scope.length > 0 ? scope : undefined;
}
```

- [ ] **Step 4: Run applier test to verify pass**

Run: `npx vitest run src/improvement/appliers/skill-create.applier.spec.ts --root apps/api`
Expected: PASS.

- [ ] **Step 5: Port the completion listener, then delete the legacy files**

Create `skill-create-completion.listener.ts` porting the logic of the old `skill-proposal-completion.listener.ts` (key off `trigger.source_proposal_id`, read `jobs.author_skill.output.materialized`, flip the new proposal to `failed` on `materialized:false`, carry recommended-scope auto-apply against `AgentSkillsService`). Then delete the seven legacy files (+ their specs) listed under **Files**, and update `learning.module.ts` / `memory.module.ts` / any `TypeOrmModule.forFeature` to drop the removed entity/providers. Update the retrospective router `skill_proposal` branch to call the new service (detailed in Epic D/B; for Epic A, make it call `submitProposal({ kind:'skill_create', payload:{ target_skill_name, proposal_title, proposal_summary, patch_markdown, assignment_targets: [] }, evidence, confidence })` so the router still compiles and routes).

- [ ] **Step 6: Grep-verify zero dangling references**

Run: `git grep -n "SkillImprovementProposal\|skill-proposal\|skill_improvement_proposals\|SKILL_PROPOSAL_APPROVED_EVENT" apps/api/src -- ':!*improvement*'`
Expected: no results (every reference now lives under `apps/api/src/improvement/` or is deleted). Fix any stragglers.

- [ ] **Step 7: Run the affected suites**

Run: `npx vitest run src/improvement src/memory/learning src/workflow/workflow-retrospective --root apps/api`
Expected: PASS (deleted specs are gone; remaining specs green).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): SkillCreateApplier + retire legacy skill-proposal path onto improvement pipeline" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: Controller + module wiring

**Files:**

- Create: `apps/api/src/improvement/improvement-proposals.controller.ts`
- Create: `apps/api/src/improvement/improvement.module.ts`
- Create: `packages/core/src/improvement/improvement-proposal-contracts.schema.ts` (Zod request schemas: list query, bulk-approve body) + export from core index
- Modify: `apps/api/src/app.module.ts` (import `ImprovementModule`)
- Test: `apps/api/src/improvement/improvement-proposals.controller.spec.ts`

**Interfaces:**

- Consumes: `ImprovementProposalService`, `ImprovementProposalRepository`.
- Produces: REST controller at `@Controller('improvement/proposals')`:
  - `GET /` (list; query `kind?`, `status?`, `page?`, `limit?`) `@RequirePermission('improvements:read')`
  - `GET /:id` `@RequirePermission('improvements:read')`
  - `POST /:id/approve` `@RequirePermission('improvements:manage')`
  - `POST /:id/reject` `@RequirePermission('improvements:manage')`
  - `POST /bulk-approve` (body `{ proposal_ids: string[] }`) `@RequirePermission('improvements:manage')`
  - `POST /:id/rollback` `@RequirePermission('improvements:manage')`
  - `ImprovementModule` registers `TypeOrmModule.forFeature([ImprovementProposal])`, all services/registry, the `IMPROVEMENT_APPLIERS` multi-provider seeded with `SkillCreateApplier`, and the completion listener.

> The permission strings `improvements:read` / `improvements:manage` are new — register them wherever `skills:read` / `skills:create` are declared (search for the permission catalog/enum that `RequirePermission` validates against and add the two new entries).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/improvement/improvement-proposals.controller.spec.ts
import { describe, expect, it, vi } from "vitest";
import { ImprovementProposalsController } from "./improvement-proposals.controller";

describe("ImprovementProposalsController", () => {
  it("approve delegates to the service and wraps success", async () => {
    const service = {
      approve: vi.fn(async () => ({ id: "p1", status: "applied" })),
    };
    const repo = { list: vi.fn(), findById: vi.fn() };
    const controller = new ImprovementProposalsController(
      service as any,
      repo as any,
    );
    const res = await controller.approve("p1");
    expect(service.approve).toHaveBeenCalledWith("p1");
    expect(res).toEqual({
      success: true,
      data: { id: "p1", status: "applied" },
    });
  });

  it("list forwards filters to the repository", async () => {
    const service = { approve: vi.fn() };
    const repo = {
      list: vi.fn(async () => ({ data: [], total: 0 })),
      findById: vi.fn(),
    };
    const controller = new ImprovementProposalsController(
      service as any,
      repo as any,
    );
    const res = await controller.list({
      kind: ["code_change"],
      status: ["pending"],
      page: 1,
      limit: 20,
    } as any);
    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({
        kinds: ["code_change"],
        statuses: ["pending"],
      }),
    );
    expect(res.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/improvement/improvement-proposals.controller.spec.ts --root apps/api`
Expected: FAIL — controller not found.

- [ ] **Step 3: Write the controller + module**

Model the controller on `SkillProposalsController` (Zod-validated query/body via `@ZodQuery`/`@ZodBody`, `JwtAuthGuard` + `PermissionsGuard`, `success:true` envelope). `list` maps `{kind,status}` query arrays to the repository's `{kinds,statuses}` filter. Write `improvement.module.ts`:

```ts
// apps/api/src/improvement/improvement.module.ts (shape)
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ImprovementProposal,
    ]) /* WorkflowModule (engine), ObservabilityModule (ledger), SettingsModule, AiConfigModule (AgentSkillsService) */,
  ],
  controllers: [ImprovementProposalsController],
  providers: [
    ImprovementProposalRepository,
    ImprovementProposalService,
    ImprovementGovernancePolicyService,
    ImprovementApplierRegistry,
    SkillCreateApplier,
    SkillCreateCompletionListener,
    {
      provide: IMPROVEMENT_APPLIERS,
      useFactory: (a: SkillCreateApplier) => [a],
      inject: [SkillCreateApplier],
    },
  ],
  exports: [ImprovementProposalService],
})
export class ImprovementModule {}
```

Resolve the module imports against the actual providers each dependency needs (mirror how `learning.module.ts` imports what `SkillProposalService` required). Add `ImprovementModule` to `app.module.ts`.

- [ ] **Step 4: Run controller test + build**

Run: `npx vitest run src/improvement/improvement-proposals.controller.spec.ts --root apps/api`
Expected: PASS.
Run: `npm run build --workspace=packages/core && npm run build:api`
Expected: both builds succeed (DI graph resolves).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/improvement/improvement-proposals.controller.ts apps/api/src/improvement/improvement.module.ts apps/api/src/app.module.ts packages/core/src/improvement/improvement-proposal-contracts.schema.ts packages/core/src/index.ts apps/api/src/improvement/improvement-proposals.controller.spec.ts
git commit -m "feat(api): improvement proposals REST controller + module wiring" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: Web — improvements queue page

**Files:**

- Create: `apps/web/src/hooks/useImprovementProposals.ts`
- Create: `apps/web/src/pages/improvements/ImprovementsQueue.tsx`
- Modify: `apps/web/src/lib/api/client.admin.ts` (add `listImprovementProposals`, `approveImprovementProposal`, `rejectImprovementProposal`, `bulkApproveImprovementProposals`, `rollbackImprovementProposal`)
- Modify: the web route table + nav (add an "Improvements" entry — locate where `AgentSkills` is routed and add a sibling route/nav item)
- Test: `apps/web/src/pages/improvements/ImprovementsQueue.test.tsx`

**Interfaces:**

- Consumes: the REST endpoints from Task 7.
- Produces: a presentational `ImprovementsQueue` page listing proposals (kind, status, confidence, created-at) with kind/status filters and approve / reject / bulk-approve actions; all data-fetching and mutations live in `useImprovementProposals` (web quality gate — components are presentation-only, side effects in hooks). Per-kind **detail rendering** is a stub in Epic A (renders `kind` + raw payload JSON); Epics B/D/E replace the stub with kind-specific views.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/improvements/ImprovementsQueue.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImprovementsQueue } from "./ImprovementsQueue";

vi.mock("../../hooks/useImprovementProposals", () => ({
  useImprovementProposals: () => ({
    proposals: [
      {
        id: "p1",
        kind: "code_change",
        status: "pending",
        confidence: 0.6,
        created_at: "2026-07-02T00:00:00Z",
      },
    ],
    isLoading: false,
    approve: vi.fn(),
    reject: vi.fn(),
    bulkApprove: vi.fn(),
    setFilters: vi.fn(),
  }),
}));

describe("ImprovementsQueue", () => {
  it("renders a proposal row with its kind and status", () => {
    render(<ImprovementsQueue />);
    expect(screen.getByText("code_change")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/improvements/ImprovementsQueue.test.tsx --root apps/web`
Expected: FAIL — page not found.

- [ ] **Step 3: Implement the client methods, hook, and page**

Mirror `useAgentSkills.ts` for the hook shape (React Query or the repo's existing data-fetching pattern — match what `useAgentSkills` uses) and `AgentSkills.tsx` for page structure/Tailwind. The hook exposes `{ proposals, isLoading, approve, reject, bulkApprove, rollback, setFilters }`. Client methods call the Task-7 endpoints via the existing admin client base.

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/pages/improvements/ImprovementsQueue.test.tsx --root apps/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useImprovementProposals.ts apps/web/src/pages/improvements apps/web/src/lib/api/client.admin.ts
git commit -m "feat(web): improvements queue page (Epic A skeleton)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: Full-suite verification + docs

**Files:**

- Modify: `docs/guide/README.md` or the learning/self-improvement guide page (document the improvement-proposal pipeline, governance modes, and that the skill-proposal queue is now the improvements queue)
- Modify: `CLAUDE.md` (add `ImprovementModule` to the workflow-module/table or a new "Improvement" note if appropriate)

- [ ] **Step 1: Build core + API + web**

Run: `npm run build --workspace=packages/core && npm run build:api && npm run build:web`
Expected: all succeed.

- [ ] **Step 2: Full test suites**

Run: `npm run test:api && npm run test:unit:web && npm run test --workspace=packages/core`
Expected: green.

- [ ] **Step 3: Lint**

Run: `npm run lint:api && npm run lint:web`
Expected: zero findings, no suppressions.

- [ ] **Step 4: Seed-data validation** (migration introduced new settings defaults)

Run: `npm run validate:seed-data`
Expected: pass.

- [ ] **Step 5: Docs + commit**

Update the guide + CLAUDE.md, then:

```bash
git add docs/ CLAUDE.md
git commit -m "docs: document the improvement-proposal pipeline (Epic A)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Deployment note (post-merge)

The new migration must run against the live DB (it backfills + drops `skill_improvement_proposals`). New settings defaults (`improvement_governance_mode`, overrides) seed on boot. Requires a nexus-api rebuild + redeploy; no image content beyond the API changes.
