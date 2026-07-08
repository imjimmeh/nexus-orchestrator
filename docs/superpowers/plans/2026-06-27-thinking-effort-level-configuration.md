# Configurable Thinking / Effort Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure an LLM thinking/effort level, resolved through `step input → agent profile → per-model default`, clamped to the levels the target model actually supports (sourced from the pi SDK), and wired into both agent dispatch paths plus the web UI.

**Architecture:** The runtime contract already exists (`RunnerThinkingLevel`, `HarnessModelConfig.thinkingLevel`, `ContainerAgentRequest.thinkingLevel`) but is never populated. We add: pure resolution/clamp helpers in `@nexus/core`; two nullable DB columns; a `ThinkingLevelCapabilityService` (pi SDK first, DB map fallback) and a `ThinkingLevelResolver` in the API; population at both dispatch sites; DTO validation; an enhanced presets endpoint; and two web UI dropdowns.

**Tech Stack:** TypeScript, NestJS, TypeORM, Vitest, Zod, Vite/React, `@earendil-works/pi-ai` (pi coding agent SDK).

**Design spec:** `docs/superpowers/specs/2026-06-27-thinking-effort-level-configuration-design.md`

## Global Constraints

- Build `packages/core` first — all apps depend on it: `npm run build --workspace=packages/core`.
- Strict lint: never use `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix in code.
- NestJS apps build with `nest build` (not `tsc`): `npm run build:api`.
- TDD: Red → Green → Refactor. One failing test first, minimal code to pass, then refactor.
- `RunnerThinkingLevel` values (canonical order): `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- Precedence (highest wins): step input → agent profile → per-model default → omit.
- Clamp ties round **down**; a requested level of `off` always resolves to `off` (never clamped up).
- pi-ai is imported dynamically: `await import('@earendil-works/pi-ai')` (matches existing usage in `ai-config-admin.service.ts`).
- Controllers transport-only; services own logic; repositories own persistence. React components presentation-only; side effects in hooks.
- All new columns nullable (null = inherit) → zero behavior change for existing data.

---

### Task 1: Core thinking-level schema + pure helpers

**Files:**

- Create: `packages/core/src/schemas/ai-config/thinking-level.schema.ts`
- Create: `packages/core/src/interfaces/thinking-level.helpers.ts`
- Create (test): `packages/core/src/interfaces/thinking-level.helpers.spec.ts`
- Modify: `packages/core/src/interfaces/index.ts` (export helpers)
- Modify: `packages/core/src/schemas/ai-config/` barrel (export schema — see Step 6)

**Interfaces:**

- Produces: `THINKING_LEVEL_ORDER: readonly RunnerThinkingLevel[]`; `RunnerThinkingLevelSchema: z.ZodEnum`; `parseThinkingLevel(value: unknown): RunnerThinkingLevel | undefined`; `clampThinkingLevel(requested: RunnerThinkingLevel, supported: readonly RunnerThinkingLevel[]): RunnerThinkingLevel | undefined`; `resolveThinkingLevel({ stepInput?, agentProfile?, modelDefault? }): RunnerThinkingLevel | undefined`.
- Consumes: `RunnerThinkingLevel` from `./runner-config.types`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/interfaces/thinking-level.helpers.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  THINKING_LEVEL_ORDER,
  parseThinkingLevel,
  clampThinkingLevel,
  resolveThinkingLevel,
} from "./thinking-level.helpers";

describe("thinking-level helpers", () => {
  it("orders levels off..xhigh", () => {
    expect(THINKING_LEVEL_ORDER).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  describe("parseThinkingLevel", () => {
    it("accepts valid levels", () => {
      expect(parseThinkingLevel("high")).toBe("high");
    });
    it("rejects invalid / non-string", () => {
      expect(parseThinkingLevel("turbo")).toBeUndefined();
      expect(parseThinkingLevel(3)).toBeUndefined();
      expect(parseThinkingLevel(undefined)).toBeUndefined();
    });
  });

  describe("clampThinkingLevel", () => {
    it("returns the requested level when supported", () => {
      expect(clampThinkingLevel("medium", ["low", "medium", "high"])).toBe(
        "medium",
      );
    });
    it("clamps down to the nearest supported", () => {
      expect(clampThinkingLevel("xhigh", ["low", "medium"])).toBe("medium");
    });
    it("clamps up when request is below all supported", () => {
      expect(clampThinkingLevel("minimal", ["high", "xhigh"])).toBe("high");
    });
    it("breaks ties downward", () => {
      // 'low'(2) is equidistant from 'minimal'(1) and 'medium'(3) -> pick lower
      expect(clampThinkingLevel("low", ["minimal", "medium"])).toBe("minimal");
    });
    it("returns undefined when nothing is supported", () => {
      expect(clampThinkingLevel("high", [])).toBeUndefined();
    });
    it("returns undefined when only 'off' is supported for a non-off request", () => {
      expect(clampThinkingLevel("high", ["off"])).toBeUndefined();
    });
    it("always honors an explicit 'off' request", () => {
      expect(clampThinkingLevel("off", ["high", "xhigh"])).toBe("off");
      expect(clampThinkingLevel("off", [])).toBe("off");
    });
  });

  describe("resolveThinkingLevel", () => {
    it("prefers step input over profile over model default", () => {
      expect(
        resolveThinkingLevel({
          stepInput: "high",
          agentProfile: "low",
          modelDefault: "off",
        }),
      ).toBe("high");
    });
    it("falls through to profile then model default", () => {
      expect(
        resolveThinkingLevel({ agentProfile: "low", modelDefault: "off" }),
      ).toBe("low");
      expect(resolveThinkingLevel({ modelDefault: "medium" })).toBe("medium");
    });
    it("returns undefined when nothing is configured", () => {
      expect(resolveThinkingLevel({})).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/interfaces/thinking-level.helpers.spec.ts`
Expected: FAIL — cannot resolve `./thinking-level.helpers`.

- [ ] **Step 3: Create the schema (canonical values)**

Create `packages/core/src/schemas/ai-config/thinking-level.schema.ts`:

```ts
import { z } from "zod";

/** Canonical ordered thinking levels; index encodes effort magnitude. */
export const RunnerThinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

/** Ordered tuple of levels (off..xhigh). Source of truth for ordinal logic. */
export const THINKING_LEVEL_ORDER = RunnerThinkingLevelSchema.options;
```

- [ ] **Step 4: Create the helpers**

Create `packages/core/src/interfaces/thinking-level.helpers.ts`:

```ts
import type { RunnerThinkingLevel } from "./runner-config.types";
import { THINKING_LEVEL_ORDER } from "../schemas/ai-config/thinking-level.schema";

export { THINKING_LEVEL_ORDER };

function indexOf(level: RunnerThinkingLevel): number {
  return THINKING_LEVEL_ORDER.indexOf(level);
}

export function parseThinkingLevel(
  value: unknown,
): RunnerThinkingLevel | undefined {
  return typeof value === "string" &&
    (THINKING_LEVEL_ORDER as readonly string[]).includes(value)
    ? (value as RunnerThinkingLevel)
    : undefined;
}

/**
 * Clamp `requested` to the nearest level in `supported` (ordinal distance,
 * ties round DOWN). `off` always returns `off`. Returns undefined when no
 * non-`off` level is supported so the caller omits the field.
 */
export function clampThinkingLevel(
  requested: RunnerThinkingLevel,
  supported: readonly RunnerThinkingLevel[],
): RunnerThinkingLevel | undefined {
  if (requested === "off") return "off";
  const candidates = [...supported]
    .filter((l) => l !== "off")
    .sort((a, b) => indexOf(a) - indexOf(b));
  if (candidates.length === 0) return undefined;
  const target = indexOf(requested);
  let best: RunnerThinkingLevel | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const level of candidates) {
    const distance = Math.abs(indexOf(level) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = level; // strict `<` + ascending order => ties keep the lower level
    }
  }
  return best;
}

/** First-defined layer wins. */
export function resolveThinkingLevel(layers: {
  stepInput?: RunnerThinkingLevel;
  agentProfile?: RunnerThinkingLevel;
  modelDefault?: RunnerThinkingLevel;
}): RunnerThinkingLevel | undefined {
  return layers.stepInput ?? layers.agentProfile ?? layers.modelDefault;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/core/src/interfaces/thinking-level.helpers.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Export from core barrels**

In `packages/core/src/interfaces/index.ts`, after the `runner-config.types` export block (around line 48), add:

```ts
export {
  THINKING_LEVEL_ORDER,
  parseThinkingLevel,
  clampThinkingLevel,
  resolveThinkingLevel,
} from "./thinking-level.helpers";
```

Find the ai-config schemas barrel that re-exports `models.schema` / `profiles.schema` (search: `grep -rn "profiles.schema" packages/core/src/schemas`), and add:

```ts
export * from "./thinking-level.schema";
```

- [ ] **Step 7: Build core + run the test through the workspace**

Run: `npm run build --workspace=packages/core && npx vitest run packages/core/src/interfaces/thinking-level.helpers.spec.ts`
Expected: build succeeds; test PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/interfaces/thinking-level.helpers.ts \
        packages/core/src/interfaces/thinking-level.helpers.spec.ts \
        packages/core/src/schemas/ai-config/thinking-level.schema.ts \
        packages/core/src/interfaces/index.ts \
        packages/core/src/schemas/ai-config/index.ts
git commit -m "feat(core): thinking-level schema + pure resolve/clamp helpers"
```

---

### Task 2: DB columns, entities, and migration

**Files:**

- Modify: `apps/api/src/ai-config/database/entities/llm-model.entity.ts` (add `default_thinking_level`)
- Modify: `apps/api/src/ai-config/database/entities/agent-profile.entity.ts` (add `thinking_level`)
- Create: migration under the API migrations directory (find with `grep -rl "implements MigrationInterface" apps/api/src | head`)
- Create (test): co-located entity/migration smoke test (see Step 4)

**Interfaces:**

- Produces: `LlmModel.default_thinking_level: string | null`; `AgentProfile.thinking_level: string | null`.

- [ ] **Step 1: Add the entity columns**

In `llm-model.entity.ts`, beside the other `@Column` defaults (near `supports_vision`):

```ts
  @Column({ type: "varchar", nullable: true })
  default_thinking_level: string | null;
```

In `agent-profile.entity.ts`, beside `model_name` / `provider_name`:

```ts
  @Column({ type: "varchar", nullable: true })
  thinking_level: string | null;
```

- [ ] **Step 2: Write the migration**

Follow the `adding-entity-migration` skill for the directory and naming. Create a migration class (timestamp prefix per existing files):

```ts
import { MigrationInterface, QueryRunner } from "typeorm";

export class AddThinkingLevelColumns1750000000000 implements MigrationInterface {
  name = "AddThinkingLevelColumns1750000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "llm_models" ADD COLUMN IF NOT EXISTS "default_thinking_level" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "thinking_level" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_profiles" DROP COLUMN IF EXISTS "thinking_level"`,
    );
    await queryRunner.query(
      `ALTER TABLE "llm_models" DROP COLUMN IF EXISTS "default_thinking_level"`,
    );
  }
}
```

Register it in the migrations array if the project lists migrations explicitly (check the file the `adding-entity-migration` skill points to).

- [ ] **Step 3: Build the API to confirm entities compile**

Run: `npm run build:api`
Expected: build succeeds (TypeORM reflection picks up the new columns).

- [ ] **Step 4: Write + run a migration smoke test**

Add a test asserting both `up` SQL statements are issued (mirror an existing migration spec in the same directory — search `grep -rl "MigrationInterface" apps/api/src | sed 's/\\.ts/.spec.ts/'`). Minimal shape:

```ts
import { describe, expect, it, vi } from "vitest";
import { AddThinkingLevelColumns1750000000000 } from "./<filename>";

describe("AddThinkingLevelColumns", () => {
  it("adds both nullable columns", async () => {
    const query = vi.fn().mockResolvedValue(undefined);
    await new AddThinkingLevelColumns1750000000000().up({ query } as never);
    const sql = query.mock.calls.map((c) => c[0] as string).join("\n");
    expect(sql).toContain('"llm_models" ADD COLUMN');
    expect(sql).toContain("default_thinking_level");
    expect(sql).toContain('"agent_profiles" ADD COLUMN');
    expect(sql).toContain("thinking_level");
  });
});
```

Run: `npx vitest run apps/api/src/<migration-dir>/<filename>.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai-config/database/entities/llm-model.entity.ts \
        apps/api/src/ai-config/database/entities/agent-profile.entity.ts \
        apps/api/src/<migration-dir>/
git commit -m "feat(api): add nullable thinking-level columns to llm_models + agent_profiles"
```

---

### Task 3: ThinkingLevelCapabilityService (pi SDK source of truth)

**Files:**

- Create: `apps/api/src/ai-config/services/thinking-level-capability.service.ts`
- Create (test): `apps/api/src/ai-config/services/thinking-level-capability.service.spec.ts`
- Modify: the owning module (`grep -rl "AiConfigurationService" apps/api/src/ai-config/*.module.ts`) to register the provider.

**Interfaces:**

- Consumes: `parseThinkingLevel`, `RunnerThinkingLevel` from `@nexus/core`; `@earendil-works/pi-ai` (`getModel`, `getSupportedThinkingLevels`).
- Produces: `ThinkingLevelCapabilityService.getSupportedLevels({ provider, modelId, thinkingLevelMap? }): Promise<RunnerThinkingLevel[]>`.

- [ ] **Step 1: Write the failing test**

Create `thinking-level-capability.service.spec.ts`. Mock pi-ai so tests are deterministic:

```ts
import { describe, expect, it, vi } from "vitest";

const getModel = vi.fn();
const getSupportedThinkingLevels = vi.fn();
vi.mock("@earendil-works/pi-ai", () => ({
  getModel: (...a: unknown[]) => getModel(...a),
  getSupportedThinkingLevels: (...a: unknown[]) =>
    getSupportedThinkingLevels(...a),
}));

import { ThinkingLevelCapabilityService } from "./thinking-level-capability.service";

describe("ThinkingLevelCapabilityService", () => {
  const svc = new ThinkingLevelCapabilityService();

  it("returns pi-SDK supported levels when the model is in the catalog", async () => {
    getModel.mockReturnValue({ id: "m", provider: "anthropic" });
    getSupportedThinkingLevels.mockReturnValue(["off", "high", "xhigh"]);
    await expect(
      svc.getSupportedLevels({ provider: "anthropic", modelId: "m" }),
    ).resolves.toEqual(["off", "high", "xhigh"]);
  });

  it("falls back to thinkingLevelMap non-null keys when not in the catalog", async () => {
    getModel.mockImplementation(() => {
      throw new Error("unknown model");
    });
    await expect(
      svc.getSupportedLevels({
        provider: "custom",
        modelId: "x",
        thinkingLevelMap: { low: "x-low", high: null, medium: "x-med" },
      }),
    ).resolves.toEqual(expect.arrayContaining(["low", "medium"]));
  });

  it("returns [] when neither catalog nor map knows the model", async () => {
    getModel.mockReturnValue(undefined);
    await expect(
      svc.getSupportedLevels({ provider: "custom", modelId: "x" }),
    ).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/ai-config/services/thinking-level-capability.service.spec.ts`
Expected: FAIL — cannot resolve the service module.

- [ ] **Step 3: Implement the service**

Create `thinking-level-capability.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import type { RunnerThinkingLevel } from "@nexus/core";
import { parseThinkingLevel } from "@nexus/core";

@Injectable()
export class ThinkingLevelCapabilityService {
  async getSupportedLevels(input: {
    provider: string;
    modelId: string;
    thinkingLevelMap?: Partial<Record<RunnerThinkingLevel, string | null>>;
  }): Promise<RunnerThinkingLevel[]> {
    const fromSdk = await this.fromPiSdk(input.provider, input.modelId);
    if (fromSdk) return fromSdk;
    if (input.thinkingLevelMap) return this.fromMap(input.thinkingLevelMap);
    return [];
  }

  private async fromPiSdk(
    provider: string,
    modelId: string,
  ): Promise<RunnerThinkingLevel[] | undefined> {
    try {
      const { getModel, getSupportedThinkingLevels } =
        await import("@earendil-works/pi-ai");
      const model = getModel(provider as never, modelId as never);
      if (!model) return undefined;
      return getSupportedThinkingLevels(model)
        .map(parseThinkingLevel)
        .filter((l): l is RunnerThinkingLevel => l !== undefined);
    } catch {
      return undefined;
    }
  }

  private fromMap(
    map: Partial<Record<RunnerThinkingLevel, string | null>>,
  ): RunnerThinkingLevel[] {
    return (Object.entries(map) as Array<[RunnerThinkingLevel, string | null]>)
      .filter(([, value]) => value !== null)
      .map(([level]) => level);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/api/src/ai-config/services/thinking-level-capability.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Register the provider**

Add `ThinkingLevelCapabilityService` to the `providers` and `exports` arrays of the ai-config module (the one exporting `AiConfigurationService`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai-config/services/thinking-level-capability.service.ts \
        apps/api/src/ai-config/services/thinking-level-capability.service.spec.ts \
        apps/api/src/ai-config/<module-file>.ts
git commit -m "feat(api): ThinkingLevelCapabilityService (pi SDK first, DB map fallback)"
```

---

### Task 4: ThinkingLevelResolver (precedence + clamp + telemetry flags)

**Files:**

- Create: `apps/api/src/ai-config/services/thinking-level-resolver.service.ts`
- Create (test): `apps/api/src/ai-config/services/thinking-level-resolver.service.spec.ts`
- Modify: ai-config module (register + export).

**Interfaces:**

- Consumes: `ThinkingLevelCapabilityService` (Task 3); `clampThinkingLevel`, `resolveThinkingLevel`, `RunnerThinkingLevel` from `@nexus/core`.
- Produces: `ThinkingLevelResolver.resolve(input): Promise<ThinkingLevelResolution>` where `ThinkingLevelResolution = { level?: RunnerThinkingLevel; clampedFrom?: RunnerThinkingLevel; dropped: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `thinking-level-resolver.service.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ThinkingLevelResolver } from "./thinking-level-resolver.service";

function makeResolver(supported: string[]) {
  const capability = {
    getSupportedLevels: async () => supported,
  } as never;
  return new ThinkingLevelResolver(capability);
}

const base = {
  provider: "anthropic",
  modelId: "m",
  harnessSupportsThinkingLevels: true,
};

describe("ThinkingLevelResolver", () => {
  it("omits (dropped:false) when nothing is configured", async () => {
    const r = makeResolver(["off", "high"]);
    await expect(r.resolve({ ...base })).resolves.toEqual({ dropped: false });
  });

  it("returns the resolved level unchanged when supported", async () => {
    const r = makeResolver(["off", "low", "high"]);
    await expect(r.resolve({ ...base, modelDefault: "high" })).resolves.toEqual(
      { level: "high" },
    );
  });

  it("clamps and reports clampedFrom", async () => {
    const r = makeResolver(["off", "low", "medium"]);
    await expect(r.resolve({ ...base, stepInput: "xhigh" })).resolves.toEqual({
      level: "medium",
      clampedFrom: "xhigh",
    });
  });

  it("drops when the harness does not support thinking", async () => {
    const r = makeResolver(["high"]);
    await expect(
      r.resolve({
        ...base,
        harnessSupportsThinkingLevels: false,
        modelDefault: "high",
      }),
    ).resolves.toEqual({ dropped: true });
  });

  it("drops when the model supports no non-off level", async () => {
    const r = makeResolver(["off"]);
    await expect(r.resolve({ ...base, modelDefault: "high" })).resolves.toEqual(
      { dropped: true },
    );
  });

  it("honors step > profile > model-default precedence", async () => {
    const r = makeResolver(["off", "low", "medium", "high"]);
    await expect(
      r.resolve({
        ...base,
        stepInput: "high",
        agentProfile: "low",
        modelDefault: "medium",
      }),
    ).resolves.toEqual({ level: "high" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/ai-config/services/thinking-level-resolver.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Create `thinking-level-resolver.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import type { RunnerThinkingLevel } from "@nexus/core";
import { clampThinkingLevel, resolveThinkingLevel } from "@nexus/core";
import { ThinkingLevelCapabilityService } from "./thinking-level-capability.service";

export interface ThinkingLevelResolution {
  level?: RunnerThinkingLevel;
  clampedFrom?: RunnerThinkingLevel;
  dropped: boolean;
}

@Injectable()
export class ThinkingLevelResolver {
  constructor(private readonly capability: ThinkingLevelCapabilityService) {}

  async resolve(input: {
    stepInput?: RunnerThinkingLevel;
    agentProfile?: RunnerThinkingLevel;
    modelDefault?: RunnerThinkingLevel;
    provider: string;
    modelId: string;
    thinkingLevelMap?: Partial<Record<RunnerThinkingLevel, string | null>>;
    harnessSupportsThinkingLevels: boolean;
  }): Promise<ThinkingLevelResolution> {
    const requested = resolveThinkingLevel({
      stepInput: input.stepInput,
      agentProfile: input.agentProfile,
      modelDefault: input.modelDefault,
    });
    if (!requested) return { dropped: false };
    if (!input.harnessSupportsThinkingLevels) return { dropped: true };

    const supported = await this.capability.getSupportedLevels({
      provider: input.provider,
      modelId: input.modelId,
      thinkingLevelMap: input.thinkingLevelMap,
    });
    const effective = clampThinkingLevel(requested, supported);
    if (!effective) return { dropped: true };
    return effective === requested
      ? { level: effective }
      : { level: effective, clampedFrom: requested };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/api/src/ai-config/services/thinking-level-resolver.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Register + commit**

Register `ThinkingLevelResolver` in the ai-config module providers/exports.

```bash
git add apps/api/src/ai-config/services/thinking-level-resolver.service.ts \
        apps/api/src/ai-config/services/thinking-level-resolver.service.spec.ts \
        apps/api/src/ai-config/<module-file>.ts
git commit -m "feat(api): ThinkingLevelResolver composing capability + core clamp"
```

---

### Task 5: Wire the workflow-step dispatch path + telemetry

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts` (`buildStepRunnerConfigPayloadCore` lines 70-199; `assembleBaseRunnerConfig` lines 201-242)
- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.types.ts` (extend any params type if needed)
- Modify (test): `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts`

**Interfaces:**

- Consumes: `ThinkingLevelResolver` (Task 4); `parseThinkingLevel` from `@nexus/core`; the resolved `finalProviderConfig` (has `models[].thinkingLevelMap`) and `harnessEntry.capabilities.supportsThinkingLevels`.
- Produces: `HarnessRuntimeConfig.model.thinkingLevel` populated when resolution yields a level.

- [ ] **Step 1: Write the failing test**

Add a case to the helpers spec asserting that, given a step input `thinking_level` and a supporting model, the returned config sets `model.thinkingLevel`. Mirror the existing test harness in that spec for constructing `params` (reuse its fixtures/builders). Core assertion:

```ts
it("sets model.thinkingLevel from step input when supported", async () => {
  const config = await buildStepRunnerConfigPayloadCore({
    ...baseParams, // existing fixture in this spec
    resolvedJobInputs: {
      ...baseParams.resolvedJobInputs,
      thinking_level: "high",
    },
    thinkingLevelResolver: {
      resolve: async () => ({ level: "high" }),
    } as never,
  });
  expect(config.model.thinkingLevel).toBe("high");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts -t "thinkingLevel"`
Expected: FAIL — `thinkingLevel` is undefined.

- [ ] **Step 3: Thread the resolver param + extract layers**

In `buildStepRunnerConfigPayloadCore` params (line 70 block), add:

```ts
  thinkingLevelResolver?: {
    resolve: (input: {
      stepInput?: RunnerThinkingLevel;
      agentProfile?: RunnerThinkingLevel;
      modelDefault?: RunnerThinkingLevel;
      provider: string;
      modelId: string;
      thinkingLevelMap?: Partial<Record<RunnerThinkingLevel, string | null>>;
      harnessSupportsThinkingLevels: boolean;
    }) => Promise<{ level?: RunnerThinkingLevel; clampedFrom?: RunnerThinkingLevel; dropped: boolean }>;
  };
```

After `assembleBaseRunnerConfig` is built (after line 184), resolve and assign:

```ts
const stepThinking = parseThinkingLevel(
  params.resolvedJobInputs.thinking_level,
);
const profileThinking = parseThinkingLevel(
  agentProfileRecord?.thinking_level, // from the agent-profile load already used for the name
);
const modelDefaultThinking = parseThinkingLevel(
  resolvedModelRecord?.default_thinking_level, // llm_models row for resolvedSettings.model
);
if (params.thinkingLevelResolver) {
  const decision = await params.thinkingLevelResolver.resolve({
    stepInput: stepThinking,
    agentProfile: profileThinking,
    modelDefault: modelDefaultThinking,
    provider: finalProviderConfig.provider,
    modelId: resolvedSettings.model,
    thinkingLevelMap: finalProviderConfig.models?.find(
      (m) => m.id === resolvedSettings.model,
    )?.thinkingLevelMap,
    harnessSupportsThinkingLevels:
      harnessEntry?.capabilities?.supportsThinkingLevels ?? false,
  });
  if (decision.level) baseConfig.model.thinkingLevel = decision.level;
  if (decision.clampedFrom || decision.dropped) {
    params.ledger?.emitBestEffort({
      event_name: "thinking_level.adjusted",
      requested: decision.clampedFrom ?? "(model has no support)",
      effective: decision.level ?? "(omitted)",
      model: resolvedSettings.model,
    });
  }
}
```

> Note: `agentProfileRecord` / `resolvedModelRecord` — the agent profile and model rows are already fetched during `resolveStepSettings` / `resolveAgentProfileFromJobInputs`. Surface the loaded records (or add a lightweight read) so `thinking_level` / `default_thinking_level` are available here. If the existing resolution doesn't return the full record, fetch the model row via the model repository (`findByName`) and read the profile's `thinking_level` from the same load that resolves the profile name. Keep it to one read each.

- [ ] **Step 4: Inject the resolver at the call site**

In `step-agent-step-executor.service.ts` (and any other caller of `buildStepRunnerConfigPayloadCore`), pass the injected `ThinkingLevelResolver` as `thinkingLevelResolver`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts -t "thinkingLevel"`
Expected: PASS.

- [ ] **Step 6: Build + commit**

Run: `npm run build:api`

```bash
git add apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts \
        apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.types.ts \
        apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts \
        apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts
git commit -m "feat(api): populate thinkingLevel on workflow-step runner config + clamp telemetry"
```

---

### Task 6: Wire the chat/session dispatch path

**Files:**

- Modify: `apps/api/src/execution-lifecycle/execution-dispatch.service.ts` (around line 126 where `ContainerAgentRequest` is built)
- Modify: `apps/api/src/ai-config/services/agent-profile-resolution.service.ts` (expose the profile `thinking_level` if not already returned)
- Modify (test): the existing `execution-dispatch.service.spec.ts`

**Interfaces:**

- Consumes: `ThinkingLevelResolver` (Task 4); `params.agentConfig` (provider, model). Two policy layers only (no step input).
- Produces: `agentConfig.thinkingLevel` set before the `ContainerAgentRequest` is built (the field is already forwarded — see `execution-dispatch.service.ts:136`).

- [ ] **Step 1: Write the failing test**

In `execution-dispatch.service.spec.ts`, add a case where the resolver returns `{ level: "medium" }` and assert the dispatched `ContainerAgentRequest.thinkingLevel === "medium"`. Mock `ThinkingLevelResolver.resolve` on the injected service.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/api/src/execution-lifecycle/execution-dispatch.service.spec.ts -t "thinkingLevel"`
Expected: FAIL — undefined.

- [ ] **Step 3: Inject + resolve before building the request**

Inject `ThinkingLevelResolver` into the dispatch service. Before constructing `agentRequest` (line 126), compute:

```ts
const decision = await this.thinkingLevelResolver.resolve({
  agentProfile: parseThinkingLevel(resolvedProfile?.thinking_level),
  modelDefault: parseThinkingLevel(resolvedModel?.default_thinking_level),
  provider: params.agentConfig.provider,
  modelId: params.agentConfig.model,
  thinkingLevelMap: params.agentConfig.providerConfig?.models?.find(
    (m) => m.id === params.agentConfig.model,
  )?.thinkingLevelMap,
  harnessSupportsThinkingLevels:
    params.capabilities?.supportsThinkingLevels ?? false,
});
const thinkingLevel = decision.level ?? params.agentConfig.thinkingLevel;
```

Then use `thinkingLevel` in the `agentRequest` object (replace the existing `thinkingLevel: params.agentConfig.thinkingLevel`). Emit the same `thinking_level.adjusted` ledger note on `clampedFrom`/`dropped` if a ledger is available on this path.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/api/src/execution-lifecycle/execution-dispatch.service.spec.ts -t "thinkingLevel"`
Expected: PASS.

- [ ] **Step 5: Build + commit**

Run: `npm run build:api`

```bash
git add apps/api/src/execution-lifecycle/execution-dispatch.service.ts \
        apps/api/src/execution-lifecycle/execution-dispatch.service.spec.ts \
        apps/api/src/ai-config/services/agent-profile-resolution.service.ts
git commit -m "feat(api): populate thinkingLevel on chat/session dispatch path"
```

---

### Task 7: DTO validation + presets endpoint enhancement

**Files:**

- Modify: `packages/core/src/schemas/ai-config/models.schema.ts` (`CreateModelSchema`)
- Modify: `packages/core/src/schemas/ai-config/profiles.schema.ts` (`CreateAgentProfileSchema`)
- Modify: `apps/api/src/ai-config/ai-config-admin.service.ts` (`listModelPresets`, lines 132-159)
- Modify (test): `packages/core/src/schemas/ai-config/profiles.schema.spec.ts` + a models-schema test; `ai-config-admin.service` presets test

**Interfaces:**

- Consumes: `RunnerThinkingLevelSchema` (Task 1); `ThinkingLevelCapabilityService` (Task 3); pi-ai `getModels`.
- Produces: validated `default_thinking_level` / `thinking_level` request fields; presets entries gain `supportedThinkingLevels: RunnerThinkingLevel[]` and `thinkingLevelMap`.

- [ ] **Step 1: Write the failing schema tests**

In `profiles.schema.spec.ts` add:

```ts
it("accepts a valid thinking_level and rejects an invalid one", () => {
  expect(
    CreateAgentProfileSchema.safeParse({ name: "p", thinking_level: "high" })
      .success,
  ).toBe(true);
  expect(
    CreateAgentProfileSchema.safeParse({ name: "p", thinking_level: "turbo" })
      .success,
  ).toBe(false);
});
```

Add the analogous test for `CreateModelSchema` + `default_thinking_level` (create `models.schema.spec.ts` if absent).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/schemas/ai-config/profiles.schema.spec.ts -t "thinking_level"`
Expected: FAIL — field stripped/unvalidated.

- [ ] **Step 3: Add the schema fields**

In `models.schema.ts`, add to `CreateModelSchema`:

```ts
  default_thinking_level: RunnerThinkingLevelSchema.nullable().optional(),
```

(with `import { RunnerThinkingLevelSchema } from "./thinking-level.schema";`)

In `profiles.schema.ts`, add to `CreateAgentProfileSchema`:

```ts
  thinking_level: RunnerThinkingLevelSchema.nullable().optional(),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/schemas/ai-config/profiles.schema.spec.ts packages/core/src/schemas/ai-config/models.schema.spec.ts`
Expected: PASS. Rebuild core: `npm run build --workspace=packages/core`.

- [ ] **Step 5: Enhance `listModelPresets` (test first)**

Add a test asserting each preset includes `supportedThinkingLevels`. Then update `listModelPresets` (inject `ThinkingLevelCapabilityService`):

```ts
allModels.push({
  id: m.id,
  name: m.name,
  provider: m.provider,
  api: m.api,
  baseUrl: m.baseUrl,
  reasoning: m.reasoning,
  input: m.input,
  contextWindow: m.contextWindow,
  maxTokens: m.maxTokens,
  cost: m.cost,
  thinkingLevelMap: m.thinkingLevelMap,
  supportedThinkingLevels:
    await this.thinkingLevelCapability.getSupportedLevels({
      provider: m.provider,
      modelId: m.id,
      thinkingLevelMap: m.thinkingLevelMap,
    }),
});
```

Run: `npx vitest run apps/api/src/ai-config/ai-config-admin.service.spec.ts -t "presets"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas/ai-config/models.schema.ts \
        packages/core/src/schemas/ai-config/profiles.schema.ts \
        packages/core/src/schemas/ai-config/*.spec.ts \
        apps/api/src/ai-config/ai-config-admin.service.ts \
        apps/api/src/ai-config/ai-config-admin.service.spec.ts
git commit -m "feat(api): validate thinking-level DTOs + expose supportedThinkingLevels in presets"
```

---

### Task 8: Web UI — model + agent-profile thinking-level controls

**Files:**

- Modify: the web API client types for models/presets/profiles (`grep -rln "models/presets" apps/web/src`)
- Modify: the model editor component + its hook
- Modify: the agent-profile editor component + its hook
- Create (test): component tests beside each editor

**Interfaces:**

- Consumes: presets `supportedThinkingLevels` (Task 7); `THINKING_LEVEL_ORDER` from `@nexus/core`.
- Produces: `default_thinking_level` on the model save payload; `thinking_level` on the profile save payload.

- [ ] **Step 1: Extend the client types**

Add `default_thinking_level?: string | null` to the model type, `thinking_level?: string | null` to the profile type, and `supportedThinkingLevels?: string[]` + `thinkingLevelMap?` to the preset type, in the web API client/types module.

- [ ] **Step 2: Write the failing model-editor test**

Beside the model editor, add a test rendering the editor with a preset whose `supportedThinkingLevels = ["off","high","xhigh"]` and asserting the dropdown offers exactly `Inherit`, `off`, `high`, `xhigh` (not `low`/`medium`), and that selecting `high` puts `default_thinking_level: "high"` in the submitted payload.

Run: `npm run test:unit:web -- <model-editor>.test.tsx`
Expected: FAIL — no such control.

- [ ] **Step 3: Implement the model-editor dropdown**

Add a presentation dropdown bound to `default_thinking_level`. Options: a leading `Inherit / None` (value `null`) + the model's `supportedThinkingLevels` (ordered by `THINKING_LEVEL_ORDER`). When `supportedThinkingLevels` is empty, render the control disabled with the hint "model has no configurable thinking levels". Side-effectful save goes through the existing mutation hook.

Run the test: Expected PASS.

- [ ] **Step 4: Write the failing agent-profile-editor test**

Assert the profile editor renders a "Thinking level" dropdown with `Inherit` + all 6 levels and submits `thinking_level: "low"` when `low` is chosen.

Run: `npm run test:unit:web -- <profile-editor>.test.tsx`
Expected: FAIL.

- [ ] **Step 5: Implement the agent-profile dropdown**

Add the dropdown bound to `thinking_level` (options `Inherit` + `THINKING_LEVEL_ORDER`), wired through the profile mutation hook.

Run the test: Expected PASS.

- [ ] **Step 6: Lint + commit**

Run: `npm run lint:web`

```bash
git add apps/web/src
git commit -m "feat(web): thinking-level controls on model + agent-profile editors"
```

---

### Task 9: Documentation + ADR

**Files:**

- Modify: `CLAUDE.md` (AI config precedence block)
- Modify: `docs/guide/` AI-config page (find with `grep -rln "agent profile" docs/guide`)
- Modify: `.agents/skills/workflow-yaml-authoring/SKILL.md` (document `steps[].inputs.thinking_level`)
- Create: `docs/architecture/decisions/ADR-thinking-effort-level-configuration.md`

- [ ] **Step 1: Update the precedence note in `CLAUDE.md`**

Under "AI config precedence", add a sibling note:

```md
- **Thinking/effort level precedence** (runtime): step input
  (`steps[].inputs.thinking_level`) → agent profile (`agent_profiles.thinking_level`)
  → per-model default (`llm_models.default_thinking_level`) → omit. The resolved
  level is clamped to the model's supported levels (pi SDK
  `getSupportedThinkingLevels`, DB `thinkingLevelMap` fallback); `off` is never
  clamped up.
```

- [ ] **Step 2: Update the guide + workflow-yaml-authoring skill**

Add a short "Thinking / effort level" subsection to the AI-config guide page and a `thinking_level` entry to the step-inputs reference in the `workflow-yaml-authoring` skill, with a YAML example:

```yaml
steps:
  - id: implement
    inputs:
      model: claude-opus-4-8
      thinking_level: high
```

- [ ] **Step 3: Write the ADR**

Create `docs/architecture/decisions/ADR-thinking-effort-level-configuration.md` capturing Context (no thinking-level config existed; runtime contract present but unpopulated), Decision (3-layer precedence; explicit `default_thinking_level` column — D2; clamp-to-nearest round-down — D3/D4; pi SDK as capability source — D7), and Consequences (backward compatible; per-model default is single-value/not per-use-case; future scope/workflow layers possible).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/guide docs/architecture/decisions/ADR-thinking-effort-level-configuration.md \
        .agents/skills/workflow-yaml-authoring/SKILL.md
git commit -m "docs(ai-config): document thinking/effort level precedence + ADR"
```

---

## Final Verification

- [ ] `npm run build --workspace=packages/core`
- [ ] `npm run build:api`
- [ ] `npm run build:web`
- [ ] `npm run test:api` (full api suite green)
- [ ] `npm run test --workspace=packages/core`
- [ ] `npm run test:unit:web`
- [ ] `npm run lint:summary` (no new findings)

## Rollout (post-merge)

- Run the new migration against the live DB (or rely on startup migration run).
- No harness/container image rebuild required — `ContainerAgentRequest.thinkingLevel` already exists end-to-end.
- Optional follow-up: seed `default_thinking_level` for reasoning-capable models.
