# Epic D — Definition-Change Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the diagnosis→mutation gap for definitions (spec §4.4): add the `agent_profile_change` and `workflow_definition_change` proposal kinds, appliers with snapshot-first rollback and reseed protection, retrospective-analyst production of both kinds through the router's confidence rails, and per-kind detail rendering (field diff / YAML diff / rollback button) in the improvements queue UI.

**Architecture:** Two Zod payload schemas in `packages/core` (shared with web); two `IImprovementApplier` implementations registered on the Epic-A `IMPROVEMENT_APPLIERS` multi-token that mutate ONLY through the existing human-edit paths (`AiConfigAdminService.updateAgentProfile` / `IWorkflowPersistenceService.updateWorkflow`), write `rollback_data` before mutating, and pin the row's `overrides` jsonb so the seed's presence-only skip guard (`agent-profile-seed.service.ts:151-162`, `workflows.seed.ts:201-238`) protects applied changes; `RetrospectiveOutputRouter` gains two dispatch branches that validate targets against real repositories and submit through `ImprovementProposalService.submitProposal` with router-derived confidence; the router port grows a route-result so invalid targets drop with a ledger note via the orchestrator's existing `emitRejectedFinding`; the web queue gets kind-dispatched detail components reusing the already-present Monaco `DiffEditor` (zero new dependencies).

**Tech Stack:** NestJS 11 + TypeORM + Zod 4 + Vitest (apps/api, packages/core); React 19 + TanStack Query + `@monaco-editor/react` + Tailwind/shadcn + Vitest/testing-library (apps/web).

## Global Constraints

- **Depends on Epic A merged.** Consume — never redefine — the Epic-A contracts: `ImprovementProposalKind` / `ImprovementProposalStatus` / `GovernanceAction` / `ImprovementEvidenceClass` (packages/core); entity `ImprovementProposal` at `apps/api/src/improvement/database/entities/improvement-proposal.entity.ts` (columns `payload`, `evidence`, `confidence`, `rollback_data`, `occurrence_count`, `provenance`, `applied_at`, `rolled_back_at`); `ImprovementProposalService.submitProposal(draft)` / `approve(id)` / `reject(id)` / `rollback(id)`; `IImprovementApplier { readonly kind; apply(proposal): Promise<ImprovementApplyResult { ok, detail?, unrouted? }>; rollback?(proposal): Promise<void> }` registered on the DI multi-token `IMPROVEMENT_APPLIERS` at `apps/api/src/improvement/appliers/`; `ImprovementGovernancePolicyService.resolveAction({ kind, evidenceClass, confidence })`.
- **Epic-A file-name resolution (do once, first):** the contract SYMBOL names above are binding; exact Epic-A FILE names (applier contract file, module file, service file, core improvement-schema barrel, web queue page/hook files) are not restated per-task — resolve them once with `Grep "ImprovementProposalService|IMPROVEMENT_APPLIERS|ImprovementProposalKind" apps/api/src/improvement packages/core/src apps/web/src` before Task 1 and use the real paths everywhere this plan says "(Epic A)".
- Strict TDD (Red-Green-Refactor); every task starts with a failing test.
- API/core unit tests: Vitest, direct `new` construction with typed mock objects cast `as unknown as <Dep>` (mirror `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.spec.ts`); web tests: testing-library + `vi.mock` (mirror `apps/web/src/pages/project-workspace/LearningTabProposalsCard.spec.tsx`).
- Build order: `npm run build --workspace=packages/core` before `npm run build:api` (nest build, never tsc) and `npm run build:web`.
- Never suppress lint; eslint `max-lines` 500 — new logic goes into pure `*.helpers.ts` files + small injectable services; exported interfaces live in `*.types.ts` companions (project `no-restricted-syntax` convention).
- No re-exports, no legacy paths, no compatibility aliases.
- Core/Kanban boundary untouched: nothing in this epic references Kanban identifiers; `nexus-boundaries/no-core-kanban-residue` must stay green.
- Web quality gate: components are presentation-only; all fetching/mutation lives in hooks; **no new dependencies** — YAML diff uses `@monaco-editor/react`'s `DiffEditor` (already in `apps/web/package.json` ^4.7.0, used by `apps/web/src/components/workflow/YamlEditor.tsx`).
- **Out of scope (spec §8):** post-apply probation watcher — the Epic-A schema (`applied_at`, `rollback_data`, `provenance`, `rolled_back_at`) is the designed-for support and is sufficient; this plan builds NOTHING for it.
- Work on branch `feature/epic-d-definition-change-proposals`; small atomic commits per task; verify `git branch --show-current` before every commit.
- Never run two web test suites concurrently (jsdom OOM).

---

## Task 1: Definition-change payload schemas in packages/core

**Files:**

- `packages/core/src/schemas/ai-config/profiles.schema.ts` (lines 28–50: extract the inline `tool_policy` object into an exported `AgentProfileToolPolicySchema`)
- `packages/core/src/schemas/improvement/definition-change-payloads.schema.ts` (new — beside the Epic-A improvement payload schemas; if Epic A landed its payload schemas in a different core directory, create this file there instead and adjust the barrel accordingly)
- Epic-A improvement schema barrel (add one export line for the new file; `packages/core/src/schemas/index.ts` already re-exports the whole tree via `export * from "./schemas"` in `packages/core/src/index.ts:9`)
- `packages/core/test/improvement/definition-change-payloads.schema.spec.ts` (new)

**Interfaces:**

- Consumes: `RunnerThinkingLevelSchema` (`packages/core/src/schemas/ai-config/thinking-level.schema.ts`), `z` (zod 4 — note `z.uuid()` top-level form as in `profiles.schema.ts:21`).
- Produces:
  - `AgentProfileToolPolicySchema` (extracted, shape-identical to the current inline object in `CreateAgentProfileSchema`)
  - `SYSTEM_PROMPT_CHANGE_MODES = ['append', 'replace'] as const`
  - `AgentProfilePatchSchema`, `AgentProfileChangePayloadSchema`, `WorkflowChangeSummaryEntrySchema`, `WorkflowDefinitionChangePayloadSchema`
  - Inferred types: `AgentProfilePatch`, `AgentProfileChangePayload`, `WorkflowChangeSummaryEntry`, `WorkflowDefinitionChangePayload`

**Steps:**

- [ ] Write the failing spec at `packages/core/test/improvement/definition-change-payloads.schema.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AgentProfileChangePayloadSchema,
  WorkflowDefinitionChangePayloadSchema,
} from "../../src/schemas/improvement/definition-change-payloads.schema";

describe("AgentProfileChangePayloadSchema", () => {
  it("accepts a system_prompt append patch", () => {
    const result = AgentProfileChangePayloadSchema.safeParse({
      profileName: "implementation-agent",
      patch: {
        system_prompt: { mode: "append", value: "Always run the linter." },
      },
      changeSummary: "Append lint reminder",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty patch", () => {
    const result = AgentProfileChangePayloadSchema.safeParse({
      profileName: "implementation-agent",
      patch: {},
      changeSummary: "no-op",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an assigned_skills change that neither adds nor removes", () => {
    const result = AgentProfileChangePayloadSchema.safeParse({
      profileName: "implementation-agent",
      patch: { assigned_skills: {} },
      changeSummary: "no-op skills",
    });
    expect(result.success).toBe(false);
  });
});

describe("WorkflowDefinitionChangePayloadSchema", () => {
  const changeSummary = [
    {
      stepId: "implement",
      field: "max_retries",
      from: "0",
      to: "2",
      rationale: "unwinnable retry budget",
    },
  ];

  it("accepts workflowName + full proposedYaml + changeSummary", () => {
    const result = WorkflowDefinitionChangePayloadSchema.safeParse({
      workflowName: "work_item_split_default",
      proposedYaml: "workflow_id: work_item_split_default\nname: Split\n",
      changeSummary,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when neither workflowName nor workflowId is present", () => {
    const result = WorkflowDefinitionChangePayloadSchema.safeParse({
      proposedYaml: "workflow_id: x\n",
      changeSummary,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty changeSummary", () => {
    const result = WorkflowDefinitionChangePayloadSchema.safeParse({
      workflowId: "1b671a64-40d5-491e-99b0-da01ff1f3341",
      proposedYaml: "workflow_id: x\n",
      changeSummary: [],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] Run: `npm run test --workspace=packages/core` — expect FAIL (module not found).
- [ ] In `packages/core/src/schemas/ai-config/profiles.schema.ts`, extract the inline `tool_policy` object (current lines 28–50) into an exported const `AgentProfileToolPolicySchema` and change `CreateAgentProfileSchema.tool_policy` to `AgentProfileToolPolicySchema.optional().nullable()` (identical semantics; `UpdateAgentProfileSchema = CreateAgentProfileSchema.partial()` is unchanged).
- [ ] Implement `packages/core/src/schemas/improvement/definition-change-payloads.schema.ts`:

```ts
import { z } from "zod";
import { AgentProfileToolPolicySchema } from "../ai-config/profiles.schema";
import { RunnerThinkingLevelSchema } from "../ai-config/thinking-level.schema";

export const SYSTEM_PROMPT_CHANGE_MODES = ["append", "replace"] as const;

const SystemPromptChangeSchema = z.object({
  mode: z.enum(SYSTEM_PROMPT_CHANGE_MODES),
  value: z.string().trim().min(1),
});

const AssignedSkillsChangeSchema = z
  .object({
    add: z.array(z.string().trim().min(1)).optional(),
    remove: z.array(z.string().trim().min(1)).optional(),
  })
  .refine(
    (change) => (change.add?.length ?? 0) + (change.remove?.length ?? 0) > 0,
    {
      message: "assigned_skills change must add or remove at least one skill",
    },
  );

export const AgentProfilePatchSchema = z
  .object({
    system_prompt: SystemPromptChangeSchema.optional(),
    model_name: z.string().trim().min(1).optional(),
    provider_name: z.string().trim().min(1).optional(),
    thinking_level: RunnerThinkingLevelSchema.nullable().optional(),
    tool_policy: AgentProfileToolPolicySchema.optional(),
    assigned_skills: AssignedSkillsChangeSchema.optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    {
      message: "patch must change at least one field",
    },
  );

export const AgentProfileChangePayloadSchema = z.object({
  profileName: z.string().trim().min(1),
  patch: AgentProfilePatchSchema,
  changeSummary: z.string().trim().min(1),
});

export const WorkflowChangeSummaryEntrySchema = z.object({
  stepId: z.string().trim().min(1).optional(),
  field: z.string().trim().min(1),
  from: z.string(),
  to: z.string(),
  rationale: z.string().trim().min(1),
});

export const WorkflowDefinitionChangePayloadSchema = z
  .object({
    workflowName: z.string().trim().min(1).optional(),
    workflowId: z.uuid().optional(),
    proposedYaml: z.string().trim().min(1),
    changeSummary: z.array(WorkflowChangeSummaryEntrySchema).min(1),
  })
  .refine(
    (payload) =>
      payload.workflowName !== undefined || payload.workflowId !== undefined,
    {
      message: "workflowName or workflowId is required",
    },
  );

export type AgentProfilePatch = z.infer<typeof AgentProfilePatchSchema>;
export type AgentProfileChangePayload = z.infer<
  typeof AgentProfileChangePayloadSchema
>;
export type WorkflowChangeSummaryEntry = z.infer<
  typeof WorkflowChangeSummaryEntrySchema
>;
export type WorkflowDefinitionChangePayload = z.infer<
  typeof WorkflowDefinitionChangePayloadSchema
>;
```

(`model_name`/`provider_name` are deliberately NOT nullable: `UpdateAgentProfileSchema` cannot clear them to null, so the patch cannot promise what the apply path cannot deliver.)

- [ ] Add the export line for the new file to the Epic-A improvement schema barrel.
- [ ] Run: `npm run test --workspace=packages/core` — expect PASS.
- [ ] Run: `npm run build --workspace=packages/core` — expect clean.
- [ ] Commit: `git add packages/core && git commit -m "feat(core): add agent_profile_change and workflow_definition_change payload schemas"`

---

## Task 2: Shared definition-change applier helpers

**Files:**

- `apps/api/src/improvement/appliers/definition-change.helpers.ts` (new, pure + one repo-taking function)
- `apps/api/src/improvement/appliers/definition-change.helpers.spec.ts` (new)

**Interfaces:**

- Consumes: `ImprovementProposal` entity (Epic A), TypeORM `Repository<ImprovementProposal>`.
- Produces:
  - `IMPROVEMENT_OVERRIDES_KEY = 'improvement_proposal'`
  - `buildImprovementOverridesMarker(existing: Record<string, unknown> | null | undefined, proposalId: string, appliedAtIso: string): Record<string, unknown>` — merges `{ [IMPROVEMENT_OVERRIDES_KEY]: { proposal_id, applied_at } }` over the existing overrides object (never discards prior keys; result is always non-null, which is exactly what both seed guards key on).
  - `persistRollbackSnapshotOnce(repository: Repository<ImprovementProposal>, proposal: ImprovementProposal, snapshot: Record<string, unknown>): Promise<void>` — no-op when `proposal.rollback_data` is already non-null (retry idempotency: the FIRST pre-mutation snapshot is never overwritten); otherwise `repository.update(proposal.id, { rollback_data: snapshot })` and mirrors onto the in-memory `proposal.rollback_data`.

**Steps:**

- [ ] Write the failing spec `apps/api/src/improvement/appliers/definition-change.helpers.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import type { ImprovementProposal } from "../database/entities/improvement-proposal.entity";
import {
  buildImprovementOverridesMarker,
  IMPROVEMENT_OVERRIDES_KEY,
  persistRollbackSnapshotOnce,
} from "./definition-change.helpers";

describe("buildImprovementOverridesMarker", () => {
  it("produces a non-null object carrying proposal provenance", () => {
    const marker = buildImprovementOverridesMarker(
      null,
      "prop-1",
      "2026-07-02T00:00:00.000Z",
    );
    expect(marker[IMPROVEMENT_OVERRIDES_KEY]).toEqual({
      proposal_id: "prop-1",
      applied_at: "2026-07-02T00:00:00.000Z",
    });
  });

  it("preserves pre-existing override keys", () => {
    const marker = buildImprovementOverridesMarker(
      { admin_custom: true },
      "prop-1",
      "x",
    );
    expect(marker.admin_custom).toBe(true);
  });
});

describe("persistRollbackSnapshotOnce", () => {
  it("writes the snapshot when rollback_data is null", async () => {
    const repository = { update: vi.fn().mockResolvedValue(undefined) };
    const proposal = {
      id: "prop-1",
      rollback_data: null,
    } as unknown as ImprovementProposal;
    await persistRollbackSnapshotOnce(
      repository as unknown as Repository<ImprovementProposal>,
      proposal,
      { yaml_definition: "old" },
    );
    expect(repository.update).toHaveBeenCalledWith("prop-1", {
      rollback_data: { yaml_definition: "old" },
    });
    expect(proposal.rollback_data).toEqual({ yaml_definition: "old" });
  });

  it("never overwrites an existing snapshot (retry idempotency)", async () => {
    const repository = { update: vi.fn() };
    const proposal = {
      id: "prop-1",
      rollback_data: { yaml_definition: "original" },
    } as unknown as ImprovementProposal;
    await persistRollbackSnapshotOnce(
      repository as unknown as Repository<ImprovementProposal>,
      proposal,
      { yaml_definition: "post-mutation-state" },
    );
    expect(repository.update).not.toHaveBeenCalled();
    expect(proposal.rollback_data).toEqual({ yaml_definition: "original" });
  });
});
```

- [ ] Run: `npm run test --workspace=apps/api -- src/improvement/appliers/definition-change.helpers.spec.ts` — expect FAIL.
- [ ] Implement `apps/api/src/improvement/appliers/definition-change.helpers.ts`:

```ts
import type { Repository } from "typeorm";
import type { ImprovementProposal } from "../database/entities/improvement-proposal.entity";

/** Overrides-jsonb key marking a row as pinned by an applied improvement proposal. */
export const IMPROVEMENT_OVERRIDES_KEY = "improvement_proposal";

/**
 * Merge the proposal-provenance marker into a row's `overrides` jsonb. Both
 * reseed guards (`AgentProfileSeedService.shouldSkipReseed`,
 * `WorkflowSeedService.updateExistingWorkflowIfNeeded`) skip on ANY non-null
 * overrides value, so a non-null merged object is the entire protection.
 */
export function buildImprovementOverridesMarker(
  existing: Record<string, unknown> | null | undefined,
  proposalId: string,
  appliedAtIso: string,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    [IMPROVEMENT_OVERRIDES_KEY]: {
      proposal_id: proposalId,
      applied_at: appliedAtIso,
    },
  };
}

/**
 * Persist the pre-mutation snapshot exactly once. A retry after a mid-apply
 * failure must keep the FIRST snapshot (true pre-mutation state), never the
 * partially mutated state observed on the retry.
 */
export async function persistRollbackSnapshotOnce(
  repository: Repository<ImprovementProposal>,
  proposal: ImprovementProposal,
  snapshot: Record<string, unknown>,
): Promise<void> {
  if (proposal.rollback_data !== null && proposal.rollback_data !== undefined) {
    return;
  }
  await repository.update(proposal.id, { rollback_data: snapshot });
  proposal.rollback_data = snapshot;
}
```

- [ ] Run the spec again — expect PASS.
- [ ] Commit: `git add apps/api/src/improvement/appliers && git commit -m "feat(api): shared overrides-marker and snapshot-once helpers for definition-change appliers"`

---

## Task 3: AgentProfileChangeApplier

**Files:**

- `apps/api/src/ai-config/ai-config.module.ts` (exports array, lines 106–117: add `AiConfigAdminService`)
- `apps/api/src/improvement/appliers/agent-profile-change.applier.types.ts` (new)
- `apps/api/src/improvement/appliers/agent-profile-change.applier.helpers.ts` (new, pure)
- `apps/api/src/improvement/appliers/agent-profile-change.applier.helpers.spec.ts` (new)
- `apps/api/src/improvement/appliers/agent-profile-change.applier.ts` (new)
- `apps/api/src/improvement/appliers/agent-profile-change.applier.spec.ts` (new)
- Epic-A `ImprovementModule` file (add the applier to `providers` and to the `IMPROVEMENT_APPLIERS` multi-provider array; add `AiConfigModule` to `imports` — `DatabaseModule` already provides/exports `AgentProfileRepository`, see `apps/api/src/database/database.module.ts:159,334`)
- `apps/api/src/database/seeds/agent-profiles/agent-profile-seed.override-safe.spec.ts` (extend — reseed-after-apply proof)

**Interfaces:**

- Consumes: `IImprovementApplier`, `ImprovementApplyResult`, `ImprovementProposal`, `ImprovementProposalKind` (Epic A); `AgentProfileChangePayloadSchema`, `AgentProfilePatch`, `UpdateAgentProfileSchema`, `UpdateAgentProfileRequest` (`@nexus/core`); `AiConfigAdminService.updateAgentProfile(id: string, data: UpdateAgentProfileRequest, actorId?: string)` (`apps/api/src/ai-config/ai-config-admin.service.ts:236`); `AgentSkillsService.addProfileSkills(profileId, skillIds)` / `removeProfileSkills(profileId, skillIds)` (`apps/api/src/ai-config/services/agent-skills.service.ts:169,203`); `AgentProfileRepository.findByName(name)` / `update(id, data)` (`apps/api/src/ai-config/database/repositories/agent-profile.repository.ts:14,82`); Task-2 helpers.
- Produces:
  - `AgentProfileRollbackSnapshot` (in `.types.ts`): `{ profileId: string; profileName: string; system_prompt: string | null; model_name: string | null; provider_name: string | null; thinking_level: string | null; tool_policy: ToolPolicyDocument | null; assigned_skills: string[] | null; overrides: Record<string, unknown> | null }`
  - Pure helpers (in `.helpers.ts`): `buildProfileRollbackSnapshot(profile: AgentProfile): AgentProfileRollbackSnapshot`; `buildProfileUpdateRequest(profile: AgentProfile, patch: AgentProfilePatch): UpdateAgentProfileRequest` (append mode = `existing + '\n\n' + value`); `splitRollbackRestore(snapshot): { serviceFields: UpdateAgentProfileRequest; rawFields: Partial<AgentProfile> }` (serviceFields = the values `UpdateAgentProfileSchema` can express — `system_prompt`, `tool_policy`, `thinking_level`, non-null `model_name`/`provider_name` — so the restore reuses the human-edit path incl. IAM policy refresh; rawFields = null model/provider restores + `assigned_skills` + `overrides`); `parseProfileRollbackSnapshot(rollbackData: unknown): AgentProfileRollbackSnapshot` (throws on absent/malformed — rollback without a snapshot is a hard error)
  - `AgentProfileChangeApplier implements IImprovementApplier` with `readonly kind: ImprovementProposalKind = 'agent_profile_change'`, `apply(proposal): Promise<ImprovementApplyResult>`, `rollback(proposal): Promise<void>`.

**Apply algorithm (order is load-bearing):** parse payload (`safeParse`; invalid → `{ ok: false, detail }`) → `findByName` (missing/inactive → `{ ok: false, detail }`) → `persistRollbackSnapshotOnce` (snapshot BEFORE any mutation) → set overrides marker via `profileRepository.update(profile.id, { overrides: buildImprovementOverridesMarker(...) })` (marker BEFORE the field mutation so a crash mid-apply can never leave an applied-but-unpinned change for reseed to clobber — spec §7; a failed apply leaves a pinned-but-unchanged profile, cleared by rollback) → `UpdateAgentProfileSchema.parse(buildProfileUpdateRequest(...))` (same validation semantics as the controller's `ZodBody`) → `aiConfigAdmin.updateAgentProfile(profile.id, request)` when the request is non-empty → `agentSkills.addProfileSkills` / `removeProfileSkills` for `patch.assigned_skills` → `{ ok: true, detail: payload.changeSummary }`. Unexpected errors are caught and returned as `{ ok: false, detail }` (Epic A records the failure in `provenance` and sets `status='failed'`).

**Rollback algorithm:** `parseProfileRollbackSnapshot(proposal.rollback_data)` → `aiConfigAdmin.updateAgentProfile(snapshot.profileId, serviceFields)` → `profileRepository.update(snapshot.profileId, rawFields)` (restores `assigned_skills`, null model/provider, and `overrides` — which clears the marker and re-enables reseed).

**Steps:**

- [ ] Write the failing helper spec `agent-profile-change.applier.helpers.spec.ts` covering: append vs replace prompt composition; snapshot captures all 7 fields + name/id; `splitRollbackRestore` routes `tool_policy`/`system_prompt`/`thinking_level` to serviceFields and `assigned_skills`/`overrides`/null-`model_name` to rawFields; `parseProfileRollbackSnapshot(null)` throws.
- [ ] Run: `npm run test --workspace=apps/api -- src/improvement/appliers/agent-profile-change.applier.helpers.spec.ts` — expect FAIL. Implement the pure helpers. Run again — expect PASS.
- [ ] Write the failing applier spec `agent-profile-change.applier.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { Repository } from "typeorm";
import { AgentProfileChangeApplier } from "./agent-profile-change.applier";
import type { AiConfigAdminService } from "../../ai-config/ai-config-admin.service";
import type { AgentSkillsService } from "../../ai-config/services/agent-skills.service";
import type { AgentProfileRepository } from "../../ai-config/database/repositories/agent-profile.repository";
import type { AgentProfile } from "../../ai-config/database/entities/agent-profile.entity";
import type { ImprovementProposal } from "../database/entities/improvement-proposal.entity";

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "profile-uuid-1",
    name: "implementation-agent",
    system_prompt: "Base prompt.",
    model_name: null,
    provider_name: null,
    thinking_level: null,
    tool_policy: { default: "deny", rules: [] },
    assigned_skills: ["testing-unit-patterns"],
    overrides: null,
    ...overrides,
  } as AgentProfile;
}

function makeProposal(
  overrides: Partial<ImprovementProposal> = {},
): ImprovementProposal {
  return {
    id: "proposal-uuid-1",
    kind: "agent_profile_change",
    status: "approved",
    payload: {
      profileName: "implementation-agent",
      patch: {
        system_prompt: { mode: "append", value: "Always run the linter." },
      },
      changeSummary: "Append lint reminder",
    },
    rollback_data: null,
    ...overrides,
  } as ImprovementProposal;
}

function buildApplier(profile: AgentProfile | null = makeProfile()) {
  const mocks = {
    aiConfigAdmin: { updateAgentProfile: vi.fn().mockResolvedValue(undefined) },
    agentSkills: {
      addProfileSkills: vi.fn().mockResolvedValue([]),
      removeProfileSkills: vi.fn().mockResolvedValue([]),
    },
    profileRepository: {
      findByName: vi.fn().mockResolvedValue(profile),
      update: vi.fn().mockResolvedValue(profile),
    },
    proposalRepository: { update: vi.fn().mockResolvedValue(undefined) },
  };
  const applier = new AgentProfileChangeApplier(
    mocks.aiConfigAdmin as unknown as AiConfigAdminService,
    mocks.agentSkills as unknown as AgentSkillsService,
    mocks.profileRepository as unknown as AgentProfileRepository,
    mocks.proposalRepository as unknown as Repository<ImprovementProposal>,
  );
  return { applier, mocks };
}

describe("AgentProfileChangeApplier.apply", () => {
  it("writes rollback_data BEFORE mutating the profile", async () => {
    const { applier, mocks } = buildApplier();
    await applier.apply(makeProposal());
    const snapshotOrder =
      mocks.proposalRepository.update.mock.invocationCallOrder[0];
    const mutateOrder =
      mocks.aiConfigAdmin.updateAgentProfile.mock.invocationCallOrder[0];
    expect(snapshotOrder).toBeLessThan(mutateOrder);
    expect(mocks.proposalRepository.update).toHaveBeenCalledWith(
      "proposal-uuid-1",
      {
        rollback_data: expect.objectContaining({
          system_prompt: "Base prompt.",
        }),
      },
    );
  });

  it("rollback_data survives a mutation failure (failure injection)", async () => {
    const { applier, mocks } = buildApplier();
    mocks.aiConfigAdmin.updateAgentProfile.mockRejectedValue(
      new Error("db down"),
    );
    const result = await applier.apply(makeProposal());
    expect(result.ok).toBe(false);
    expect(mocks.proposalRepository.update).toHaveBeenCalledWith(
      "proposal-uuid-1",
      expect.objectContaining({ rollback_data: expect.anything() }),
    );
  });

  it("does not re-snapshot on retry (idempotency)", async () => {
    const { applier, mocks } = buildApplier();
    const proposal = makeProposal({
      rollback_data: {
        profileId: "profile-uuid-1",
        system_prompt: "Original.",
      },
    });
    const result = await applier.apply(proposal);
    expect(result.ok).toBe(true);
    expect(mocks.proposalRepository.update).not.toHaveBeenCalled();
  });

  it("appends to the existing system prompt and pins overrides with provenance", async () => {
    const { applier, mocks } = buildApplier();
    await applier.apply(makeProposal());
    expect(mocks.aiConfigAdmin.updateAgentProfile).toHaveBeenCalledWith(
      "profile-uuid-1",
      expect.objectContaining({
        system_prompt: "Base prompt.\n\nAlways run the linter.",
      }),
    );
    expect(mocks.profileRepository.update).toHaveBeenCalledWith(
      "profile-uuid-1",
      {
        overrides: expect.objectContaining({
          improvement_proposal: expect.objectContaining({
            proposal_id: "proposal-uuid-1",
          }),
        }),
      },
    );
  });

  it("applies assigned_skills add/remove through AgentSkillsService", async () => {
    const { applier, mocks } = buildApplier();
    await applier.apply(
      makeProposal({
        payload: {
          profileName: "implementation-agent",
          patch: {
            assigned_skills: {
              add: ["workflow-yaml-authoring"],
              remove: ["testing-unit-patterns"],
            },
          },
          changeSummary: "Swap skills",
        },
      }),
    );
    expect(mocks.agentSkills.addProfileSkills).toHaveBeenCalledWith(
      "profile-uuid-1",
      ["workflow-yaml-authoring"],
    );
    expect(mocks.agentSkills.removeProfileSkills).toHaveBeenCalledWith(
      "profile-uuid-1",
      ["testing-unit-patterns"],
    );
  });

  it("returns ok:false without mutating when the profile does not exist", async () => {
    const { applier, mocks } = buildApplier(null);
    const result = await applier.apply(makeProposal());
    expect(result.ok).toBe(false);
    expect(mocks.aiConfigAdmin.updateAgentProfile).not.toHaveBeenCalled();
    expect(mocks.proposalRepository.update).not.toHaveBeenCalled();
  });
});

describe("AgentProfileChangeApplier.rollback", () => {
  it("restores the snapshot via the service path and clears the overrides marker", async () => {
    const { applier, mocks } = buildApplier();
    await applier.rollback(
      makeProposal({
        rollback_data: {
          profileId: "profile-uuid-1",
          profileName: "implementation-agent",
          system_prompt: "Base prompt.",
          model_name: null,
          provider_name: null,
          thinking_level: null,
          tool_policy: { default: "deny", rules: [] },
          assigned_skills: ["testing-unit-patterns"],
          overrides: null,
        },
      }),
    );
    expect(mocks.aiConfigAdmin.updateAgentProfile).toHaveBeenCalledWith(
      "profile-uuid-1",
      expect.objectContaining({ system_prompt: "Base prompt." }),
    );
    expect(mocks.profileRepository.update).toHaveBeenCalledWith(
      "profile-uuid-1",
      expect.objectContaining({
        overrides: null,
        assigned_skills: ["testing-unit-patterns"],
      }),
    );
  });

  it("throws when rollback_data is absent", async () => {
    const { applier } = buildApplier();
    await expect(
      applier.rollback(makeProposal({ rollback_data: null })),
    ).rejects.toThrow();
  });
});
```

- [ ] Run: `npm run test --workspace=apps/api -- src/improvement/appliers/agent-profile-change.applier.spec.ts` — expect FAIL (module not found).
- [ ] Implement `agent-profile-change.applier.ts` per the apply/rollback algorithms above (constructor injects `AiConfigAdminService`, `AgentSkillsService`, `AgentProfileRepository`, `@InjectRepository(ImprovementProposal) Repository<ImprovementProposal>`; all branching delegated to the pure helpers; file stays well under 500 lines).
- [ ] Run the applier spec — expect PASS.
- [ ] Wire DI: add `AiConfigAdminService` to the `exports` array of `apps/api/src/ai-config/ai-config.module.ts` (lines 106–117; it is already a provider); in the Epic-A `ImprovementModule` add `AiConfigModule` + `DatabaseModule` to `imports` (skip whichever is already there) and register `AgentProfileChangeApplier` in `providers` + the `IMPROVEMENT_APPLIERS` multi-provider array.
- [ ] Extend `apps/api/src/database/seeds/agent-profiles/agent-profile-seed.override-safe.spec.ts` with the reseed-after-apply proof, reusing that file's `buildService` factory (lines 12–40):

```ts
describe("improvement-proposal overrides marker (Epic D)", () => {
  it("skips reseed for a profile pinned by an applied improvement proposal", async () => {
    const pinnedProfile = {
      name: "test-agent",
      system_prompt: "Prompt changed by proposal",
      tier_preference: "heavy",
      source: "seeded",
      scope_node_id: null,
      locked: false,
      overrides: {
        improvement_proposal: {
          proposal_id: "proposal-uuid-1",
          applied_at: "2026-07-02T00:00:00.000Z",
        },
      },
      is_active: true,
      assigned_skills: [],
    };
    const save = vi.fn();
    const merge = vi.fn();
    const service = buildService({
      findOne: vi.fn().mockResolvedValue(pinnedProfile),
      save,
      merge,
    });
    await service.seed();
    expect(merge).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
```

- [ ] Run: `npm run test --workspace=apps/api -- src/database/seeds/agent-profiles/agent-profile-seed.override-safe.spec.ts` — expect PASS (guard already skips any non-null overrides; this is the pinned-shape characterization the spec §7 risk row demands).
- [ ] Run: `npm run build:api` — expect clean.
- [ ] Commit: `git add apps/api/src && git commit -m "feat(api): AgentProfileChangeApplier with snapshot-first rollback and reseed pinning"`

---

## Task 4: WorkflowDefinitionChangeApplier

**Files:**

- `apps/api/src/improvement/appliers/workflow-definition-change.applier.types.ts` (new)
- `apps/api/src/improvement/appliers/workflow-definition-change.applier.ts` (new)
- `apps/api/src/improvement/appliers/workflow-definition-change.applier.spec.ts` (new)
- Epic-A `ImprovementModule` file (add `WorkflowCoreModule` to `imports`; register the applier in `providers` + `IMPROVEMENT_APPLIERS`)
- `apps/api/src/database/seeds/workflow/workflows.seed.override-safe.spec.ts` (extend — reseed-after-apply proof, following that file's existing harness)

**Interfaces:**

- Consumes: `IImprovementApplier`, `ImprovementApplyResult`, `ImprovementProposal` (Epic A); `WorkflowDefinitionChangePayloadSchema` (`@nexus/core`, Task 1); `WORKFLOW_PERSISTENCE_SERVICE` + `IWorkflowPersistenceService.updateWorkflow(id: string, yamlDefinition: string, actorId?: string): Promise<IWorkflow | null>` (`apps/api/src/workflow/kernel/interfaces/workflow-kernel.ports.ts:112-116`; implementation `apps/api/src/workflow/workflow-persistence.service.ts:264-295` — runs `YAMLValidationService.validateAndThrow` → `WorkflowParserService.parseWorkflow` → `WorkflowValidationService.validateAndThrow` before writing); `WorkflowRepositoryAggregator` (`apps/api/src/workflow/workflow-repository-aggregator.service.ts` — `repos.workflows.findByIdentifier(identifier, { includeInactive: true })` at `workflow.repository.ts:44-84`, `repos.workflows.update(id, partial)` at `workflow.repository.ts:208-214`); `WorkflowParserService.parseWorkflow(yaml): IWorkflowDefinition` (`apps/api/src/workflow/workflow-parser.service.ts:36-45`); `WorkflowValidationService.validateWorkflow(def): Promise<{ valid: boolean; errors: string[] }>` (`apps/api/src/workflow/workflow-validation.service.ts:29-54`); `ConfigResolutionCache` (`apps/api/src/config-resolution/config-resolution-cache.service.ts`, injected `@Optional()` exactly like `WorkflowSeedService`); Task-2 helpers. All workflow collaborators are exported from `WorkflowCoreModule` (`apps/api/src/workflow/workflow-core.module.ts:131-167`).
- Produces:
  - `WorkflowRollbackSnapshot` (in `.types.ts`): `{ workflowId: string; name: string; yaml_definition: string; overrides: Record<string, unknown> | null }`
  - `WorkflowDefinitionChangeApplier implements IImprovementApplier` with `readonly kind: ImprovementProposalKind = 'workflow_definition_change'`, `apply`, `rollback`.

**Apply algorithm:** parse payload (`safeParse`) → resolve target `repos.workflows.findByIdentifier(payload.workflowId ?? payload.workflowName, { includeInactive: true })` (missing → `{ ok: false, detail }`) → **pre-validate before any write**: `parser.parseWorkflow(payload.proposedYaml)` (catch `BadRequestException` → `{ ok: false, detail }`) then `validator.validateWorkflow(definition)` (`!valid` → `{ ok: false, detail: errors.join(', ') }`) then guard `definition.name === workflow.name` (mismatch → `{ ok: false, detail }`; the update path persists the parsed name, so a renamed YAML would silently re-identify the row) → `persistRollbackSnapshotOnce` with `{ workflowId, name, yaml_definition, overrides }` → pin `repos.workflows.update(workflow.id, { overrides: buildImprovementOverridesMarker(workflow.overrides, proposal.id, nowIso) })` → `workflowPersistence.updateWorkflow(workflow.id, payload.proposedYaml)` (re-runs all three validation layers including the security scan, plus the GitOps edit policy — a policy denial surfaces as a failed apply) → `configResolutionCache?.invalidate('workflow', workflow.name)` → `{ ok: true, detail }`.

**Rollback algorithm:** parse snapshot from `rollback_data` (absent → throw) → `repos.workflows.update(snapshot.workflowId, { yaml_definition: snapshot.yaml_definition, overrides: snapshot.overrides })` (raw restore, deliberately NOT via `updateWorkflow`: the snapshot was valid when captured and rollback must not be blocked by later tool-registry/validator drift) → `configResolutionCache?.invalidate('workflow', snapshot.name)`.

**Steps:**

- [ ] Write the failing spec `workflow-definition-change.applier.spec.ts` with a `buildApplier()` factory mocking `{ workflowPersistence: { updateWorkflow }, repos: { workflows: { findByIdentifier, update } }, parser: { parseWorkflow }, validator: { validateWorkflow }, proposalRepository: { update }, configResolutionCache: { invalidate } }` (direct `new`, same conventions as Task 3). Cover:
  - invalid proposedYaml (parser throws) → `{ ok: false }` and **no** `proposalRepository.update`, **no** `repos.workflows.update` (validation strictly before snapshot/mutation);
  - semantic validation failure (`validateWorkflow` → `{ valid: false, errors: ['job implement: unknown tool x'] }`) → `{ ok: false }` carrying the error text;
  - name-mismatch guard;
  - happy path: snapshot written first (`invocationCallOrder` vs `updateWorkflow`), overrides pinned with `improvement_proposal.proposal_id`, `updateWorkflow` called with `(workflow.id, proposedYaml)`, cache invalidated;
  - failure injection: `updateWorkflow` rejects → `{ ok: false }` but rollback_data already persisted;
  - retry idempotency: pre-existing `rollback_data` is not overwritten;
  - rollback restores `yaml_definition` + `overrides` via `repos.workflows.update` and invalidates the cache; rollback with null `rollback_data` throws.
- [ ] Run: `npm run test --workspace=apps/api -- src/improvement/appliers/workflow-definition-change.applier.spec.ts` — expect FAIL.
- [ ] Implement the applier per the algorithms (constructor: `@Inject(WORKFLOW_PERSISTENCE_SERVICE) workflowPersistence: IWorkflowPersistenceService`, `repos: WorkflowRepositoryAggregator`, `parser: WorkflowParserService`, `validator: WorkflowValidationService`, `@InjectRepository(ImprovementProposal) proposals: Repository<ImprovementProposal>`, `@Optional() configResolutionCache?: ConfigResolutionCache`).
- [ ] Run the spec — expect PASS.
- [ ] Wire DI: `ImprovementModule` imports `WorkflowCoreModule`; register the applier in `providers` + `IMPROVEMENT_APPLIERS`.
- [ ] Extend `apps/api/src/database/seeds/workflow/workflows.seed.override-safe.spec.ts` (reuse its existing factory/fixtures) with: an existing workflow row whose `overrides = { improvement_proposal: { proposal_id: 'proposal-uuid-1', applied_at: '2026-07-02T00:00:00.000Z' } }` and a drifted `yaml_definition` → assert the seed pass performs **no** save and the row keeps the applied YAML (guard at `workflows.seed.ts:216-224` skips any non-null overrides).
- [ ] Run: `npm run test --workspace=apps/api -- src/database/seeds/workflow/workflows.seed.override-safe.spec.ts` — expect PASS.
- [ ] Run: `npm run build:api` — expect clean.
- [ ] Commit: `git add apps/api/src && git commit -m "feat(api): WorkflowDefinitionChangeApplier with pre-validation, snapshot-first rollback and reseed pinning"`

---

## Task 5: Governance posture for the definition-change kinds (tests)

**Files:**

- `apps/api/src/improvement/governance/definition-change-governance.spec.ts` (new; colocate next to the Epic-A `ImprovementGovernancePolicyService` — if Epic A placed the service in a different subdirectory, colocate there)

**Interfaces:**

- Consumes: `ImprovementGovernancePolicyService.resolveAction({ kind, evidenceClass, confidence }): Promise<GovernanceAction>` (Epic A; `GovernanceAction = 'auto_apply' | 'propose' | 'drop'`), `SystemSettingsService`-style settings mock echoing per-key values for `improvement_governance_mode` / `improvement_governance_overrides` (settings keys per spec §4.1; verify the exact constant names in the Epic-A settings constants file and import them — do not restring).
- Produces: table-driven regression coverage only; no production code (Epic A's tiered defaults already classify both kinds as `propose` — these tests pin that contract for Epic D's kinds).

**Steps:**

- [ ] Write the spec with a `buildPolicy(mode: 'tiered' | 'manual' | 'autonomous')` factory (direct `new` on the Epic-A service with its collaborators mocked; settings mock: `get: vi.fn(async (key, def) => (key === <modeKey> ? mode : def))` — adjust the constructor call to the Epic-A signature; the ASSERTION TABLE below is the binding part):

```ts
const CASES: Array<{
  mode: "tiered" | "manual" | "autonomous";
  kind: "agent_profile_change" | "workflow_definition_change";
  evidenceClass: "struggle_backed" | "inference";
  confidence: number;
  expected: "auto_apply" | "propose";
}> = [
  // tiered: definition changes ALWAYS propose, even at the struggle cap
  {
    mode: "tiered",
    kind: "agent_profile_change",
    evidenceClass: "struggle_backed",
    confidence: 0.7,
    expected: "propose",
  },
  {
    mode: "tiered",
    kind: "workflow_definition_change",
    evidenceClass: "struggle_backed",
    confidence: 0.7,
    expected: "propose",
  },
  {
    mode: "tiered",
    kind: "agent_profile_change",
    evidenceClass: "inference",
    confidence: 0.45,
    expected: "propose",
  },
  {
    mode: "tiered",
    kind: "workflow_definition_change",
    evidenceClass: "inference",
    confidence: 0.45,
    expected: "propose",
  },
  // manual: everything above the drop floor proposes
  {
    mode: "manual",
    kind: "agent_profile_change",
    evidenceClass: "struggle_backed",
    confidence: 0.7,
    expected: "propose",
  },
  {
    mode: "manual",
    kind: "workflow_definition_change",
    evidenceClass: "struggle_backed",
    confidence: 0.7,
    expected: "propose",
  },
  // autonomous: auto-apply reachable ONLY by struggle-backed evidence at/above the 0.5 floor
  {
    mode: "autonomous",
    kind: "agent_profile_change",
    evidenceClass: "struggle_backed",
    confidence: 0.7,
    expected: "auto_apply",
  },
  {
    mode: "autonomous",
    kind: "workflow_definition_change",
    evidenceClass: "struggle_backed",
    confidence: 0.5,
    expected: "auto_apply",
  },
  {
    mode: "autonomous",
    kind: "agent_profile_change",
    evidenceClass: "struggle_backed",
    confidence: 0.45,
    expected: "propose",
  },
  // autonomous + inference: the 0.45 inference cap keeps speculation below the floor
  {
    mode: "autonomous",
    kind: "agent_profile_change",
    evidenceClass: "inference",
    confidence: 0.45,
    expected: "propose",
  },
  {
    mode: "autonomous",
    kind: "workflow_definition_change",
    evidenceClass: "inference",
    confidence: 0.45,
    expected: "propose",
  },
];

it.each(CASES)(
  "$mode/$kind/$evidenceClass@$confidence → $expected",
  async (row) => {
    const policy = buildPolicy(row.mode);
    await expect(
      policy.resolveAction({
        kind: row.kind,
        evidenceClass: row.evidenceClass,
        confidence: row.confidence,
      }),
    ).resolves.toBe(row.expected);
  },
);
```

- [ ] Run: `npm run test --workspace=apps/api -- src/improvement/governance/definition-change-governance.spec.ts` — expect FAIL (file new) then PASS once the factory matches the Epic-A constructor. If any case fails against Epic-A behavior, the Epic-A policy is wrong per spec §4.1/§4.4 — fix the policy (not the test) and note it in the commit body.
- [ ] Commit: `git add apps/api/src/improvement && git commit -m "test(api): pin governance posture for definition-change proposal kinds"`

---

## Task 6: Rollback round-trip through the Epic-A service

**Files:**

- `apps/api/src/improvement/definition-change-rollback.roundtrip.spec.ts` (new; beside the Epic-A `ImprovementProposalService`)

**Interfaces:**

- Consumes: `ImprovementProposalService.rollback(id)` (Epic A — backs `POST /improvement-proposals/:id/rollback`; sets `status='rolled_back'`, stamps `rolled_back_at`, emits the ledger entry), the two Task-3/Task-4 appliers (real instances with mocked collaborators), `IMPROVEMENT_APPLIERS` registry shape.
- Produces: round-trip regression coverage; no production code (unless the Epic-A service fails to invoke `applier.rollback` for these kinds — then fix the service).

**Steps:**

- [ ] Write the failing spec: construct `ImprovementProposalService` directly (Epic-A constructor, mocked repository returning an `applied` `agent_profile_change` proposal with a valid `rollback_data` snapshot from Task 3's fixture) with the appliers array containing the REAL `AgentProfileChangeApplier` (its own deps mocked as in Task 3). Assert:
  - `await service.rollback('proposal-uuid-1')` → the applier's profile-restore calls happen (`updateAgentProfile` + `profileRepository.update` with `overrides: null`);
  - the proposal repository receives `status: 'rolled_back'` and a non-null `rolled_back_at`;
  - repeat the same shape for a `workflow_definition_change` proposal (real Task-4 applier, `repos.workflows.update` restore assertion).
- [ ] Run: `npm run test --workspace=apps/api -- src/improvement/definition-change-rollback.roundtrip.spec.ts` — expect FAIL, then PASS after aligning the factory with the Epic-A constructor (and fixing the Epic-A service only if it does not dispatch `rollback` to the registered applier).
- [ ] Commit: `git add apps/api/src/improvement && git commit -m "test(api): rollback round-trip for definition-change proposals via ImprovementProposalService"`

---

## Task 7: Retrospective finding schema + router route-result seam

**Files:**

- `packages/core/src/retrospectives/retrospective-finding.schema.ts` (lines 38, 57: extend `RETROSPECTIVE_FINDING_KINDS`; add payload fields + cross-field refinement)
- `packages/core/src/retrospectives/retrospective-finding.types.ts` (inferred types pick the changes up automatically; verify)
- `packages/core/test/retrospectives/retrospective-finding.schema.spec.ts` (extend if present; else create)
- `apps/api/src/workflow/workflow-retrospective/retrospective-router.types.ts` (lines 24–39: add `RetrospectiveRouteResult`; change `RetrospectiveRouterPort.route` return type)
- `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.ts` (lines 119–157: `route`/`dispatchByKind` return `RetrospectiveRouteResult`)
- `apps/api/src/workflow/workflow-retrospective/retrospective-analysis.service.ts` (lines 324–370: `routeFindings` consumes the result; `dropped` → `emitRejectedFinding`)
- `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.spec.ts`, `retrospective-analysis.service.spec.ts` (update)

**Interfaces:**

- Consumes: `AgentProfileChangePayloadSchema`, `WorkflowDefinitionChangePayloadSchema` (Task 1).
- Produces:
  - `RETROSPECTIVE_FINDING_KINDS = ["memory", "skill_proposal", "agent_profile_change", "workflow_definition_change", "none"] as const`
  - `retrospectiveFindingSchema` gains `profile_change: AgentProfileChangePayloadSchema.optional()` and `workflow_change: WorkflowDefinitionChangePayloadSchema.optional()` plus a `superRefine` requiring `profile_change` when `kind === 'agent_profile_change'` and `workflow_change` when `kind === 'workflow_definition_change'` (schema-invalid findings keep dying at `parseFindingsWithOutcomes`, `retrospective-findings.helpers.ts:88`, with `rejected_schema` ledger notes — no new rejection plumbing needed for malformed payloads)
  - `export type RetrospectiveRouteResult = { outcome: 'routed' } | { outcome: 'dropped'; reasonCode: string; detail?: string }` (in `retrospective-router.types.ts`)
  - `RetrospectiveRouterPort.route(input): Promise<RetrospectiveRouteResult>`

**Steps:**

- [ ] Write failing core schema tests: `agent_profile_change` finding without `profile_change` → rejected; with a valid `profile_change` payload (+ required `lesson`, `confidence_self`, `evidence_event_ids`) → accepted; same pair for `workflow_definition_change`/`workflow_change`. Run: `npm run test --workspace=packages/core` — expect FAIL. Implement the schema changes. Run — expect PASS. Then `npm run build --workspace=packages/core`.
- [ ] Update `retrospective-router.types.ts` with `RetrospectiveRouteResult` and the new `route` signature.
- [ ] Adapt `retrospective-output-router.service.ts` (behavior-preserving for existing kinds):
  - `route(...)`: `kind === 'none'` → `return { outcome: 'routed' }` (defensive no-op, upstream already drops); success path → `return this.dispatchByKind(ctx)`; the existing catch (line 141) now returns `{ outcome: 'dropped', reasonCode: 'router_error', detail: message }` instead of swallowing silently.
  - `dispatchByKind` returns `Promise<RetrospectiveRouteResult>`; `routeMemory`/`routeSkillProposal` branches end with `return { outcome: 'routed' }`; the default arm returns `{ outcome: 'dropped', reasonCode: 'kind_unroutable' }`.
- [ ] Adapt `retrospective-analysis.service.ts` `routeFindings` (line 352-368): replace the bare `await this.router.route(...)` with

```ts
const result = await this.router.route({ finding, scopeId, originalRunId });
if (result.outcome === "routed") {
  await this.emitRoutedFinding(originalRunId, scopeId, routed, finding);
  routed += 1;
} else {
  await this.emitRejectedFinding(originalRunId, scopeId, {
    findingIndex: routed,
    terminalOutcome: "routing_dropped",
    reasonCode: result.reasonCode,
    lessonSnippet: snippet(finding.lesson),
    outcome: "failure",
    errorMessage: result.detail,
  });
}
```

(the surrounding `try/catch` with `reasonCode: 'router_error'` stays as the last-resort guard).

- [ ] Update the two existing specs: router spec assertions gain `.resolves.toEqual({ outcome: 'routed' })` on the memory/skill paths and a new test `route error → { outcome: 'dropped', reasonCode: 'router_error' }`; analysis spec gains `dropped result → RETROSPECTIVE_FINDING_REJECTED emitted with reason_code, routed count not incremented`.
- [ ] Run: `npm run test --workspace=apps/api -- src/workflow/workflow-retrospective/retrospective-output-router.service.spec.ts src/workflow/workflow-retrospective/retrospective-analysis.service.spec.ts` — expect PASS.
- [ ] Commit: `git add packages/core apps/api/src/workflow/workflow-retrospective && git commit -m "feat(core,api): definition-change finding kinds and honest route-result seam for the retrospective router"`

---

## Task 8: Router branches → ImprovementProposalService.submitProposal

**Files:**

- `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.definition-changes.helpers.ts` (new, pure — keeps the router under the 500-line cap)
- `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.definition-changes.helpers.spec.ts` (new)
- `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.ts` (constructor lines 107–112 + `dispatchByKind` lines 146–157: two new branches)
- `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.spec.ts` (extend)
- `apps/api/src/workflow/workflow-retrospective/workflow-retrospective.module.ts` (lines 51–64: add the Epic-A `ImprovementModule` to `imports`)

**Interfaces:**

- Consumes: `ImprovementProposalService.submitProposal(draft)` (Epic A — governance resolution, dedup/occurrence bumping, and status assignment are ITS job, not the router's); `ImprovementEvidenceClass` (Epic A, values `'struggle_backed' | 'inference'`); `AgentProfileRepository.findByName` (provided AND exported by `DatabaseModule`, already imported by this module — `database.module.ts:159,334`); `WorkflowRepository.findByIdentifier` (same, `database.module.ts:130,306`); `deriveRetrospectiveConfidence` + `ConfidenceCaps` (existing, `retrospective-output-router.service.ts:267-274`).
- Produces (helpers file):
  - `buildDefinitionChangeEvidence(finding: RetrospectiveFinding, originalRunId: string, struggleBacked: boolean): { evidence_class: ImprovementEvidenceClass; run_ids: string[]; event_ledger_ids: string[] }`
  - `buildDefinitionChangeProvenance(originalRunId: string): { source: 'retrospective_analyst'; original_run_id: string }`
  - (Verify both key sets against the Epic-A draft/`evidence`/`provenance` typing once during Epic-A file-name resolution; the class/run/event-ids CONTENT is fixed by spec §4.1's evidence column contract.)
- Produces (router): private `routeAgentProfileChange(ctx: RouteContext): Promise<RetrospectiveRouteResult>` and `routeWorkflowDefinitionChange(ctx: RouteContext): Promise<RetrospectiveRouteResult>`; constructor gains `agentProfiles: AgentProfileRepository`, `workflows: WorkflowRepository`, `improvementProposals: ImprovementProposalService`.

**Branch behavior (both kinds):**

1. Payload presence + `safeParse` re-check (`ctx.finding.profile_change` / `ctx.finding.workflow_change`) — invalid/absent → `{ outcome: 'dropped', reasonCode: 'payload_invalid', detail }` (defensive; schema parse upstream normally catches this).
2. Target existence: `agentProfiles.findByName(payload.profileName)` / `workflows.findByIdentifier(payload.workflowId ?? payload.workflowName, { includeInactive: true })` — null → `{ outcome: 'dropped', reasonCode: 'target_not_found', detail: '<kind> target "<name>" does not exist' }`. Via Task 7's seam this surfaces as a `RETROSPECTIVE_FINDING_REJECTED` ledger entry — the spec's "invalid → drop with ledger note".
3. Submit: `await this.improvementProposals.submitProposal({ kind: 'agent_profile_change' | 'workflow_definition_change', payload, confidence: ctx.confidence, evidence: buildDefinitionChangeEvidence(ctx.finding, ctx.originalRunId, ctx.struggleBacked), provenance: buildDefinitionChangeProvenance(ctx.originalRunId) })` → `{ outcome: 'routed' }`. `ctx.confidence` is already the router-derived cap (`deriveRetrospectiveConfidence`: struggle-backed ≤ 0.7, inference ≤ 0.45 — `retrospective-router.settings.constants.ts:23-37`); `finding.confidence_self` stays ignored.

**Steps:**

- [ ] Write the failing helper spec (evidence class flips on `struggleBacked`; `run_ids === [originalRunId]`; `event_ledger_ids` mirrors `finding.evidence_event_ids`). Run `npm run test --workspace=apps/api -- src/workflow/workflow-retrospective/retrospective-output-router.definition-changes.helpers.spec.ts` — FAIL → implement → PASS.
- [ ] Extend the router spec (reuse its `buildRouter()`/`memoryFinding()` factories at lines 38/57 — add the three new constructor mocks `agentProfiles: { findByName }`, `workflows: { findByIdentifier }`, `improvementProposals: { submitProposal }` and a `profileChangeFinding()`/`workflowChangeFinding()` fixture pair):

```ts
it("routes agent_profile_change into submitProposal with struggle-capped confidence", async () => {
  const { router, mocks } = buildRouter();
  mocks.struggleDetector.detect.mockResolvedValue([span()]);
  mocks.agentProfiles.findByName.mockResolvedValue({
    id: "p1",
    name: "implementation-agent",
  });
  await expect(
    router.route({
      finding: profileChangeFinding(),
      scopeId: "scope-1",
      originalRunId: "run-1",
    }),
  ).resolves.toEqual({ outcome: "routed" });
  expect(mocks.improvementProposals.submitProposal).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "agent_profile_change",
      confidence: STRUGGLE_CAP,
      evidence: expect.objectContaining({ evidence_class: "struggle_backed" }),
    }),
  );
});

it("drops workflow_definition_change for a nonexistent workflow with a reason code", async () => {
  const { router, mocks } = buildRouter();
  mocks.workflows.findByIdentifier.mockResolvedValue(null);
  await expect(
    router.route({
      finding: workflowChangeFinding(),
      scopeId: null,
      originalRunId: "run-1",
    }),
  ).resolves.toEqual(
    expect.objectContaining({
      outcome: "dropped",
      reasonCode: "target_not_found",
    }),
  );
  expect(mocks.improvementProposals.submitProposal).not.toHaveBeenCalled();
});

it("caps inference-only definition changes at the inference cap", async () => {
  const { router, mocks } = buildRouter();
  mocks.struggleDetector.detect.mockResolvedValue([]);
  mocks.agentProfiles.findByName.mockResolvedValue({
    id: "p1",
    name: "implementation-agent",
  });
  await router.route({
    finding: profileChangeFinding(),
    scopeId: null,
    originalRunId: "run-1",
  });
  expect(mocks.improvementProposals.submitProposal).toHaveBeenCalledWith(
    expect.objectContaining({
      confidence: INFERENCE_CAP,
      evidence: expect.objectContaining({ evidence_class: "inference" }),
    }),
  );
});
```

- [ ] Run: `npm run test --workspace=apps/api -- src/workflow/workflow-retrospective/retrospective-output-router.service.spec.ts` — expect FAIL → implement the two branches + constructor deps + `dispatchByKind` cases → PASS.
- [ ] Module wiring: add the Epic-A `ImprovementModule` to `workflow-retrospective.module.ts` `imports` (use `forwardRef` only if a real cycle appears — `ImprovementModule` must NOT import `WorkflowRetrospectiveModule`, so none is expected).
- [ ] Run: `npm run build:api` — expect clean (catches DI/type wiring).
- [ ] Commit: `git add apps/api/src/workflow/workflow-retrospective && git commit -m "feat(api): route analyst definition-change findings into improvement proposals with target validation"`

---

## Task 9: Analyst inputs + prompt extension + seed validation

**Files:**

- `apps/api/src/workflow/workflow-retrospective/retrospective-analysis.service.ts` (lines 119–151 `analyze`, constructor lines 90–108: thread the original run's workflow YAML into the launch)
- `apps/api/src/workflow/workflow-retrospective/retrospective-analysis.service.spec.ts` (extend)
- `seed/workflows/run-retrospective.workflow.yaml` (trigger inputs lines 11–23; job inputs lines 52–56)
- `seed/workflows/prompts/run-retrospective/analyze.md` (kind list lines 20–26, JSON shape block lines 30–41, hard rules)
- `apps/api/src/database/seeds/workflow/run-retrospective.seed.contract.spec.ts` (extend)

**Interfaces:**

- Consumes: `WorkflowRunRepository.findById(runId)` and `WorkflowRepository.findById(id)` (both provided/exported by `DatabaseModule`, already imported by the module; run entity carries `workflow_id` at `apps/api/src/workflow/database/entities/workflow-run.entity.ts:19`).
- Produces: launch input `workflow_yaml` (optional string) on the `run_retrospective` start payload; matching trigger input + `{{ trigger.workflow_yaml }}` job input; prompt sections for the two new kinds.

**Rationale:** `workflow_definition_change` demands the FULL proposed `yaml_definition` (spec §4.4). The analyst's only inputs today are the digest + read-only FS tools (`run-retrospective.workflow.yaml:25-42`) — the current YAML lives in the DB, so the orchestrator must hand it over at launch. Fail-soft: if the run/workflow lookup fails, `workflow_yaml` is omitted and the prompt tells the analyst it must NOT emit `workflow_definition_change` without it.

**Steps:**

- [ ] Extend `retrospective-analysis.service.spec.ts` (reuse its existing mock factory): failing test asserting `analyze(row)` for a workflow-run row calls `workflowEngine.startWorkflow('run_retrospective', expect.objectContaining({ workflow_yaml: 'workflow_id: original\n' }))` when the run/workflow lookups resolve, and `expect.not.objectContaining({ workflow_yaml: expect.anything() })`-style omission (assert the key is `undefined`) when the lookup throws. Run: `npm run test --workspace=apps/api -- src/workflow/workflow-retrospective/retrospective-analysis.service.spec.ts` — expect FAIL.
- [ ] Implement: inject `WorkflowRunRepository` + `WorkflowRepository`; private `resolveOriginalWorkflowYaml(workflowRunId: string): Promise<string | undefined>` (try `runs.findById` → `workflows.findById(run.workflow_id)` → `workflow.yaml_definition`; any error → `undefined` + warn); pass `workflow_yaml` in the `startWorkflow` input map (`retrospective-analysis.service.ts:130-136`; chat-session rows pass `undefined`). Run — expect PASS.
- [ ] `seed/workflows/run-retrospective.workflow.yaml`: add trigger input `{ name: workflow_yaml, type: string, required: false }` and job input `workflow_yaml: "{{ trigger.workflow_yaml }}"`.
- [ ] `seed/workflows/prompts/run-retrospective/analyze.md`: extend the "What counts as a finding" list (after the `skill_proposal` bullet, before `none`):

```markdown
- `kind: 'agent_profile_change'` — the evidence shows the AGENT PROFILE DEFINITION itself is wrong
  (missing tool grant that caused failed tool calls, wrong model or thinking tier for the work,
  a system-prompt gap that repeatedly misdirects the agent). Include a `profile_change` payload:
  `{"profileName": "<exact profile name from the digest>", "patch": {<only the fields to change:
system_prompt {mode: append|replace, value}, model_name, provider_name, thinking_level,
tool_policy, assigned_skills {add, remove}>}, "changeSummary": "<one sentence>"}`.
- `kind: 'workflow_definition_change'` — the evidence shows the WORKFLOW DEFINITION is structurally
  defective (unwinnable retry budget, missing output contract, wrong step ordering or inputs).
  Only emit this kind when the input includes `workflow_yaml`; produce the COMPLETE corrected YAML
  (never a fragment) in a `workflow_change` payload: `{"workflowName": "<name>", "proposedYaml":
"<the FULL corrected yaml_definition>", "changeSummary": [{"stepId": "<step>", "field": "<field>",
"from": "<old>", "to": "<new>", "rationale": "<why>"}]}`. Do not rename the workflow.
```

Update the JSON shape block to list the two kinds and the optional `profile_change` / `workflow_change` fields, and extend the hard rules: evidence-citation requirements apply to these kinds too; definition-change findings are re-checked and confidence-capped by the router; never propose targets not named in the digest.

- [ ] Extend `run-retrospective.seed.contract.spec.ts` with assertions that the seeded YAML declares the `workflow_yaml` trigger input and the prompt file mentions both new kinds (follow the file's existing read-and-assert pattern).
- [ ] Run: `npm run test --workspace=apps/api -- src/database/seeds/workflow/run-retrospective.seed.contract.spec.ts` — expect PASS.
- [ ] Run: `npm run validate:seed-data` — expect clean.
- [ ] Commit: `git add apps/api/src/workflow/workflow-retrospective seed/workflows && git commit -m "feat(api,seed): give the retrospective analyst workflow YAML context and definition-change output kinds"` (note in the commit body: live stacks need a reseed for the prompt/trigger change to take effect).

---

## Task 10: Web — client method + hooks for rollback and detail data

**Files:**

- Epic-A improvements client file in `apps/web/src/lib/api/` (extend; if Epic A named it e.g. `client.improvements.ts`, add there — method-object + `this: ApiClient` mixin pattern as in `apps/web/src/lib/api/client.projects.learning.ts`) and its `*.types.ts` interface
- Epic-A improvements hook file in `apps/web/src/hooks/` (extend, e.g. `useImprovementProposals.ts`)
- `apps/web/src/hooks/useImprovementProposalDetail.ts` (new)
- `apps/web/src/hooks/useImprovementProposalDetail.spec.ts` (new)

**Interfaces:**

- Consumes: `ApiClient.post/get` (`apps/web/src/lib/api/client.ts`), existing `api.getWorkflow(id)` (`apps/web/src/lib/api/client.workflow.ts:132`), Epic-A `ImprovementProposal` DTO type (kind/status/payload/rollback_data), `AgentProfileChangePayload` / `WorkflowDefinitionChangePayload` (`@nexus/core`, Task 1), TanStack Query, Epic-A improvements query key (reuse; do not invent a second one).
- Produces:
  - `rollbackImprovementProposal(this: ApiClient, id: string): Promise<ImprovementProposal>` → `this.post(\`/improvement-proposals/${id}/rollback\`)` (Epic-A endpoint; add only if Epic A did not already ship it)
  - `useRollbackImprovementProposal()` — `useMutation` wrapping the client method, invalidating the Epic-A improvements query key, toasting via the existing sonner `useToast` pattern
  - `useWorkflowYamlForDiff(proposal: ImprovementProposal): { originalYaml: string | undefined; isLoading: boolean }` — pure decision cascade: `rollback_data?.yaml_definition` when present (applied/rolled-back proposals diff against the true pre-apply snapshot) → else `useQuery(api.getWorkflow(payload.workflowId))` enabled only when `workflowId` is set → else `{ originalYaml: undefined }` (component falls back to plain YAML view)

**Steps:**

- [ ] Write the failing hook spec `useImprovementProposalDetail.spec.ts` (mock `@/lib/api/client` via `vi.mock`; `QueryClientProvider` wrapper; three cases: snapshot short-circuits without fetching; workflowId triggers `getWorkflow`; neither → undefined and no fetch).
- [ ] Run: `npm run test:unit --workspace=apps/web -- src/hooks/useImprovementProposalDetail.spec.ts` — expect FAIL.
- [ ] Implement the client method (+ types interface entry), `useRollbackImprovementProposal`, and `useWorkflowYamlForDiff`.
- [ ] Run the spec — expect PASS.
- [ ] Commit: `git add apps/web/src && git commit -m "feat(web): rollback mutation and yaml-diff source hooks for definition-change proposals"`

---

## Task 11: Web — per-kind detail components + rollback button

**Files:**

- `apps/web/src/pages/improvements/improvements-detail.helpers.ts` (new, pure: `formatProfilePatchEntries(payload: AgentProfileChangePayload, rollbackData: unknown): Array<{ field: string; from?: string; to: string }>` — stringifies each patch field; `from` filled from the rollback snapshot when present)
- `apps/web/src/pages/improvements/improvements-detail.helpers.spec.ts` (new)
- `apps/web/src/pages/improvements/AgentProfileChangeDetail.tsx` (new, presentation-only)
- `apps/web/src/pages/improvements/AgentProfileChangeDetail.spec.tsx` (new)
- `apps/web/src/pages/improvements/WorkflowDefinitionChangeDetail.tsx` (new, presentation-only)
- `apps/web/src/pages/improvements/WorkflowDefinitionChangeDetail.spec.tsx` (new)
- `apps/web/src/pages/improvements/ProposalRollbackButton.tsx` (new)
- Epic-A improvements queue page (wire the kind switch into its `renderExpanded`; the Epic-A skeleton follows the `DataTable` + `renderExpanded` pattern of `apps/web/src/pages/project-workspace/LearningTabProposalsCard.tsx`)

**Interfaces:**

- Consumes: `DiffEditor` from `@monaco-editor/react` (existing dep; same import family as `apps/web/src/components/workflow/YamlEditor.tsx`), `components/ui` primitives (`card`, `badge`, `table`, `alert-dialog`, `async-button`), Task-10 hooks, Task-1 payload types.
- Produces:
  - `AgentProfileChangeDetail({ proposal }: { proposal: ImprovementProposal })` — profile name, `changeSummary`, and a field-diff table from `formatProfilePatchEntries` (From column dimmed/absent for pending proposals, populated from `rollback_data` on applied ones)
  - `WorkflowDefinitionChangeDetail({ proposal })` — target workflow name/id, `changeSummary` table (`stepId | field | from | to | rationale`), then: `originalYaml` available → `<DiffEditor original={originalYaml} modified={payload.proposedYaml} language="yaml" options={{ readOnly: true, renderSideBySide: true }} />` inside an `overflow-x-auto` container; unavailable → `<pre className="whitespace-pre-wrap">` of `proposedYaml` with an explanatory note
  - `ProposalRollbackButton({ proposal })` — rendered ONLY when `proposal.status === 'applied'` and kind is `agent_profile_change` or `workflow_definition_change`; alert-dialog confirm → `useRollbackImprovementProposal().mutate(proposal.id)`
  - Kind switch in the queue page's expanded row: `agent_profile_change` → `AgentProfileChangeDetail`, `workflow_definition_change` → `WorkflowDefinitionChangeDetail`, all other kinds → the Epic-A default rendering (unchanged)

**Steps:**

- [ ] Write the failing pure-helper spec (append prompt patch → one entry `{ field: 'system_prompt (append)', to: 'Always run the linter.' }`; applied proposal fills `from` from the snapshot; skills add/remove render as separate entries). Run: `npm run test:unit --workspace=apps/web -- src/pages/improvements/improvements-detail.helpers.spec.ts` — FAIL → implement → PASS.
- [ ] Write the failing component specs (testing-library; `vi.mock("@monaco-editor/react", () => ({ DiffEditor: (props: { original: string; modified: string }) => <div data-testid="diff-editor" data-original={props.original} data-modified={props.modified} /> }))` — Monaco cannot mount in jsdom; `vi.mock` Task-10 hooks; `QueryClientProvider` + `MemoryRouter` wrappers; factory `makeProposal(overrides)`). Cover: field table rows for a profile patch; DiffEditor receives original/modified when the hook supplies `originalYaml`; `<pre>` fallback when it does not; rollback button visible only for applied definition-change proposals and firing the mutation on confirm.
- [ ] Run: `npm run test:unit --workspace=apps/web -- src/pages/improvements/AgentProfileChangeDetail.spec.tsx src/pages/improvements/WorkflowDefinitionChangeDetail.spec.tsx` — expect FAIL → implement the three components + the queue-page kind switch → PASS.
- [ ] Run: `npm run build:web` — expect clean.
- [ ] Commit: `git add apps/web/src && git commit -m "feat(web): per-kind detail rendering and rollback for definition-change proposals"`

---

## Task 12: Full verification, docs, and self-review

**Files:**

- `docs/guide/35-memory-learning.md` (retrospective analyst section: the two new finding kinds, router target-validation + drop-with-ledger-note, confidence rails feeding `submitProposal`)
- `docs/guide/12-ai-config.md` (agent profiles: proposal-applied changes, the `overrides.improvement_proposal` marker, snapshot-based rollback)
- `docs/guide/32-seed-data.md` (reseed semantics: applied definition changes pin rows via `overrides`; clearing the marker re-enables reseed; rollback clears it automatically)
- `docs/guide/26-web-overview.md` (improvements queue: per-kind detail rendering + rollback button)

**Steps:**

- [ ] Run the full builds: `npm run build --workspace=packages/core && npm run build:api && npm run build:web` — all clean.
- [ ] Run the full suites (sequentially, never two web suites at once): `npm run test --workspace=packages/core`, then `npm run test:api`, then `npm run test:unit:web` — 100% pass.
- [ ] Run: `npm run lint:summary` for repo-wide visibility, then `npm run lint` — zero new findings; `nexus-boundaries/no-core-kanban-residue` green; no suppressions anywhere in the diff.
- [ ] Run: `npm run validate:seed-data` — clean.
- [ ] Update the four docs/guide pages listed above.
- [ ] Self-review against spec §4.4: payload shapes match (field-level profile patch; full-YAML + structured change summary); appliers snapshot before writing; reseed protection via `overrides` marker verified by tests; rollback endpoint restores + `rolled_back` status; tiered=propose / autonomous=struggle-backed-only-≥0.5 pinned by tests; analyst prompt emits the kinds on definition-shaped evidence; probation watcher NOT built (schema-only, per §8). Grep the diff for leftover `TODO`/placeholder text.
- [ ] Commit: `git add docs/guide && git commit -m "docs: definition-change proposal pipeline (Epic D) across learning, ai-config, seed, and web guides"`

---

## Deployment note (post-merge, not part of this plan's execution)

The analyst prompt + trigger-input change lives in seed data: live stacks pick it up only after an image rebuild + reseed. The router/applier changes require a nexus-api rebuild + redeploy.
