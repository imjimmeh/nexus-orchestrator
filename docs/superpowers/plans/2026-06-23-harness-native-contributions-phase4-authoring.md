# Harness-Native Contributions — Phase 4 (Authoring Surfaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators author harness contributions on agent profiles, workflow steps, and skill bundles; resolve them by precedence at runtime-config assembly and attach the result to `HarnessRuntimeConfig.contributions` so Phases 2-3 materialize them.

**Architecture:** Add a `harness_contributions` jsonb column to `agent_profiles` and a `contributions` block to skill metadata. At config assembly (`buildStepRunnerConfigPayloadCore` and the subagent path), gather the three sources (step inputs, profile, skills), run the Phase-1 `resolveHarnessContributions` against the resolved harness's capabilities, and attach the bundle. A web form section and docs complete the surface.

**Tech Stack:** TypeScript (strict), TypeORM, Zod, Vitest, React. Workspaces: `packages/core`, `apps/api`, `apps/web`.

**Spec:** `docs/superpowers/specs/2026-06-23-harness-native-contributions-design.md` · **Depends on:** Phase 1 (foundation). Phases 2-3 may land in parallel; this phase is what makes contributions non-empty.

## Global Constraints

- Strict lint policy: no `eslint-disable`/`@ts-ignore`/`@ts-nocheck`.
- New column is nullable jsonb (no backfill); absent ⇒ no contributions.
- Author input is validated by zod; invalid contribution blocks are dropped (not fatal) with a logged warning, mirroring the resolver's drop-with-diagnostics ethos.
- Precedence is **step → profile → skill → platform** (highest first), matching `resolveHarnessContributions`'s `sources` ordering.
- Build `packages/core` before API consumers: `npm run build --workspace=packages/core`.
- Test commands: `npm run test --workspace=packages/core -- <pattern>`, `npm run test:api -- <pattern>`, `npm run test:unit:web -- <pattern>`.

---

### Task 1: Core — profile contract + author input schema

**Files:**

- Modify: `packages/core/src/interfaces/agent-profile.types.ts:10-33`
- Modify: `packages/core/src/schemas/ai-config/harness-contributions.schema.ts` (add input schema)
- Modify: `packages/core/src/schemas/ai-config/profiles.schema.ts:9-44`
- Modify (test): `packages/core/src/schemas/ai-config/profiles.schema.spec.ts` (create if absent)

**Interfaces:**

- Consumes: `HarnessHookContributionSchema`, `HarnessExtensionContributionSchema`, `HarnessSettingsContributionSchema`, `HarnessContributions` (Phase 1).
- Produces: `IAgentProfile.harness_contributions?: Partial<HarnessContributions> | null`; `HarnessContributionsInputSchema`; `CreateAgentProfileSchema.harness_contributions`.

- [ ] **Step 1: Write the failing test**

Create/append `packages/core/src/schemas/ai-config/profiles.schema.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CreateAgentProfileSchema } from "./profiles.schema";
import { HarnessContributionsInputSchema } from "./harness-contributions.schema";

describe("agent profile harness_contributions", () => {
  it("accepts a partial contributions block on a profile", () => {
    const parsed = CreateAgentProfileSchema.parse({
      name: "p",
      harness_contributions: {
        hooks: [{ event: "session_start", command: "echo hi" }],
      },
    });
    expect(parsed.harness_contributions?.hooks?.[0].command).toBe("echo hi");
  });

  it("input schema allows any subset (no required arrays)", () => {
    expect(() => HarnessContributionsInputSchema.parse({})).not.toThrow();
    expect(() =>
      HarnessContributionsInputSchema.parse({
        settings: { outputStyle: "concise" },
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- profiles.schema`
Expected: FAIL — `HarnessContributionsInputSchema` undefined / `harness_contributions` rejected.

- [ ] **Step 3: Add the input schema**

In `packages/core/src/schemas/ai-config/harness-contributions.schema.ts`, append:

```ts
/**
 * Author-facing input: any subset of a contributions bundle. Differs from
 * HarnessContributionsSchema (the resolved bundle) by making every group
 * optional, so a profile/step/skill can contribute just hooks, just settings, etc.
 */
export const HarnessContributionsInputSchema = z.object({
  hooks: z.array(HarnessHookContributionSchema).optional(),
  extensions: z.array(HarnessExtensionContributionSchema).optional(),
  settings: HarnessSettingsContributionSchema.optional(),
});
```

- [ ] **Step 4: Add the profile field**

In `packages/core/src/interfaces/agent-profile.types.ts`, add the import and field:

```ts
import type { HarnessContributions } from "./harness-contributions.types";
```

Inside `IAgentProfile` (after `tool_policy?`):

```ts
  harness_contributions?: Partial<HarnessContributions> | null;
```

In `packages/core/src/schemas/ai-config/profiles.schema.ts`, add the import and field inside `CreateAgentProfileSchema` (after `tool_policy`):

```ts
import { HarnessContributionsInputSchema } from "./harness-contributions.schema";
```

```ts
  harness_contributions: HarnessContributionsInputSchema.optional().nullable(),
```

- [ ] **Step 5: Run test to verify it passes + build**

Run: `npm run test --workspace=packages/core -- profiles.schema`
Then: `npm run build --workspace=packages/core`
Expected: PASS, clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/interfaces/agent-profile.types.ts \
        packages/core/src/schemas/ai-config/harness-contributions.schema.ts \
        packages/core/src/schemas/ai-config/profiles.schema.ts \
        packages/core/src/schemas/ai-config/profiles.schema.spec.ts
git commit -m "feat(core): add harness_contributions to agent profile contract"
```

---

### Task 2: API — entity column + migration

**Files:**

- Modify: `apps/api/src/ai-config/database/entities/agent-profile.entity.ts:78-79`
- Create: `apps/api/src/database/migrations/20260624000000-add-agent-profile-harness-contributions.ts`
- Modify: `apps/api/src/database/migrations/registered-migrations.ts`
- Create (test): `apps/api/src/ai-config/database/entities/agent-profile.harness-contributions.spec.ts`

**Interfaces:**

- Consumes: `HarnessContributions` (Phase 1).
- Produces: `AgentProfile.harness_contributions` jsonb column; migration `AddAgentProfileHarnessContributions20260624000000`.

> Reference the `adding-entity-migration` agent skill for the project's entity/migration conventions.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/ai-config/database/entities/agent-profile.harness-contributions.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getMetadataArgsStorage } from "typeorm";
import { AgentProfile } from "./agent-profile.entity";

describe("AgentProfile.harness_contributions column", () => {
  it("is declared as a nullable jsonb column", () => {
    const col = getMetadataArgsStorage().columns.find(
      (c) =>
        c.target === AgentProfile && c.propertyName === "harness_contributions",
    );
    expect(col).toBeDefined();
    expect(col?.options.type).toBe("jsonb");
    expect(col?.options.nullable).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- agent-profile.harness-contributions`
Expected: FAIL — column not found.

- [ ] **Step 3: Add the entity column**

In `apps/api/src/ai-config/database/entities/agent-profile.entity.ts`, add the import and column (after `tool_policy` at line 79):

```ts
import type { ToolPolicyDocument, HarnessContributions } from "@nexus/core";
```

```ts
  @Column({ type: 'jsonb', nullable: true, default: null })
  harness_contributions?: Partial<HarnessContributions> | null;
```

(Merge the import with the existing `@nexus/core` type import rather than adding a duplicate line.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- agent-profile.harness-contributions`
Expected: PASS.

- [ ] **Step 5: Write the migration**

Create `apps/api/src/database/migrations/20260624000000-add-agent-profile-harness-contributions.ts`:

```ts
import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAgentProfileHarnessContributions20260624000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
      ADD COLUMN IF NOT EXISTS harness_contributions jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agent_profiles
      DROP COLUMN IF EXISTS harness_contributions;
    `);
  }
}
```

Register it in `apps/api/src/database/migrations/registered-migrations.ts` (import + add to the exported array, following the existing entries' pattern).

- [ ] **Step 6: Build the API to confirm migration wiring**

Run: `npm run build:api`
Expected: clean (confirms the migration is registered and typed).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/ai-config/database/entities/agent-profile.entity.ts \
        apps/api/src/database/migrations/20260624000000-add-agent-profile-harness-contributions.ts \
        apps/api/src/database/migrations/registered-migrations.ts \
        apps/api/src/ai-config/database/entities/agent-profile.harness-contributions.spec.ts
git commit -m "feat(api): add harness_contributions column + migration to agent_profiles"
```

---

### Task 3: API — pure source-gathering helper

**Files:**

- Create: `apps/api/src/harness/gather-contribution-sources.ts`
- Create (test): `apps/api/src/harness/gather-contribution-sources.spec.ts`

**Interfaces:**

- Consumes: `HarnessContributionsInputSchema` (Task 1); `ContributionSource` (Phase 1 resolver types); `SkillLibraryRecord` (`apps/api/src/ai-config/services/agent-skill-library.service.types.ts`).
- Produces: `gatherContributionSources(input: GatherInput): ContributionSource[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/harness/gather-contribution-sources.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gatherContributionSources } from "./gather-contribution-sources";

describe("gatherContributionSources", () => {
  it("orders sources step → profile → skill and validates each", () => {
    const sources = gatherContributionSources({
      stepInput: { hooks: [{ event: "session_start", command: "step" }] },
      profile: { settings: { outputStyle: "verbose" } },
      skills: [
        {
          metadata: {
            contributions: {
              extensions: [
                { name: "fs", transport: "stdio", command: "mcp-fs" },
              ],
            },
          },
        },
      ],
    });
    expect(sources.map((s) => s.origin)).toEqual(["step", "profile", "skill"]);
    expect(sources[0].contributions.hooks?.[0].command).toBe("step");
    expect(sources[2].contributions.extensions?.[0].name).toBe("fs");
  });

  it("drops invalid author input rather than throwing", () => {
    const sources = gatherContributionSources({
      stepInput: { hooks: [{ event: "not-a-real-event", command: "x" }] },
      profile: null,
      skills: [],
    });
    expect(sources).toEqual([]);
  });

  it("ignores skills without a contributions block", () => {
    const sources = gatherContributionSources({
      stepInput: undefined,
      profile: undefined,
      skills: [{ metadata: { foo: "bar" } }, { metadata: null }],
    });
    expect(sources).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- gather-contribution-sources`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `apps/api/src/harness/gather-contribution-sources.ts`:

```ts
import {
  HarnessContributionsInputSchema,
  type HarnessContributions,
} from "@nexus/core";
import type { ContributionSource } from "./harness-contribution-resolver.types";

interface SkillLike {
  metadata?: Record<string, unknown> | null;
}

export interface GatherInput {
  stepInput?: unknown;
  profile?: unknown;
  skills?: SkillLike[];
}

function validate(raw: unknown): Partial<HarnessContributions> | undefined {
  if (raw == null) return undefined;
  const result = HarnessContributionsInputSchema.safeParse(raw);
  return result.success
    ? (result.data as Partial<HarnessContributions>)
    : undefined;
}

/**
 * Build the precedence-ordered (step → profile → skill) contribution sources for
 * the resolver. Each candidate is validated against the author-input schema;
 * invalid blocks are dropped (never throw) so one bad authored entry cannot fail
 * a run. Skills contribute via `metadata.contributions`.
 */
export function gatherContributionSources(
  input: GatherInput,
): ContributionSource[] {
  const sources: ContributionSource[] = [];

  const step = validate(input.stepInput);
  if (step) sources.push({ origin: "step", contributions: step });

  const profile = validate(input.profile);
  if (profile) sources.push({ origin: "profile", contributions: profile });

  for (const skill of input.skills ?? []) {
    const contributions = validate(skill.metadata?.["contributions"]);
    if (contributions) sources.push({ origin: "skill", contributions });
  }

  return sources;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- gather-contribution-sources`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/harness/gather-contribution-sources.ts \
        apps/api/src/harness/gather-contribution-sources.spec.ts
git commit -m "feat(api): pure contribution source gatherer (step/profile/skill)"
```

---

### Task 4: API — profile contributions loader

**Files:**

- Modify: `apps/api/src/ai-config/services/agent-profile-resolution.service.ts`
- Create (test): `apps/api/src/ai-config/services/agent-profile-resolution.contributions.spec.ts`

**Interfaces:**

- Consumes: `ScopedConfigResolver.resolve` (existing), `AgentProfile.harness_contributions` (Task 2).
- Produces: `AgentProfileResolutionService.resolveContributions(name, scopeNodeId): Promise<Partial<HarnessContributions> | undefined>`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/ai-config/services/agent-profile-resolution.contributions.spec.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { AgentProfileResolutionService } from "./agent-profile-resolution.service";

function makeService(harnessContributions: unknown) {
  const resolver = {
    resolve: vi.fn(async () => ({
      config: { harness_contributions: harnessContributions },
    })),
  };
  return new AgentProfileResolutionService(resolver as never);
}

describe("AgentProfileResolutionService.resolveContributions", () => {
  it("returns the profile's harness_contributions", async () => {
    const svc = makeService({
      hooks: [{ event: "session_start", command: "x" }],
    });
    const out = await svc.resolveContributions("p", null);
    expect(out?.hooks?.[0].command).toBe("x");
  });

  it("returns undefined when the profile has none", async () => {
    const svc = makeService(null);
    expect(await svc.resolveContributions("p", null)).toBeUndefined();
  });

  it("returns undefined for an empty name", async () => {
    const svc = makeService({});
    expect(await svc.resolveContributions(undefined, null)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- agent-profile-resolution.contributions`
Expected: FAIL — `resolveContributions` not a function.

- [ ] **Step 3: Add the method**

In `apps/api/src/ai-config/services/agent-profile-resolution.service.ts`, add the import and method:

```ts
import type { HarnessContributions } from "@nexus/core";
```

```ts
  async resolveContributions(
    name: string | undefined,
    scopeNodeId: string | null,
  ): Promise<Partial<HarnessContributions> | undefined> {
    if (!name) return undefined;
    const effective = await this.resolve(name, scopeNodeId);
    const raw = effective.config?.harness_contributions;
    return raw ?? undefined;
  }
```

> Confirm the `EffectiveConfig<AgentProfile>` accessor: this assumes the resolved entity is on `.config`. If `effective-config.types.ts` exposes it under a different field (e.g. `.value`), use that — the test's mock mirrors `.config`, so keep them aligned.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- agent-profile-resolution.contributions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai-config/services/agent-profile-resolution.service.ts \
        apps/api/src/ai-config/services/agent-profile-resolution.contributions.spec.ts
git commit -m "feat(api): load harness_contributions from resolved agent profile"
```

---

### Task 5: API — wire the resolver into step runtime-config assembly

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts:69-190`
- Create (test): `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.contributions.spec.ts`

**Interfaces:**

- Consumes: `gatherContributionSources` (Task 3), `resolveHarnessContributions` (Phase 1), `AgentProfileResolutionService.resolveContributions` (Task 4), `harnessEntry.capabilities` (existing, line 168).
- Produces: `buildStepRunnerConfigPayloadCore` attaches `contributions` to the returned `HarnessRuntimeConfig` (omitted when empty); new optional param `agentProfileResolution?`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.contributions.spec.ts`. Test the small attachment seam via a focused unit — assert that when sources resolve to a non-empty bundle, the returned config carries `contributions`; when empty, it is omitted.

```ts
import { describe, it, expect } from "vitest";
import { attachResolvedContributions } from "./step-agent-step-executor.helpers";
import type { HarnessCapabilities } from "@nexus/core";

const caps: HarnessCapabilities = {
  executionModes: ["agent_turn"],
  toolModel: "permission_callback",
  supportsSubagents: true,
  supportsWarRoom: true,
  supportsBranching: false,
  supportsResume: true,
  resumeMechanism: "config_ref",
  supportsThinkingLevels: false,
  supportedAuthTypes: ["api_key"],
  telemetryContractVersion: "v1",
  supportsHooks: true,
  supportsExtensions: true,
  supportsSettings: true,
  supportedHookEvents: ["session_start"],
};

describe("attachResolvedContributions", () => {
  it("adds a contributions key when sources resolve non-empty", () => {
    const out = attachResolvedContributions(
      { harnessId: "claude-code" } as never,
      {
        harnessId: "claude-code",
        capabilities: caps,
        sources: [
          {
            origin: "profile",
            contributions: {
              hooks: [{ event: "session_start", command: "x" }],
            },
          },
        ],
      },
    );
    expect(out.contributions?.hooks?.[0].command).toBe("x");
  });

  it("omits contributions when nothing resolves", () => {
    const out = attachResolvedContributions({ harnessId: "pi" } as never, {
      harnessId: "pi",
      capabilities: { ...caps, supportsHooks: false, supportedHookEvents: [] },
      sources: [
        {
          origin: "profile",
          contributions: { hooks: [{ event: "session_start", command: "x" }] },
        },
      ],
    });
    expect(out.contributions).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:api -- step-agent-step-executor.contributions`
Expected: FAIL — `attachResolvedContributions` not exported.

- [ ] **Step 3: Add the attachment helper + wire it in**

In `step-agent-step-executor.helpers.ts`, add imports:

```ts
import { resolveHarnessContributions } from "../../harness/harness-contribution-resolver";
import type { ResolveContributionsParams } from "../../harness/harness-contribution-resolver.types";
import {
  EMPTY_HARNESS_CONTRIBUTIONS,
  type HarnessRuntimeConfig,
} from "@nexus/core";
```

Add the pure attachment helper (exported for unit testing):

```ts
/**
 * Resolve contributions for the chosen harness and attach them to the config,
 * omitting the key entirely when nothing survives capability validation (keeps
 * empty-bundle runs byte-identical to before this feature).
 */
export function attachResolvedContributions(
  config: HarnessRuntimeConfig,
  resolveParams: ResolveContributionsParams,
): HarnessRuntimeConfig {
  const contributions = resolveHarnessContributions(resolveParams);
  if (contributions === EMPTY_HARNESS_CONTRIBUTIONS) return config;
  return { ...config, contributions };
}
```

Add a new optional param to `buildStepRunnerConfigPayloadCore`'s signature (alongside the existing service params):

```ts
  agentProfileResolution?: {
    resolveContributions(
      name: string | undefined,
      scopeNodeId: string | null,
    ): Promise<import('@nexus/core').HarnessContributions | Partial<import('@nexus/core').HarnessContributions> | undefined>;
  };
```

Replace the final `return { ... }` (lines 177-189) so it gathers sources and attaches:

```ts
const harnessEntry = params.registry.resolve?.(finalHarnessId);
const resumeMechanism = harnessEntry?.capabilities?.resumeMechanism;
const session = resumeMechanism
  ? buildRunnerSessionConfig({
      resumeSessionRef: params.data.resumeSessionRef,
      resumeMechanism,
    })
  : undefined;

const baseConfig: HarnessRuntimeConfig = {
  harnessId: finalHarnessId,
  model: {
    provider: finalProviderConfig.provider,
    model: resolvedSettings.model,
    auth: resolvedAuth,
    baseUrl: finalProviderConfig.baseUrl,
    providerConfig: finalProviderConfig.providerConfig,
  },
  prompt: { systemPrompt, initialPrompt },
  ...(session ? { session } : {}),
  ...(credentials ? { harnessOptions: { credentials } } : {}),
};

// Attach author contributions only when the registry exposes capabilities to
// validate against (custom registries without `resolve` keep the base config).
if (!harnessEntry?.capabilities) return baseConfig;

const profileContributions = params.agentProfileResolution
  ? await params.agentProfileResolution.resolveContributions(
      agentProfile,
      params.scopeNodeId ?? null,
    )
  : undefined;

const sources = gatherContributionSources({
  stepInput: params.resolvedJobInputs.harness_contributions,
  profile: profileContributions,
  skills: params.assignedSkills ?? [],
});

return attachResolvedContributions(baseConfig, {
  harnessId: finalHarnessId,
  capabilities: harnessEntry.capabilities,
  sources,
  ledger: params.ledger,
});
```

Add the `gatherContributionSources` import at the top:

```ts
import { gatherContributionSources } from "../../harness/gather-contribution-sources";
```

Wire the real `AgentProfileResolutionService` into the caller that invokes `buildStepRunnerConfigPayloadCore` (the step executor service) by passing `agentProfileResolution: this.agentProfileResolution`. Inject `AgentProfileResolutionService` into that service's constructor if not already present (it lives in the `ai-config` module; import and add to providers/exports as needed).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:api -- step-agent-step-executor.contributions`
Expected: PASS.

- [ ] **Step 5: Build the API**

Run: `npm run build:api`
Expected: clean (confirms the new param + DI wiring typecheck).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts \
        apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.contributions.spec.ts
git commit -m "feat(api): resolve + attach harness contributions at step config assembly"
```

---

### Task 6: API — wire the subagent path

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts:54-120`
- Create (test): `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.contributions.spec.ts`

**Interfaces:**

- Consumes: the same `gatherContributionSources` + `resolveHarnessContributions` + `attachResolvedContributions` helpers, plus the subagent's resolved harness capabilities and agent profile.
- Produces: subagent `HarnessRuntimeConfig` carries `contributions` when authored.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.contributions.spec.ts` asserting that when the subagent's profile/spawn params carry contributions and the resolved harness supports them, the stored runner config includes `contributions`; otherwise it is omitted. Mirror the existing subagent config test setup in the same directory for the mock shapes.

```ts
import { describe, it, expect } from "vitest";
import { attachResolvedContributions } from "../workflow-step-execution/step-agent-step-executor.helpers";
import type { HarnessCapabilities } from "@nexus/core";

const caps: HarnessCapabilities = {
  executionModes: ["agent_turn"],
  toolModel: "permission_callback",
  supportsSubagents: true,
  supportsWarRoom: true,
  supportsBranching: false,
  supportsResume: true,
  resumeMechanism: "config_ref",
  supportsThinkingLevels: false,
  supportedAuthTypes: ["api_key"],
  telemetryContractVersion: "v1",
  supportsHooks: true,
  supportsExtensions: true,
  supportsSettings: true,
  supportedHookEvents: ["session_start"],
};

describe("subagent contributions attachment", () => {
  it("attaches resolved contributions to the subagent config", () => {
    const out = attachResolvedContributions(
      { harnessId: "claude-code" } as never,
      {
        harnessId: "claude-code",
        capabilities: caps,
        sources: [
          {
            origin: "profile",
            contributions: { settings: { outputStyle: "concise" } },
          },
        ],
      },
    );
    expect(out.contributions?.settings.outputStyle).toBe("concise");
  });
});
```

- [ ] **Step 2: Run it (helper already exists from Task 5)**

Run: `npm run test:api -- subagent-orchestrator.contributions`
Expected: PASS (reuses the exported `attachResolvedContributions`).

- [ ] **Step 3: Wire the subagent config assembly**

In `subagent-orchestrator.container-config.operations.ts`'s `resolveAndStageSubagentRunnerConfig` (lines 54-120), after the harness/provider/model resolve and before `runnerConfigStore.store(...)`, gather sources (subagent profile via the same resolution loader; spawn-param `harness_contributions` if supported; the subagent's assigned skills) and apply `attachResolvedContributions` to the config object that is stored. Pass the subagent's resolved harness capabilities (from the registry `resolve`) and the ledger for diagnostics.

```ts
const baseConfig = {
  harnessId,
  model: {
    /* ... */
  },
  prompt: {
    /* ... */
  },
};
const capabilities = context.harnessRegistry.resolve?.(harnessId)?.capabilities;
const finalConfig = capabilities
  ? attachResolvedContributions(baseConfig, {
      harnessId,
      capabilities,
      sources: gatherContributionSources({
        stepInput: params.spawnParams.harness_contributions,
        profile: subagentProfileContributions,
        skills: assignedSubagentSkills ?? [],
      }),
      ledger: context.ledger,
    })
  : baseConfig;

await context.runnerConfigStore.store(
  params.spawnParams.workflowRunId,
  params.executionId,
  finalConfig,
);
```

(Use the field names present in this operation for the registry, ledger, profile, and skills; the research located `agentProfile` at line 62 and `spawnParams` at line 79. Load `subagentProfileContributions` via the same `AgentProfileResolutionService.resolveContributions` used in Task 5, injected into this operation's context.)

- [ ] **Step 4: Build + commit**

Run: `npm run build:api`
Expected: clean.

```bash
git add apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts \
        apps/api/src/workflow/workflow-subagents/subagent-orchestrator.contributions.spec.ts
git commit -m "feat(api): resolve + attach harness contributions for subagents"
```

---

### Task 7: Web — agent profile contributions editor

**Files:**

- Modify: `apps/web/src/pages/agents/AgentProfileForm.tsx:39-69` (schema)
- Modify: `apps/web/src/pages/agents/AgentProfileForm.fields.tsx` (new section)
- Create (test): `apps/web/src/pages/agents/AgentProfileForm.contributions.test.tsx`

**Interfaces:**

- Consumes: the profile form state + the API's `harness_contributions` field.
- Produces: a "Harness Contributions" section editing hooks/extensions/settings as JSON, persisted on save.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/agents/AgentProfileForm.contributions.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HarnessContributionsField } from "./AgentProfileForm.fields";

describe("HarnessContributionsField", () => {
  it("renders a contributions editor with the section label", () => {
    render(<HarnessContributionsField value={null} onChange={() => {}} />);
    expect(screen.getByText(/Harness Contributions/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit:web -- AgentProfileForm.contributions`
Expected: FAIL — `HarnessContributionsField` not exported.

- [ ] **Step 3: Add the field component + schema**

In `AgentProfileForm.fields.tsx`, add and export a `HarnessContributionsField` component — a labeled JSON textarea (the bundle is low-frequency and structurally rich; a guided JSON editor is the YAGNI choice for v1) that parses/validates against the shape and surfaces parse errors inline:

```tsx
export function HarnessContributionsField({
  value,
  onChange,
}: {
  value: Record<string, unknown> | null;
  onChange: (next: Record<string, unknown> | null) => void;
}) {
  return (
    <section>
      <label className="font-medium">Harness Contributions</label>
      <p className="text-sm text-muted-foreground">
        Author hooks, extensions (MCP servers), and settings. Applied per the
        resolved harness's capabilities; unsupported entries are dropped.
      </p>
      <textarea
        aria-label="Harness Contributions JSON"
        defaultValue={value ? JSON.stringify(value, null, 2) : ""}
        onBlur={(e) => {
          const text = e.target.value.trim();
          if (!text) return onChange(null);
          try {
            onChange(JSON.parse(text));
          } catch {
            /* leave prior value; inline error UI is handled by the form */
          }
        }}
      />
    </section>
  );
}
```

In `AgentProfileForm.tsx`, add `harness_contributions: z.record(z.string(), z.any()).optional().nullable()` to the form schema (line 39-69) and render `<HarnessContributionsField />` wired to the form state; include the field in the submit payload.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit:web -- AgentProfileForm.contributions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/agents/AgentProfileForm.tsx \
        apps/web/src/pages/agents/AgentProfileForm.fields.tsx \
        apps/web/src/pages/agents/AgentProfileForm.contributions.test.tsx
git commit -m "feat(web): author harness contributions on the agent profile form"
```

---

### Task 8: Docs + seed validation

**Files:**

- Modify: `docs/guide/41-harness-runtime.md`
- Modify: `.agents/skills/seed-workflow-patterns/` reference (if it documents profile fields) and `.agents/skills/workflow-yaml-authoring/` (document `inputs.harness_contributions`)
- Modify: `docs/superpowers/specs/2026-06-23-harness-native-contributions-design.md` (§8 mark authoring surfaces delivered)

**Interfaces:** none (documentation).

- [ ] **Step 1: Document the authoring surfaces**

Update `docs/guide/41-harness-runtime.md` with a "Authoring harness contributions" subsection: the three surfaces (profile `harness_contributions`, step `inputs.harness_contributions`, skill `metadata.contributions`), the step→profile→skill→platform precedence, and a worked example (a profile that installs an MCP server + a `SessionStart` hook). Note the capability gating (PI drops them; Claude Code materializes them).

Update the `workflow-yaml-authoring` skill to list `inputs.harness_contributions` as a recognized step input override, with a short YAML example.

In the design spec §8, mark the authoring surfaces as delivered and link the worked example.

- [ ] **Step 2: Validate seed data still passes**

Run: `npm run validate:seed-data`
Expected: PASS (no seed contributions added, but confirms the new optional field doesn't break validation).

- [ ] **Step 3: Commit**

```bash
git add docs/guide/41-harness-runtime.md \
        docs/superpowers/specs/2026-06-23-harness-native-contributions-design.md \
        .agents/skills/workflow-yaml-authoring
git commit -m "docs(harness): document harness contribution authoring surfaces"
```

---

## Phase 4 Completion Check

- [ ] `npm run build --workspace=packages/core` — clean
- [ ] `npm run build:api` — clean
- [ ] `npm run test:api -- "harness|contribution|agent-profile"` — green
- [ ] `npm run test:unit:web -- AgentProfileForm.contributions` — green
- [ ] `npm run validate:seed-data` — green
- [ ] Migration runs on the live stack; a profile with `harness_contributions` round-trips through the API and web form
- [ ] **End-to-end (with Phase 3):** author an MCP server + `SessionStart` hook on a profile, run a Claude Code step, confirm via run logs that the hook fired and the MCP tool was available and governed; run the same on a `pi` step and confirm a `harness_contribution_dropped` ledger diagnostic.

## Epic-level Done

With Phases 1-4 merged: contributions are authored on profiles/steps/skills, resolved with precedence + capability diagnostics, attached to the runtime config, and materialized natively by Claude Code (PI honestly drops them). The full EPIC-210 surface — minus the deferred slash-commands contribution type — is delivered.
