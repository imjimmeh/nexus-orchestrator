# Tool Registry Source Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the already-computed tool `source` (`decorator_provider` | `internal_tool_handler` | `external_mcp` | `external_acp` | `manual`) onto `tool_registry` rows and surface it on the Tools page, so built-in/MCP/ACP tools are visually distinguished from custom tools and no longer show a fake, editable TypeScript snippet.

**Architecture:** Add a `source` column to `tool_registry` (default `'manual'`) and thread the value that already exists in-memory (`CanonicalCapabilityDefinition.source`) through the two places that currently discard it before persistence. The web Tools page reads `source` to render a badge and to choose between the existing editable form (for `manual` tools) and a new read-only detail view (for everything else).

**Tech Stack:** NestJS + TypeORM (Postgres) on the API; React + react-hook-form + shadcn/ui on the web; Vitest + Testing Library for tests on both sides.

## Global Constraints

- Never widen `createToolSchema`/`upsertToolSchema`/`updateToolSchema` (`packages/core/src/schemas/tools/tool-management-requests.schema.ts`) to accept a client-supplied `source` — it must remain server-computed only.
- Build `packages/core` before running/building `apps/api` or `apps/web` after any change to its exported types (repo convention, see root `CLAUDE.md`).
- Follow existing migration convention: raw SQL via `queryRunner.query()`, `ADD COLUMN IF NOT EXISTS` / `DROP COLUMN IF EXISTS` pair, registered in `apps/api/src/database/migrations/registered-migrations.ts`, paired `.spec.ts`.
- Test file convention on the web side is colocated `*.spec.tsx`/`*.spec.ts` (NOT `*.test.tsx`).
- No `eslint-disable`, `@ts-ignore`, or `@ts-nocheck` — fix findings directly.

---

### Task 1: Add persisted `source` field (shared types, entity, migration)

**Files:**

- Modify: `packages/core/src/interfaces/workflow-legacy.types.ts:57-78`
- Modify: `apps/api/src/capability-infra/canonical-capability.types.ts:1-9`
- Modify: `apps/api/src/tool/database/entities/tool-registry.entity.ts:28-33`
- Create: `apps/api/src/database/migrations/20260714030000-add-tool-registry-source.ts`
- Create: `apps/api/src/database/migrations/20260714030000-add-tool-registry-source.spec.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts:1,98`
- Modify: `apps/api/src/workflow/workflow-step-execution/step-support.service.spec.ts:1037-1048`
- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-container-schema.integration.spec.ts:42-95`
- Modify: `apps/api/src/plugin-kernel/contributions/plugin-tool-projection.service.spec.ts:82-96`

**Interfaces:**

- Produces: `ToolRegistrySource` type (`packages/core`) = `"decorator_provider" | "internal_tool_handler" | "external_mcp" | "external_acp" | "manual"`; `IToolRegistry.source: ToolRegistrySource` (required); `ToolRegistry.source` entity column of the same shape. Later tasks read/write `entry.source`, `data.source`, `tool.source`.

This task makes `source` a **required** field on `IToolRegistry`, which the `ToolRegistry` entity `implements`. The type change and the entity/migration change must land together — the entity would otherwise fail to satisfy the interface. Three existing spec files construct full (non-`Partial`) `IToolRegistry` object literals and must be updated in the same commit or the API test suite won't compile.

- [ ] **Step 1: Write the failing migration test**

Create `apps/api/src/database/migrations/20260714030000-add-tool-registry-source.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { AddToolRegistrySource20260714030000 } from "./20260714030000-add-tool-registry-source";

describe("AddToolRegistrySource migration", () => {
  it("adds the source column with a manual default", async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new AddToolRegistrySource20260714030000().up({ query } as never);

    const sql = query.mock.calls.map((call) => call[0] as string).join("\n");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS source");
    expect(sql).toContain("DEFAULT 'manual'");
  });

  it("drops the source column in down()", async () => {
    const query = vi.fn().mockResolvedValue(undefined);

    await new AddToolRegistrySource20260714030000().down({ query } as never);

    const sql = query.mock.calls.map((call) => call[0] as string).join("\n");
    expect(sql).toContain("DROP COLUMN IF EXISTS source");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/api/src/database/migrations/20260714030000-add-tool-registry-source.spec.ts --workspace=apps/api`
Expected: FAIL — cannot find module `./20260714030000-add-tool-registry-source`.

- [ ] **Step 3: Write the migration**

Create `apps/api/src/database/migrations/20260714030000-add-tool-registry-source.ts`:

```ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddToolRegistrySource20260714030000 implements MigrationInterface {
  name = "AddToolRegistrySource20260714030000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tool_registry
      ADD COLUMN IF NOT EXISTS source varchar(32) NOT NULL DEFAULT 'manual';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tool_registry
      DROP COLUMN IF EXISTS source;
    `);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/api/src/database/migrations/20260714030000-add-tool-registry-source.spec.ts --workspace=apps/api`
Expected: PASS (2 tests)

- [ ] **Step 5: Register the migration**

In `apps/api/src/database/migrations/registered-migrations.ts`, add the import after line 1 (top of the import list, matching newest-first ordering) and the entry as the first array element:

```ts
import { AddToolRegistrySource20260714030000 } from "./20260714030000-add-tool-registry-source";
import { CreateInvitations20260714020000 } from "./20260714020000-create-invitations";
```

```ts
export const registeredMigrations = [
  AddToolRegistrySource20260714030000,
  CreateInvitations20260714020000,
```

- [ ] **Step 6: Add `ToolRegistrySource` and `IToolRegistry.source` to `packages/core`**

In `packages/core/src/interfaces/workflow-legacy.types.ts`, insert before `export interface IToolRegistry {` (currently line 57):

```ts
export type ToolRegistrySource =
  | "decorator_provider"
  | "internal_tool_handler"
  | "external_mcp"
  | "external_acp"
  | "manual";
```

Then add `source` to the interface body, right after `tier_restriction: number;`:

```ts
  tier_restriction: number;
  source: ToolRegistrySource;
  runtime_owner?: "api" | "runner";
```

- [ ] **Step 7: Reuse the core type in `apps/api`'s `CanonicalCapabilitySource`**

Replace the top of `apps/api/src/capability-infra/canonical-capability.types.ts` (currently lines 1-9):

```ts
import type { IToolRegistry } from "@nexus/core";
import type { CapabilityManifestEntry } from "./capability-manifest.types";

export type CanonicalCapabilitySource =
  | "decorator_provider"
  | "internal_tool_handler"
  | "external_mcp"
  | "external_acp"
  | "manual";
```

with:

```ts
import type { IToolRegistry, ToolRegistrySource } from "@nexus/core";
import type { CapabilityManifestEntry } from "./capability-manifest.types";

export type CanonicalCapabilitySource = ToolRegistrySource;
```

- [ ] **Step 8: Add the entity column**

In `apps/api/src/tool/database/entities/tool-registry.entity.ts`, add a column right after `tier_restriction` (currently lines 31-32):

```ts
  @Column({ type: 'int', default: 0 })
  tier_restriction: number;

  @Column({ type: 'varchar', length: 32, default: 'manual' })
  source: IToolRegistry['source'];

  @Column({ type: 'varchar', length: 16, nullable: true })
  runtime_owner?: IToolRegistry['runtime_owner'];
```

- [ ] **Step 9: Fix full-literal `IToolRegistry` test fixtures**

These three fixtures build a complete (non-`Partial`) `IToolRegistry` object and will fail to typecheck without `source`.

In `apps/api/src/workflow/workflow-step-execution/step-support.service.spec.ts`, update `makeTool` (currently lines 1037-1048):

```ts
function makeTool(overrides: Partial<IToolRegistry> = {}): IToolRegistry {
  return {
    id: "tool-1",
    name: "read",
    schema: { type: "object", properties: {} },
    typescript_code: "",
    tier_restriction: 1,
    source: "manual",
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}
```

In `apps/api/src/workflow/workflow-step-execution/step-agent-container-schema.integration.spec.ts`, add `source: 'decorator_provider',` right after `tier_restriction: 1,` in both `buildBaseSetJobOutputTool` (currently line 62) and `buildReadTool` (currently line 89):

```ts
    typescript_code:
      'export default async function setJobOutput() { return { ok: true }; }',
    tier_restriction: 1,
    source: 'decorator_provider',
    runtime_owner: 'api',
```

```ts
    typescript_code:
      "export default async function read() { return { content: '' }; }",
    tier_restriction: 1,
    source: 'decorator_provider',
    runtime_owner: 'runner',
```

In `apps/api/src/plugin-kernel/contributions/plugin-tool-projection.service.spec.ts`, add `source: 'manual',` to `buildTool` before the `...overrides` spread (currently lines 82-96):

```ts
function buildTool(overrides: Partial<IToolRegistry> = {}): IToolRegistry {
  return {
    id: "tool-1",
    name: "plugin:com.acme.workflow-tools:summarize",
    schema: toolInputSchema,
    typescript_code: "export async function execute() { return {}; }",
    tier_restriction: 0,
    source: "manual",
    runtime_owner: "api",
    transport: "api_callback",
    api_callback: true,
    created_at: new Date("2026-05-18T00:00:00.000Z"),
    updated_at: new Date("2026-05-18T00:00:00.000Z"),
    ...overrides,
  };
}
```

- [ ] **Step 10: Build core and verify the API compiles and tests pass**

Run:

```bash
npm run build --workspace=packages/core
npx vitest run --workspace=apps/api src/database/migrations/20260714030000-add-tool-registry-source.spec.ts src/workflow/workflow-step-execution/step-support.service.spec.ts src/workflow/workflow-step-execution/step-agent-container-schema.integration.spec.ts src/plugin-kernel/contributions/plugin-tool-projection.service.spec.ts
```

Expected: build succeeds, all listed test files PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/interfaces/workflow-legacy.types.ts \
  apps/api/src/capability-infra/canonical-capability.types.ts \
  apps/api/src/tool/database/entities/tool-registry.entity.ts \
  apps/api/src/database/migrations/20260714030000-add-tool-registry-source.ts \
  apps/api/src/database/migrations/20260714030000-add-tool-registry-source.spec.ts \
  apps/api/src/database/migrations/registered-migrations.ts \
  apps/api/src/workflow/workflow-step-execution/step-support.service.spec.ts \
  apps/api/src/workflow/workflow-step-execution/step-agent-container-schema.integration.spec.ts \
  apps/api/src/plugin-kernel/contributions/plugin-tool-projection.service.spec.ts
git commit -m "feat(api): add persisted source column to tool_registry"
```

---

### Task 2: Thread `source` through the capability manifest mapper

**Files:**

- Modify: `apps/api/src/capability-infra/capability-manifest-to-tool-registry.mapper.ts`
- Create: `apps/api/src/capability-infra/capability-manifest-to-tool-registry.mapper.spec.ts`
- Modify: `apps/api/src/tool-registry/tool-catalog.service.ts`
- Delete: `apps/api/src/tool/tool-catalog.service.spec.ts`

**Interfaces:**

- Consumes: `CanonicalCapabilityDefinition` (`apps/api/src/capability-infra/canonical-capability.types.ts`, has `.source: CanonicalCapabilitySource`), `IToolRegistry` (Task 1).
- Produces: `mapCapabilityEntryToToolRegistryPayload(entry: CanonicalCapabilityDefinition): Partial<IToolRegistry>` — now includes `source` in its return value. This is consumed by `CapabilityRegistrarService` in Task 3 (already does, no signature change needed there).

`mapCapabilityEntryToToolRegistryPayload` currently takes a `CapabilityManifestEntry`, which has no `source` field — the wrapping `CanonicalCapabilityDefinition` does. Its only other caller, `ToolCatalogService.getBuiltInTools()`, passes a plain `CapabilityManifestEntry` (no `source`) and has zero production callers (only its own now-deleted spec) — deleting it removes the one caller that would otherwise conflict with tightening the mapper's parameter type.

- [ ] **Step 1: Write the failing mapper test**

Create `apps/api/src/capability-infra/capability-manifest-to-tool-registry.mapper.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapCapabilityEntryToToolRegistryPayload } from "./capability-manifest-to-tool-registry.mapper";
import type { CanonicalCapabilityDefinition } from "./canonical-capability.types";

const baseEntry: CanonicalCapabilityDefinition = {
  name: "file.read",
  description: "Read a file",
  schema: { type: "object" },
  typescriptCode: "export const tool = {};",
  tierRestriction: 1,
  transport: "api_callback",
  runtimeOwner: "api",
  policyTags: [],
  apiCallback: {
    method: "POST",
    pathTemplate: "/api/tools/file/read",
  },
  source: "decorator_provider",
};

describe("mapCapabilityEntryToToolRegistryPayload", () => {
  it("includes the entry source in the resulting payload", () => {
    const payload = mapCapabilityEntryToToolRegistryPayload(baseEntry);

    expect(payload.source).toBe("decorator_provider");
  });

  it("carries through external MCP source values unchanged", () => {
    const payload = mapCapabilityEntryToToolRegistryPayload({
      ...baseEntry,
      source: "external_mcp",
    });

    expect(payload.source).toBe("external_mcp");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/api/src/capability-infra/capability-manifest-to-tool-registry.mapper.spec.ts --workspace=apps/api`
Expected: FAIL — `payload.source` is `undefined`.

- [ ] **Step 3: Update the mapper**

Replace `apps/api/src/capability-infra/capability-manifest-to-tool-registry.mapper.ts` in full:

```ts
import type { IToolRegistry } from "@nexus/core";
import type { CanonicalCapabilityDefinition } from "./canonical-capability.types";

export function mapCapabilityEntryToToolRegistryPayload(
  entry: CanonicalCapabilityDefinition,
): Partial<IToolRegistry> {
  return {
    name: entry.name,
    schema: entry.schema,
    typescript_code: entry.typescriptCode,
    tier_restriction: entry.tierRestriction,
    transport: entry.transport,
    runtime_owner: entry.runtimeOwner,
    source: entry.source,
    api_callback: entry.apiCallback
      ? {
          method: entry.apiCallback.method,
          path_template: entry.apiCallback.pathTemplate,
          body_mapping: entry.apiCallback.bodyMapping,
        }
      : undefined,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/api/src/capability-infra/capability-manifest-to-tool-registry.mapper.spec.ts --workspace=apps/api`
Expected: PASS (2 tests)

- [ ] **Step 5: Delete the now-conflicting dead method**

The mapper's parameter type is now `CanonicalCapabilityDefinition` (has `.source`), but `ToolCatalogService.getBuiltInTools()` passes a plain `CapabilityManifestEntry` (no `.source`) and has no production callers (verified: only referenced by its own spec). Delete the method and its now-unused imports.

Replace `apps/api/src/tool-registry/tool-catalog.service.ts` in full:

```ts
import { Injectable } from "@nestjs/common";
import { CapabilityRegistryService } from "../capability-infra/capability-registry.service";
import type { CapabilityManifestEntry } from "../capability-infra/capability-manifest.types";

@Injectable()
export class ToolCatalogService {
  constructor(private readonly capabilityRegistry: CapabilityRegistryService) {}

  getBuiltInCapabilityEntries(): CapabilityManifestEntry[] {
    return this.capabilityRegistry.getDiscoveredEntries();
  }
}
```

Delete `apps/api/src/tool/tool-catalog.service.spec.ts` (its only test, `getBuiltInTools`, no longer exists):

```bash
rm apps/api/src/tool/tool-catalog.service.spec.ts
```

- [ ] **Step 6: Run the full affected test set and typecheck**

Run:

```bash
npx vitest run --workspace=apps/api src/capability-infra/capability-manifest-to-tool-registry.mapper.spec.ts src/tool-registry
npm run build --workspace=apps/api
```

Expected: all PASS, build succeeds (confirms no remaining reference to the deleted method/spec).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/capability-infra/capability-manifest-to-tool-registry.mapper.ts \
  apps/api/src/capability-infra/capability-manifest-to-tool-registry.mapper.spec.ts \
  apps/api/src/tool-registry/tool-catalog.service.ts
git rm apps/api/src/tool/tool-catalog.service.spec.ts
git commit -m "feat(api): thread capability source through the manifest mapper"
```

---

### Task 3: Stop discarding `source` in `CapabilityRegistrarService.registerToolProjection`

**Files:**

- Modify: `apps/api/src/tool-registry/capability-registrar.service.ts:63-67`
- Modify: `apps/api/src/tool/capability-registrar.service.spec.ts:82-107`

**Interfaces:**

- Consumes: `ToolProjectionRegistrationRequest { tool: Partial<IToolRegistry>; source: CanonicalCapabilitySource; sourceMetadata?: Record<string, unknown> }` (unchanged shape, already defined).
- Produces: `registerToolProjection` now calls `this.toolRegistry.upsertTool({ ...request.tool, source: request.source })` instead of dropping `source`. This is the path used by `apps/mcp/mcp-runtime-manager.service.ts`, `apps/acp/acp-runtime-manager.service.ts`, and `apps/api/src/workflow/workflow-delegation-tools/workflow-delegation-tool-projection.service.ts` — no changes needed in those three callers, they already pass `source` correctly.

- [ ] **Step 1: Strengthen the existing failing assertion**

In `apps/api/src/tool/capability-registrar.service.spec.ts`, update the `'registers external tool projections through tool registry service'` test (currently lines 82-107) to assert the source is actually forwarded:

```ts
it("registers external tool projections through tool registry service", async () => {
  const upserted = { id: "tool-1", name: "mcp:server/tool" };
  const toolRegistry = {
    upsertTool: vi.fn().mockResolvedValue(upserted),
  } as unknown as ToolRegistryService;
  const toolRegistryRepository = {
    findByName: vi.fn().mockResolvedValue(null),
  } as unknown as ToolRegistryRepository;

  const service = new CapabilityRegistrarService(
    toolRegistry,
    toolRegistryRepository,
  );

  const result = await service.registerToolProjection({
    source: "external_mcp",
    sourceMetadata: { server_id: "server-1" },
    tool: {
      name: "mcp:server-1/tool-1",
      schema: { type: "object" },
    },
  });

  expect(result).toEqual(upserted);
  expect(toolRegistry.upsertTool).toHaveBeenCalledTimes(1);
  expect(toolRegistry.upsertTool).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "mcp:server-1/tool-1",
      source: "external_mcp",
    }),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/api/src/tool/capability-registrar.service.spec.ts --workspace=apps/api`
Expected: FAIL — `upsertTool` called without `source` in the payload.

- [ ] **Step 3: Fix `registerToolProjection`**

In `apps/api/src/tool-registry/capability-registrar.service.ts`, replace (currently lines 63-67):

```ts
  async registerToolProjection(
    request: ToolProjectionRegistrationRequest,
  ): Promise<IToolRegistry> {
    return this.toolRegistry.upsertTool(request.tool);
  }
```

with:

```ts
  async registerToolProjection(
    request: ToolProjectionRegistrationRequest,
  ): Promise<IToolRegistry> {
    return this.toolRegistry.upsertTool({
      ...request.tool,
      source: request.source,
    });
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/api/src/tool/capability-registrar.service.spec.ts --workspace=apps/api`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tool-registry/capability-registrar.service.ts \
  apps/api/src/tool/capability-registrar.service.spec.ts
git commit -m "fix(api): stop dropping tool source in registerToolProjection"
```

---

### Task 4: Thread `source` through `ToolPayloadMapper`

**Files:**

- Modify: `apps/api/src/tool-registry/tool-payload.mapper.ts`
- Create: `apps/api/src/tool-registry/tool-payload.mapper.spec.ts`

**Interfaces:**

- Consumes: `ToolPayloadInput` (existing type in this file, `Partial<IToolRegistry> & {...}`), which already includes `source?: ToolRegistrySource` transitively via `Partial<IToolRegistry>`.
- Produces: `toCreatePayload` now includes `source` when present on the input. `toUpdatePayload` deliberately continues to omit `source` — Task 5 relies on `toCreatePayload` carrying `source` through for both the built-in/MCP/ACP registrar path and the user-facing create path.

Without this fix, Tasks 2 and 3's payloads would have `source` set in memory but it would be silently stripped here before reaching the repository — this is the third of the three drop points identified during design.

- [ ] **Step 1: Write the failing payload mapper tests**

Create `apps/api/src/tool-registry/tool-payload.mapper.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ToolPayloadMapper } from "./tool-payload.mapper";

describe("ToolPayloadMapper", () => {
  const mapper = new ToolPayloadMapper();

  it("includes source in the create payload when provided", () => {
    const payload = mapper.toCreatePayload({
      name: "file.read",
      schema: { type: "object" },
      typescript_code: "export const tool = {};",
      source: "decorator_provider",
    });

    expect(payload.source).toBe("decorator_provider");
  });

  it("omits source from the create payload when not provided", () => {
    const payload = mapper.toCreatePayload({
      name: "file.read",
      schema: { type: "object" },
      typescript_code: "export const tool = {};",
    });

    expect(payload.source).toBeUndefined();
  });

  it("never includes source in the update payload, even when provided", () => {
    const payload = mapper.toUpdatePayload({
      name: "file.read",
      source: "manual",
    });

    expect(payload.source).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npx vitest run apps/api/src/tool-registry/tool-payload.mapper.spec.ts --workspace=apps/api`
Expected: FAIL on the first test (`payload.source` is `undefined`); the other two pass already since `source` isn't in the allowlist yet.

- [ ] **Step 3: Add `source` to the create-payload allowlist only**

In `apps/api/src/tool-registry/tool-payload.mapper.ts`, in `toCreatePayload` (currently lines 17-55), add after the `tier_restriction` block:

```ts
this.assignIfDefined(
  payload,
  "tier_restriction",
  this.resolveTierRestriction(data),
);
// source is server-computed provenance (built-in/MCP/ACP/manual) — never
// exposed as writable input, but must survive from the registrar/service
// layer through to the persisted row.
this.assignIfDefined(payload, "source", data.source);
this.assignIfDefined(payload, "language", data.language);
```

Do **not** add an equivalent line to `pickUpdateFields` (used by `toUpdatePayload`) — `source` must stay immutable via `PATCH /tools/:id`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/api/src/tool-registry/tool-payload.mapper.spec.ts --workspace=apps/api`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/tool-registry/tool-payload.mapper.ts \
  apps/api/src/tool-registry/tool-payload.mapper.spec.ts
git commit -m "feat(api): carry tool source through the create payload mapper"
```

---

### Task 5: Force `source: 'manual'` on user-created tools

**Files:**

- Modify: `apps/api/src/tool-registry/tool-registry.service.ts:31-59`
- Modify: `apps/api/src/tool/tool-registry.service.spec.ts:109-128`

**Interfaces:**

- Consumes: `ToolPayloadMapper.toCreatePayload` (Task 4).
- Produces: `ToolRegistryService.createTool(data)` always persists `source: 'manual'`, regardless of what (if anything) is present on `data.source`. `upsertTool` is intentionally left unchanged — it is reused by the registrar path (Task 3), which must be able to pass through non-`manual` values; the public `POST /tools/upsert` endpoint never has a `source` in its DTO (not in `upsertToolSchema`), so new rows fall through to the column's `DEFAULT 'manual'` and existing rows keep whatever `source` they already have.

- [ ] **Step 1: Update the existing exact-match test and add a forcing test**

In `apps/api/src/tool/tool-registry.service.spec.ts`, update `'should create a tool when payload is valid'` (currently lines 109-128):

```ts
it("should create a tool when payload is valid", async () => {
  const result = await service.createTool(validTool);

  expect(validator.validateTypeScript).toHaveBeenCalledTimes(1);
  expect(validator.validateSchema).toHaveBeenCalledTimes(1);
  expect(repository.create).toHaveBeenCalledWith({
    name: validTool.name,
    schema: validTool.schema,
    typescript_code: validTool.typescript_code,
    tier_restriction: validTool.tier_restriction,
    source: "manual",
  });
  expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
    expect.objectContaining({
      domain: "tool",
      eventName: "tool.registry.create.succeeded",
      outcome: "success",
    }),
  );
  expect(result).toMatchObject({ id: "tool-id", name: "sample_tool" });
});

it("should force source to manual even if the caller supplies a different value", async () => {
  await service.createTool({
    ...validTool,
    source: "decorator_provider",
  });

  expect(repository.create).toHaveBeenCalledWith(
    expect.objectContaining({ source: "manual" }),
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/api/src/tool/tool-registry.service.spec.ts --workspace=apps/api`
Expected: FAIL — `repository.create` called without `source` (first test), and with `source: 'decorator_provider'` instead of `'manual'` (second test).

- [ ] **Step 3: Force `source` in `createTool`**

In `apps/api/src/tool-registry/tool-registry.service.ts`, replace `createTool` (currently lines 31-59):

```ts
  async createTool(data: Partial<IToolRegistry>): Promise<IToolRegistry> {
    const payload: Partial<IToolRegistry> = { ...data, source: 'manual' };

    try {
      this.validateRequiredFields(payload, ['name', 'schema', 'typescript_code']);
      this.validateTypeScriptCode(payload.typescript_code);
      this.validateSchema(payload.schema);
      const created = await this.repository.create(
        this.payloadMapper.toCreatePayload(payload),
      );

      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.registry.create.succeeded',
        outcome: 'success',
        toolId: created.id,
        toolName: created.name,
      });

      return created;
    } catch (error) {
      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.registry.create.failed',
        outcome: 'failure',
        toolName: payload.name,
        errorMessage: (error as Error).message,
      });
      throw error;
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/api/src/tool/tool-registry.service.spec.ts --workspace=apps/api`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full API test suite**

Run: `npm run test:api`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/tool-registry/tool-registry.service.ts \
  apps/api/src/tool/tool-registry.service.spec.ts
git commit -m "fix(api): force source=manual for user-created tools"
```

---

### Task 6: Frontend — `Tool.source` type and the `ToolSourceBadge` component

**Files:**

- Modify: `apps/web/src/lib/api/types.ts:1-11,318-328`
- Create: `apps/web/src/pages/tools/tool-source.ts`
- Create: `apps/web/src/pages/tools/tool-source.spec.ts`
- Create: `apps/web/src/pages/tools/ToolSourceBadge.tsx`
- Create: `apps/web/src/pages/tools/ToolSourceBadge.spec.tsx`

**Interfaces:**

- Consumes: `ToolRegistrySource` (imported from `@nexus/core`, added in Task 1).
- Produces: `Tool.source: ToolRegistrySource` (web `Tool` type); `isManualToolSource(source): boolean`, `getToolSourceLabel(source): string`, `getToolSourceDescription(source): string` (`apps/web/src/pages/tools/tool-source.ts`); `<ToolSourceBadge source={...} />` component. Tasks 7 and 8 consume all of these.

- [ ] **Step 1: Add `ToolRegistrySource` import and `Tool.source`**

In `apps/web/src/lib/api/types.ts`, add `ToolRegistrySource` to the existing `@nexus/core` import (currently lines 2-11):

```ts
import type {
  IMcpDiscoveredTool,
  IMcpInvokeToolResult,
  IMcpReloadResult,
  IMcpReloadServerResult,
  IMcpServer,
  IMcpServerTestResult,
  ImprovementProposalKind,
  ImprovementProposalStatus,
  ToolRegistrySource,
} from "@nexus/core";
```

Add `source` to the `Tool` interface (currently lines 318-328), after `tier_restriction`:

```ts
export interface Tool extends Timestamps {
  id: string;
  name: string;
  schema: Record<string, unknown>;
  typescript_code: string;
  tier_restriction: number;
  source: ToolRegistrySource;
  language?: "node" | "python";
  publication_status?: ToolPublicationStatus;
  published_artifact_id?: string | null;
  published_version?: number | null;
}
```

- [ ] **Step 2: Write the failing helper tests**

Create `apps/web/src/pages/tools/tool-source.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getToolSourceDescription,
  getToolSourceLabel,
  isManualToolSource,
} from "./tool-source";

describe("tool-source", () => {
  it("labels manual tools as Custom and reports them as manual", () => {
    expect(getToolSourceLabel("manual")).toBe("Custom");
    expect(isManualToolSource("manual")).toBe(true);
  });

  it.each([
    ["decorator_provider", "Built-in"],
    ["internal_tool_handler", "Built-in"],
    ["external_mcp", "MCP"],
    ["external_acp", "ACP"],
  ] as const)(
    "labels %s tools as %s and reports them as non-manual",
    (source, label) => {
      expect(getToolSourceLabel(source)).toBe(label);
      expect(isManualToolSource(source)).toBe(false);
    },
  );

  it("describes built-in and synced tools by their implementation", () => {
    expect(getToolSourceDescription("decorator_provider")).toBe(
      "Implemented in code.",
    );
    expect(getToolSourceDescription("internal_tool_handler")).toBe(
      "Implemented in code.",
    );
    expect(getToolSourceDescription("external_mcp")).toBe(
      "Synced from an MCP server.",
    );
    expect(getToolSourceDescription("external_acp")).toBe(
      "Synced from an ACP server.",
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run apps/web/src/pages/tools/tool-source.spec.ts --workspace=apps/web`
Expected: FAIL — cannot find module `./tool-source`.

- [ ] **Step 4: Write the helper module**

Create `apps/web/src/pages/tools/tool-source.ts`:

```ts
import type { ToolRegistrySource } from "@nexus/core";

const TOOL_SOURCE_LABELS: Record<ToolRegistrySource, string> = {
  manual: "Custom",
  decorator_provider: "Built-in",
  internal_tool_handler: "Built-in",
  external_mcp: "MCP",
  external_acp: "ACP",
};

const TOOL_SOURCE_DESCRIPTIONS: Record<ToolRegistrySource, string> = {
  manual: "",
  decorator_provider: "Implemented in code.",
  internal_tool_handler: "Implemented in code.",
  external_mcp: "Synced from an MCP server.",
  external_acp: "Synced from an ACP server.",
};

export function isManualToolSource(source: ToolRegistrySource): boolean {
  return source === "manual";
}

export function getToolSourceLabel(source: ToolRegistrySource): string {
  return TOOL_SOURCE_LABELS[source];
}

export function getToolSourceDescription(source: ToolRegistrySource): string {
  return TOOL_SOURCE_DESCRIPTIONS[source];
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run apps/web/src/pages/tools/tool-source.spec.ts --workspace=apps/web`
Expected: PASS (3 tests)

- [ ] **Step 6: Write the failing badge test**

Create `apps/web/src/pages/tools/ToolSourceBadge.spec.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolSourceBadge } from "./ToolSourceBadge";

describe("ToolSourceBadge", () => {
  it("renders Custom for manual tools", () => {
    render(<ToolSourceBadge source="manual" />);
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("renders Built-in for decorator-provided tools", () => {
    render(<ToolSourceBadge source="decorator_provider" />);
    expect(screen.getByText("Built-in")).toBeInTheDocument();
  });

  it("renders MCP for externally synced tools", () => {
    render(<ToolSourceBadge source="external_mcp" />);
    expect(screen.getByText("MCP")).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run apps/web/src/pages/tools/ToolSourceBadge.spec.tsx --workspace=apps/web`
Expected: FAIL — cannot find module `./ToolSourceBadge`.

- [ ] **Step 8: Write the badge component**

Create `apps/web/src/pages/tools/ToolSourceBadge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import type { ToolRegistrySource } from "@nexus/core";
import { getToolSourceLabel, isManualToolSource } from "./tool-source";

interface ToolSourceBadgeProps {
  source: ToolRegistrySource;
}

export function ToolSourceBadge({ source }: Readonly<ToolSourceBadgeProps>) {
  return (
    <Badge variant={isManualToolSource(source) ? "secondary" : "outline"}>
      {getToolSourceLabel(source)}
    </Badge>
  );
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run apps/web/src/pages/tools/ToolSourceBadge.spec.tsx --workspace=apps/web`
Expected: PASS (3 tests)

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/api/types.ts \
  apps/web/src/pages/tools/tool-source.ts \
  apps/web/src/pages/tools/tool-source.spec.ts \
  apps/web/src/pages/tools/ToolSourceBadge.tsx \
  apps/web/src/pages/tools/ToolSourceBadge.spec.tsx
git commit -m "feat(web): add tool source type, helpers, and badge component"
```

---

### Task 7: Frontend — Source column in `ToolsListSection`

**Files:**

- Modify: `apps/web/src/pages/tools/ToolsListSection.tsx`
- Create: `apps/web/src/pages/tools/ToolsListSection.spec.tsx`

**Interfaces:**

- Consumes: `ToolSourceBadge` (Task 6), `Tool.source` (Task 6).
- Produces: no new exports; existing exports (`ToolsListSection`, `TOOL_SORT_FIELD`, `SORT_DIRECTION`, `ToolSortField`, `SortDirection`) unchanged.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/tools/ToolsListSection.spec.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SORT_DIRECTION,
  TOOL_SORT_FIELD,
  ToolsListSection,
} from "./ToolsListSection";
import type { Tool } from "@/lib/api/types";

const baseTool: Tool = {
  id: "tool-1",
  name: "file.read",
  schema: { type: "object" },
  typescript_code: "",
  tier_restriction: 1,
  source: "decorator_provider",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function renderSection(tools: Tool[]) {
  render(
    <ToolsListSection
      isLoading={false}
      tools={tools}
      total={tools.length}
      page={0}
      pageSize={20}
      search=""
      sortBy={TOOL_SORT_FIELD.NAME}
      sortDir={SORT_DIRECTION.ASC}
      onSearchChange={vi.fn()}
      onSortByChange={vi.fn()}
      onSortDirChange={vi.fn()}
      onPageChange={vi.fn()}
      onEditTool={vi.fn()}
      onDeleteTool={vi.fn()}
    />,
  );
}

describe("ToolsListSection", () => {
  it("renders a Source column with a Built-in badge for non-manual tools", () => {
    renderSection([baseTool]);

    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Built-in")).toBeInTheDocument();
  });

  it("renders a Custom badge for manual tools", () => {
    renderSection([{ ...baseTool, source: "manual" }]);

    expect(screen.getByText("Custom")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/web/src/pages/tools/ToolsListSection.spec.tsx --workspace=apps/web`
Expected: FAIL — no element with text "Source".

- [ ] **Step 3: Add the Source column**

In `apps/web/src/pages/tools/ToolsListSection.tsx`, add the import (near the top, with the other local imports):

```ts
import { ToolSourceBadge } from "./ToolSourceBadge";
```

Update `ToolRows` (currently lines 61-110) to add a Source cell and bump `colSpan` from `4` to `5` in both the loading and empty states:

```tsx
function ToolRows({
  isLoading,
  tools,
  onEdit,
  onDelete,
}: Readonly<ToolRowsProps>) {
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={5} className="text-center">
          Loading...
        </TableCell>
      </TableRow>
    );
  }

  if (tools.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={5} className="text-center">
          No tools found
        </TableCell>
      </TableRow>
    );
  }

  return tools.map((tool) => (
    <TableRow key={tool.id}>
      <TableCell className="font-medium">{tool.name}</TableCell>
      <TableCell>
        <ToolSourceBadge source={tool.source} />
      </TableCell>
      <TableCell>
        <Badge variant={tool.tier_restriction === 2 ? "default" : "secondary"}>
          {tool.tier_restriction === 2 ? "heavy (2)" : "light (1)"}
        </Badge>
      </TableCell>
      <TableCell>
        {typeof tool.schema?.type === "string" ? tool.schema.type : "-"}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="icon" onClick={() => onEdit(tool)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(tool)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  ));
}
```

Update the header row (currently lines 206-228) to add a Source header:

```tsx
<TableHeader>
  <TableRow>
    <TableHead>
      <SortableHeader
        label="Name"
        field={TOOL_SORT_FIELD.NAME}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={handleSort}
      />
    </TableHead>
    <TableHead>Source</TableHead>
    <TableHead>
      <SortableHeader
        label="Tier"
        field={TOOL_SORT_FIELD.TIER}
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={handleSort}
      />
    </TableHead>
    <TableHead>Schema Type</TableHead>
    <TableHead className="text-right">Actions</TableHead>
  </TableRow>
</TableHeader>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/web/src/pages/tools/ToolsListSection.spec.tsx --workspace=apps/web`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/tools/ToolsListSection.tsx \
  apps/web/src/pages/tools/ToolsListSection.spec.tsx
git commit -m "feat(web): show tool source badge in the Tools list"
```

---

### Task 8: Frontend — read-only `ToolDetailDialog` for non-manual tools

**Files:**

- Create: `apps/web/src/pages/tools/ToolDetailDialog.tsx`
- Create: `apps/web/src/pages/tools/ToolDetailDialog.spec.tsx`
- Modify: `apps/web/src/pages/tools/ToolsPageView.tsx`

**Interfaces:**

- Consumes: `ToolSourceBadge`, `isManualToolSource`, `getToolSourceDescription` (Task 6), `Tool` (Task 6).
- Produces: `ToolDetailDialog({ open, tool, onOpenChange, onCancel })` component, no new state — reuses `ToolsPageViewModel`'s existing `isEditOpen`/`editingTool`/`onEditOpenChange`/`onEditCancel`.

This is the fix for the reported problem: opening a built-in/MCP/ACP tool no longer shows the fake, editable TypeScript snippet — it shows a read-only summary instead. `manual` tools are completely unaffected (still open the existing editable `EditToolDialog`/`ToolForm`).

- [ ] **Step 1: Write the failing dialog test**

Create `apps/web/src/pages/tools/ToolDetailDialog.spec.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolDetailDialog } from "./ToolDetailDialog";
import type { Tool } from "@/lib/api/types";

const baseTool: Tool = {
  id: "tool-1",
  name: "file.read",
  schema: { type: "object", properties: {} },
  typescript_code: "export const tool = {};",
  tier_restriction: 1,
  source: "decorator_provider",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("ToolDetailDialog", () => {
  it("renders tool name, source badge, and implementation note", () => {
    render(
      <ToolDetailDialog
        open
        tool={baseTool}
        onOpenChange={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("file.read")).toBeInTheDocument();
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByText("Implemented in code.")).toBeInTheDocument();
  });

  it("renders nothing when no tool is provided", () => {
    render(
      <ToolDetailDialog
        open
        tool={null}
        onOpenChange={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByText("Implemented in code.")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/web/src/pages/tools/ToolDetailDialog.spec.tsx --workspace=apps/web`
Expected: FAIL — cannot find module `./ToolDetailDialog`.

- [ ] **Step 3: Write the dialog component**

Create `apps/web/src/pages/tools/ToolDetailDialog.tsx`:

```tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tool } from "@/lib/api/types";
import { ToolSourceBadge } from "./ToolSourceBadge";
import { getToolSourceDescription } from "./tool-source";

interface ToolDetailDialogProps {
  open: boolean;
  tool: Tool | null;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
}

export function ToolDetailDialog(props: Readonly<ToolDetailDialogProps>) {
  const { open, tool, onOpenChange, onCancel } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>View Tool</DialogTitle>
        </DialogHeader>
        {tool && (
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium">Name</div>
              <div className="text-sm text-muted-foreground">{tool.name}</div>
            </div>
            <div>
              <div className="text-sm font-medium">Source</div>
              <ToolSourceBadge source={tool.source} />
            </div>
            <div>
              <div className="text-sm font-medium">Tier Restriction</div>
              <div className="text-sm text-muted-foreground">
                {tool.tier_restriction}
              </div>
            </div>
            <div>
              <div className="text-sm font-medium">Schema (JSON)</div>
              <pre className="max-h-[220px] overflow-auto rounded-md border bg-muted p-3 font-mono text-xs">
                {JSON.stringify(tool.schema, null, 2)}
              </pre>
            </div>
            <div>
              <div className="text-sm font-medium">Implementation</div>
              <div className="text-sm text-muted-foreground">
                {getToolSourceDescription(tool.source)}
              </div>
            </div>
            <div className="flex justify-end pt-4">
              <Button type="button" variant="outline" onClick={onCancel}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/web/src/pages/tools/ToolDetailDialog.spec.tsx --workspace=apps/web`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire it into `ToolsPageView`**

In `apps/web/src/pages/tools/ToolsPageView.tsx`, add imports (with the other local imports, currently lines 1-11):

```tsx
import { CreateToolDialog } from "./CreateToolDialog";
import { DeleteToolAlert } from "./DeleteToolAlert";
import { EditToolDialog } from "./EditToolDialog";
import { ToolDetailDialog } from "./ToolDetailDialog";
import { ToolFormValues } from "./ToolFormValues.types";
import { ToolsCandidateLifecycleSection } from "./ToolsCandidateLifecycleSection";
import { ToolsListSection } from "./ToolsListSection";
import { isManualToolSource } from "./tool-source";
import type { Tool, ToolCandidate, ToolValidationRun } from "@/lib/api/types";
import type { SortDirection, ToolSortField } from "./ToolsListSection";
```

Replace the `<EditToolDialog ... />` block (currently lines 114-121) with:

```tsx
{
  props.editingTool && !isManualToolSource(props.editingTool.source) ? (
    <ToolDetailDialog
      open={props.isEditOpen}
      tool={props.editingTool}
      onOpenChange={props.onEditOpenChange}
      onCancel={props.onEditCancel}
    />
  ) : (
    <EditToolDialog
      open={props.isEditOpen}
      onOpenChange={props.onEditOpenChange}
      tool={props.editingTool}
      onCancel={props.onEditCancel}
      onSubmit={props.onUpdate}
      isSubmitting={props.isUpdateSubmitting}
    />
  );
}
```

- [ ] **Step 6: Typecheck and run the web unit suite**

Run:

```bash
npm run test:unit:web
```

Expected: all tests PASS (including the new `ToolDetailDialog`, `ToolSourceBadge`, `ToolsListSection`, and `tool-source` specs).

- [ ] **Step 7: Manually verify in the browser**

Start the dev server (`npm run dev:web`, with the API running), open the Tools page, and confirm:

- Built-in tools (e.g. `file.read`, `set_job_output`) show a "Built-in" badge and open a read-only view with no editable code field.
- A tool created via "Add Tool" shows a "Custom" badge and still opens the existing editable form.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/tools/ToolDetailDialog.tsx \
  apps/web/src/pages/tools/ToolDetailDialog.spec.tsx \
  apps/web/src/pages/tools/ToolsPageView.tsx
git commit -m "feat(web): show a read-only view for non-manual tools"
```

---

### Task 9: Update documentation

**Files:**

- Modify: `docs/guide/14-tool-system.md`

**Interfaces:**

- None — documentation only.

- [ ] **Step 1: Correct the source-tracking description and add a provenance section**

In `docs/guide/14-tool-system.md`, replace the "Source tracking" bullet inside the `CapabilityRegistrarService` section (currently line 144):

```markdown
- **Source tracking** — tags tools with their origin (`internal`, `external_mcp`, `external_acp`, `plugin`)
```

with:

```markdown
- **Source tracking** — every tool projection carries a `source` (`decorator_provider`, `internal_tool_handler`, `external_mcp`, `external_acp`, or `manual`), persisted on the `tool_registry` row via the `source` column and surfaced on the Tools page (see "Tool Provenance" below)
```

Add a new subsection right after "### ToolPayloadMapper" (currently ends at line 170, before "### ToolTierPolicyService"):

```markdown
### Tool Provenance (`source`)

Every `tool_registry` row carries a `source` column (`ToolRegistrySource` in
`packages/core`): `decorator_provider` and `internal_tool_handler` for
built-in capabilities, `external_mcp`/`external_acp` for tools synced from
remote servers, and `manual` for tools created directly via `POST /tools`.
The value originates once, at registration time
(`CapabilityRegistrarService.registerCanonicalCapabilities` /
`registerToolProjection`), and is never client-writable — `createToolSchema`
has no `source` field, and `ToolRegistryService.createTool` always forces
`manual` regardless of what a caller supplies.

The Tools page (`apps/web/src/pages/tools/`) uses `source` to distinguish
built-in/synced tools from custom ones: the list shows a badge ("Built-in" /
"MCP" / "ACP" / "Custom"), and opening a non-`manual` tool shows a read-only
`ToolDetailDialog` instead of the editable `ToolForm` — built-in tools don't
have a real, editable TypeScript source in the registry (the `typescript_code`
column holds a placeholder for them), so surfacing it as editable was
misleading.
```

- [ ] **Step 2: Commit**

```bash
git add docs/guide/14-tool-system.md
git commit -m "docs: document tool source provenance and the Tools page treatment"
```
