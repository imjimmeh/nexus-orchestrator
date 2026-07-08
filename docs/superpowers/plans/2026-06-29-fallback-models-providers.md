# Fallback Models / Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator define an ordered fallback chain of `(provider, model)` pairs so that when the active model hits a usage/billing/auth/outage failure, the orchestrator records a per-provider cooldown, requeues the job, and re-resolves onto the next viable entry — auto-recovering when the cooldown expires.

**Architecture:** A new `provider_cooldowns` table is the system-global, lazily-evaluated cooldown registry and the chain-progress mechanism. A `fallback_chains` table holds named global chains (`default` seeded) and a new `agent_profiles.fallback_chain` JSONB column holds per-profile chains. A single `FallbackChainResolverService` is the one source of truth for "given an effective chain + active cooldowns, which `(provider, model)` is viable" — consumed by both the read path (`AiConfigurationService.resolveStepSettings`) and the write path (the agent-step terminal-failure seam, which records a cooldown then requeues via `WorkflowFailedJobRetryService.retryFailedJobWithMessage`). The web UI edits chains and shows cooldown status.

**Tech Stack:** NestJS + TypeORM + PostgreSQL (apps/api), shared contracts in `@nexus/core`, Vitest, Vite + React + react-hook-form + Zod + TanStack Query (apps/web).

## Global Constraints

- **No lint suppressions** — never use `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- **Strict typing** — shared interfaces live in `@nexus/core`; no `any`. Build `packages/core` first (`npm run build --workspace=packages/core`) before apps consume new types.
- **Core/Kanban boundary** — all code here is AI-config / workflow-repair / web. Do not introduce any `kanban`, work-item, or project-domain identifiers. API/core stays Kanban-neutral.
- **NestJS build** — use `nest build` for apps/api (not `tsc`); tests rely on SWC decorator metadata.
- **TDD** — every task: failing test → run it red → minimal implementation → run it green → commit.
- **Entities live domain-local** — `apps/api/src/ai-config/database/entities/` + `.../repositories/`, registered in `apps/api/src/database/database.module.ts` and (for tables) `apps/api/src/database/migrations/registered-migrations.ts`.
- **Migration naming** — `apps/api/src/database/migrations/{YYYYMMDDHHMMSS}-{kebab-description}.ts`, class `Description{Timestamp} implements MigrationInterface`, `CREATE TABLE IF NOT EXISTS` / `DROP TABLE IF EXISTS`.
- **React Query keys** — register every new key in `apps/web/src/lib/queryKeys.ts`; never inline a key array.
- **Feature flag** — advance behavior is gated by a system setting `fallback_chains.enabled` (default `true`); resolution skipping cooled providers is inert until a chain is configured, so the feature is backward-compatible regardless.

## Resolved spec open items

- **Cooldown key:** `provider_name` (varchar). Resolution operates on provider _name_; `provider_id` is optional/scoped and not always present.
- **Global default chain storage:** a `fallback_chains` table keyed by unique `name`, with a `default` row seeded empty. (Not a singleton config row — a table gives room for named chains and matches the seed pattern.)
- **Chain entry shape:** `{ provider_name: string; model_name: string }`.

## File Structure

**Shared (`packages/core/src`)**

- Create: `packages/core/src/ai-config/fallback-chain.types.ts` — `FallbackChainEntry`, `FallbackChain`, `ProviderCooldownReason`, `ProviderCooldownStatus`, `FALLBACK_COOLDOWN_DEFAULT_MS`. Re-export from the package index.

**API data layer (`apps/api/src`)**

- Create: `ai-config/database/entities/provider-cooldown.entity.ts`
- Create: `ai-config/database/repositories/provider-cooldown.repository.ts`
- Create: `ai-config/database/entities/fallback-chain.entity.ts`
- Create: `ai-config/database/repositories/fallback-chain.repository.ts`
- Modify: `ai-config/database/entities/agent-profile.entity.ts` (add `fallback_chain` column)
- Create migrations under `database/migrations/` (3) + register them
- Modify: `database/database.module.ts` (register 2 entities + 2 repos)
- Create: `database/seeds/config/fallback-chains.seed.ts` + register in `database.module.ts` and `database/seeds/startup-seed.service.ts`

**API logic (`apps/api/src`)**

- Create: `ai-config/fallback/fallback-chain-resolver.service.ts` (+ types file)
- Create: `ai-config/fallback/cooldown-duration.helpers.ts`
- Create: `ai-config/fallback/provider-fallback.service.ts`
- Create: `llm/provider-outage-failure.helpers.ts` (+ types)
- Modify: `ai-config/ai-configuration.service.ts` (consume resolver in `resolveStepSettings`)
- Modify: `ai-config/ai-config.module.ts` (provide new services)
- Modify: `workflow/workflow-step-execution/step-agent-step-executor.multistep.ts` (failure seam)
- Create/modify: AI-config controller + DTOs for chain CRUD + cooldown status

**Web (`apps/web/src`)**

- Modify: `lib/queryKeys.ts`, `lib/api/client.admin.ts`
- Create: `hooks/useFallbackChains.ts`, `hooks/useProviderCooldownStatus.ts`
- Create: `components/fallback/FallbackChainEditor.tsx`, `components/fallback/ProviderCooldownPanel.tsx`
- Modify: `pages/Settings.tsx` (new tab), `pages/agents/AgentProfileForm.tsx` (per-profile chain section)

**Docs**

- Modify: `docs/guide/README.md` (or AI-config sub-doc), `CLAUDE.md` (precedence note)
- Create: `docs/architecture/decisions/ADR-fallback-models-providers.md`

---

## Phase 0 — Shared contracts

### Task 1: Shared fallback-chain types in `@nexus/core`

**Files:**

- Create: `packages/core/src/ai-config/fallback-chain.types.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './ai-config/fallback-chain.types';` — match the existing export style in that file)
- Test: `packages/core/src/ai-config/fallback-chain.types.spec.ts`

**Interfaces (Produces):**

```typescript
export interface FallbackChainEntry {
  provider_name: string;
  model_name: string;
}
export type ProviderCooldownReason =
  | "usage_exhausted"
  | "billing_exhausted"
  | "auth_failed"
  | "provider_outage";
export interface FallbackChain {
  name: string;
  entries: FallbackChainEntry[];
}
export interface ProviderCooldownStatus {
  provider_name: string;
  reason: ProviderCooldownReason;
  cooled_until: string; // ISO-8601
  last_failure_at: string; // ISO-8601
  source_run_id?: string | null;
}
export const FALLBACK_COOLDOWN_DEFAULT_MS: Record<
  ProviderCooldownReason,
  number
> = {
  usage_exhausted: 30 * 60 * 1000,
  billing_exhausted: 30 * 60 * 1000,
  auth_failed: 30 * 60 * 1000,
  provider_outage: 2 * 60 * 1000,
};
```

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/ai-config/fallback-chain.types.spec.ts
import { describe, it, expect } from "vitest";
import { FALLBACK_COOLDOWN_DEFAULT_MS } from "./fallback-chain.types";

describe("FALLBACK_COOLDOWN_DEFAULT_MS", () => {
  it("uses a short window for outages and 30m for account-scoped failures", () => {
    expect(FALLBACK_COOLDOWN_DEFAULT_MS.provider_outage).toBe(120000);
    expect(FALLBACK_COOLDOWN_DEFAULT_MS.usage_exhausted).toBe(1800000);
    expect(FALLBACK_COOLDOWN_DEFAULT_MS.billing_exhausted).toBe(1800000);
    expect(FALLBACK_COOLDOWN_DEFAULT_MS.auth_failed).toBe(1800000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- fallback-chain.types`
Expected: FAIL — cannot resolve `./fallback-chain.types`.

- [ ] **Step 3: Write the file shown in "Interfaces (Produces)" above and add the index export.**

- [ ] **Step 4: Run tests + build core**

Run: `npm run test --workspace=packages/core -- fallback-chain.types && npm run build --workspace=packages/core`
Expected: PASS and a clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ai-config/fallback-chain.types.ts packages/core/src/ai-config/fallback-chain.types.spec.ts packages/core/src/index.ts
git commit -m "feat(core): add fallback chain + provider cooldown contracts"
```

---

## Phase 1 — Data layer

### Task 2: `provider_cooldowns` entity, repository, migration, registration

**Files:**

- Create: `apps/api/src/ai-config/database/entities/provider-cooldown.entity.ts`
- Create: `apps/api/src/ai-config/database/repositories/provider-cooldown.repository.ts`
- Create: `apps/api/src/database/migrations/20260629120000-create-provider-cooldowns.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts`
- Modify: `apps/api/src/database/database.module.ts`
- Test: `apps/api/src/ai-config/database/repositories/provider-cooldown.repository.spec.ts`

**Interfaces (Produces):**

```typescript
class ProviderCooldownRepository {
  upsertCooldown(data: {
    provider_name: string;
    reason: ProviderCooldownReason;
    cooled_until: Date;
    last_failure_at: Date;
    source_run_id?: string | null;
  }): Promise<void>;
  findActive(now: Date): Promise<ProviderCooldown[]>; // cooled_until > now
  findActiveProviderNames(now: Date): Promise<Set<string>>; // convenience
  deleteExpired(now: Date): Promise<void>;
}
```

- [ ] **Step 1: Write the failing test** (uses an in-memory-style mocked TypeORM repository; follow the mock factory conventions in `apps/api` tests — see `testing-unit-patterns` skill).

```typescript
// provider-cooldown.repository.spec.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Repository } from "typeorm";
import { ProviderCooldown } from "../entities/provider-cooldown.entity";
import { ProviderCooldownRepository } from "./provider-cooldown.repository";

describe("ProviderCooldownRepository", () => {
  let typeorm: {
    createQueryBuilder: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let repo: ProviderCooldownRepository;

  beforeEach(() => {
    typeorm = {
      createQueryBuilder: vi.fn(),
      query: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    repo = new ProviderCooldownRepository(
      typeorm as unknown as Repository<ProviderCooldown>,
    );
  });

  it("findActiveProviderNames returns the set of provider names with active cooldowns", async () => {
    const getMany = vi
      .fn()
      .mockResolvedValue([
        { provider_name: "anthropic-a" },
        { provider_name: "openai-b" },
      ]);
    typeorm.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      getMany,
    });
    const result = await repo.findActiveProviderNames(
      new Date("2026-06-29T00:00:00Z"),
    );
    expect(result).toEqual(new Set(["anthropic-a", "openai-b"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- provider-cooldown.repository`
Expected: FAIL — entity/repository modules not found.

- [ ] **Step 3: Write the entity**

```typescript
// apps/api/src/ai-config/database/entities/provider-cooldown.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import type { ProviderCooldownReason } from "@nexus/core";

@Index("UQ_provider_cooldowns_provider_name", ["provider_name"], {
  unique: true,
})
@Entity("provider_cooldowns")
export class ProviderCooldown {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255 })
  provider_name: string;

  @Column({ type: "varchar", length: 32 })
  reason: ProviderCooldownReason;

  @Column({ type: "timestamp" })
  cooled_until: Date;

  @Column({ type: "timestamp" })
  last_failure_at: Date;

  @Column({ type: "varchar", length: 64, nullable: true })
  source_run_id?: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
```

- [ ] **Step 4: Write the repository**

```typescript
// apps/api/src/ai-config/database/repositories/provider-cooldown.repository.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThanOrEqual, MoreThan, Repository } from "typeorm";
import type { ProviderCooldownReason } from "@nexus/core";
import { ProviderCooldown } from "../entities/provider-cooldown.entity";

@Injectable()
export class ProviderCooldownRepository {
  constructor(
    @InjectRepository(ProviderCooldown)
    private readonly repository: Repository<ProviderCooldown>,
  ) {}

  async upsertCooldown(data: {
    provider_name: string;
    reason: ProviderCooldownReason;
    cooled_until: Date;
    last_failure_at: Date;
    source_run_id?: string | null;
  }): Promise<void> {
    await this.repository.upsert(
      {
        provider_name: data.provider_name,
        reason: data.reason,
        cooled_until: data.cooled_until,
        last_failure_at: data.last_failure_at,
        source_run_id: data.source_run_id ?? null,
      },
      ["provider_name"],
    );
  }

  async findActive(now: Date): Promise<ProviderCooldown[]> {
    return this.repository.find({ where: { cooled_until: MoreThan(now) } });
  }

  async findActiveProviderNames(now: Date): Promise<Set<string>> {
    const rows = await this.repository
      .createQueryBuilder("cooldown")
      .where("cooldown.cooled_until > :now", { now })
      .getMany();
    return new Set(rows.map((row) => row.provider_name));
  }

  async deleteExpired(now: Date): Promise<void> {
    await this.repository.delete({ cooled_until: LessThanOrEqual(now) });
  }
}
```

- [ ] **Step 5: Write the migration**

```typescript
// apps/api/src/database/migrations/20260629120000-create-provider-cooldowns.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateProviderCooldowns20260629120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS provider_cooldowns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider_name character varying(255) NOT NULL,
        reason character varying(32) NOT NULL,
        cooled_until TIMESTAMP NOT NULL,
        last_failure_at TIMESTAMP NOT NULL,
        source_run_id character varying(64),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_cooldowns_provider_name
      ON provider_cooldowns(provider_name);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_cooldowns_cooled_until
      ON provider_cooldowns(cooled_until);
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'provider_cooldowns'::regclass
            AND conname = 'chk_provider_cooldowns_reason'
        ) THEN
          ALTER TABLE provider_cooldowns
            ADD CONSTRAINT chk_provider_cooldowns_reason
            CHECK (reason IN ('usage_exhausted','billing_exhausted','auth_failed','provider_outage'));
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS provider_cooldowns");
  }
}
```

- [ ] **Step 6: Register migration + entity + repository**

In `apps/api/src/database/migrations/registered-migrations.ts`: add `import { CreateProviderCooldowns20260629120000 } from './20260629120000-create-provider-cooldowns';` and add it to the `registeredMigrations` array.

In `apps/api/src/database/database.module.ts`: import `ProviderCooldown` and add to the `entities` array; import `ProviderCooldownRepository` and add to the `repositories` array (which is spread into both `providers` and `exports`).

- [ ] **Step 7: Run test to verify it passes + typecheck**

Run: `npm run test --workspace=apps/api -- provider-cooldown.repository && npm run build:api`
Expected: PASS + clean build.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/ai-config/database/entities/provider-cooldown.entity.ts apps/api/src/ai-config/database/repositories/provider-cooldown.repository.ts apps/api/src/database/migrations/20260629120000-create-provider-cooldowns.ts apps/api/src/database/migrations/registered-migrations.ts apps/api/src/database/database.module.ts apps/api/src/ai-config/database/repositories/provider-cooldown.repository.spec.ts
git commit -m "feat(api): add provider_cooldowns table, repository, migration"
```

---

### Task 3: `fallback_chains` entity, repository, migration, seed, registration

**Files:**

- Create: `apps/api/src/ai-config/database/entities/fallback-chain.entity.ts`
- Create: `apps/api/src/ai-config/database/repositories/fallback-chain.repository.ts`
- Create: `apps/api/src/database/migrations/20260629120500-create-fallback-chains.ts`
- Create: `apps/api/src/database/seeds/config/fallback-chains.seed.ts`
- Modify: `registered-migrations.ts`, `database.module.ts`, `database/seeds/startup-seed.service.ts`
- Test: `apps/api/src/ai-config/database/repositories/fallback-chain.repository.spec.ts`

**Interfaces (Produces):**

```typescript
class FallbackChainRepository {
  findByName(name: string): Promise<FallbackChainEntity | null>;
  upsert(
    name: string,
    entries: FallbackChainEntry[],
  ): Promise<FallbackChainEntity>;
  findAll(): Promise<FallbackChainEntity[]>;
}
const GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME = "default";
```

- [ ] **Step 1: Write the failing test**

```typescript
// fallback-chain.repository.spec.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Repository } from "typeorm";
import { FallbackChainEntity } from "../entities/fallback-chain.entity";
import { FallbackChainRepository } from "./fallback-chain.repository";

describe("FallbackChainRepository", () => {
  let typeorm: { findOne: ReturnType<typeof vi.fn> };
  let repo: FallbackChainRepository;
  beforeEach(() => {
    typeorm = { findOne: vi.fn() };
    repo = new FallbackChainRepository(
      typeorm as unknown as Repository<FallbackChainEntity>,
    );
  });
  it("findByName queries by unique name", async () => {
    typeorm.findOne.mockResolvedValue({ name: "default", entries: [] });
    const result = await repo.findByName("default");
    expect(typeorm.findOne).toHaveBeenCalledWith({
      where: { name: "default" },
    });
    expect(result?.name).toBe("default");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- fallback-chain.repository`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the entity**

```typescript
// apps/api/src/ai-config/database/entities/fallback-chain.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import type { FallbackChainEntry } from "@nexus/core";

@Index("UQ_fallback_chains_name", ["name"], { unique: true })
@Entity("fallback_chains")
export class FallbackChainEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 128 })
  name: string;

  @Column({ type: "jsonb", default: [] })
  entries: FallbackChainEntry[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
```

- [ ] **Step 4: Write the repository**

```typescript
// apps/api/src/ai-config/database/repositories/fallback-chain.repository.ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import type { FallbackChainEntry } from "@nexus/core";
import { FallbackChainEntity } from "../entities/fallback-chain.entity";

export const GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME = "default";

@Injectable()
export class FallbackChainRepository {
  constructor(
    @InjectRepository(FallbackChainEntity)
    private readonly repository: Repository<FallbackChainEntity>,
  ) {}

  async findByName(name: string): Promise<FallbackChainEntity | null> {
    return this.repository.findOne({ where: { name } });
  }

  async findAll(): Promise<FallbackChainEntity[]> {
    return this.repository.find({ order: { name: "ASC" } });
  }

  async upsert(
    name: string,
    entries: FallbackChainEntry[],
  ): Promise<FallbackChainEntity> {
    const existing = await this.findByName(name);
    if (existing) {
      existing.entries = entries;
      return this.repository.save(existing);
    }
    return this.repository.save(this.repository.create({ name, entries }));
  }
}
```

- [ ] **Step 5: Write the migration**

```typescript
// apps/api/src/database/migrations/20260629120500-create-fallback-chains.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateFallbackChains20260629120500 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fallback_chains (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name character varying(128) NOT NULL,
        entries jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_fallback_chains_name
      ON fallback_chains(name);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS fallback_chains");
  }
}
```

- [ ] **Step 6: Write the seed** (idempotent; seeds an empty `default` chain so the row exists for the UI to edit)

```typescript
// apps/api/src/database/seeds/config/fallback-chains.seed.ts
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { FallbackChainEntity } from "../../../ai-config/database/entities/fallback-chain.entity";
import { GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME } from "../../../ai-config/database/repositories/fallback-chain.repository";

@Injectable()
export class FallbackChainSeedService {
  private readonly logger = new Logger(FallbackChainSeedService.name);

  constructor(
    @InjectRepository(FallbackChainEntity)
    private readonly repository: Repository<FallbackChainEntity>,
  ) {}

  async seed(): Promise<void> {
    const existing = await this.repository.findOne({
      where: { name: GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME },
    });
    if (existing) {
      return;
    }
    await this.repository.save(
      this.repository.create({
        name: GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME,
        entries: [],
      }),
    );
    this.logger.log("Created default fallback chain (empty)");
  }
}
```

- [ ] **Step 7: Register everything**

- `registered-migrations.ts`: import + add `CreateFallbackChains20260629120500`.
- `database.module.ts`: add `FallbackChainEntity` to `entities`; add `FallbackChainRepository` and `FallbackChainSeedService` to `repositories` (so both are provided/exported, matching how seed services are co-located there per the explored pattern).
- `database/seeds/startup-seed.service.ts`: inject `FallbackChainSeedService` in the constructor and call `await this.fallbackChainSeedService.seed();` inside `seedOnStartup()` after the LLM model seed.

- [ ] **Step 8: Run test + build**

Run: `npm run test --workspace=apps/api -- fallback-chain.repository && npm run build:api`
Expected: PASS + clean build.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/ai-config/database/entities/fallback-chain.entity.ts apps/api/src/ai-config/database/repositories/fallback-chain.repository.ts apps/api/src/database/migrations/20260629120500-create-fallback-chains.ts apps/api/src/database/seeds/config/fallback-chains.seed.ts apps/api/src/database/migrations/registered-migrations.ts apps/api/src/database/database.module.ts apps/api/src/database/seeds/startup-seed.service.ts apps/api/src/ai-config/database/repositories/fallback-chain.repository.spec.ts
git commit -m "feat(api): add fallback_chains table, repository, seed"
```

---

### Task 4: `agent_profiles.fallback_chain` column

**Files:**

- Modify: `apps/api/src/ai-config/database/entities/agent-profile.entity.ts`
- Create: `apps/api/src/database/migrations/20260629121000-add-agent-profile-fallback-chain.ts`
- Modify: `registered-migrations.ts`
- Test: `apps/api/src/ai-config/database/entities/agent-profile.entity.spec.ts` (a small type-level/shape test, or extend an existing agent-profile repo test to round-trip the column)

**Interfaces (Produces):** `AgentProfile.fallback_chain?: FallbackChainEntry[] | null`

- [ ] **Step 1: Write the failing test**

```typescript
// agent-profile.entity.spec.ts
import { describe, it, expect } from "vitest";
import { AgentProfile } from "./agent-profile.entity";
import type { FallbackChainEntry } from "@nexus/core";

describe("AgentProfile.fallback_chain", () => {
  it("accepts an ordered list of provider/model entries", () => {
    const profile = new AgentProfile();
    const chain: FallbackChainEntry[] = [
      { provider_name: "anthropic-a", model_name: "claude-opus-4-8" },
      { provider_name: "openai-b", model_name: "gpt-4" },
    ];
    profile.fallback_chain = chain;
    expect(profile.fallback_chain).toHaveLength(2);
    expect(profile.fallback_chain[0].provider_name).toBe("anthropic-a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- agent-profile.entity`
Expected: FAIL — `fallback_chain` not a property of `AgentProfile`.

- [ ] **Step 3: Add the column** — in `agent-profile.entity.ts`, after the `harness_contributions` column, add the import `import type { FallbackChainEntry } from '@nexus/core';` (extend the existing `@nexus/core` import line) and:

```typescript
@Column({ type: 'jsonb', nullable: true, default: null })
fallback_chain?: FallbackChainEntry[] | null;
```

If `IAgentProfile` in `@nexus/core` is the implemented interface, add `fallback_chain?: FallbackChainEntry[] | null;` there too so the `implements IAgentProfile` contract stays satisfied; rebuild core.

- [ ] **Step 4: Write the migration**

```typescript
// apps/api/src/database/migrations/20260629121000-add-agent-profile-fallback-chain.ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAgentProfileFallbackChain20260629121000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
      ADD COLUMN IF NOT EXISTS fallback_chain jsonb;
    `);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles DROP COLUMN IF EXISTS fallback_chain;
    `);
  }
}
```

- [ ] **Step 5: Register migration, run test, build**

Add to `registered-migrations.ts`. Then:
Run: `npm run build --workspace=packages/core && npm run test --workspace=apps/api -- agent-profile.entity && npm run build:api`
Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai-config/database/entities/agent-profile.entity.ts apps/api/src/database/migrations/20260629121000-add-agent-profile-fallback-chain.ts apps/api/src/database/migrations/registered-migrations.ts apps/api/src/ai-config/database/entities/agent-profile.entity.spec.ts packages/core/src
git commit -m "feat(api): add agent_profiles.fallback_chain column"
```

---

## Phase 2 — Resolution (read path)

### Task 5: `FallbackChainResolverService` — effective chain + viable-entry selection

This is the single source of truth used by both read and write paths.

**Files:**

- Create: `apps/api/src/ai-config/fallback/fallback-chain-resolver.service.ts`
- Create: `apps/api/src/ai-config/fallback/fallback-chain-resolver.types.ts`
- Modify: `apps/api/src/ai-config/ai-config.module.ts` (provide + export the service)
- Test: `apps/api/src/ai-config/fallback/fallback-chain-resolver.service.spec.ts`

**Interfaces (Consumes):** `FallbackChainRepository`, `ProviderCooldownRepository`, `FallbackChainEntry` (`@nexus/core`).

**Interfaces (Produces):**

```typescript
interface EffectiveChainParams {
  primary: FallbackChainEntry; // resolved primary (provider, model)
  stepInlineChain?: FallbackChainEntry[]; // steps[].inputs.fallback_chain
  profileChain?: FallbackChainEntry[] | null;
}
class FallbackChainResolverService {
  // Layered precedence: stepInline > profile > global default. Primary is always entry[0] if not already present.
  buildEffectiveChain(
    params: EffectiveChainParams,
  ): Promise<FallbackChainEntry[]>;
  // Pure: first entry whose provider is not in cooledProviders; null if none.
  selectViableEntry(
    chain: FallbackChainEntry[],
    cooledProviders: Set<string>,
  ): FallbackChainEntry | null;
  // Convenience for the read path: build chain, load cooldowns(now), select; falls back to primary if all cooled or no chain.
  resolve(params: EffectiveChainParams, now: Date): Promise<FallbackChainEntry>;
}
```

- [ ] **Step 1: Write the failing tests** (table-driven, pure logic — no DB needed for `selectViableEntry`; mock the two repos for `buildEffectiveChain`/`resolve`)

```typescript
// fallback-chain-resolver.service.spec.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FallbackChainResolverService } from "./fallback-chain-resolver.service";

const E = (provider_name: string, model_name: string) => ({
  provider_name,
  model_name,
});

describe("FallbackChainResolverService.selectViableEntry", () => {
  const svc = new FallbackChainResolverService({} as never, {} as never);
  const chain = [E("a", "m1"), E("b", "m2"), E("c", "m3")];

  it("returns the first entry when none are cooled", () => {
    expect(svc.selectViableEntry(chain, new Set())).toEqual(E("a", "m1"));
  });
  it("skips a cooled provider and returns the next viable entry", () => {
    expect(svc.selectViableEntry(chain, new Set(["a"]))).toEqual(E("b", "m2"));
  });
  it("returns null when every entry is cooled", () => {
    expect(svc.selectViableEntry(chain, new Set(["a", "b", "c"]))).toBeNull();
  });
});

describe("FallbackChainResolverService.resolve", () => {
  let chains: { findByName: ReturnType<typeof vi.fn> };
  let cooldowns: { findActiveProviderNames: ReturnType<typeof vi.fn> };
  let svc: FallbackChainResolverService;
  beforeEach(() => {
    chains = { findByName: vi.fn().mockResolvedValue(null) };
    cooldowns = {
      findActiveProviderNames: vi.fn().mockResolvedValue(new Set<string>()),
    };
    svc = new FallbackChainResolverService(chains as never, cooldowns as never);
  });

  it("returns the primary unchanged when no chain is configured", async () => {
    const out = await svc.resolve({ primary: E("a", "m1") }, new Date());
    expect(out).toEqual(E("a", "m1"));
  });

  it("prefers the profile chain over the global default and skips cooled providers", async () => {
    chains.findByName.mockResolvedValue({
      name: "default",
      entries: [E("z", "mz")],
    });
    cooldowns.findActiveProviderNames.mockResolvedValue(new Set(["a"]));
    const out = await svc.resolve(
      { primary: E("a", "m1"), profileChain: [E("a", "m1"), E("b", "m2")] },
      new Date(),
    );
    expect(out).toEqual(E("b", "m2"));
  });

  it("falls back to the primary (best-effort) when all entries are cooled", async () => {
    cooldowns.findActiveProviderNames.mockResolvedValue(new Set(["a", "b"]));
    const out = await svc.resolve(
      { primary: E("a", "m1"), profileChain: [E("a", "m1"), E("b", "m2")] },
      new Date(),
    );
    expect(out).toEqual(E("a", "m1"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- fallback-chain-resolver`
Expected: FAIL — service not found.

- [ ] **Step 3: Write the service**

```typescript
// apps/api/src/ai-config/fallback/fallback-chain-resolver.service.ts
import { Injectable } from "@nestjs/common";
import type { FallbackChainEntry } from "@nexus/core";
import {
  FallbackChainRepository,
  GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME,
} from "../database/repositories/fallback-chain.repository";
import { ProviderCooldownRepository } from "../database/repositories/provider-cooldown.repository";

export interface EffectiveChainParams {
  primary: FallbackChainEntry;
  stepInlineChain?: FallbackChainEntry[];
  profileChain?: FallbackChainEntry[] | null;
}

@Injectable()
export class FallbackChainResolverService {
  constructor(
    private readonly chains: FallbackChainRepository,
    private readonly cooldowns: ProviderCooldownRepository,
  ) {}

  async buildEffectiveChain(
    params: EffectiveChainParams,
  ): Promise<FallbackChainEntry[]> {
    const configured =
      this.nonEmpty(params.stepInlineChain) ??
      this.nonEmpty(params.profileChain) ??
      this.nonEmpty(
        (await this.chains.findByName(GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME))
          ?.entries,
      );

    if (!configured) {
      return [params.primary];
    }
    // Guarantee the primary leads the chain and entries are de-duplicated by (provider, model).
    return this.dedupe([params.primary, ...configured]);
  }

  selectViableEntry(
    chain: FallbackChainEntry[],
    cooledProviders: Set<string>,
  ): FallbackChainEntry | null {
    return (
      chain.find((entry) => !cooledProviders.has(entry.provider_name)) ?? null
    );
  }

  async resolve(
    params: EffectiveChainParams,
    now: Date,
  ): Promise<FallbackChainEntry> {
    const chain = await this.buildEffectiveChain(params);
    if (chain.length <= 1) {
      return params.primary;
    }
    const cooled = await this.cooldowns.findActiveProviderNames(now);
    return this.selectViableEntry(chain, cooled) ?? params.primary;
  }

  private nonEmpty(
    entries?: FallbackChainEntry[] | null,
  ): FallbackChainEntry[] | null {
    return entries && entries.length > 0 ? entries : null;
  }

  private dedupe(entries: FallbackChainEntry[]): FallbackChainEntry[] {
    const seen = new Set<string>();
    const out: FallbackChainEntry[] = [];
    for (const entry of entries) {
      const key = `${entry.provider_name}::${entry.model_name}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(entry);
      }
    }
    return out;
  }
}
```

- [ ] **Step 4: Provide the service** — in `ai-config.module.ts`, add `FallbackChainResolverService` (and `FallbackChainRepository`, `ProviderCooldownRepository` if not already reachable from `DatabaseModule` imports) to `providers` and `exports`.

- [ ] **Step 5: Run test + build**

Run: `npm run test --workspace=apps/api -- fallback-chain-resolver && npm run build:api`
Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai-config/fallback/ apps/api/src/ai-config/ai-config.module.ts
git commit -m "feat(api): add FallbackChainResolverService (effective chain + cooldown-aware selection)"
```

---

### Task 6: Wire resolver into `resolveStepSettings`

**Files:**

- Modify: `apps/api/src/ai-config/ai-configuration.service.ts`
- Modify: `apps/api/src/ai-config/ai-configuration.service.types.ts` (extend `resolveStepSettings` params)
- Test: extend `apps/api/src/ai-config/ai-configuration.service.spec.ts` (or create if absent)

**Interfaces (Consumes):** `FallbackChainResolverService.resolve`, `ResolvedAgentSettings`.

**Behavior:** `resolveStepSettings` accepts a new optional param `stepFallbackChain?: FallbackChainEntry[]`. After computing the primary `model` + `providerName` (current logic), it calls the resolver. If the resolver returns a different `(provider, model)` than the primary, the returned `ResolvedAgentSettings.model` and `.providerName` reflect the chosen entry, and `providerId` is cleared to `null` (the new provider resolves by name via `resolveRunnerProviderConfig`). When no chain is configured, output is byte-for-byte identical to today.

- [ ] **Step 1: Write the failing test**

```typescript
// ai-configuration.service.spec.ts (excerpt)
it("resolveStepSettings advances to the profile chain entry when the primary provider is cooled", async () => {
  // profile resolves primary => provider 'anthropic-a' / model 'opus'
  // FallbackChainResolverService.resolve mocked to return { provider_name: 'openai-b', model_name: 'gpt-4' }
  const settings = await service.resolveStepSettings({
    agentProfileName: "architect-agent",
  });
  expect(settings.providerName).toBe("openai-b");
  expect(settings.model).toBe("gpt-4");
  expect(settings.providerId).toBeNull();
});

it("resolveStepSettings is unchanged when resolver returns the primary", async () => {
  // resolver mocked to echo the primary
  const settings = await service.resolveStepSettings({
    agentProfileName: "architect-agent",
  });
  expect(settings.providerName).toBe("anthropic-a");
  expect(settings.model).toBe("opus");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- ai-configuration.service`
Expected: FAIL — resolver not invoked / param not accepted.

- [ ] **Step 3: Implement** — inject `FallbackChainResolverService` into `AiConfigurationService` constructor. In `resolveStepSettings`, after computing `model` and `providerName`:

```typescript
const primary = { provider_name: providerName ?? "", model_name: model };
const chosen = providerName
  ? await this.fallbackResolver.resolve(
      {
        primary,
        stepInlineChain: params.stepFallbackChain,
        profileChain: profile?.fallback_chain ?? null,
      },
      new Date(),
    )
  : primary;

const switched =
  chosen.provider_name !== primary.provider_name ||
  chosen.model_name !== primary.model_name;

return {
  model: chosen.model_name,
  systemPrompt,
  providerName: chosen.provider_name || undefined,
  providerId: switched ? null : profile?.provider_id,
  providerSource: switched ? null : profile?.provider_source,
};
```

Add `stepFallbackChain?: FallbackChainEntry[];` to the `resolveStepSettings` params type.

- [ ] **Step 4: Pass the step inline chain at the call site** — in `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts`, read `steps[].inputs.fallback_chain` from `resolvedJobInputs` (validate it is an array of `{provider_name, model_name}`; ignore otherwise) and pass it as `stepFallbackChain` to `resolveStepSettings`.

- [ ] **Step 5: Run test + build**

Run: `npm run test --workspace=apps/api -- ai-configuration.service && npm run build:api`
Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai-config/ai-configuration.service.ts apps/api/src/ai-config/ai-configuration.service.types.ts apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts apps/api/src/ai-config/ai-configuration.service.spec.ts
git commit -m "feat(api): resolve fallback chain in resolveStepSettings (read path)"
```

---

## Phase 3 — Cooldown duration + outage classification

### Task 7: `deriveCooldownUntil` pure helper

**Files:**

- Create: `apps/api/src/ai-config/fallback/cooldown-duration.helpers.ts`
- Test: `apps/api/src/ai-config/fallback/cooldown-duration.helpers.spec.ts`

**Interfaces (Produces):**

```typescript
function deriveCooldownUntil(params: {
  reason: ProviderCooldownReason;
  resetAt?: string | null; // ISO-8601 from the transient classifier
  now: Date;
}): Date;
```

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { deriveCooldownUntil } from "./cooldown-duration.helpers";

describe("deriveCooldownUntil", () => {
  const now = new Date("2026-06-29T00:00:00.000Z");
  it("honors a valid future resetAt", () => {
    const out = deriveCooldownUntil({
      reason: "usage_exhausted",
      resetAt: "2026-06-29T01:00:00.000Z",
      now,
    });
    expect(out.toISOString()).toBe("2026-06-29T01:00:00.000Z");
  });
  it("falls back to the per-reason default when resetAt is absent", () => {
    const out = deriveCooldownUntil({ reason: "provider_outage", now });
    expect(out.toISOString()).toBe("2026-06-29T00:02:00.000Z"); // 2 min
  });
  it("ignores a past resetAt and uses the default", () => {
    const out = deriveCooldownUntil({
      reason: "usage_exhausted",
      resetAt: "2020-01-01T00:00:00.000Z",
      now,
    });
    expect(out.toISOString()).toBe("2026-06-29T00:30:00.000Z"); // 30 min
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- cooldown-duration`
Expected: FAIL — helper not found.

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/ai-config/fallback/cooldown-duration.helpers.ts
import {
  FALLBACK_COOLDOWN_DEFAULT_MS,
  type ProviderCooldownReason,
} from "@nexus/core";

export function deriveCooldownUntil(params: {
  reason: ProviderCooldownReason;
  resetAt?: string | null;
  now: Date;
}): Date {
  if (params.resetAt) {
    const reset = new Date(params.resetAt);
    if (
      !Number.isNaN(reset.getTime()) &&
      reset.getTime() > params.now.getTime()
    ) {
      return reset;
    }
  }
  return new Date(
    params.now.getTime() + FALLBACK_COOLDOWN_DEFAULT_MS[params.reason],
  );
}
```

- [ ] **Step 4: Run test + build**

Run: `npm run test --workspace=apps/api -- cooldown-duration && npm run build:api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai-config/fallback/cooldown-duration.helpers.ts apps/api/src/ai-config/fallback/cooldown-duration.helpers.spec.ts
git commit -m "feat(api): add deriveCooldownUntil helper"
```

---

### Task 8: Provider-outage classifier (5xx)

The existing `classifyProviderTransientFailure` already covers 429 (not a fallback trigger) and 529 overload. Add a dedicated outage classifier for 500/502/503 so the write path can treat outages as a fallback trigger without disturbing the existing transient/429 retry-same behavior.

**Files:**

- Create: `apps/api/src/llm/provider-outage-failure.helpers.ts`
- Create: `apps/api/src/llm/provider-outage-failure.types.ts`
- Test: `apps/api/src/llm/provider-outage-failure.helpers.spec.ts`

**Interfaces (Produces):**

```typescript
function classifyProviderOutageFailure(
  message: string,
): { isOutage: true } | null;
```

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { classifyProviderOutageFailure } from "./provider-outage-failure.helpers";

describe("classifyProviderOutageFailure", () => {
  it.each([
    "HTTP 500 internal server error",
    "502 Bad Gateway",
    "status 503 Service Unavailable",
    "Error 529 overloaded",
  ])("flags %s as an outage", (msg) => {
    expect(classifyProviderOutageFailure(msg)).toEqual({ isOutage: true });
  });
  it("returns null for a 429 rate limit", () => {
    expect(
      classifyProviderOutageFailure("HTTP 429 rate limit reached"),
    ).toBeNull();
  });
  it("returns null for unrelated text", () => {
    expect(classifyProviderOutageFailure("out of extra usage")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- provider-outage-failure`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/llm/provider-outage-failure.types.ts
export interface ProviderOutageClassification {
  isOutage: true;
}
```

```typescript
// apps/api/src/llm/provider-outage-failure.helpers.ts
import type { ProviderOutageClassification } from "./provider-outage-failure.types";

const OUTAGE_PATTERN =
  /\b(50[023]|529)\b|bad gateway|service unavailable|internal server error|overload/i;
const RATE_LIMIT_PATTERN = /\b429\b|rate limit|too many requests/i;

export function classifyProviderOutageFailure(
  message: string,
): ProviderOutageClassification | null {
  if (RATE_LIMIT_PATTERN.test(message)) {
    return null;
  }
  return OUTAGE_PATTERN.test(message) ? { isOutage: true } : null;
}
```

- [ ] **Step 4: Run test + build; Step 5: Commit**

```bash
git add apps/api/src/llm/provider-outage-failure.helpers.ts apps/api/src/llm/provider-outage-failure.types.ts apps/api/src/llm/provider-outage-failure.helpers.spec.ts
git commit -m "feat(api): add provider outage (5xx) classifier"
```

---

## Phase 4 — Advance (write path)

### Task 9: `ProviderFallbackService` — map failure → reason, record cooldown, decide requeue

**Files:**

- Create: `apps/api/src/ai-config/fallback/provider-fallback.service.ts`
- Modify: `apps/api/src/ai-config/ai-config.module.ts` (provide + export)
- Test: `apps/api/src/ai-config/fallback/provider-fallback.service.spec.ts`

**Interfaces (Consumes):** `classifyProviderTerminalFailure`, `classifyProviderTransientFailure`, `classifyProviderOutageFailure`, `deriveCooldownUntil`, `FallbackChainResolverService`, `ProviderCooldownRepository`.

**Interfaces (Produces):**

```typescript
type FallbackTrigger = {
  reason: ProviderCooldownReason;
  resetAt?: string | null;
} | null;
class ProviderFallbackService {
  // Maps a raw provider error message to a cooldown reason, or null if not a fallback trigger (e.g. plain 429).
  classifyTrigger(message: string): FallbackTrigger;
  // Records the cooldown for the failing provider and returns whether a viable next entry exists.
  // Returns true => caller should requeue; false => caller proceeds with terminal failure.
  handleFailure(params: {
    message: string;
    failingProvider: string;
    primary: FallbackChainEntry;
    stepInlineChain?: FallbackChainEntry[];
    profileChain?: FallbackChainEntry[] | null;
    runId?: string | null;
    now: Date;
  }): Promise<
    | { shouldRequeue: boolean; reason: ProviderCooldownReason }
    | { shouldRequeue: false; reason: null }
  >;
}
```

**Trigger mapping rules:**

- `classifyProviderTerminalFailure` → `provider_usage_exhausted`⇒`usage_exhausted`, `provider_billing_exhausted`⇒`billing_exhausted`, `provider_auth_failed`⇒`auth_failed`.
- else `classifyProviderOutageFailure` truthy ⇒ `provider_outage` (carry `resetAt` from the transient classifier if it also matched 529).
- else (incl. plain 429) ⇒ `null` (not a fallback trigger).

- [ ] **Step 1: Write the failing tests**

```typescript
// provider-fallback.service.spec.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderFallbackService } from "./provider-fallback.service";

const E = (p: string, m: string) => ({ provider_name: p, model_name: m });

describe("ProviderFallbackService.classifyTrigger", () => {
  const svc = new ProviderFallbackService({} as never, {} as never);
  it('maps "out of extra usage" to usage_exhausted', () => {
    expect(svc.classifyTrigger("out of extra usage")?.reason).toBe(
      "usage_exhausted",
    );
  });
  it("maps a 503 to provider_outage", () => {
    expect(svc.classifyTrigger("HTTP 503 service unavailable")?.reason).toBe(
      "provider_outage",
    );
  });
  it("returns null for a plain 429 rate limit", () => {
    expect(svc.classifyTrigger("HTTP 429 rate limit reached")).toBeNull();
  });
});

describe("ProviderFallbackService.handleFailure", () => {
  let cooldowns: {
    upsertCooldown: ReturnType<typeof vi.fn>;
    findActiveProviderNames: ReturnType<typeof vi.fn>;
  };
  let resolver: {
    buildEffectiveChain: ReturnType<typeof vi.fn>;
    selectViableEntry: ReturnType<typeof vi.fn>;
  };
  let svc: ProviderFallbackService;
  const now = new Date("2026-06-29T00:00:00Z");

  beforeEach(() => {
    cooldowns = {
      upsertCooldown: vi.fn().mockResolvedValue(undefined),
      findActiveProviderNames: vi.fn(),
    };
    resolver = { buildEffectiveChain: vi.fn(), selectViableEntry: vi.fn() };
    svc = new ProviderFallbackService(resolver as never, cooldowns as never);
  });

  it("records a cooldown and requeues when a viable next entry remains", async () => {
    resolver.buildEffectiveChain.mockResolvedValue([
      E("a", "m1"),
      E("b", "m2"),
    ]);
    cooldowns.findActiveProviderNames.mockResolvedValue(new Set(["a"]));
    resolver.selectViableEntry.mockReturnValue(E("b", "m2"));
    const out = await svc.handleFailure({
      message: "out of extra usage",
      failingProvider: "a",
      primary: E("a", "m1"),
      now,
    });
    expect(cooldowns.upsertCooldown).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_name: "a",
        reason: "usage_exhausted",
      }),
    );
    expect(out).toEqual({ shouldRequeue: true, reason: "usage_exhausted" });
  });

  it("records a cooldown but does NOT requeue when every entry is now cooled", async () => {
    resolver.buildEffectiveChain.mockResolvedValue([
      E("a", "m1"),
      E("b", "m2"),
    ]);
    cooldowns.findActiveProviderNames.mockResolvedValue(new Set(["a", "b"]));
    resolver.selectViableEntry.mockReturnValue(null);
    const out = await svc.handleFailure({
      message: "out of extra usage",
      failingProvider: "a",
      primary: E("a", "m1"),
      profileChain: [E("a", "m1"), E("b", "m2")],
      now,
    });
    expect(cooldowns.upsertCooldown).toHaveBeenCalled();
    expect(out.shouldRequeue).toBe(false);
  });

  it("does nothing and does not requeue for a non-trigger failure (plain 429)", async () => {
    const out = await svc.handleFailure({
      message: "HTTP 429 rate limit reached",
      failingProvider: "a",
      primary: E("a", "m1"),
      now,
    });
    expect(cooldowns.upsertCooldown).not.toHaveBeenCalled();
    expect(out).toEqual({ shouldRequeue: false, reason: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- provider-fallback.service`
Expected: FAIL.

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/ai-config/fallback/provider-fallback.service.ts
import { Injectable } from "@nestjs/common";
import type { FallbackChainEntry, ProviderCooldownReason } from "@nexus/core";
import { classifyProviderTerminalFailure } from "../../llm/provider-terminal-failure.helpers";
import { classifyProviderTransientFailure } from "../../llm/provider-transient-failure.helpers";
import { classifyProviderOutageFailure } from "../../llm/provider-outage-failure.helpers";
import { deriveCooldownUntil } from "./cooldown-duration.helpers";
import { FallbackChainResolverService } from "./fallback-chain-resolver.service";
import { ProviderCooldownRepository } from "../database/repositories/provider-cooldown.repository";

const TERMINAL_REASON_MAP: Record<string, ProviderCooldownReason> = {
  provider_usage_exhausted: "usage_exhausted",
  provider_billing_exhausted: "billing_exhausted",
  provider_auth_failed: "auth_failed",
};

export interface FallbackTrigger {
  reason: ProviderCooldownReason;
  resetAt?: string | null;
}

@Injectable()
export class ProviderFallbackService {
  constructor(
    private readonly resolver: FallbackChainResolverService,
    private readonly cooldowns: ProviderCooldownRepository,
  ) {}

  classifyTrigger(message: string): FallbackTrigger | null {
    const terminal = classifyProviderTerminalFailure(message);
    if (terminal) {
      return { reason: TERMINAL_REASON_MAP[terminal.reasonCode] };
    }
    if (classifyProviderOutageFailure(message)) {
      const transient = classifyProviderTransientFailure({
        message,
        resetBufferMs: 0,
      });
      return { reason: "provider_outage", resetAt: transient.resetAt ?? null };
    }
    return null;
  }

  async handleFailure(params: {
    message: string;
    failingProvider: string;
    primary: FallbackChainEntry;
    stepInlineChain?: FallbackChainEntry[];
    profileChain?: FallbackChainEntry[] | null;
    runId?: string | null;
    now: Date;
  }): Promise<
    | { shouldRequeue: boolean; reason: ProviderCooldownReason }
    | { shouldRequeue: false; reason: null }
  > {
    const trigger = this.classifyTrigger(params.message);
    if (!trigger) {
      return { shouldRequeue: false, reason: null };
    }

    await this.cooldowns.upsertCooldown({
      provider_name: params.failingProvider,
      reason: trigger.reason,
      cooled_until: deriveCooldownUntil({
        reason: trigger.reason,
        resetAt: trigger.resetAt,
        now: params.now,
      }),
      last_failure_at: params.now,
      source_run_id: params.runId ?? null,
    });

    const chain = await this.resolver.buildEffectiveChain({
      primary: params.primary,
      stepInlineChain: params.stepInlineChain,
      profileChain: params.profileChain,
    });
    const cooled = await this.cooldowns.findActiveProviderNames(params.now);
    const viable = this.resolver.selectViableEntry(chain, cooled);

    return { shouldRequeue: viable !== null, reason: trigger.reason };
  }
}
```

- [ ] **Step 4: Provide service in `ai-config.module.ts`. Run test + build.**

Run: `npm run test --workspace=apps/api -- provider-fallback.service && npm run build:api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai-config/fallback/provider-fallback.service.ts apps/api/src/ai-config/fallback/provider-fallback.service.spec.ts apps/api/src/ai-config/ai-config.module.ts
git commit -m "feat(api): add ProviderFallbackService (cooldown record + requeue decision)"
```

---

### Task 10: Wire the write path into the agent-step terminal-failure seam

The deterministic interception: when an agent step fails with a provider fallback-trigger AND a viable fallback exists, record the cooldown (done in `handleFailure`) and requeue the failed job via `WorkflowFailedJobRetryService.retryFailedJobWithMessage` instead of finalizing the failure. Gated by the `fallback_chains.enabled` setting.

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.ts` (the terminal-failure handling around lines 346–375, per exploration)
- Modify: the owning module (`WorkflowStepExecutionModule`) to inject `ProviderFallbackService`, `WorkflowFailedJobRetryService`, and the settings service
- Test: `apps/api/src/workflow/workflow-step-execution/step-agent-fallback-advance.spec.ts` (unit test of the extracted decision helper — keep the seam thin by extracting a pure helper)

**Design to keep the seam testable:** extract a small async function `maybeAdvanceFallback(...)` that takes the failure message, the resolved primary `(provider, model)`, the profile/step chains, run+job ids, the enabled flag, and the two collaborators (`ProviderFallbackService`, a `requeue` callback). It returns `true` if it requeued (caller then returns without finalizing failure) or `false` (caller proceeds with existing terminal-failure path). Unit-test the helper; the seam just calls it.

**Interfaces (Produces):**

```typescript
async function maybeAdvanceFallback(params: {
  enabled: boolean;
  message: string;
  primary: FallbackChainEntry;
  profileChain?: FallbackChainEntry[] | null;
  stepInlineChain?: FallbackChainEntry[];
  runId: string;
  failedJobId: string;
  now: Date;
  fallback: ProviderFallbackService;
  requeue: (args: {
    runId: string;
    failedJobId: string;
    retryPrompt: string;
  }) => Promise<unknown>;
}): Promise<boolean>;
```

- [ ] **Step 1: Write the failing test**

```typescript
// step-agent-fallback-advance.spec.ts
import { describe, it, expect, vi } from "vitest";
import { maybeAdvanceFallback } from "./step-agent-fallback-advance";

const E = (p: string, m: string) => ({ provider_name: p, model_name: m });
const base = {
  message: "out of extra usage",
  primary: E("a", "m1"),
  runId: "run-1",
  failedJobId: "job-1",
  now: new Date("2026-06-29T00:00:00Z"),
};

it("requeues and returns true when fallback handler says shouldRequeue", async () => {
  const fallback = {
    handleFailure: vi
      .fn()
      .mockResolvedValue({ shouldRequeue: true, reason: "usage_exhausted" }),
  };
  const requeue = vi.fn().mockResolvedValue(undefined);
  const result = await maybeAdvanceFallback({
    ...base,
    enabled: true,
    fallback: fallback as never,
    requeue,
  });
  expect(requeue).toHaveBeenCalledWith(
    expect.objectContaining({ runId: "run-1", failedJobId: "job-1" }),
  );
  expect(result).toBe(true);
});

it("returns false without requeue when disabled", async () => {
  const fallback = { handleFailure: vi.fn() };
  const requeue = vi.fn();
  const result = await maybeAdvanceFallback({
    ...base,
    enabled: false,
    fallback: fallback as never,
    requeue,
  });
  expect(fallback.handleFailure).not.toHaveBeenCalled();
  expect(requeue).not.toHaveBeenCalled();
  expect(result).toBe(false);
});

it("returns false without requeue when no viable fallback remains", async () => {
  const fallback = {
    handleFailure: vi
      .fn()
      .mockResolvedValue({ shouldRequeue: false, reason: "usage_exhausted" }),
  };
  const requeue = vi.fn();
  const result = await maybeAdvanceFallback({
    ...base,
    enabled: true,
    fallback: fallback as never,
    requeue,
  });
  expect(requeue).not.toHaveBeenCalled();
  expect(result).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- step-agent-fallback-advance`
Expected: FAIL — helper not found.

- [ ] **Step 3: Implement the helper**

```typescript
// apps/api/src/workflow/workflow-step-execution/step-agent-fallback-advance.ts
import type { FallbackChainEntry } from "@nexus/core";
import type { ProviderFallbackService } from "../../ai-config/fallback/provider-fallback.service";

export async function maybeAdvanceFallback(params: {
  enabled: boolean;
  message: string;
  primary: FallbackChainEntry;
  profileChain?: FallbackChainEntry[] | null;
  stepInlineChain?: FallbackChainEntry[];
  runId: string;
  failedJobId: string;
  now: Date;
  fallback: ProviderFallbackService;
  requeue: (args: {
    runId: string;
    failedJobId: string;
    retryPrompt: string;
  }) => Promise<unknown>;
}): Promise<boolean> {
  if (!params.enabled) {
    return false;
  }
  const decision = await params.fallback.handleFailure({
    message: params.message,
    failingProvider: params.primary.provider_name,
    primary: params.primary,
    stepInlineChain: params.stepInlineChain,
    profileChain: params.profileChain,
    runId: params.runId,
    now: params.now,
  });
  if (!decision.shouldRequeue) {
    return false;
  }
  await params.requeue({
    runId: params.runId,
    failedJobId: params.failedJobId,
    retryPrompt: `The previous provider was unavailable (${decision.reason}); retrying this job on the next configured fallback model.`,
  });
  return true;
}
```

- [ ] **Step 4: Wire the seam** — in `step-agent-step-executor.multistep.ts`, where a terminal provider failure is currently finalized, call `maybeAdvanceFallback` first. Supply:
  - `enabled` from the settings service (`fallback_chains.enabled`, default `true`),
  - `primary` = the `(providerName, model)` that this step actually ran with (already resolved in the executor),
  - `profileChain` = the resolved agent profile's `fallback_chain`,
  - `stepInlineChain` = the validated `steps[].inputs.fallback_chain`,
  - `runId` / `failedJobId` from the execution context,
  - `now: new Date()`,
  - `fallback` = injected `ProviderFallbackService`,
  - `requeue` = a thunk calling `this.failedJobRetry.retryFailedJobWithMessage({ workflowRunId, failedJobId, retryPrompt })`.
    If it returns `true`, return early (do not finalize the failure). If `false`, proceed with the existing terminal-failure handling unchanged.

  Register `ProviderFallbackService` and `WorkflowFailedJobRetryService` in `WorkflowStepExecutionModule` imports/providers (import `AiConfigModule` and the module that exports `WorkflowFailedJobRetryService`).

- [ ] **Step 5: Run test + build + run the broader executor suite**

Run: `npm run test --workspace=apps/api -- step-agent && npm run build:api`
Expected: PASS (existing executor tests still green).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/step-agent-fallback-advance.ts apps/api/src/workflow/workflow-step-execution/step-agent-fallback-advance.spec.ts apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.multistep.ts apps/api/src/workflow/workflow-step-execution/workflow-step-execution.module.ts
git commit -m "feat(api): advance fallback chain on provider failure (write path)"
```

---

## Phase 5 — API surface

### Task 11: Controller endpoints for chains + cooldown status

**Files:**

- Modify (or create): the AI-config controller (`apps/api/src/ai-config/ai-config.controller.ts` — follow the existing controller in this module for agent-profile endpoints) + a service method layer
- Create: DTOs `apps/api/src/ai-config/dto/fallback-chain.dto.ts` (Zod schemas per `nestjs-module-conventions`)
- Test: `apps/api/src/ai-config/fallback/fallback-chain.controller.spec.ts`

**Endpoints (Produces):**

- `GET  /ai-config/fallback-chains/global` → `FallbackChain` (the `default` row)
- `PUT  /ai-config/fallback-chains/global` body `{ entries: FallbackChainEntry[] }` → `FallbackChain`
- `GET  /ai-config/provider-cooldowns` → `ProviderCooldownStatus[]` (active only)
- (Per-profile chain is edited through the existing agent-profile update endpoint by including `fallback_chain` in its DTO — extend that DTO to accept the optional array.)

**Validation:** each entry `{ provider_name: string (non-empty), model_name: string (non-empty) }`; reject unknown providers/models with a 400 (look them up via `LlmProviderRepository.findByName` / `LlmModelRepository.findByName`).

- [ ] **Step 1: Write the failing test** (controller unit test with mocked services — assert GET returns mapped status, PUT validates entries and calls `FallbackChainRepository.upsert('default', entries)`).

```typescript
// fallback-chain.controller.spec.ts (shape)
it("GET /ai-config/provider-cooldowns maps active cooldowns to status DTOs", async () => {
  cooldowns.findActive.mockResolvedValue([
    {
      provider_name: "a",
      reason: "usage_exhausted",
      cooled_until: new Date("2026-06-29T01:00:00Z"),
      last_failure_at: new Date("2026-06-29T00:00:00Z"),
      source_run_id: "run-1",
    },
  ]);
  const out = await controller.getProviderCooldowns();
  expect(out[0]).toEqual(
    expect.objectContaining({ provider_name: "a", reason: "usage_exhausted" }),
  );
});

it("PUT /ai-config/fallback-chains/global rejects an entry with an unknown provider", async () => {
  providers.findByName.mockResolvedValue(null);
  await expect(
    controller.putGlobalChain({
      entries: [{ provider_name: "nope", model_name: "m" }],
    }),
  ).rejects.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails; Step 3: implement controller + DTO + service methods; Step 4: run test + build; Step 5: commit.**

Run (Step 4): `npm run test --workspace=apps/api -- fallback-chain.controller && npm run build:api`

```bash
git add apps/api/src/ai-config/ai-config.controller.ts apps/api/src/ai-config/dto/fallback-chain.dto.ts apps/api/src/ai-config/fallback/fallback-chain.controller.spec.ts
git commit -m "feat(api): fallback chain + provider cooldown endpoints"
```

---

## Phase 6 — Web UI

### Task 12: Web API client, query keys, hooks

**Files:**

- Modify: `apps/web/src/lib/queryKeys.ts`
- Modify: `apps/web/src/lib/api/client.admin.ts`
- Create: `apps/web/src/hooks/useFallbackChains.ts`
- Create: `apps/web/src/hooks/useProviderCooldownStatus.ts`
- Test: `apps/web/src/hooks/useFallbackChains.test.tsx`

**Interfaces (Consumes):** `FallbackChain`, `FallbackChainEntry`, `ProviderCooldownStatus` from `@nexus/core`.

- [ ] **Step 1:** add to `queryKeys.ts`:

```typescript
fallbackChains: {
  global: () => ["fallback-chains", "global"] as const,
},
providerCooldownStatus: () => ["provider-cooldown-status"] as const,
```

- [ ] **Step 2:** add client methods in `client.admin.ts`:

```typescript
async getGlobalFallbackChain(this: ApiClient): Promise<FallbackChain> {
  return this.get<FallbackChain>("/ai-config/fallback-chains/global");
}
async setGlobalFallbackChain(this: ApiClient, entries: FallbackChainEntry[]): Promise<FallbackChain> {
  return this.put<FallbackChain>("/ai-config/fallback-chains/global", { entries });
}
async getProviderCooldowns(this: ApiClient): Promise<ProviderCooldownStatus[]> {
  return this.get<ProviderCooldownStatus[]>("/ai-config/provider-cooldowns");
}
```

- [ ] **Step 3: Write a failing hook test** (render `useGlobalFallbackChain` with a QueryClient wrapper + mocked `api`, assert it queries the `fallbackChains.global` key and returns data). Follow the existing web hook test pattern.

- [ ] **Step 4: Implement hooks**

```typescript
// apps/web/src/hooks/useFallbackChains.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FallbackChain, FallbackChainEntry } from "@nexus/core";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

export function useGlobalFallbackChain() {
  return useQuery<FallbackChain>({
    queryKey: queryKeys.fallbackChains.global(),
    queryFn: () => api.getGlobalFallbackChain(),
  });
}

export function useSetGlobalFallbackChain() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entries: FallbackChainEntry[]) =>
      api.setGlobalFallbackChain(entries),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.fallbackChains.global(),
      }),
  });
}
```

```typescript
// apps/web/src/hooks/useProviderCooldownStatus.ts
import { useQuery } from "@tanstack/react-query";
import type { ProviderCooldownStatus } from "@nexus/core";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";

export function useProviderCooldownStatus() {
  return useQuery<ProviderCooldownStatus[]>({
    queryKey: queryKeys.providerCooldownStatus(),
    queryFn: () => api.getProviderCooldowns(),
    refetchInterval: 30_000,
  });
}
```

- [ ] **Step 5: Run test + build web**

Run: `npm run test:unit:web -- useFallbackChains && npm run build:web`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/queryKeys.ts apps/web/src/lib/api/client.admin.ts apps/web/src/hooks/useFallbackChains.ts apps/web/src/hooks/useProviderCooldownStatus.ts apps/web/src/hooks/useFallbackChains.test.tsx
git commit -m "feat(web): fallback chain + cooldown hooks and api client"
```

---

### Task 13: `FallbackChainEditor` component (ordered list of provider/model rows)

**Files:**

- Create: `apps/web/src/components/fallback/FallbackChainEditor.tsx`
- Test: `apps/web/src/components/fallback/FallbackChainEditor.test.tsx`

**Props (Produces):**

```typescript
interface FallbackChainEditorProps {
  value: FallbackChainEntry[];
  onChange: (next: FallbackChainEntry[]) => void;
  providers: { name: string }[]; // from existing providers hook
  models: { name: string; provider_name?: string | null }[]; // from existing models hook
}
```

**Behavior:** renders each entry as a row with a provider `<select>` + model `<select>` + remove button, an "Add fallback" button appends an empty row, and up/down buttons reorder (array splice — no drag-drop dependency needed for v1). Mirrors the `useFieldArray`/`RefList` add-remove patterns already in the codebase but driven by `value`/`onChange` so it composes into both the global form and the agent-profile form.

- [ ] **Step 1: Write failing tests** (render with two entries; click "Add fallback" → `onChange` called with 3 entries; click remove on row 0 → `onChange` called with row 0 dropped; click "move down" on row 0 → order swapped).

```typescript
// FallbackChainEditor.test.tsx (shape)
import { render, screen, fireEvent } from "@testing-library/react";
import { FallbackChainEditor } from "./FallbackChainEditor";

const providers = [{ name: "a" }, { name: "b" }];
const models = [{ name: "m1" }, { name: "m2" }];

it("appends an empty row on Add fallback", () => {
  const onChange = vi.fn();
  render(<FallbackChainEditor value={[{ provider_name: "a", model_name: "m1" }]} onChange={onChange} providers={providers} models={models} />);
  fireEvent.click(screen.getByRole("button", { name: /add fallback/i }));
  expect(onChange).toHaveBeenCalledWith([
    { provider_name: "a", model_name: "m1" },
    { provider_name: "", model_name: "" },
  ]);
});
```

- [ ] **Step 2: Run test red; Step 3: implement the component (controlled, provider/model `<select>`s sourced from props, add/remove/reorder via array ops calling `onChange`); Step 4: run test green + `npm run build:web`; Step 5: commit.**

```bash
git add apps/web/src/components/fallback/FallbackChainEditor.tsx apps/web/src/components/fallback/FallbackChainEditor.test.tsx
git commit -m "feat(web): FallbackChainEditor component"
```

---

### Task 14: `ProviderCooldownPanel` + Settings tab + agent-profile integration

**Files:**

- Create: `apps/web/src/components/fallback/ProviderCooldownPanel.tsx`
- Modify: `apps/web/src/pages/Settings.tsx` (new "Fallback" tab hosting the global `FallbackChainEditor` wired to `useGlobalFallbackChain`/`useSetGlobalFallbackChain`, plus `ProviderCooldownPanel`)
- Modify: `apps/web/src/pages/agents/AgentProfileForm.tsx` (add a "Fallback chain" section using `FallbackChainEditor` bound to the form's `fallback_chain` field; extend the Zod schema with `fallback_chain: z.array(z.object({ provider_name: z.string(), model_name: z.string() })).default([])` and include it in submit payload)
- Test: `apps/web/src/components/fallback/ProviderCooldownPanel.test.tsx`

**Behavior:** `ProviderCooldownPanel` reads `useProviderCooldownStatus()` and renders a table/badge list of `provider_name`, `reason`, and a humanized "cooled until" time; shows an empty state when none are active.

- [ ] **Step 1: Write failing test** (mock `useProviderCooldownStatus` to return one active cooldown → assert provider name + reason render; mock empty → assert empty-state text).

- [ ] **Step 2: red; Step 3: implement panel + Settings tab + AgentProfileForm section; Step 4:** run web unit tests + e2e smoke if present + build:

Run: `npm run test:unit:web -- fallback && npm run build:web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/fallback/ProviderCooldownPanel.tsx apps/web/src/components/fallback/ProviderCooldownPanel.test.tsx apps/web/src/pages/Settings.tsx apps/web/src/pages/agents/AgentProfileForm.tsx
git commit -m "feat(web): cooldown panel, Settings fallback tab, per-profile chain editor"
```

---

## Phase 7 — Documentation

### Task 15: Docs + ADR + precedence note

**Files:**

- Modify: `CLAUDE.md` (under "AI config precedence" / "Thinking/effort level precedence", add a "Fallback chain resolution" bullet describing layered chains + per-provider cooldown)
- Modify: `docs/guide/README.md` (or the AI-config sub-doc) — operator guide for defining chains + reading cooldown status
- Create: `docs/architecture/decisions/ADR-fallback-models-providers.md` (context, decision, consequences — summarize the spec's key decisions table)

- [ ] **Step 1: Write the docs** reflecting the implemented behavior (chain entry shape, triggers, 429-stays-retry-same, cooldown auto-recovery, `fallback_chains.enabled` flag, where to configure in the UI).

- [ ] **Step 2: Verify links/build** — run the docs/markdown lint if the repo has one (`npm run lint` covers web/api; docs are markdown only). Confirm no broken relative links.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/guide/README.md docs/architecture/decisions/ADR-fallback-models-providers.md
git commit -m "docs: fallback models/providers operator guide + ADR"
```

---

## Final Verification

- [ ] `npm run build --workspace=packages/core && npm run build:api && npm run build:web` — all clean.
- [ ] `npm run test:api` — green. **Caveat (from project memory):** `test:api` includes integration specs that TRUNCATE the dev DB on `localhost:5433`; run against a disposable DB or accept the documented data loss. Prefer targeted `npm run test --workspace=apps/api -- <file>` during iteration.
- [ ] `npm run test:unit:web` — green.
- [ ] `npm run lint:summary` — no new findings.
- [ ] Manual smoke (optional, live stack): configure a 2-entry global chain with a deliberately-exhausted first provider; launch a workflow; confirm the run records a `provider_cooldowns` row and completes on the second entry; confirm the cooldown appears in the Settings panel and clears after `cooled_until`.

## Self-Review notes (author)

- **Spec coverage:** chain entry shape (Task 1/3/4), layered precedence step>profile>global (Task 5/6), triggers usage/billing/auth/outage + 429-excluded (Task 8/9), retry-layer fresh-attempt switch (Task 10), per-provider system-global cooldown with auto-recovery (Task 2/5/7), only-jobs-with-a-chain reach (Task 5 `resolve` returns primary when chain length ≤ 1), DB+seed+web-UI surface (Tasks 2–4, 3 seed, 11–14), loop termination via cooldown (Task 9 "all cooled ⇒ no requeue" test). All spec sections map to a task.
- **Retry-budget concern (spec §3.4):** resolved by the cooldown-driven natural termination — each advance cools one provider; when `selectViableEntry` returns null the write path stops requeuing, so advances are inherently bounded by chain length without a numeric counter. The deterministic seam bypasses the repair-delegation `maxAttempts=1` path intentionally.
- **Open item for executor:** confirm the exact terminal-failure finalization line in `step-agent-step-executor.multistep.ts` to place the `maybeAdvanceFallback` call, and confirm `WorkflowFailedJobRetryService` is exportable to `WorkflowStepExecutionModule` without a circular import (if circular, inject via a thin interface token per `nestjs-interface-extraction`).
