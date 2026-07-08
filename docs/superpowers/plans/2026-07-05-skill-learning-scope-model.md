# Skill/Learning Scope Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give skill proposals from the self-improvement/retrospective pipeline real project (and project+agent) scoping instead of landing global by default, while guaranteeing the pipeline can never grant itself scope wider than the run it actually executed under.

**Architecture:** A new additive, reseed-safe runtime table (`agent_profile_skill_bindings`, mirroring the existing `workflow_skill_bindings` pattern) records project-tier and project+agent-tier skill assignments, keyed on the existing `scope_nodes` tenancy tree. The retrospective pipeline's already-captured `provenance.scope_id` is applied unconditionally as the _origin_ scope (a fact, not a guess); the LLM's separate `recommended_scope` (a judgment call that may propose something broader) stays gated behind a widening-confirmation check that requires a real `skills:update` permission grant at the target scope node, reusing the existing `AuthorizationService`/`scope_node_closure` machinery — no new authorization concept.

**Tech Stack:** NestJS, TypeORM (Postgres), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-skill-learning-scope-model-design.md` — read it before starting; this plan implements it task-by-task.
- No lint suppressions (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`) — see `.github/instructions/lint-warning-policy.instructions.md`.
- `apps/api/src` and `packages/core/src` must stay Kanban-neutral — this feature never introduces Kanban-specific identifiers.
- Controllers handle transport only; services own domain logic; repositories own persistence (`.github/instructions/api-quality-gate.instructions.md`).
- Tests use Vitest with plain constructor injection and hand-rolled mocks (`vi.fn()`), not a NestJS `TestingModule`, for unit-level specs — follow the existing convention in `workflow-skill-binding.service.spec.ts` and `workflow-stage-skill-policy.service.spec.ts`.
- `nest build` (not `tsc`) is required for the API — TypeORM decorator metadata depends on it.
- Run `npm run test --workspace=apps/api -- <path>` to target a single spec file while iterating.

---

### Task 1: `agent_profile_skill_bindings` migration, entity, and repository

**Files:**

- Create: `apps/api/src/database/migrations/20260714040000-create-agent-profile-skill-bindings.ts`
- Create: `apps/api/src/ai-config/database/entities/agent-profile-skill-binding.entity.ts`
- Create: `apps/api/src/ai-config/database/repositories/agent-profile-skill-binding.repository.ts`
- Create: `apps/api/src/ai-config/database/repositories/agent-profile-skill-binding.repository.types.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts`
- Modify: `apps/api/src/database/database.module.ts`

**Interfaces:**

- Produces: `AgentProfileSkillBinding` entity (`id`, `agent_profile_id: string | null`, `scope_node_id: string`, `skill_name: string`, `provenance: Record<string, unknown> | null`, `created_at`, `updated_at`); `AgentProfileSkillBindingRepository` with `upsert(input: InsertAgentProfileSkillBindingInput): Promise<AgentProfileSkillBinding>` and `listForScopeNodeIds(scopeNodeIds: string[]): Promise<AgentProfileSkillBinding[]>`. Task 2 consumes both.

This mirrors `workflow_skill_bindings`/`WorkflowSkillBindingRepository` exactly (read `apps/api/src/workflow/workflow-skill-bindings/workflow-skill-binding.repository.ts` and its migration `apps/api/src/database/migrations/20260714000000-create-workflow-skill-bindings.ts` for the precedent this follows). Per project convention, thin TypeORM repository wrappers are not independently unit-tested here (see `workflow-skill-binding.repository.ts`, which has no `.spec.ts` sibling) — this repository is exercised indirectly through Task 2's service spec via a hand-rolled mock, so this task's own "test" is a compile-and-boot check.

- [ ] **Step 1: Write the migration**

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Create `agent_profile_skill_bindings`: runtime skill -> (scope_node |
 * scope_node + agent_profile) assignment, recorded separately from
 * `agent_profiles.assigned_skills` so it can never be clobbered by a profile
 * reseed. Mirrors `workflow_skill_bindings`'s COALESCE-expression-index
 * technique: `agent_profile_id IS NULL` means "any profile within this scope
 * node", and a plain UNIQUE constraint would fail to dedupe two such rows for
 * the same `(scope_node_id, skill_name)` pair because Postgres treats NULLs
 * as distinct. `COALESCE(agent_profile_id, '00000000-0000-0000-0000-000000000000')`
 * collapses NULL to a fixed sentinel so whole-scope bindings dedupe correctly
 * while remaining distinct from any profile-scoped binding sharing the same
 * scope/skill.
 */
export class CreateAgentProfileSkillBindings20260714040000 implements MigrationInterface {
  name = "CreateAgentProfileSkillBindings20260714040000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agent_profile_skill_bindings (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "agent_profile_id" uuid,
        "scope_node_id" uuid NOT NULL,
        "skill_name" varchar(64) NOT NULL,
        "provenance" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_profile_skill_bindings_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_agent_profile_skill_bindings_scope_node"
          FOREIGN KEY ("scope_node_id") REFERENCES scope_nodes(id) ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_profile_skill_bindings
        ON agent_profile_skill_bindings (
          COALESCE(agent_profile_id, '00000000-0000-0000-0000-000000000000'),
          scope_node_id,
          skill_name
        );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_profile_skill_bindings_scope_node
        ON agent_profile_skill_bindings (scope_node_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS agent_profile_skill_bindings;`,
    );
  }
}
```

- [ ] **Step 2: Write the entity**

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Runtime skill -> (scope_node | scope_node + agent_profile) assignment.
 * `agent_profile_id: null` means the binding applies to any agent profile
 * operating under `scope_node_id` (the "project" tier); a non-null
 * `agent_profile_id` restricts it to that one profile (the "project+agent"
 * tier). The true uniqueness constraint on
 * `(COALESCE(agent_profile_id, '00000000-...-000000'), scope_node_id, skill_name)`
 * is an expression index created in the migration
 * (`apps/api/src/database/migrations/20260714040000-create-agent-profile-skill-bindings.ts`)
 * — TypeORM's `@Index`/`@Unique` decorators cannot express a `COALESCE`
 * expression, so it is intentionally not mirrored here (same discipline as
 * `WorkflowSkillBinding`).
 */
@Entity("agent_profile_skill_bindings")
@Index("idx_agent_profile_skill_bindings_scope_node", ["scope_node_id"])
export class AgentProfileSkillBinding {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "agent_profile_id", type: "uuid", nullable: true })
  agent_profile_id!: string | null;

  @Column({ name: "scope_node_id", type: "uuid" })
  scope_node_id!: string;

  @Column({ name: "skill_name", type: "varchar", length: 64 })
  skill_name!: string;

  @Column({ type: "jsonb", nullable: true })
  provenance!: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updated_at!: Date;
}
```

- [ ] **Step 3: Write the repository types**

```typescript
export interface InsertAgentProfileSkillBindingInput {
  agent_profile_id: string | null;
  scope_node_id: string;
  skill_name: string;
  provenance: Record<string, unknown> | null;
}

export interface AgentProfileSkillBindingKey {
  agentProfileId: string | null;
  scopeNodeId: string;
  skillName: string;
}
```

- [ ] **Step 4: Write the repository**

```typescript
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, IsNull, Repository } from "typeorm";
import { AgentProfileSkillBinding } from "../entities/agent-profile-skill-binding.entity";
import type {
  AgentProfileSkillBindingKey,
  InsertAgentProfileSkillBindingInput,
} from "./agent-profile-skill-binding.repository.types";

/**
 * Persistence surface for `agent_profile_skill_bindings`. `findExisting`
 * mirrors the migration's
 * `(COALESCE(agent_profile_id, '00000000-...-000000'), scope_node_id, skill_name)`
 * unique index at the query level: `IsNull()` is used when `agentProfileId`
 * is `null` so a whole-scope binding is never matched against (or by) a
 * profile-scoped one.
 */
@Injectable()
export class AgentProfileSkillBindingRepository {
  constructor(
    @InjectRepository(AgentProfileSkillBinding)
    private readonly repo: Repository<AgentProfileSkillBinding>,
  ) {}

  findExisting(
    key: AgentProfileSkillBindingKey,
  ): Promise<AgentProfileSkillBinding | null> {
    return this.repo.findOne({
      where: {
        agent_profile_id:
          key.agentProfileId === null ? IsNull() : key.agentProfileId,
        scope_node_id: key.scopeNodeId,
        skill_name: key.skillName,
      },
    });
  }

  async upsert(
    input: InsertAgentProfileSkillBindingInput,
  ): Promise<AgentProfileSkillBinding> {
    const existing = await this.findExisting({
      agentProfileId: input.agent_profile_id,
      scopeNodeId: input.scope_node_id,
      skillName: input.skill_name,
    });
    if (existing) return existing;
    return this.repo.save(this.repo.create(input));
  }

  listForScopeNodeIds(
    scopeNodeIds: string[],
  ): Promise<AgentProfileSkillBinding[]> {
    if (scopeNodeIds.length === 0) return Promise.resolve([]);
    return this.repo.find({
      where: { scope_node_id: In(scopeNodeIds) },
      order: { created_at: "ASC" },
    });
  }
}
```

- [ ] **Step 5: Register the migration**

In `apps/api/src/database/migrations/registered-migrations.ts`, add the import at the top of the file (line 1):

```typescript
import { CreateAgentProfileSkillBindings20260714040000 } from "./20260714040000-create-agent-profile-skill-bindings";
```

And add the class name as the first entry inside `export const registeredMigrations = [`:

```typescript
export const registeredMigrations = [
  CreateAgentProfileSkillBindings20260714040000,
  AddToolRegistrySource20260714030000,
  // ...existing entries unchanged
```

- [ ] **Step 6: Register the entity and repository in `DatabaseModule`**

In `apps/api/src/database/database.module.ts`, add the import near the other `ai-config/database/entities` imports (after the `AgentProfileSkill` import):

```typescript
import { AgentProfileSkillBinding } from "../ai-config/database/entities/agent-profile-skill-binding.entity";
import { AgentProfileSkillBindingRepository } from "../ai-config/database/repositories/agent-profile-skill-binding.repository";
```

Add `AgentProfileSkillBinding` to the `entities` array (next to `WorkflowSkillBinding`) and `AgentProfileSkillBindingRepository` to the `repositories` array (next to `WorkflowSkillBindingRepository`):

```typescript
  ImprovementProposal,
  WorkflowSkillBinding,
  AgentProfileSkillBinding,
];
```

```typescript
  ImprovementProposalRepository,
  WorkflowSkillBindingRepository,
  AgentProfileSkillBindingRepository,
];
```

- [ ] **Step 7: Verify the API builds**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/database/migrations/20260714040000-create-agent-profile-skill-bindings.ts \
  apps/api/src/ai-config/database/entities/agent-profile-skill-binding.entity.ts \
  apps/api/src/ai-config/database/repositories/agent-profile-skill-binding.repository.ts \
  apps/api/src/ai-config/database/repositories/agent-profile-skill-binding.repository.types.ts \
  apps/api/src/database/migrations/registered-migrations.ts \
  apps/api/src/database/database.module.ts
git commit -m "feat(ai-config): add agent_profile_skill_bindings table"
```

---

### Task 2: `AgentProfileSkillBindingService`

**Files:**

- Create: `apps/api/src/ai-config/services/agent-profile-skill-binding.service.ts`
- Create: `apps/api/src/ai-config/services/agent-profile-skill-binding.service.spec.ts`
- Modify: `apps/api/src/ai-config/ai-config.module.ts`

**Interfaces:**

- Consumes: `AgentProfileSkillBindingRepository.upsert`/`listForScopeNodeIds` (Task 1); `AgentProfileRepository.findByName(name: string): Promise<AgentProfile | null>` (existing, `apps/api/src/ai-config/database/repositories/agent-profile.repository.ts`); `ScopeService.getAncestorIds(nodeId: string): Promise<string[]>` (existing, `apps/api/src/scope/scope.service.ts`).
- Produces: `AgentProfileSkillBindingService` with `addProjectScopedBinding(input: { skillName: string; scopeNodeId: string; provenance?: Record<string, unknown> }): Promise<void>`, `addProfileScopedBinding(input: { skillName: string; scopeNodeId: string; profileName: string; provenance?: Record<string, unknown> }): Promise<void>`, and `listApplicableSkillNames(params: { scopeNodeId?: string; agentProfileName?: string }): Promise<string[]>`. Task 3 and Task 7 consume all three.

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProfileSkillBindingService } from "./agent-profile-skill-binding.service";

function makeRepo() {
  const rows: any[] = [];
  return {
    rows,
    upsert: vi.fn(async (input: any) => {
      const row = { id: `b${rows.length + 1}`, ...input };
      rows.push(row);
      return row;
    }),
    listForScopeNodeIds: vi.fn(async (ids: string[]) =>
      rows.filter((r) => ids.includes(r.scope_node_id)),
    ),
  };
}

function makeProfiles() {
  return {
    findByName: vi.fn(async (name: string) =>
      name === "unknown-profile" ? null : { id: `profile-${name}`, name },
    ),
  };
}

function makeScope() {
  return {
    getAncestorIds: vi.fn(async (nodeId: string) => [nodeId, "org-root"]),
  };
}

describe("AgentProfileSkillBindingService.addProjectScopedBinding", () => {
  it("inserts a whole-scope binding with a null agent_profile_id", async () => {
    const repo = makeRepo();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      makeScope() as any,
    );

    await service.addProjectScopedBinding({
      skillName: "incident-response",
      scopeNodeId: "scope-1",
    });

    expect(repo.upsert).toHaveBeenCalledWith({
      agent_profile_id: null,
      scope_node_id: "scope-1",
      skill_name: "incident-response",
      provenance: null,
    });
  });
});

describe("AgentProfileSkillBindingService.addProfileScopedBinding", () => {
  it("resolves the profile name and inserts a profile-scoped binding", async () => {
    const repo = makeRepo();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      makeScope() as any,
    );

    await service.addProfileScopedBinding({
      skillName: "incident-response",
      scopeNodeId: "scope-1",
      profileName: "backend-engineer",
    });

    expect(repo.upsert).toHaveBeenCalledWith({
      agent_profile_id: "profile-backend-engineer",
      scope_node_id: "scope-1",
      skill_name: "incident-response",
      provenance: null,
    });
  });

  it("throws when the profile name does not resolve", async () => {
    const repo = makeRepo();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      makeScope() as any,
    );

    await expect(
      service.addProfileScopedBinding({
        skillName: "incident-response",
        scopeNodeId: "scope-1",
        profileName: "unknown-profile",
      }),
    ).rejects.toThrow("unknown-profile");
  });
});

describe("AgentProfileSkillBindingService.listApplicableSkillNames", () => {
  it("returns an empty array when no scopeNodeId is given", async () => {
    const repo = makeRepo();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      makeScope() as any,
    );

    const names = await service.listApplicableSkillNames({});
    expect(names).toEqual([]);
    expect(repo.listForScopeNodeIds).not.toHaveBeenCalled();
  });

  it("includes whole-scope bindings for any profile", async () => {
    const repo = makeRepo();
    const scope = makeScope();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      scope as any,
    );
    await service.addProjectScopedBinding({
      skillName: "incident-response",
      scopeNodeId: "scope-1",
    });

    const names = await service.listApplicableSkillNames({
      scopeNodeId: "scope-1",
      agentProfileName: "backend-engineer",
    });

    expect(names).toEqual(["incident-response"]);
    expect(scope.getAncestorIds).toHaveBeenCalledWith("scope-1");
  });

  it("includes ancestor-scope bindings (org-level binding reaches a child project)", async () => {
    const repo = makeRepo();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      makeScope() as any,
    );
    await service.addProjectScopedBinding({
      skillName: "org-wide-skill",
      scopeNodeId: "org-root",
    });

    const names = await service.listApplicableSkillNames({
      scopeNodeId: "scope-1",
    });

    expect(names).toEqual(["org-wide-skill"]);
  });

  it("excludes a profile-scoped binding for a different profile", async () => {
    const repo = makeRepo();
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      makeScope() as any,
    );
    await service.addProfileScopedBinding({
      skillName: "incident-response",
      scopeNodeId: "scope-1",
      profileName: "backend-engineer",
    });

    const names = await service.listApplicableSkillNames({
      scopeNodeId: "scope-1",
      agentProfileName: "frontend-engineer",
    });

    expect(names).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- agent-profile-skill-binding.service.spec.ts`
Expected: FAIL with "Cannot find module './agent-profile-skill-binding.service'"

- [ ] **Step 3: Write the implementation**

```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import { AgentProfileRepository } from "../database/repositories/agent-profile.repository";
import { AgentProfileSkillBindingRepository } from "../database/repositories/agent-profile-skill-binding.repository";
import { ScopeService } from "../../scope/scope.service";

/**
 * Runtime binding lifecycle for the "project" and "project+agent" skill
 * scope tiers. Bindings live in `agent_profile_skill_bindings` rather than
 * `agent_profiles.assigned_skills` so a profile reseed never clobbers
 * assignments applied outside of source control (e.g. by the
 * self-improvement pipeline's appliers) — same discipline as
 * `WorkflowSkillBindingService` for workflow-level bindings.
 *
 * A binding with a null `agent_profile_id` applies to any agent profile
 * operating under its `scope_node_id` (project tier); a binding with a
 * resolved `agent_profile_id` applies only to that profile within that scope
 * (project+agent tier). Ancestor scopes reach their descendants via
 * `ScopeService.getAncestorIds`, the same closure-table lookup
 * `AuthorizationService` already uses for permission inheritance — an
 * org-level binding is visible to every project under that org.
 */
@Injectable()
export class AgentProfileSkillBindingService {
  constructor(
    private readonly repo: AgentProfileSkillBindingRepository,
    private readonly profiles: AgentProfileRepository,
    private readonly scopeService: ScopeService,
  ) {}

  async addProjectScopedBinding(input: {
    skillName: string;
    scopeNodeId: string;
    provenance?: Record<string, unknown>;
  }): Promise<void> {
    await this.repo.upsert({
      agent_profile_id: null,
      scope_node_id: input.scopeNodeId,
      skill_name: input.skillName,
      provenance: input.provenance ?? null,
    });
  }

  async addProfileScopedBinding(input: {
    skillName: string;
    scopeNodeId: string;
    profileName: string;
    provenance?: Record<string, unknown>;
  }): Promise<void> {
    const profile = await this.profiles.findByName(input.profileName);
    if (!profile) {
      throw new NotFoundException(
        `Agent profile with name ${input.profileName} not found`,
      );
    }
    await this.repo.upsert({
      agent_profile_id: profile.id,
      scope_node_id: input.scopeNodeId,
      skill_name: input.skillName,
      provenance: input.provenance ?? null,
    });
  }

  async listApplicableSkillNames(params: {
    scopeNodeId?: string;
    agentProfileName?: string;
  }): Promise<string[]> {
    if (!params.scopeNodeId) {
      return [];
    }

    const ancestorIds = await this.scopeService.getAncestorIds(
      params.scopeNodeId,
    );

    let profileId: string | null = null;
    if (params.agentProfileName) {
      const profile = await this.profiles.findByName(params.agentProfileName);
      profileId = profile?.id ?? null;
    }

    const rows = await this.repo.listForScopeNodeIds(ancestorIds);
    return rows
      .filter(
        (row) =>
          row.agent_profile_id === null || row.agent_profile_id === profileId,
      )
      .map((row) => row.skill_name);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- agent-profile-skill-binding.service.spec.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Register in `AiConfigModule`**

`AgentProfileSkillBindingService` needs `ScopeService`, so `AiConfigModule` needs `ScopeModule` imported (it does not today). In `apps/api/src/ai-config/ai-config.module.ts`, add the import:

```typescript
import { ScopeModule } from "../scope/scope.module";
import { AgentProfileSkillBindingService } from "./services/agent-profile-skill-binding.service";
```

Add `ScopeModule` to the `imports` array and `AgentProfileSkillBindingService` to both `providers` and `exports`:

```typescript
  imports: [
    AuthModule,
    AuthorizationModule,
    ConfigModule,
    ConfigResolutionModule,
    GitOpsModule,
    DatabaseModule,
    ObservabilityModule,
    SecurityModule,
    CapabilityInfraModule,
    OAuthModule,
    ScopeModule,
  ],
```

```typescript
  providers: [
    // ...existing entries unchanged
    ProviderFallbackService,
    AgentProfileSkillBindingService,
  ],
  exports: [
    // ...existing entries unchanged
    ProviderFallbackService,
    AgentProfileSkillBindingService,
  ],
```

- [ ] **Step 6: Verify the API builds**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds with no TypeScript or DI-wiring errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/ai-config/services/agent-profile-skill-binding.service.ts \
  apps/api/src/ai-config/services/agent-profile-skill-binding.service.spec.ts \
  apps/api/src/ai-config/ai-config.module.ts
git commit -m "feat(ai-config): add AgentProfileSkillBindingService"
```

---

### Task 3: Wire scoped bindings into `WorkflowStageSkillPolicyService`

**Files:**

- Modify: `apps/api/src/workflow/workflow-stage-skill-policy.service.ts`
- Modify: `apps/api/src/workflow/workflow-stage-skill-policy.service.spec.ts`

**Interfaces:**

- Consumes: `AgentProfileSkillBindingService.listApplicableSkillNames` (Task 2); existing `AgentSkillsService.listSkills()`, `listSkillsByProfileName()`, `listSkillsForScope()`.
- Produces: `WorkflowStageSkillPolicyService.resolveAssignedSkills` now includes project/project+agent-tier skills in its result (no change to its public signature).

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/workflow/workflow-stage-skill-policy.service.spec.ts`, inside the existing `describe('WorkflowStageSkillPolicyService', ...)` block, alongside the other `resolveAssignedSkills` scope tests (after the `'forwards workflowId to listSkillsForScope'` test, before its closing `});`):

```typescript
it("includes a scope-node binding skill alongside global and frontmatter-scoped skills", async () => {
  const boundSkill: SkillLibraryRecord = {
    ...projectSkill,
    id: "bound-skill",
    name: "bound-skill",
    scope: null,
  };
  listSkillsByProfileNameMock.mockResolvedValue([architectureSkill]);
  listSkillsForScopeMock.mockReturnValue([]);
  listSkillsMock.mockReturnValue([
    architectureSkill,
    testSkill,
    documentationSkill,
    boundSkill,
  ]);
  listApplicableSkillNamesMock.mockResolvedValue(["bound-skill"]);

  const selection = await service.resolveAssignedSkills({
    agentProfile: "software-architect",
    scopeId: "scope-123",
  });

  const names = selection.skills.map((s) => s.name).sort();
  expect(names).toEqual(["architecture-review", "bound-skill"]);
  expect(listApplicableSkillNamesMock).toHaveBeenCalledWith({
    scopeNodeId: "scope-123",
    agentProfileName: "software-architect",
  });
});

it("does not query bindings when no scopeId is given", async () => {
  listSkillsByProfileNameMock.mockResolvedValue([architectureSkill]);
  listSkillsForScopeMock.mockReturnValue([]);

  await service.resolveAssignedSkills({ agentProfile: "software-architect" });

  expect(listApplicableSkillNamesMock).toHaveBeenCalledWith({
    scopeNodeId: undefined,
    agentProfileName: "software-architect",
  });
});
```

Also add the mock declaration near the other `*Mock` constants (after `const listSkillsForScopeMock = vi.fn();`):

```typescript
const listApplicableSkillNamesMock = vi.fn();
```

And wire it into the `beforeEach` block — replace:

```typescript
service = new WorkflowStageSkillPolicyService(agentSkills, settings);
```

with:

```typescript
listApplicableSkillNamesMock.mockResolvedValue([]);
const profileSkillBindings = {
  listApplicableSkillNames: listApplicableSkillNamesMock,
} as unknown as AgentProfileSkillBindingService;

service = new WorkflowStageSkillPolicyService(
  agentSkills,
  settings,
  profileSkillBindings,
);
```

And add the import at the top of the spec file:

```typescript
import type { AgentProfileSkillBindingService } from "../ai-config/services/agent-profile-skill-binding.service";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- workflow-stage-skill-policy.service.spec.ts`
Expected: FAIL — `WorkflowStageSkillPolicyService` constructor does not accept a third argument yet, and `listApplicableSkillNamesMock` is never called.

- [ ] **Step 3: Write the implementation**

In `apps/api/src/workflow/workflow-stage-skill-policy.service.ts`, add the import:

```typescript
import { AgentProfileSkillBindingService } from "../ai-config/services/agent-profile-skill-binding.service";
```

Add the constructor parameter:

```typescript
  constructor(
    private readonly agentSkills: AgentSkillsService,
    private readonly settings: SystemSettingsService,
    private readonly profileSkillBindings: AgentProfileSkillBindingService,
  ) {}
```

Replace `resolveBaseSkillSet` with:

```typescript
  private async resolveBaseSkillSet(
    agentProfile: string,
    scopeId?: string,
    workflowId?: string,
  ): Promise<SkillLibraryRecord[]> {
    const assignedGlobal = (
      await this.agentSkills.listSkillsByProfileName(agentProfile)
    ).filter((skill) => !skill.scope);

    // listSkillsForScope is synchronous (in-memory); no await needed
    const scoped = this.agentSkills.listSkillsForScope({
      scopeId,
      agentProfile,
      workflowId,
    });

    const boundNames = await this.profileSkillBindings.listApplicableSkillNames({
      scopeNodeId: scopeId,
      agentProfileName: agentProfile,
    });
    const boundSkills =
      boundNames.length > 0
        ? this.agentSkills
            .listSkills()
            .filter((skill) => boundNames.includes(normalizeSkillName(skill.name)))
        : [];

    // Scoped/bound variants take precedence over global when names collide
    const byName = new Map<string, SkillLibraryRecord>();
    for (const skill of [...assignedGlobal, ...scoped, ...boundSkills]) {
      byName.set(normalizeSkillName(skill.name), skill);
    }
    return [...byName.values()];
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- workflow-stage-skill-policy.service.spec.ts`
Expected: PASS, all tests green (existing tests unaffected since `listApplicableSkillNamesMock` defaults to resolving `[]`).

- [ ] **Step 5: Verify the API builds**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds. `WorkflowStageSkillPolicyService` is constructed only via NestJS DI elsewhere (confirmed: no other direct `new WorkflowStageSkillPolicyService(...)` call site), and `AgentProfileSkillBindingService` is already exported by `AiConfigModule`, which `WorkflowCoreModule` already imports — no module-wiring change needed there.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-stage-skill-policy.service.ts \
  apps/api/src/workflow/workflow-stage-skill-policy.service.spec.ts
git commit -m "feat(workflow): resolve project/project+agent skill bindings in stage policy"
```

---

### Task 4: Origin-aware widening check in `decideScopeApplication`

**Files:**

- Modify: `apps/api/src/memory/learning/skill-scope-auto-apply.decide.ts`
- Modify: `apps/api/src/memory/learning/skill-scope-auto-apply.decide.types.ts`
- Create: `apps/api/src/memory/learning/skill-scope-auto-apply.decide.spec.ts` (create if it does not already exist; if it exists, add to it)

**Interfaces:**

- Produces: `decideScopeApplication(input: ScopeApplicationInput): ScopeApplicationDecision` now takes an additional `originScopeId: string | null` field on `ScopeApplicationInput`, and `'auto_apply'` decisions clamp the confirmed scope's `projects` to exactly `[originScopeId]` rather than trusting the raw recommendation. Task 5 consumes this.

- [ ] **Step 1: Read the current file to confirm no existing spec conflicts**

Read `apps/api/src/memory/learning/skill-scope-auto-apply.decide.ts` (already reviewed during design) and check whether `apps/api/src/memory/learning/skill-scope-auto-apply.decide.spec.ts` exists; if it does, read it fully before editing so the new tests are added consistently with the existing ones rather than duplicating setup.

- [ ] **Step 2: Write the failing test**

Add these cases (to the existing spec file if present, otherwise create the file with a `describe('decideScopeApplication', ...)` block containing them):

```typescript
import { describe, expect, it } from "vitest";
import { decideScopeApplication } from "./skill-scope-auto-apply.decide";

describe("decideScopeApplication — origin-aware widening", () => {
  it("auto-applies and clamps projects to the origin scope when the recommendation matches it", () => {
    const decision = decideScopeApplication({
      recommendedScope: {
        projects: ["scope-1"],
        agents: ["backend-engineer"],
        workflows: [],
      },
      mode: "auto",
      originScopeId: "scope-1",
    });

    expect(decision.action).toBe("auto_apply");
    expect(decision.confirmedScope).toEqual({
      projects: ["scope-1"],
      agents: ["backend-engineer"],
      workflows: [],
    });
  });

  it("stages (never auto-applies) when the recommendation names a different project than the origin", () => {
    const decision = decideScopeApplication({
      recommendedScope: { projects: ["scope-2"], agents: [], workflows: [] },
      mode: "auto",
      originScopeId: "scope-1",
    });

    expect(decision.action).toBe("stage");
    expect(decision.reason).toContain("widens beyond origin scope");
  });

  it("stages when the recommendation has no project restriction (implicit global widening)", () => {
    const decision = decideScopeApplication({
      recommendedScope: {
        projects: [],
        agents: ["backend-engineer"],
        workflows: [],
      },
      mode: "auto",
      originScopeId: "scope-1",
    });

    expect(decision.action).toBe("stage");
    expect(decision.reason).toContain("widens beyond origin scope");
  });

  it("stages when there is no known origin scope, even in auto mode", () => {
    const decision = decideScopeApplication({
      recommendedScope: { projects: ["scope-1"], agents: [], workflows: [] },
      mode: "auto",
      originScopeId: null,
    });

    expect(decision.action).toBe("stage");
    expect(decision.reason).toContain("no known origin scope");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- skill-scope-auto-apply.decide.spec.ts`
Expected: FAIL — `originScopeId` is not a recognized field on `ScopeApplicationInput` (TypeScript error) and the widening cases still return `'auto_apply'`.

- [ ] **Step 4: Write the implementation**

In `apps/api/src/memory/learning/skill-scope-auto-apply.decide.types.ts`, add `originScopeId` to `ScopeApplicationInput` (read the file first to add the field alongside `mode`/`recommendedScope`/`rationale` rather than guessing its exact current shape).

```typescript
export interface ScopeApplicationInput {
  recommendedScope: Record<string, unknown> | null | undefined;
  rationale?: string;
  mode: SkillScopeConfirmationMode;
  /**
   * The scope_node_id the proposal actually ran under, or null if unknown.
   * A recommendation can only auto-apply if it stays within this scope —
   * anything wider (a different project, or no project restriction at all)
   * always stages for manual confirmation, regardless of `mode`.
   */
  originScopeId: string | null;
}
```

Replace `apps/api/src/memory/learning/skill-scope-auto-apply.decide.ts` with:

```typescript
import type {
  ScopeApplicationDecision,
  ScopeApplicationInput,
} from "./skill-scope-auto-apply.decide.types";

/**
 * Pure function — no NestJS, no side effects, no I/O.
 *
 * Decides whether an analyst-recommended skill scope should be applied
 * immediately (`auto_apply`) or parked for human review (`stage`).
 *
 * Rules:
 * - `manual` → always stage (preserves the pre-Phase-4 behaviour exactly).
 * - `staged` → stage (marks eligible for future bulk-confirm, not yet wired).
 * - `auto`   → auto_apply only when ALL of the following hold: the scope has
 *              at least one non-empty array in `projects`, `agents`, or
 *              `workflows`; `originScopeId` is known (non-null); and the
 *              recommendation does not widen past that origin scope (its
 *              `projects` list is either empty-meaning-"no restriction", in
 *              which case it is treated as widening and NOT auto-applied, or
 *              contains only `originScopeId`). A recommendation that widens
 *              past the origin — including recommending global (no project
 *              restriction) or a different project — always stages, even in
 *              `auto` mode: no autonomous proposal may grant itself scope
 *              wider than the run it actually executed under.
 *
 * When auto-applying, `confirmedScope.projects` is clamped to exactly
 * `[originScopeId]` rather than trusting the recommendation's own `projects`
 * value verbatim, so the applied scope's project dimension can never drift
 * from the run's actual origin even if the recommendation redundantly named
 * it. `agents`/`workflows` narrow further and are passed through unchanged.
 */
export function decideScopeApplication(
  input: ScopeApplicationInput,
): ScopeApplicationDecision {
  const { mode, recommendedScope, originScopeId } = input;

  if (
    mode !== "auto" ||
    recommendedScope == null ||
    !hasContent(recommendedScope)
  ) {
    return {
      action: "stage",
      reason: buildStageReason(mode, recommendedScope),
    };
  }

  if (originScopeId === null) {
    return {
      action: "stage",
      reason: "auto mode but there is no known origin scope to clamp against",
    };
  }

  if (!isWithinOriginScope(recommendedScope, originScopeId)) {
    return {
      action: "stage",
      reason: "recommendation widens beyond origin scope",
    };
  }

  const { agents, workflows } = recommendedScope as {
    agents?: unknown;
    workflows?: unknown;
  };
  return {
    action: "auto_apply",
    confirmedScope: {
      projects: [originScopeId],
      agents: Array.isArray(agents) ? agents : [],
      workflows: Array.isArray(workflows) ? workflows : [],
    },
    reason: "auto mode with a recommendation clamped to the origin scope",
  };
}

/**
 * True when the recommendation's `projects` dimension does not reach beyond
 * `originScopeId`: an empty list means "no restriction" (implicit global,
 * always a widening) and any entry other than `originScopeId` is a widening
 * to a different scope. A recommendation naming only `originScopeId` (or
 * omitting `projects` entirely, treated the same as empty) is the only case
 * that passes.
 */
function isWithinOriginScope(
  recommendedScope: Record<string, unknown>,
  originScopeId: string,
): boolean {
  const projects = (recommendedScope as { projects?: unknown }).projects;
  if (!Array.isArray(projects) || projects.length === 0) {
    return false;
  }
  return projects.every((project) => project === originScopeId);
}

function hasContent(scope: Record<string, unknown>): boolean {
  const { projects, agents, workflows } = scope as {
    projects?: unknown;
    agents?: unknown;
    workflows?: unknown;
  };
  return [projects, agents, workflows].some(
    (arr) => Array.isArray(arr) && arr.length > 0,
  );
}

function buildStageReason(
  mode: ScopeApplicationInput["mode"],
  scope: Record<string, unknown> | null | undefined,
): string {
  if (mode !== "auto") {
    return `mode is ${mode}`;
  }
  if (scope == null) {
    return "auto mode but recommended scope is null/undefined";
  }
  return "auto mode but recommended scope has no projects, agents, or workflows entries";
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- skill-scope-auto-apply.decide.spec.ts`
Expected: PASS, all new and pre-existing tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/memory/learning/skill-scope-auto-apply.decide.ts \
  apps/api/src/memory/learning/skill-scope-auto-apply.decide.types.ts \
  apps/api/src/memory/learning/skill-scope-auto-apply.decide.spec.ts
git commit -m "feat(memory): clamp auto-applied skill scope to its origin, never widen"
```

---

### Task 5: Origin-scope auto-apply in `SkillCreateCompletionListener`

**Files:**

- Modify: `apps/api/src/improvement/skill-create-completion.listener.ts`
- Modify: `apps/api/src/improvement/skill-create-completion.listener.spec.ts`

**Interfaces:**

- Consumes: `decideScopeApplication` (Task 4, now requiring `originScopeId`).
- Produces: on successful materialization, the new skill's frontmatter `scope.projects` is always set to `[originScopeId]` immediately (when `provenance.scope_id` is present), independent of `skill_scope_confirmation_mode`; the LLM's `recommended_scope` still only auto-applies when it stays within that origin (Task 4's new rule).

- [ ] **Step 1: Read the current spec file**

Read `apps/api/src/improvement/skill-create-completion.listener.spec.ts` in full before editing, to match its existing mock/fixture conventions exactly (constructor args, `proposals`/`settingsService`/`skillsService`/`bindings` mock shapes).

- [ ] **Step 2: Write the failing test**

Add to the spec file, alongside the existing materialization tests:

```typescript
it("applies the origin scope_id to the skill frontmatter unconditionally, even in manual mode", async () => {
  const proposal = buildProposal({
    provenance: { scope_id: "scope-1" },
  }); // use this suite's existing proposal-fixture helper; if none exists, construct
  // an ImprovementProposal-shaped object matching the other tests in this file,
  // with payload.target_skill_name set and provenance.scope_id: 'scope-1'.
  settingsService.get.mockResolvedValue("manual");
  skillsService.getSkill.mockReturnValue({
    name: proposal.payload.target_skill_name,
    skillMarkdown: "---\nname: some-skill\ndescription: does things\n---\n",
  });

  await listener.handleWorkflowCompleted(
    buildCompletedEvent(proposal, { materialized: true }),
  ); // use this suite's existing event-fixture helper

  expect(skillsService.updateSkill).toHaveBeenCalledWith(
    proposal.payload.target_skill_name,
    {
      skill_markdown: expect.stringContaining("scope-1"),
    },
  );
});

it("does not apply any scope when provenance has no scope_id", async () => {
  const proposal = buildProposal({ provenance: {} });
  settingsService.get.mockResolvedValue("manual");

  await listener.handleWorkflowCompleted(
    buildCompletedEvent(proposal, { materialized: true }),
  );

  expect(skillsService.updateSkill).not.toHaveBeenCalled();
});
```

(Adapt `buildProposal`/`buildCompletedEvent` to whatever fixture helpers the existing spec file already uses — read it first per Step 1 so these two tests slot into the real structure rather than inventing a parallel one.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- skill-create-completion.listener.spec.ts`
Expected: FAIL — `skillsService.updateSkill` is never called for the origin-scope case yet.

- [ ] **Step 4: Write the implementation**

In `apps/api/src/improvement/skill-create-completion.listener.ts`, update `handleWorkflowCompleted`'s materialized branch to apply the origin scope before the recommended-scope logic:

```typescript
    if (materialized) {
      await this.proposals.updateById(
        proposalId,
        buildAppliedUpdate(proposal, output),
      );
      await this.applyAssignmentTargets(proposalId, proposal);
      this.applyOriginScope(proposal);
      await this.tryAutoApplyScope(proposalId, proposal, output);
    } else {
```

Add the new private method (near `applyScopeToSkill`):

```typescript
  /**
   * Applies the proposal's factual origin scope (`provenance.scope_id` — the
   * scope_node_id the run that produced this proposal actually executed
   * under) to the newly-materialized skill's frontmatter immediately,
   * unconditionally, regardless of `skill_scope_confirmation_mode`. This is
   * not a "recommendation" requiring confirmation — it is a record of where
   * the learning came from. A missing/empty scope_id (e.g. a manually
   * triggered proposal with no run context) leaves the skill unscoped, same
   * as before this change — there is no narrower scope to default to when
   * none is known. Fail-soft: any error is logged and swallowed, exactly
   * like {@link tryAutoApplyScope}'s existing discipline, since a partial
   * failure here must not affect the materialization outcome already
   * recorded above.
   */
  private applyOriginScope(proposal: ImprovementProposal): void {
    const scopeId = readScopeId(proposal.provenance);
    if (!scopeId) {
      return;
    }
    try {
      this.applyScopeToSkill(readSkillName(proposal.payload), {
        projects: [scopeId],
        agents: [],
        workflows: [],
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to apply origin scope ${scopeId} to proposal ${proposal.id}: ${String(err)}`,
      );
    }
  }
```

Add the module-local helper (mirrors `skill-create.applier.ts`'s own `readScopeId` — deliberately duplicated per this codebase's existing discipline for module-local scope helpers, see `resolve-scope-id.helper.ts`'s doc comment):

```typescript
function readScopeId(provenance: Record<string, unknown>): string | undefined {
  const scope = provenance?.scope_id;
  return typeof scope === "string" && scope.length > 0 ? scope : undefined;
}
```

Update `tryAutoApplyScope` to pass `originScopeId` into `decideScopeApplication`:

```typescript
const decision = decideScopeApplication({
  recommendedScope,
  rationale: scopeRationale ?? undefined,
  mode,
  originScopeId: readScopeId(proposal.provenance) ?? null,
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- skill-create-completion.listener.spec.ts`
Expected: PASS, all new and pre-existing tests green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/improvement/skill-create-completion.listener.ts \
  apps/api/src/improvement/skill-create-completion.listener.spec.ts
git commit -m "feat(improvement): auto-apply origin scope on skill materialization"
```

---

### Task 6: Scope-aware `applySkillAssignments`

**Files:**

- Modify: `apps/api/src/improvement/appliers/skill-create.applier.ts`
- Modify: `apps/api/src/improvement/appliers/skill-assignment.types.ts`
- Modify: `apps/api/src/improvement/appliers/skill-create.applier.assignment.spec.ts`

**Interfaces:**

- Produces: `applySkillAssignments(input: { skillName, targets, proposalId, scopeId?: string | null }, deps)` — when `input.scopeId` is present, agent_profile targets route through `deps.skills.addScopedProfileSkill` instead of `deps.skills.addProfileSkills`; falls back to the existing unconditional global assignment when `scopeId` is absent. `SkillAssignmentDeps['skills']` gains `addScopedProfileSkill(input: { profileName: string; skillName: string; scopeNodeId: string }): Promise<void>`. Task 7 wires the real implementation and both call sites.

- [ ] **Step 1: Read the current spec file**

Read `apps/api/src/improvement/appliers/skill-create.applier.assignment.spec.ts` in full before editing (it already covers `applySkillAssignments`) so the new tests slot in alongside the existing ones without duplicating fixture setup.

- [ ] **Step 2: Write the failing test**

Add to the spec file:

```typescript
it("routes an agent_profile target through addScopedProfileSkill when scopeId is present", async () => {
  const skills = {
    addProfileSkills: vi.fn(),
    addScopedProfileSkill: vi.fn(),
  };
  const bindings = { addBinding: vi.fn() };

  const outcomes = await applySkillAssignments(
    {
      skillName: "incident-response",
      targets: [{ type: "agent_profile", profileName: "backend-engineer" }],
      proposalId: "proposal-1",
      scopeId: "scope-1",
    },
    { skills, bindings },
  );

  expect(skills.addScopedProfileSkill).toHaveBeenCalledWith({
    profileName: "backend-engineer",
    skillName: "incident-response",
    scopeNodeId: "scope-1",
  });
  expect(skills.addProfileSkills).not.toHaveBeenCalled();
  expect(outcomes).toEqual([
    {
      status: "applied",
      target: { type: "agent_profile", profileName: "backend-engineer" },
    },
  ]);
});

it("falls back to global addProfileSkills when scopeId is absent", async () => {
  const skills = {
    addProfileSkills: vi.fn(),
    addScopedProfileSkill: vi.fn(),
  };
  const bindings = { addBinding: vi.fn() };

  await applySkillAssignments(
    {
      skillName: "incident-response",
      targets: [{ type: "agent_profile", profileName: "backend-engineer" }],
      proposalId: "proposal-1",
    },
    { skills, bindings },
  );

  expect(skills.addProfileSkills).toHaveBeenCalledWith("backend-engineer", [
    "incident-response",
  ]);
  expect(skills.addScopedProfileSkill).not.toHaveBeenCalled();
});

it("records an unrouted outcome (not a throw) when addScopedProfileSkill rejects", async () => {
  const skills = {
    addProfileSkills: vi.fn(),
    addScopedProfileSkill: vi
      .fn()
      .mockRejectedValue(new Error("profile not found")),
  };
  const bindings = { addBinding: vi.fn() };

  const outcomes = await applySkillAssignments(
    {
      skillName: "incident-response",
      targets: [{ type: "agent_profile", profileName: "unknown" }],
      proposalId: "proposal-1",
      scopeId: "scope-1",
    },
    { skills, bindings },
  );

  expect(outcomes).toEqual([
    {
      status: "unrouted",
      target: { type: "agent_profile", profileName: "unknown" },
      reason: "profile not found",
    },
  ]);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- skill-create.applier.assignment.spec.ts`
Expected: FAIL — TypeScript error (`addScopedProfileSkill` does not exist on the deps type) and `applySkillAssignments` still calls `addProfileSkills` unconditionally.

- [ ] **Step 4: Write the implementation**

In `apps/api/src/improvement/appliers/skill-assignment.types.ts`, add `addScopedProfileSkill` to `SkillAssignmentDeps['skills']`:

```typescript
export interface SkillAssignmentDeps {
  skills: {
    addProfileSkills(profileName: string, skillNames: string[]): Promise<void>;
    addScopedProfileSkill(input: {
      profileName: string;
      skillName: string;
      scopeNodeId: string;
    }): Promise<void>;
  };
  bindings: {
    addBinding(input: {
      workflowName: string;
      stepId: string | null;
      skillName: string;
      provenance?: Record<string, unknown>;
    }): Promise<unknown>;
  };
}
```

In `apps/api/src/improvement/appliers/skill-create.applier.ts`, update `applySkillAssignments`'s signature and profile-target loop:

```typescript
export async function applySkillAssignments(
  input: {
    skillName: string;
    targets: AssignmentTarget[];
    proposalId: string;
    scopeId?: string | null;
  },
  deps: SkillAssignmentDeps,
): Promise<AssignmentApplicationOutcome[]> {
  const { profileTargets, workflowTargets } = partitionAssignmentTargets(
    input.targets,
  );
  const outcomes: AssignmentApplicationOutcome[] = [];

  for (const target of profileTargets) {
    try {
      if (input.scopeId) {
        await deps.skills.addScopedProfileSkill({
          profileName: target.profileName,
          skillName: input.skillName,
          scopeNodeId: input.scopeId,
        });
      } else {
        await deps.skills.addProfileSkills(target.profileName, [
          input.skillName,
        ]);
      }
      outcomes.push({ status: "applied", target });
    } catch (err: unknown) {
      outcomes.push({ status: "unrouted", target, reason: describeError(err) });
    }
  }

  for (const target of workflowTargets) {
    try {
      await deps.bindings.addBinding({
        workflowName: target.workflowName,
        stepId: target.stepId ?? null,
        skillName: input.skillName,
        provenance: { proposalId: input.proposalId },
      });
      outcomes.push({ status: "applied", target });
    } catch (err: unknown) {
      outcomes.push({ status: "unrouted", target, reason: describeError(err) });
    }
  }

  return outcomes;
}
```

(Only the profile-target branch and the function signature change; the workflow-target loop and `describeError` are unchanged — leave them as-is.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- skill-create.applier.assignment.spec.ts`
Expected: PASS, all new and pre-existing tests green.

- [ ] **Step 6: Fix the existing call sites so the build still type-checks**

`SkillAssignmentApplier` and `SkillCreateCompletionListener` currently construct a `deps.skills` object without `addScopedProfileSkill` — this will now fail to compile. This is intentionally left broken until Task 7 wires the real implementation; run the build to confirm the exact errors, then stop (do not paper over them with a stub here):

Run: `npm run build --workspace=apps/api`
Expected: FAIL with TypeScript errors naming `addScopedProfileSkill` missing on the object literals in `skill-assignment.applier.ts`'s factory-adjacent usage and `skill-create-completion.listener.ts`'s `applyAssignmentTargets`. This is the expected, intentional state at the end of this task — Task 7 fixes it.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/improvement/appliers/skill-create.applier.ts \
  apps/api/src/improvement/appliers/skill-assignment.types.ts \
  apps/api/src/improvement/appliers/skill-create.applier.assignment.spec.ts
git commit -m "feat(improvement): teach applySkillAssignments to route through scoped bindings"
```

---

### Task 7: Wire scoped bindings into both `skill_assignment` call sites

**Files:**

- Modify: `apps/api/src/improvement/appliers/skill-assignment.applier.ts`
- Modify: `apps/api/src/improvement/appliers/skill-assignment.applier.spec.ts`
- Modify: `apps/api/src/improvement/skill-create-completion.listener.ts`
- Modify: `apps/api/src/improvement/skill-create-completion.listener.spec.ts`
- Modify: `apps/api/src/improvement/improvement.module.ts`

**Interfaces:**

- Consumes: `AgentProfileSkillBindingService.addProfileScopedBinding` (Task 2); `applySkillAssignments` with `scopeId` (Task 6).
- Produces: fixes the Task 6 build break — both `skill_assignment` (standalone) and `skill_create`'s post-materialization assignment now pass `proposal.provenance.scope_id` through to `applySkillAssignments`, and `addScopedProfileSkill` is backed by a real implementation.

- [ ] **Step 1: Read the current spec files**

Read `apps/api/src/improvement/appliers/skill-assignment.applier.spec.ts` and (again) `apps/api/src/improvement/skill-create-completion.listener.spec.ts` in full before editing, to match existing mock conventions.

- [ ] **Step 2: Write the failing test for `SkillAssignmentApplier`**

Add to `skill-assignment.applier.spec.ts`:

```typescript
it("passes provenance.scope_id through to applySkillAssignments", async () => {
  const bindings = { addProfileSkillBinding: vi.fn() }; // placeholder name check against
  // this file's existing bindings gateway
  // mock shape — read Step 1's file first
  // and adapt to the real gateway name.
  const skills = {
    skillExists: vi.fn().mockReturnValue(true),
    addProfileSkills: vi.fn(),
    addScopedProfileSkill: vi.fn(),
    removeProfileSkills: vi.fn(),
  };
  const workflowBindings = { addBinding: vi.fn(), removeBinding: vi.fn() };
  const proposals = { updateById: vi.fn() };
  const applier = new SkillAssignmentApplier(
    skills as any,
    workflowBindings as any,
    proposals as any,
  );

  await applier.apply({
    id: "proposal-1",
    payload: {
      skillName: "incident-response",
      assignment_targets: [
        { type: "agent_profile", profileName: "backend-engineer" },
      ],
    },
    provenance: { scope_id: "scope-1" },
    rollback_data: null,
  } as any);

  expect(skills.addScopedProfileSkill).toHaveBeenCalledWith({
    profileName: "backend-engineer",
    skillName: "incident-response",
    scopeNodeId: "scope-1",
  });
});
```

(Adapt the exact mock object shapes to whatever `skill-assignment.applier.spec.ts` already uses for its `skills`/`bindings`/`proposals` fixtures — read Step 1's file first rather than guessing.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- skill-assignment.applier.spec.ts`
Expected: FAIL — `SkillAssignmentApplier.apply` does not read `proposal.provenance.scope_id` yet, so `addScopedProfileSkill` is never called.

- [ ] **Step 4: Update `SkillAssignmentApplier`**

In `apps/api/src/improvement/appliers/skill-assignment.applier.ts`, update the `apply` method's `applySkillAssignments` call to pass `scopeId`:

```typescript
const targets = parseAssignmentTargets(payload.assignment_targets);
const outcomes = await applySkillAssignments(
  {
    skillName,
    targets,
    proposalId: proposal.id,
    scopeId: readScopeId(proposal.provenance),
  },
  { skills: this.skills, bindings: this.bindings },
);
```

Add the same module-local `readScopeId` helper used elsewhere (this file does not have one yet):

```typescript
function readScopeId(provenance: Record<string, unknown>): string | null {
  const scope = provenance?.scope_id;
  return typeof scope === "string" && scope.length > 0 ? scope : null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- skill-assignment.applier.spec.ts`
Expected: still FAIL at this point (the gateway wiring in `improvement.module.ts` is a separate step) unless the test constructs `SkillAssignmentApplier` directly with a mock `skills` object that already includes `addScopedProfileSkill` — which the Step 2 test does. Re-run and confirm PASS for this specific test; the module-level wiring compile error from Task 6 Step 6 is fixed in Step 8 below.

- [ ] **Step 6: Write the failing test for `SkillCreateCompletionListener`**

Add to `skill-create-completion.listener.spec.ts` (read the file first per Step 1 for exact fixture shapes):

```typescript
it("passes provenance.scope_id through when applying assignment_targets post-materialization", async () => {
  const proposal = buildProposal({
    payload: {
      target_skill_name: "incident-response",
      assignment_targets: [
        { type: "agent_profile", profileName: "backend-engineer" },
      ],
    },
    provenance: { scope_id: "scope-1" },
  });
  skillsService.addProfileSkillsByProfileName.mockResolvedValue(undefined);

  await listener.handleWorkflowCompleted(
    buildCompletedEvent(proposal, { materialized: true }),
  );

  expect(profileSkillBindings.addProfileScopedBinding).toHaveBeenCalledWith({
    skillName: "incident-response",
    scopeNodeId: "scope-1",
    profileName: "backend-engineer",
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- skill-create-completion.listener.spec.ts`
Expected: FAIL — `profileSkillBindings` is not yet an injected dependency of `SkillCreateCompletionListener`.

- [ ] **Step 8: Update `SkillCreateCompletionListener` and `improvement.module.ts`**

In `apps/api/src/improvement/skill-create-completion.listener.ts`, add the constructor dependency and wire it into `applyAssignmentTargets`:

```typescript
import { AgentProfileSkillBindingService } from '../ai-config/services/agent-profile-skill-binding.service';

// ...

  constructor(
    private readonly proposals: ImprovementProposalRepository,
    private readonly settingsService: SystemSettingsService,
    private readonly skillsService: AgentSkillsService,
    private readonly bindings: WorkflowSkillBindingService,
    private readonly profileSkillBindings: AgentProfileSkillBindingService,
  ) {}
```

```typescript
const outcomes = await applySkillAssignments(
  { skillName, targets, proposalId, scopeId: readScopeId(proposal.provenance) },
  {
    skills: {
      addProfileSkills: async (profileName, skillNames) => {
        await this.skillsService.addProfileSkillsByProfileName(
          profileName,
          skillNames,
        );
      },
      addScopedProfileSkill: async (scopedInput) => {
        await this.profileSkillBindings.addProfileScopedBinding({
          skillName: scopedInput.skillName,
          scopeNodeId: scopedInput.scopeNodeId,
          profileName: scopedInput.profileName,
        });
      },
    },
    bindings: {
      addBinding: (input) => this.bindings.addBinding(input),
    },
  },
);
```

In `apps/api/src/improvement/improvement.module.ts`, update the `SkillAssignmentApplier` factory's `skills` gateway to add `addScopedProfileSkill`, and inject `AgentProfileSkillBindingService`:

```typescript
import { AgentProfileSkillBindingService } from '../ai-config/services/agent-profile-skill-binding.service';

// ...

    {
      provide: SkillAssignmentApplier,
      useFactory: (
        skillsService: AgentSkillsService,
        bindings: WorkflowSkillBindingService,
        proposals: ImprovementProposalRepository,
        profileSkillBindings: AgentProfileSkillBindingService,
      ) =>
        new SkillAssignmentApplier(
          {
            skillExists: (name) => skillsService.skillExists(name),
            addProfileSkills: async (profileName, skillNames) => {
              await skillsService.addProfileSkillsByProfileName(
                profileName,
                skillNames,
              );
            },
            addScopedProfileSkill: async (input) => {
              await profileSkillBindings.addProfileScopedBinding({
                skillName: input.skillName,
                scopeNodeId: input.scopeNodeId,
                profileName: input.profileName,
              });
            },
            removeProfileSkills: async (profileName, skillNames) => {
              await skillsService.removeProfileSkillsByProfileName(
                profileName,
                skillNames,
              );
            },
          },
          {
            addBinding: (input) => bindings.addBinding(input),
            removeBinding: (input) => bindings.removeBinding(input),
          },
          proposals,
        ),
      inject: [
        AgentSkillsService,
        WorkflowSkillBindingService,
        ImprovementProposalRepository,
        AgentProfileSkillBindingService,
      ],
    },
```

Add `SkillCreateCompletionListener` to the providers array already lists it — no change needed there since it is a plain `@Injectable()` class NestJS resolves via constructor injection automatically, and `AgentProfileSkillBindingService` is already exported by `AiConfigModule`, which this module already imports.

- [ ] **Step 9: Run tests to verify everything passes**

Run: `npm run test --workspace=apps/api -- skill-assignment.applier.spec.ts skill-create-completion.listener.spec.ts skill-create.applier.assignment.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 10: Verify the API builds**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds — the Task 6 Step 6 compile errors are now resolved.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/improvement/appliers/skill-assignment.applier.ts \
  apps/api/src/improvement/appliers/skill-assignment.applier.spec.ts \
  apps/api/src/improvement/skill-create-completion.listener.ts \
  apps/api/src/improvement/skill-create-completion.listener.spec.ts \
  apps/api/src/improvement/improvement.module.ts
git commit -m "feat(improvement): wire scope_id through both skill_assignment call sites"
```

---

### Task 8: Scope-widening confirm/reject endpoint

**Files:**

- Create: `apps/api/src/improvement/skill-scope-confirmation.service.ts`
- Create: `apps/api/src/improvement/skill-scope-confirmation.service.spec.ts`
- Modify: `apps/api/src/improvement/improvement-proposals.controller.ts`
- Modify: `apps/api/src/improvement/improvement.module.ts`

**Interfaces:**

- Consumes: `ImprovementProposalRepository.findById`/`updateById` (existing); `AuthorizationService.can(userId, permissionName, scopeNodeId): Promise<boolean>` (existing, `apps/api/src/auth/authorization/authorization.service.ts`); `GLOBAL_SCOPE_NODE_ID` (existing, `apps/api/src/scope/scope.constants.ts`); `AgentSkillsService.getSkill`/`updateSkill` (existing).
- Produces: `SkillScopeConfirmationService.confirm(proposalId: string, userId: string): Promise<{ confirmed: boolean; reason?: string }>` and `.reject(proposalId: string): Promise<void>`; two new controller routes `POST /improvement/proposals/:id/scope/confirm` and `POST /improvement/proposals/:id/scope/reject`.

This is the endpoint that never existed before this feature — `'manual'` mode has always parked proposals with no way to act on them. Per the design spec, permission is checked against the _target_ scope node(s) the recommendation would reach into (every entry in `recommended_scope.projects`, or `GLOBAL_SCOPE_NODE_ID` if that list is empty), using the existing `AuthorizationService.can`, which already walks the `scope_node_closure` ancestor chain — a platform-level role assignment satisfies a project-level target automatically, with no new authorization logic.

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillScopeConfirmationService } from "./skill-scope-confirmation.service";
import { GLOBAL_SCOPE_NODE_ID } from "../scope/scope.constants";

function buildPendingProposal(
  recommendedScope: Record<string, unknown> | null,
) {
  return {
    id: "proposal-1",
    payload: { target_skill_name: "incident-response" },
    provenance: {
      materialization: {
        materialized: true,
        scope_confirmation: {
          pending: true,
          recommended_scope: recommendedScope,
          scope_rationale: "generalizes across projects",
        },
      },
    },
  };
}

describe("SkillScopeConfirmationService.confirm", () => {
  let proposals: any;
  let authz: any;
  let skillsService: any;
  let service: SkillScopeConfirmationService;

  beforeEach(() => {
    proposals = {
      findById: vi.fn(),
      updateById: vi.fn(),
    };
    authz = { can: vi.fn() };
    skillsService = {
      getSkill: vi.fn().mockReturnValue({
        name: "incident-response",
        skillMarkdown:
          "---\nname: incident-response\ndescription: handles incidents\n---\n",
      }),
      updateSkill: vi.fn(),
    };
    service = new SkillScopeConfirmationService(
      proposals,
      authz,
      skillsService,
    );
  });

  it("applies the recommended scope when the user has skills:update at every target project", async () => {
    proposals.findById.mockResolvedValue(
      buildPendingProposal({
        projects: ["scope-2"],
        agents: [],
        workflows: [],
      }),
    );
    authz.can.mockResolvedValue(true);

    const result = await service.confirm("proposal-1", "user-1");

    expect(result.confirmed).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      "user-1",
      "skills:update",
      "scope-2",
    );
    expect(skillsService.updateSkill).toHaveBeenCalledWith(
      "incident-response",
      {
        skill_markdown: expect.stringContaining("scope-2"),
      },
    );
    expect(proposals.updateById).toHaveBeenCalledWith(
      "proposal-1",
      expect.objectContaining({
        provenance: expect.objectContaining({
          materialization: expect.objectContaining({
            scope_confirmation: expect.objectContaining({
              pending: false,
              auto_applied: false,
            }),
          }),
        }),
      }),
    );
  });

  it("checks GLOBAL_SCOPE_NODE_ID when the recommendation has no project restriction", async () => {
    proposals.findById.mockResolvedValue(
      buildPendingProposal({ projects: [], agents: [], workflows: [] }),
    );
    authz.can.mockResolvedValue(true);

    await service.confirm("proposal-1", "user-1");

    expect(authz.can).toHaveBeenCalledWith(
      "user-1",
      "skills:update",
      GLOBAL_SCOPE_NODE_ID,
    );
  });

  it("refuses to apply when the user lacks permission at any target scope", async () => {
    proposals.findById.mockResolvedValue(
      buildPendingProposal({
        projects: ["scope-2", "scope-3"],
        agents: [],
        workflows: [],
      }),
    );
    authz.can.mockImplementation(
      async (_userId: string, _perm: string, scopeNodeId: string) =>
        scopeNodeId === "scope-2",
    );

    const result = await service.confirm("proposal-1", "user-1");

    expect(result.confirmed).toBe(false);
    expect(result.reason).toContain("scope-3");
    expect(skillsService.updateSkill).not.toHaveBeenCalled();
  });

  it("throws when the proposal has no pending scope confirmation", async () => {
    proposals.findById.mockResolvedValue({
      id: "proposal-1",
      payload: {},
      provenance: {},
    });

    await expect(service.confirm("proposal-1", "user-1")).rejects.toThrow(
      "no pending scope confirmation",
    );
  });
});

describe("SkillScopeConfirmationService.reject", () => {
  it("clears pending without changing the applied origin scope", async () => {
    const proposals = {
      findById: vi
        .fn()
        .mockResolvedValue(
          buildPendingProposal({
            projects: ["scope-2"],
            agents: [],
            workflows: [],
          }),
        ),
      updateById: vi.fn(),
    };
    const authz = { can: vi.fn() };
    const skillsService = { getSkill: vi.fn(), updateSkill: vi.fn() };
    const service = new SkillScopeConfirmationService(
      proposals as any,
      authz as any,
      skillsService as any,
    );

    await service.reject("proposal-1");

    expect(skillsService.updateSkill).not.toHaveBeenCalled();
    expect(proposals.updateById).toHaveBeenCalledWith(
      "proposal-1",
      expect.objectContaining({
        provenance: expect.objectContaining({
          materialization: expect.objectContaining({
            scope_confirmation: expect.objectContaining({ pending: false }),
          }),
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- skill-scope-confirmation.service.spec.ts`
Expected: FAIL with "Cannot find module './skill-scope-confirmation.service'"

- [ ] **Step 3: Write the implementation**

```typescript
import { BadRequestException, Injectable } from "@nestjs/common";
import * as yaml from "js-yaml";
import { AgentSkillsService } from "../ai-config/services/agent-skills.service";
import { AuthorizationService } from "../auth/authorization/authorization.service";
import { GLOBAL_SCOPE_NODE_ID } from "../scope/scope.constants";
import { ImprovementProposalRepository } from "./database/repositories/improvement-proposal.repository";
import type { ImprovementProposal } from "./database/entities/improvement-proposal.entity";

const SKILL_UPDATE_PERMISSION = "skills:update";

interface PendingScopeConfirmation {
  recommendedScope: {
    projects: string[];
    agents: string[];
    workflows: string[];
  } | null;
}

/**
 * The confirm/reject action for a `skill_create` proposal's LLM-recommended
 * scope, parked at `provenance.materialization.scope_confirmation.pending`
 * by {@link import('./skill-create-completion.listener').SkillCreateCompletionListener}.
 * This is the action that has never existed before this feature — `'manual'`
 * mode (the default) has always parked proposals with no way to act on them.
 *
 * Permission is checked against the scope(s) the recommendation would
 * actually widen INTO (every `recommended_scope.projects` entry, or
 * {@link GLOBAL_SCOPE_NODE_ID} when that list is empty, meaning "no project
 * restriction"), via the existing {@link AuthorizationService.can}, which
 * already walks the `scope_node_closure` ancestor chain — a role assigned at
 * an ancestor scope (e.g. a platform admin) satisfies a narrower target
 * automatically, with no new authorization concept introduced here. If the
 * confirming user lacks the permission at even one target scope, the whole
 * confirmation is refused (all-or-nothing) — the already-applied origin
 * scope from {@link import('./skill-create-completion.listener').SkillCreateCompletionListener.applyOriginScope}
 * is untouched either way.
 */
@Injectable()
export class SkillScopeConfirmationService {
  constructor(
    private readonly proposals: ImprovementProposalRepository,
    private readonly authz: AuthorizationService,
    private readonly skillsService: AgentSkillsService,
  ) {}

  async confirm(
    proposalId: string,
    userId: string,
  ): Promise<{ confirmed: boolean; reason?: string }> {
    const proposal = await this.loadProposal(proposalId);
    const pending = readPendingScopeConfirmation(proposal);

    const targetScopeNodeIds = resolveTargetScopeNodeIds(
      pending.recommendedScope,
    );
    const deniedScope = await this.findFirstDeniedScope(
      userId,
      targetScopeNodeIds,
    );
    if (deniedScope) {
      return {
        confirmed: false,
        reason: `missing ${SKILL_UPDATE_PERMISSION} permission at scope ${deniedScope}`,
      };
    }

    const skillName = readSkillName(proposal.payload);
    const record = this.skillsService.getSkill(skillName);
    const updatedMarkdown = buildScopedMarkdown(
      record.skillMarkdown,
      pending.recommendedScope,
    );
    this.skillsService.updateSkill(skillName, {
      skill_markdown: updatedMarkdown,
    });

    await this.proposals.updateById(proposalId, {
      provenance: mergeScopeConfirmation(proposal.provenance, {
        pending: false,
        confirmed_scope: pending.recommendedScope,
        auto_applied: false,
        confirmed_by: userId,
      }),
    });

    return { confirmed: true };
  }

  async reject(proposalId: string): Promise<void> {
    const proposal = await this.loadProposal(proposalId);
    readPendingScopeConfirmation(proposal);

    await this.proposals.updateById(proposalId, {
      provenance: mergeScopeConfirmation(proposal.provenance, {
        pending: false,
        rejected: true,
      }),
    });
  }

  private async loadProposal(proposalId: string): Promise<ImprovementProposal> {
    const proposal = await this.proposals.findById(proposalId);
    if (!proposal) {
      throw new BadRequestException(`proposal ${proposalId} not found`);
    }
    return proposal;
  }

  private async findFirstDeniedScope(
    userId: string,
    scopeNodeIds: string[],
  ): Promise<string | null> {
    for (const scopeNodeId of scopeNodeIds) {
      const allowed = await this.authz.can(
        userId,
        SKILL_UPDATE_PERMISSION,
        scopeNodeId,
      );
      if (!allowed) {
        return scopeNodeId;
      }
    }
    return null;
  }
}

function resolveTargetScopeNodeIds(
  recommendedScope: PendingScopeConfirmation["recommendedScope"],
): string[] {
  const projects = recommendedScope?.projects ?? [];
  return projects.length > 0 ? projects : [GLOBAL_SCOPE_NODE_ID];
}

function readPendingScopeConfirmation(
  proposal: ImprovementProposal,
): PendingScopeConfirmation {
  const materialization = readRecord(proposal.provenance?.materialization);
  const scopeConfirmation = readRecord(materialization?.scope_confirmation);
  if (!scopeConfirmation?.pending) {
    throw new BadRequestException(
      `proposal ${proposal.id} has no pending scope confirmation`,
    );
  }
  return {
    recommendedScope: readScope(scopeConfirmation.recommended_scope),
  };
}

function readScope(
  value: unknown,
): { projects: string[]; agents: string[]; workflows: string[] } | null {
  const record = readRecord(value);
  if (!record) return null;
  return {
    projects: readStringArray(record.projects),
    agents: readStringArray(record.agents),
    workflows: readStringArray(record.workflows),
  };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readSkillName(payload: Record<string, unknown>): string {
  const name = payload?.target_skill_name;
  if (typeof name !== "string" || name.length === 0) {
    throw new BadRequestException("proposal payload has no target_skill_name");
  }
  return name;
}

function mergeScopeConfirmation(
  provenance: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> {
  const materialization = readRecord(provenance?.materialization) ?? {};
  const scopeConfirmation =
    readRecord(materialization.scope_confirmation) ?? {};
  return {
    ...provenance,
    materialization: {
      ...materialization,
      scope_confirmation: { ...scopeConfirmation, ...update },
    },
  };
}

/**
 * Rewrite the target skill's frontmatter `scope` from a confirmed scope.
 * Mirrors `SkillCreateCompletionListener`'s private `buildScopedMarkdown` —
 * deliberately duplicated rather than shared across modules for the same
 * reason `readScopeId` is duplicated elsewhere in this codebase (small, pure,
 * module-local helper; not worth an extraction that adds an import edge
 * between two otherwise-independent services for four lines of logic).
 */
function buildScopedMarkdown(
  currentMarkdown: string,
  scope: { projects: string[]; agents: string[]; workflows: string[] } | null,
): string {
  const match = currentMarkdown.match(/^(---\n)([\s\S]*?)(\n---)([\s\S]*)$/);
  if (!match) {
    return currentMarkdown;
  }
  const frontmatter = (yaml.load(match[2]) ?? {}) as Record<string, unknown>;
  if (scope === null) {
    delete frontmatter.scope;
  } else {
    const scopeObj: Record<string, string[]> = {};
    if (scope.projects.length) scopeObj.projects = scope.projects;
    if (scope.agents.length) scopeObj.agents = scope.agents;
    if (scope.workflows.length) scopeObj.workflows = scope.workflows;
    if (Object.keys(scopeObj).length > 0) {
      frontmatter.scope = scopeObj;
    } else {
      delete frontmatter.scope;
    }
  }
  const serialized = yaml.dump(frontmatter).trimEnd();
  return `---\n${serialized}\n---${match[4]}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- skill-scope-confirmation.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Add the controller routes**

In `apps/api/src/improvement/improvement-proposals.controller.ts`, add the import and inject the new service:

```typescript
import { SkillScopeConfirmationService } from "./skill-scope-confirmation.service";
import { JwtUser } from "../auth/jwt-user.types";
import { Req } from "@nestjs/common";
```

(Add `Req` to the existing `@nestjs/common` import line rather than a second import statement.)

```typescript
  constructor(
    private readonly improvementProposalService: ImprovementProposalService,
    private readonly skillScopeConfirmation: SkillScopeConfirmationService,
  ) {}
```

Add the two routes (after the existing `rollback` route):

```typescript
  @Post(':id/scope/confirm')
  @RequirePermission('improvements:manage')
  @ApiOperation({
    summary: 'Confirm a skill_create proposal\'s recommended scope widening',
  })
  async confirmScope(
    @ZodParam('id', proposalIdSchema) id: string,
    @Req() req: { user: JwtUser },
  ): Promise<{ success: true; confirmed: boolean; reason?: string }> {
    const result = await this.skillScopeConfirmation.confirm(
      id,
      req.user.userId,
    );
    return { success: true, ...result };
  }

  @Post(':id/scope/reject')
  @RequirePermission('improvements:manage')
  @ApiOperation({ summary: 'Reject a skill_create proposal\'s recommended scope widening' })
  async rejectScope(
    @ZodParam('id', proposalIdSchema) id: string,
  ): Promise<{ success: true }> {
    await this.skillScopeConfirmation.reject(id);
    return { success: true };
  }
```

- [ ] **Step 6: Register the service in `improvement.module.ts`**

Add the import and providers entry:

```typescript
import { SkillScopeConfirmationService } from "./skill-scope-confirmation.service";
```

```typescript
  providers: [
    ImprovementProposalService,
    ImprovementGovernancePolicyService,
    ImprovementApplierRegistry,
    ImprovementTaskEventPublisher,
    CodeChangeDedupService,
    CodeChangeProposalIntakeService,
    SkillCreateApplier,
    AgentProfileChangeApplier,
    WorkflowDefinitionChangeApplier,
    CodeChangeApplier,
    SkillCreateCompletionListener,
    SkillScopeConfirmationService,
    // ...factory providers unchanged
```

`AuthorizationModule` (for `AuthorizationService`) and `AiConfigModule` (for `AgentSkillsService`) are both already imported into `ImprovementModule` — no further module import changes needed.

- [ ] **Step 7: Verify the API builds**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/improvement/skill-scope-confirmation.service.ts \
  apps/api/src/improvement/skill-scope-confirmation.service.spec.ts \
  apps/api/src/improvement/improvement-proposals.controller.ts \
  apps/api/src/improvement/improvement.module.ts
git commit -m "feat(improvement): add skill scope widening confirm/reject endpoint"
```

---

### Task 9: Wipe existing skill/assignment data

**Files:**

- Create: `apps/api/src/database/migrations/20260714050000-reset-skill-scope-data.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts`

**Interfaces:**

- None — this is a one-time data migration, not a code interface other tasks depend on.

Per the design spec's explicit instruction: wipe all existing skill assignments and skill rows (including hand-configured ones), rather than reconcile them, now that the new scope-aware system is built and tested. This also clears the on-disk `storage/skills/<name>/` directories the `AgentSkill`/`skills`-corpus rows point at, since a migration alone cannot delete files — the migration truncates the DB tables and the accompanying step below removes the directory tree.

- [ ] **Step 1: Write the migration**

```typescript
import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * One-time reset: wipe every existing skill assignment and skill definition
 * now that project/project+agent scoping (this feature) is built and tested.
 * Per explicit product decision, this clears ALL assignments, including ones
 * an operator configured by hand — not just pipeline-created ones — since
 * none of the pre-existing data carries scope information the new system
 * can make sense of. `agent_profile_skill_bindings` (this feature's own new
 * table) is not touched — it starts empty regardless.
 */
export class ResetSkillScopeData20260714050000 implements MigrationInterface {
  name = "ResetSkillScopeData20260714050000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE agent_profiles SET assigned_skills = NULL;`,
    );
    await queryRunner.query(`DELETE FROM agent_profile_skills;`);
    await queryRunner.query(`DELETE FROM agent_skills;`);
    await queryRunner.query(`DELETE FROM skills;`);
    await queryRunner.query(
      `DELETE FROM improvement_proposals WHERE kind IN ('skill_create', 'skill_assignment');`,
    );
  }

  public async down(): Promise<void> {
    // Intentionally irreversible: the deleted rows and cleared column values
    // cannot be reconstructed. A rollback of this migration is a no-op.
  }
}
```

- [ ] **Step 2: Register the migration**

In `apps/api/src/database/migrations/registered-migrations.ts`, add the import at the top:

```typescript
import { ResetSkillScopeData20260714050000 } from "./20260714050000-reset-skill-scope-data";
```

And add it as the first entry in `registeredMigrations` (before `CreateAgentProfileSkillBindings20260714040000` from Task 1, so it runs after the new table exists but that ordering does not actually matter here since this migration never touches `agent_profile_skill_bindings` — list order in the array does not control execution order, TypeORM orders by migration timestamp/name regardless of array position, so just add it anywhere in the array):

```typescript
export const registeredMigrations = [
  ResetSkillScopeData20260714050000,
  CreateAgentProfileSkillBindings20260714040000,
  AddToolRegistrySource20260714030000,
  // ...existing entries unchanged
```

- [ ] **Step 3: Remove the on-disk skill library directory**

This step is a manual operational action, not something the migration can do (TypeORM migrations only touch the database). Run once, against the actual deployment's skill storage path (the default is `storage/skills` relative to the API process's working directory, overridable via `NEXUS_SKILLS_LIBRARY_PATH` — check the running environment's value of that variable before running this):

```bash
rm -rf storage/skills
```

Expected: the directory is removed; `AgentSkillLibraryService` recreates it empty on next boot (`fs.mkdirSync(this.libraryRoot, { recursive: true })` in its constructor).

- [ ] **Step 4: Verify the migration runs cleanly against a scratch database**

Run: `npm run build --workspace=apps/api` (confirms the migration file compiles), then start the API against a disposable/dev database with `TYPEORM_MIGRATIONS_RUN` unset (default: migrations run) and confirm no errors in the startup log about this migration.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/database/migrations/20260714050000-reset-skill-scope-data.ts \
  apps/api/src/database/migrations/registered-migrations.ts
git commit -m "chore(db): reset existing skill assignments for the new scope model"
```

---

### Task 10: End-to-end integration test

**Files:**

- Create: `packages/e2e-tests/src/skill-scope-model.integration.spec.ts` (adjust the exact path/naming to match this package's existing integration-spec conventions — check `packages/e2e-tests/src` for a similarly-scoped existing spec, e.g. a retrospective or improvement-pipeline integration test, and mirror its file location and NestJS `TestingModule` bootstrap pattern before writing this one)

**Interfaces:**

- Consumes: everything built in Tasks 1–8, exercised through real NestJS DI (not hand-mocked) against a real test database.

- [ ] **Step 1: Find the closest existing integration test to mirror**

Search `packages/e2e-tests/src` for an existing spec that boots a NestJS `TestingModule` covering `ImprovementModule`/`WorkflowRetrospectiveModule` (e.g. anything asserting on `skill_create`/`skill_assignment` proposal outcomes end-to-end) and read it in full — this determines the exact module-bootstrap boilerplate, test-database setup/teardown, and fixture-seeding helpers this task's spec must reuse rather than reinvent.

- [ ] **Step 2: Write the failing test**

Using the bootstrap pattern found in Step 1, write a spec asserting:

```typescript
it("scopes a skill_assignment proposal to its originating project, invisible to a different project", async () => {
  // 1. Seed two scope_nodes of type 'project' (scopeA, scopeB) under the
  //    global root, and two agent_profiles ('profile-a', 'profile-b') with
  //    no pre-existing skill assignments.
  // 2. Seed one pre-existing AgentSkill named 'incident-response' (so the
  //    retrospective router's skillExists() check routes to skill_assignment,
  //    not skill_create).
  // 3. Submit an improvement proposal via ImprovementProposalService.submitProposal
  //    with kind: 'skill_assignment', payload: { skillName: 'incident-response',
  //    assignment_targets: [{ type: 'agent_profile', profileName: 'profile-a' }] },
  //    provenance: { scope_id: scopeA.id }, evidence/confidence sufficient for
  //    the default governance mode to auto-apply (mirror an existing
  //    submitProposal integration test's evidence/confidence fixture values).
  // 4. Assert the proposal reaches status 'applied'.
  // 5. Resolve effective skills for ('profile-a', scopeA.id) via
  //    WorkflowStageSkillPolicyService.resolveAssignedSkills and assert
  //    'incident-response' is present.
  // 6. Resolve effective skills for ('profile-a', scopeB.id) — a different
  //    project — and assert 'incident-response' is ABSENT (this is the
  //    exact bug this feature fixes: before this change, the same call would
  //    have returned the skill regardless of scope).
  // 7. Resolve effective skills for ('profile-b', scopeA.id) — same project,
  //    different profile — and assert 'incident-response' is ABSENT (proving
  //    the project+agent tier, not just the project tier, is respected when
  //    the assignment target is a specific profile).
});
```

Fill in the actual seeding/assertion code using this package's real repository/service APIs and fixture helpers discovered in Step 1 — the numbered comments above are the required assertions, not a placeholder for the final test; replace each with executable code before this step is considered done.

- [ ] **Step 3: Run test to verify it fails**

Run the package's integration test command (e.g. `npm run test:integration:kanban-core`-equivalent for `packages/e2e-tests` — check `package.json` in that package for the exact script name) targeting this new spec file.
Expected: FAIL before Task 1–8's code exists in this environment would be the pre-condition; since those tasks are already implemented by this point in the plan, the realistic failure mode here is a fixture/setup bug in the new spec itself — debug until the test's _assertions_ are what's failing, not a setup error, then proceed.

- [ ] **Step 4: Debug to green**

Iterate on the spec until all three resolution assertions (Steps 5–7 in the test) pass against the real, wired-together system.

- [ ] **Step 5: Run the full API and e2e test suites**

Run: `npm run test:api` and the `packages/e2e-tests` suite identified in Step 3.
Expected: PASS, no regressions in either suite.

- [ ] **Step 6: Commit**

```bash
git add packages/e2e-tests/src/skill-scope-model.integration.spec.ts
git commit -m "test(e2e): cover project and project+agent skill scoping end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1–3 cover the additive `agent_profile_skill_bindings` table and its resolution wiring (spec §2–3). Task 4–5 cover origin-vs-recommended scope and the never-auto-widen rule (spec §4). Task 6–7 cover the previously-unscoped `skill_assignment` path (spec §2, "no representation per tier" fix). Task 8 covers the escalation guard / confirm action (spec §5) — the one piece of this feature with no prior code to extend. Task 9 covers migration (spec §6). Task 10 covers the testing plan's integration-test requirement (spec §7). The spec's two "Open Questions" (ancestor inheritance default, proposal-row preserve-vs-delete) are resolved in this plan: ancestor inheritance is implemented in Task 2 (`getAncestorIds`) per the spec's own recommendation, and Task 9 hard-deletes `skill_create`/`skill_assignment` proposal rows per the explicit "wipe everything" product decision.
- **Placeholder scan:** Task 10 contains descriptive seeding/assertion steps rather than fully-inlined code, because the exact fixture/bootstrap helpers live in an existing `packages/e2e-tests` spec this plan could not read during authoring (outside `apps/api`, not investigated). This is flagged explicitly in Task 10 itself as a "read first, then replace" step, not left as a silent gap — treat Task 10 as needing one extra research pass (Step 1) before its code is written, unlike every other task in this plan which is fully concrete already.
- **Type consistency:** `SkillAssignmentDeps['skills'].addScopedProfileSkill` (Task 6) is the exact shape both the `SkillAssignmentApplier` factory and `SkillCreateCompletionListener` (Task 7) implement against. `AgentProfileSkillBindingService.addProfileScopedBinding`/`addProjectScopedBinding`/`listApplicableSkillNames` (Task 2) are the exact method names Task 3, Task 7, and Task 8 all call. `decideScopeApplication`'s new `originScopeId` field (Task 4) is threaded through by Task 5's updated `tryAutoApplyScope` call.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-05-skill-learning-scope-model.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
