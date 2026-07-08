# Skill/Learning Scope Model Follow-Ups (I1 + I2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two Important (non-blocking) follow-ups (I1, I2) flagged by the final whole-branch review of the skill/learning scope model feature (merged to main at `3f333260b`, pushed at `1985d5b25`):

- **I1** — the frontmatter (`skill_create`) scope-matching path and the binding-table (`skill_assignment`) scope-matching path implement inconsistent inheritance semantics for the same conceptual guarantee ("visible at this scope").
- **I2** — nothing validates that `provenance.scope_id` resolves to a real, live `scope_nodes` row before it is written into either a skill's frontmatter or an `agent_profile_skill_bindings` row.

**Design decisions already made (confirmed with the human partner before this plan was written):**

1. **I1 direction:** make the frontmatter path (`AgentSkillLibraryService.listSkillsForScope`) ancestor-inclusive for the `projects` axis, matching the binding path's already-reviewed cascading design (`AgentProfileSkillBindingService.listApplicableSkillNames`), rather than tightening the binding path to exact-match. `project` is a leaf scope-node type (`PARENT_CHILD_TYPE_MATRIX['project'] === []`, `apps/api/src/scope/scope-typing.ts`) and every run's `scopeId` is always a project, so this change is a no-op for every currently-functioning frontmatter scope (`scope.projects: [someProjectId]`) — it only starts correctly cascading a currently-inert case (an org/team/region id placed in `scope.projects`, which today can never match any real run's exact-match query). `agents`/`workflows` have no scope-tree concept and stay exact-match.
2. **I2 mode split:** the two fully-automatic/background paths (`SkillCreateCompletionListener.applyOriginScope`, `tryAutoApplyScope`'s auto-apply branch) fail soft — an unresolvable/archived `scope_id` is treated as absent (matches this feature's existing fail-soft discipline; `decideScopeApplication` already treats `originScopeId: null` as "never auto-apply, always stage", so no change to the pure decision function is needed). The human-driven `SkillScopeConfirmationService.confirm` path fails loud (throws), since a human is taking an explicit, permission-gated action and should see a clear rejection rather than a silent no-op. The binding-write path (`AgentProfileSkillBindingService.addProjectScopedBinding`/`addProfileScopedBinding`) throws from deep inside `ScopeService`-backed validation, which is already caught by `applySkillAssignments`'s existing per-target try/catch and surfaces as a `status: 'unrouted'` outcome — no new plumbing needed there.

**Architecture:** Add one new primitive, `ScopeService.isLiveScope(scopeId): Promise<boolean>` (exists + not archived), and thread it through the four call sites that currently trust an unvalidated `scope_id`/`scope.projects` entry. Make `AgentSkillLibraryService.listSkillsForScope`'s `projects` check ancestor-inclusive via the existing `ScopeService.getAncestorIds`, the same closure-table lookup the binding path and `AuthorizationService` already use.

**Tech Stack:** NestJS, TypeORM (Postgres), Vitest.

## Global Constraints

- No lint suppressions (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`) — see `.github/instructions/lint-warning-policy.instructions.md`.
- `apps/api/src` and `packages/core/src` must stay Kanban-neutral.
- Controllers handle transport only; services own domain logic; repositories own persistence (`.github/instructions/api-quality-gate.instructions.md`).
- Tests use Vitest with plain constructor injection and hand-rolled mocks (`vi.fn()`), not a NestJS `TestingModule`, for unit-level specs — follow the existing convention in every spec file this plan touches.
- `nest build` (not `tsc`) is required for the API — TypeORM decorator metadata depends on it.
- Run `npm run test --workspace=apps/api -- <path>` to target a single spec file while iterating.
- Do not change `decideScopeApplication`'s pure-function signature or behavior — I2's fail-soft handling is achieved entirely by what gets passed into it (a validated `originScopeId`, collapsing to `null` when invalid), not by changing the function itself.

---

### Task 1: Ancestor-inclusive `projects` matching in `AgentSkillLibraryService.listSkillsForScope` (I1)

**Files:**

- Modify: `apps/api/src/ai-config/services/agent-skill-library.service.ts`
- Modify: `apps/api/src/ai-config/services/agent-skill-library.service.spec.ts`
- Modify: `apps/api/src/ai-config/services/agent-skills.service.ts`
- Modify: `apps/api/src/workflow/workflow-stage-skill-policy.service.ts`
- Modify: `apps/api/src/workflow/workflow-stage-skill-policy.service.spec.ts`

**Interfaces:**

- Consumes: `ScopeService.getAncestorIds(nodeId: string): Promise<string[]>` (existing, `apps/api/src/scope/scope.service.ts`; already exported by `ScopeModule`, already imported by `AiConfigModule`, which both `AgentSkillLibraryService` and `AgentSkillsService` live in).
- Produces: `AgentSkillLibraryService.listSkillsForScope` and `AgentSkillsService.listSkillsForScope` become `async` (`Promise<SkillLibraryRecord[]>` instead of `SkillLibraryRecord[]`); the `projects` axis now matches against the full ancestor chain of the queried `scopeId`, not just an exact id match. `agents`/`workflows` matching is unchanged (exact match — no scope-tree concept applies to them).

- [ ] **Step 1: Read the current spec files**

Read `apps/api/src/ai-config/services/agent-skill-library.service.spec.ts` (in full — it constructs `AgentSkillLibraryService` directly, `new AgentSkillLibraryService(mockSkillIndex)`, and calls `listSkillsForScope` synchronously in 5 places around its `describe('listSkillsForScope', ...)` block) and `apps/api/src/workflow/workflow-stage-skill-policy.service.spec.ts` (its `listSkillsForScopeMock` is currently wired with `mockReturnValue`, not `mockResolvedValue`, in ~9 places) before editing, so every existing call site gets updated consistently rather than partially.

- [ ] **Step 2: Write the failing test**

In `agent-skill-library.service.spec.ts`, update the constructor call in the outer `beforeEach` to pass a mock `ScopeService`:

```typescript
const mockScopeService = {
  getAncestorIds: vi.fn(async (nodeId: string) => [nodeId]),
} as any;

// inside beforeEach:
service = new AgentSkillLibraryService(mockSkillIndex, mockScopeService);
```

Add `vi.clearAllMocks()` already covers `mockScopeService.getAncestorIds` since it is a fresh `vi.fn()` per module load; if the existing `beforeEach` recreates `service` each time (it does), leave `mockScopeService` at module scope like `mockSkillIndex`.

Add these two tests inside the existing `describe('listSkillsForScope', ...)` block (after the existing `'returns skills matching the project scopeId'` test):

```typescript
it("matches a project scope via an ancestor id (org-level scope.projects entry reaches a descendant query)", async () => {
  service.writeSkillMarkdown(
    "org-wide-skill",
    SCOPED("org-wide-skill", "scope:\n  projects: [org-root]\n"),
  );
  mockScopeService.getAncestorIds.mockImplementationOnce(async () => [
    "org-root",
    "scope-999",
  ]);

  const names = (
    await service.listSkillsForScope({ scopeId: "scope-999" })
  ).map((s) => s.name);

  expect(names).toEqual(["org-wide-skill"]);
  expect(mockScopeService.getAncestorIds).toHaveBeenCalledWith("scope-999");
});

it("does not call getAncestorIds when no scopeId is given", async () => {
  await service.listSkillsForScope({ agentProfile: "software-architect" });
  expect(mockScopeService.getAncestorIds).not.toHaveBeenCalled();
});
```

Update the 5 existing calls in the same `describe` block to `await` (they currently call `service.listSkillsForScope({...})` synchronously) and mark their `it` callbacks `async`.

In `workflow-stage-skill-policy.service.spec.ts`, change every `listSkillsForScopeMock.mockReturnValue(...)` to `listSkillsForScopeMock.mockResolvedValue(...)` (there are ~9 occurrences — read the file's own guidance from Step 1 to catch all of them).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace=apps/api -- agent-skill-library.service.spec.ts`
Expected: FAIL — `AgentSkillLibraryService` constructor does not accept a second argument yet; `listSkillsForScope` still returns a plain array, so `await`-ing it in the new/updated tests either passes trivially (masking the real behavior) or the new ancestor test fails because `getAncestorIds` is never called.

Run: `npm run test --workspace=apps/api -- workflow-stage-skill-policy.service.spec.ts`
Expected: FAIL — `mockResolvedValue` on a still-synchronous production method causes the tests that inspect the returned array shape to fail (the code path will treat the returned Promise as a plain value until Step 4 lands).

- [ ] **Step 4: Write the implementation**

In `apps/api/src/ai-config/services/agent-skill-library.service.ts`, add the import and constructor parameter:

```typescript
import { ScopeService } from "../../scope/scope.service";
```

```typescript
  constructor(
    private readonly skillIndex: SkillIndexService,
    private readonly scopeService: ScopeService,
  ) {
```

Replace `listSkillsForScope`:

```typescript
  async listSkillsForScope(
    context: SkillScopeContext,
  ): Promise<SkillLibraryRecord[]> {
    const { scopeId, agentProfile, workflowId } = context;
    if (
      scopeId === undefined &&
      agentProfile === undefined &&
      workflowId === undefined
    ) {
      return [];
    }

    const scopeAncestorIds =
      scopeId !== undefined
        ? new Set(await this.scopeService.getAncestorIds(scopeId))
        : null;

    return this.listSkills().filter((skill) => {
      const scope = skill.scope;
      if (!scope) {
        return false;
      }

      return (
        (scopeAncestorIds !== null &&
          scope.projects.some((projectId) => scopeAncestorIds.has(projectId))) ||
        (agentProfile !== undefined && scope.agents.includes(agentProfile)) ||
        (workflowId !== undefined && scope.workflows.includes(workflowId))
      );
    });
  }
```

In `apps/api/src/ai-config/services/agent-skills.service.ts`, change the thin wrapper to pass the promise through:

```typescript
  listSkillsForScope(context: SkillScopeContext): Promise<SkillLibraryRecord[]> {
    return this.skillLibrary.listSkillsForScope(context);
  }
```

In `apps/api/src/workflow/workflow-stage-skill-policy.service.ts`, update `resolveBaseSkillSet`:

```typescript
const scoped = await this.agentSkills.listSkillsForScope({
  scopeId,
  agentProfile,
  workflowId,
});
```

(remove the now-stale `// listSkillsForScope is synchronous (in-memory); no await needed` comment above it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- agent-skill-library.service.spec.ts`
Expected: PASS, all tests green.

Run: `npm run test --workspace=apps/api -- workflow-stage-skill-policy.service.spec.ts`
Expected: PASS, all tests green.

- [ ] **Step 6: Verify the API builds**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds. Check for any other production call site of `listSkillsForScope` that assumes synchronous return (this plan's research found exactly one production caller — `WorkflowStageSkillPolicyService.resolveBaseSkillSet` — but re-verify via `grep -rn "listSkillsForScope" apps/api/src --include=*.ts` excluding `*.spec.ts` before concluding no other site needs an `await` added).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/ai-config/services/agent-skill-library.service.ts \
  apps/api/src/ai-config/services/agent-skill-library.service.spec.ts \
  apps/api/src/ai-config/services/agent-skills.service.ts \
  apps/api/src/workflow/workflow-stage-skill-policy.service.ts \
  apps/api/src/workflow/workflow-stage-skill-policy.service.spec.ts
git commit -m "fix(ai-config): make frontmatter skill scope matching ancestor-inclusive"
```

---

### Task 2: `ScopeService.isLiveScope` + validate the binding-write path (I2, part A)

**Files:**

- Modify: `apps/api/src/scope/scope.service.ts`
- Modify: `apps/api/src/scope/scope.service.spec.ts`
- Modify: `apps/api/src/ai-config/services/agent-profile-skill-binding.service.ts`
- Modify: `apps/api/src/ai-config/services/agent-profile-skill-binding.service.spec.ts`

**Interfaces:**

- Produces: `ScopeService.isLiveScope(scopeId: string): Promise<boolean>` — true iff `scopeId` resolves to a `scope_nodes` row with `archivedAt` null. `AgentProfileSkillBindingService.addProjectScopedBinding`/`addProfileScopedBinding` now throw `NotFoundException` when `scopeNodeId` is not live, before any repository write. This propagates through the existing `applySkillAssignments` try/catch (`apps/api/src/improvement/appliers/skill-create.applier.ts`) as a `status: 'unrouted'` outcome for both of its callers (`SkillCreateCompletionListener.applyAssignmentTargets`, `SkillAssignmentApplier.apply`) — no changes needed in either of those two files for this task.

- [ ] **Step 1: Read the current files**

Read `apps/api/src/scope/scope.service.spec.ts` (to match its `new ScopeService(nodeRepo, dataSource)` mock-repo convention) and `apps/api/src/ai-config/services/agent-profile-skill-binding.service.spec.ts` (its `makeScope()` helper currently only stubs `getAncestorIds`) before editing.

- [ ] **Step 2: Write the failing tests**

In `scope.service.spec.ts`, add a new `describe` block:

```typescript
describe("ScopeService.isLiveScope", () => {
  it("returns true for a live (non-archived) scope node", async () => {
    const nodeRepo = {
      findOne: vi.fn(async () => ({ id: "scope-1", archivedAt: null })),
    };
    const service = new ScopeService(nodeRepo as any, {} as any);

    await expect(service.isLiveScope("scope-1")).resolves.toBe(true);
    expect(nodeRepo.findOne).toHaveBeenCalledWith({
      where: { id: "scope-1", archivedAt: expect.anything() },
    });
  });

  it("returns false when the scope node does not exist", async () => {
    const nodeRepo = { findOne: vi.fn(async () => null) };
    const service = new ScopeService(nodeRepo as any, {} as any);

    await expect(service.isLiveScope("missing-scope")).resolves.toBe(false);
  });
});
```

(Adjust the `IsNull()` matcher expectation if the real TypeORM `IsNull()` operator does not compare equal via `expect.anything()` in this codebase's existing tests — check how `scope.service.spec.ts`'s other `IsNull()`-using tests, if any, assert on the `where` clause, and mirror that convention instead.)

In `agent-profile-skill-binding.service.spec.ts`, update `makeScope()`:

```typescript
function makeScope() {
  return {
    getAncestorIds: vi.fn(async (nodeId: string) => [nodeId, "org-root"]),
    isLiveScope: vi.fn(async () => true),
  };
}
```

Add two new tests:

```typescript
describe("AgentProfileSkillBindingService — scope validation", () => {
  it("addProjectScopedBinding throws when the scope node is not live", async () => {
    const repo = makeRepo();
    const scope = makeScope();
    scope.isLiveScope.mockResolvedValue(false);
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      scope as any,
    );

    await expect(
      service.addProjectScopedBinding({
        skillName: "incident-response",
        scopeNodeId: "archived-scope",
      }),
    ).rejects.toThrow("archived-scope");
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it("addProfileScopedBinding throws when the scope node is not live", async () => {
    const repo = makeRepo();
    const scope = makeScope();
    scope.isLiveScope.mockResolvedValue(false);
    const service = new AgentProfileSkillBindingService(
      repo as any,
      makeProfiles() as any,
      scope as any,
    );

    await expect(
      service.addProfileScopedBinding({
        skillName: "incident-response",
        scopeNodeId: "archived-scope",
        profileName: "backend-engineer",
      }),
    ).rejects.toThrow("archived-scope");
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test --workspace=apps/api -- scope.service.spec.ts`
Expected: FAIL — `ScopeService.isLiveScope` does not exist.

Run: `npm run test --workspace=apps/api -- agent-profile-skill-binding.service.spec.ts`
Expected: FAIL — `scope.isLiveScope` is never called; both bindings still upsert against an archived scope.

- [ ] **Step 4: Write the implementation**

In `apps/api/src/scope/scope.service.ts`, add (near `getAncestorIds`):

```typescript
  /** True iff scopeId resolves to a non-archived scope_nodes row. */
  async isLiveScope(scopeId: string): Promise<boolean> {
    const node = await this.nodes.findOne({
      where: { id: scopeId, archivedAt: IsNull() },
    });
    return node !== null;
  }
```

In `apps/api/src/ai-config/services/agent-profile-skill-binding.service.ts`, add a private helper and call it from both public methods before the upsert:

```typescript
  async addProjectScopedBinding(input: {
    skillName: string;
    scopeNodeId: string;
    provenance?: Record<string, unknown>;
  }): Promise<void> {
    await this.assertLiveScope(input.scopeNodeId);
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
    await this.assertLiveScope(input.scopeNodeId);
    await this.repo.upsert({
      agent_profile_id: profile.id,
      scope_node_id: input.scopeNodeId,
      skill_name: input.skillName,
      provenance: input.provenance ?? null,
    });
  }

  private async assertLiveScope(scopeNodeId: string): Promise<void> {
    const isLive = await this.scopeService.isLiveScope(scopeNodeId);
    if (!isLive) {
      throw new NotFoundException(
        `Scope node ${scopeNodeId} not found or archived`,
      );
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- scope.service.spec.ts`
Expected: PASS.

Run: `npm run test --workspace=apps/api -- agent-profile-skill-binding.service.spec.ts`
Expected: PASS, all tests green (existing tests unaffected since `makeScope().isLiveScope` defaults to resolving `true`).

- [ ] **Step 6: Verify the API builds**

Run: `npm run build --workspace=apps/api`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/scope/scope.service.ts \
  apps/api/src/scope/scope.service.spec.ts \
  apps/api/src/ai-config/services/agent-profile-skill-binding.service.ts \
  apps/api/src/ai-config/services/agent-profile-skill-binding.service.spec.ts
git commit -m "fix(scope): validate scope_id liveness before writing a skill binding"
```

---

### Task 3: Fail-soft scope validation in `SkillCreateCompletionListener` (I2, part B)

**Files:**

- Modify: `apps/api/src/improvement/improvement.module.ts`
- Modify: `apps/api/src/improvement/skill-create-completion.listener.ts`
- Modify: `apps/api/src/improvement/skill-create-completion.listener.spec.ts`

**Interfaces:**

- Consumes: `ScopeService.isLiveScope` (Task 2). `ImprovementModule` does not currently import `ScopeModule` (only `AiConfigModule`, which imports but does not re-export `ScopeModule`/`ScopeService`) — this task adds that import. `ScopeModule` only depends on `AuthModule`/`AuthorizationModule`, both already imported by `ImprovementModule`, so this introduces no circularity.
- Produces: `SkillCreateCompletionListener.applyOriginScope` becomes `async` and treats an unresolvable/archived `scope_id` as absent (logs a warning, does not write frontmatter). `tryAutoApplyScope` passes a validated `originScopeId` (collapsed to `null` when the raw `scope_id` does not resolve to a live scope) into `decideScopeApplication` — `decideScopeApplication` itself is unchanged.

- [ ] **Step 1: Read the current files**

Read `apps/api/src/improvement/skill-create-completion.listener.spec.ts` in full (its constructor mock shapes: `proposals`, `settingsService`, `skillsService`, `bindings`, `profileSkillBindings`) before editing.

- [ ] **Step 2: Write the failing tests**

Add a mock `scopeService` to the spec file's shared setup (wherever the other collaborator mocks — `bindings`, `profileSkillBindings` — are constructed) with `isLiveScope: vi.fn(async () => true)` as the default, and pass it as the 6th constructor argument.

Add these tests alongside the existing origin-scope tests added by the original feature (search for `'applies the origin scope_id to the skill frontmatter unconditionally'`):

```typescript
it("does not apply origin scope when scope_id does not resolve to a live scope node", async () => {
  const proposal = buildProposal({
    provenance: { scope_id: "archived-scope" },
  });
  scopeService.isLiveScope.mockResolvedValue(false);
  settingsService.get.mockResolvedValue("manual");

  await listener.handleWorkflowCompleted(
    buildCompletedEvent(proposal, { materialized: true }),
  );

  expect(skillsService.updateSkill).not.toHaveBeenCalled();
});

it("treats an invalid origin scope as null when deciding auto-apply (never auto-applies against a stale scope)", async () => {
  const proposal = buildProposal({
    provenance: { scope_id: "archived-scope" },
  });
  scopeService.isLiveScope.mockResolvedValue(false);
  settingsService.get.mockResolvedValue("auto");
  skillsService.getSkill.mockReturnValue({
    name: proposal.payload.target_skill_name,
    skillMarkdown: "---\nname: some-skill\ndescription: does things\n---\n",
  });

  await listener.handleWorkflowCompleted(
    buildCompletedEvent(proposal, {
      materialized: true,
      recommended_scope: {
        projects: ["archived-scope"],
        agents: [],
        workflows: [],
      },
    }),
  );

  // auto-apply must not fire off a stale origin scope; only the (skipped) origin-scope
  // write and no confirmed-scope write should have happened.
  expect(skillsService.updateSkill).not.toHaveBeenCalled();
});
```

(Adapt fixture helper names to whatever the spec file actually uses per Step 1 — this mirrors the existing origin-scope test pair added by the prior feature work in the same file.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- skill-create-completion.listener.spec.ts`
Expected: FAIL — constructor does not accept a `ScopeService` argument yet; `applyOriginScope`/`tryAutoApplyScope` still act on the raw unvalidated `scope_id`.

- [ ] **Step 4: Write the implementation**

In `apps/api/src/improvement/improvement.module.ts`, add the import and add `ScopeModule` to `imports`:

```typescript
import { ScopeModule } from "../scope/scope.module";
```

```typescript
  imports: [
    AiConfigModule,
    AuthModule,
    AuthorizationModule,
    ConfigResolutionModule,
    DatabaseModule,
    ObservabilityModule,
    RedisModule,
    ScopeModule,
    SystemSettingsModule,
    WorkflowSkillBindingsModule,
    forwardRef(() => WorkflowCoreModule),
  ],
```

In `apps/api/src/improvement/skill-create-completion.listener.ts`, add the import and constructor parameter:

```typescript
import { ScopeService } from "../scope/scope.service";
```

```typescript
  constructor(
    private readonly proposals: ImprovementProposalRepository,
    private readonly settingsService: SystemSettingsService,
    private readonly skillsService: AgentSkillsService,
    private readonly bindings: WorkflowSkillBindingService,
    private readonly profileSkillBindings: AgentProfileSkillBindingService,
    private readonly scopeService: ScopeService,
  ) {}
```

Update the call site in `handleWorkflowCompleted` to await the now-async method:

```typescript
await this.applyAssignmentTargets(proposalId, proposal);
await this.applyOriginScope(proposal);
await this.tryAutoApplyScope(proposalId, proposal, output);
```

Replace `applyOriginScope`:

```typescript
  private async applyOriginScope(proposal: ImprovementProposal): Promise<void> {
    const scopeId = readScopeId(proposal.provenance);
    if (!scopeId) {
      return;
    }
    if (!(await this.scopeService.isLiveScope(scopeId))) {
      this.logger.warn(
        `Origin scope ${scopeId} for proposal ${proposal.id} no longer resolves to a live scope node; skipping origin-scope application`,
      );
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

Add a small private helper used by both `applyOriginScope` and `tryAutoApplyScope`, and use it in `tryAutoApplyScope` when building `originScopeId`:

```typescript
  private async resolveLiveScopeId(
    provenance: Record<string, unknown>,
  ): Promise<string | null> {
    const scopeId = readScopeId(provenance);
    if (!scopeId) {
      return null;
    }
    return (await this.scopeService.isLiveScope(scopeId)) ? scopeId : null;
  }
```

In `tryAutoApplyScope`, replace:

```typescript
      originScopeId: readScopeId(proposal.provenance) ?? null,
```

with:

```typescript
      originScopeId: await this.resolveLiveScopeId(proposal.provenance),
```

(`tryAutoApplyScope` is already `async`, so this is a direct substitution — no signature change.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- skill-create-completion.listener.spec.ts`
Expected: PASS, all new and pre-existing tests green.

- [ ] **Step 6: Verify the API builds**

Run: `npm run build --workspace=apps/api`
Expected: build succeeds; confirms `ImprovementModule`'s new `ScopeModule` import resolves with no DI-wiring errors at Nest bootstrap (this is exercised by the api's existing bootstrap smoke coverage, not by this spec alone).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/improvement/improvement.module.ts \
  apps/api/src/improvement/skill-create-completion.listener.ts \
  apps/api/src/improvement/skill-create-completion.listener.spec.ts
git commit -m "fix(improvement): fail soft on a stale origin scope_id when auto-applying skill scope"
```

---

### Task 4: Fail-loud scope validation in `SkillScopeConfirmationService.confirm` (I2, part C)

**Files:**

- Modify: `apps/api/src/improvement/skill-scope-confirmation.service.ts`
- Modify: `apps/api/src/improvement/skill-scope-confirmation.service.spec.ts`

**Interfaces:**

- Consumes: `ScopeService.isLiveScope` (Task 2); `ScopeModule` is already an available import at this point (added to `ImprovementModule` in Task 3).
- Produces: `SkillScopeConfirmationService.confirm` throws `BadRequestException` — before performing the existing permission check or writing frontmatter — when any entry in the recommended scope's `projects` list does not resolve to a live scope node. This is deliberately fail-loud: a human is taking an explicit, permission-gated action and should see a clear rejection, not a silent no-op.

- [ ] **Step 1: Read the current files**

Read `apps/api/src/improvement/skill-scope-confirmation.service.spec.ts` in full before editing.

- [ ] **Step 2: Write the failing test**

Add `isLiveScope: vi.fn(async () => true)` to the spec file's mock `ScopeService`/`authz` collaborator setup (inject `ScopeService` as a new constructor argument), then add:

```typescript
it("rejects confirmation when a recommended project scope no longer resolves to a live scope node", async () => {
  const scopeService = { isLiveScope: vi.fn(async () => false) };
  const service = new SkillScopeConfirmationService(
    proposals as any,
    authz as any,
    skillsService as any,
    scopeService as any,
  );
  proposals.findById.mockResolvedValue(
    buildPendingProposal({
      projects: ["deleted-project"],
      agents: [],
      workflows: [],
    }),
  );

  await expect(service.confirm("proposal-1", "user-1")).rejects.toThrow(
    "deleted-project",
  );
  expect(authz.can).not.toHaveBeenCalled();
  expect(skillsService.updateSkill).not.toHaveBeenCalled();
});
```

(Adapt `buildPendingProposal`/fixture names to whatever this spec file's existing tests already use for a proposal with a pending `scope_confirmation` — read Step 1's output before writing this.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- skill-scope-confirmation.service.spec.ts`
Expected: FAIL — constructor does not accept a `ScopeService` argument yet; `confirm` proceeds straight to the permission check without validating scope liveness.

- [ ] **Step 4: Write the implementation**

In `apps/api/src/improvement/skill-scope-confirmation.service.ts`, add the import and constructor parameter:

```typescript
import { ScopeService } from "../scope/scope.service";
```

```typescript
  constructor(
    private readonly proposals: ImprovementProposalRepository,
    private readonly authz: AuthorizationService,
    private readonly skillsService: AgentSkillsService,
    private readonly scopeService: ScopeService,
  ) {}
```

In `confirm`, add a liveness check on `pending.recommendedScope.projects` immediately after resolving `pending`, before the permission check:

```typescript
  async confirm(
    proposalId: string,
    userId: string,
  ): Promise<{ confirmed: boolean; reason?: string }> {
    const proposal = await this.loadProposal(proposalId);
    const pending = readPendingScopeConfirmation(proposal);

    const staleProjectId = await this.findFirstStaleProjectScope(
      pending.recommendedScope?.projects ?? [],
    );
    if (staleProjectId) {
      throw new BadRequestException(
        `Recommended scope names project ${staleProjectId}, which no longer resolves to a live scope node`,
      );
    }

    const targetScopeNodeIds = resolveTargetScopeNodeIds(
      pending.recommendedScope,
    );
    // ...unchanged from here
```

Add the private helper (near `findFirstDeniedScope`):

```typescript
  private async findFirstStaleProjectScope(
    projectIds: string[],
  ): Promise<string | null> {
    for (const projectId of projectIds) {
      if (!(await this.scopeService.isLiveScope(projectId))) {
        return projectId;
      }
    }
    return null;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- skill-scope-confirmation.service.spec.ts`
Expected: PASS, all new and pre-existing tests green.

- [ ] **Step 6: Verify the API builds**

Run: `npm run build --workspace=apps/api`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/improvement/skill-scope-confirmation.service.ts \
  apps/api/src/improvement/skill-scope-confirmation.service.spec.ts
git commit -m "fix(improvement): reject skill scope confirmation naming a stale project scope"
```

---

### Task 5: Integration test coverage for both fixes + final review

**Files:**

- Modify: `apps/api/src/improvement/skill-scope-model.integration.spec.ts`

**Interfaces:**

- Consumes: everything from Tasks 1-4. No new production interfaces — this task only extends the existing real-Postgres integration test (written in the original feature's Task 10) to prove both fixes end-to-end.

- [ ] **Step 1: Read the current file**

Read `apps/api/src/improvement/skill-scope-model.integration.spec.ts` in full — it already seeds two scope_nodes (project type), two agent_profiles, and submits a real `skill_assignment` proposal through `ImprovementProposalService.submitProposal`, then asserts effective-skill resolution via `WorkflowStageSkillPolicyService.resolveAssignedSkills`.

- [ ] **Step 2: Add ancestor-inclusion coverage (I1)**

Add a third scope node as a child of one of the existing two (an `org`-or-appropriate-type parent of one of the existing `project` nodes, respecting `PARENT_CHILD_TYPE_MATRIX`), create a binding at the **parent**, and assert `resolveAssignedSkills` sees it from the **child** project's scopeId — this already exercises the binding path's ancestor-inclusion (pre-existing behavior). Add a second case that creates a `skill_create`-style skill with `scope.projects` naming the **parent** id directly (bypassing the pipeline — write the skill file directly via the test's existing `AgentSkillsService`/library-writing helper) and assert `resolveAssignedSkills` at the **child** project's scopeId now also sees it (this is the Task 1 fix under real-Postgres `ScopeService.getAncestorIds`, not a mock).

- [ ] **Step 3: Add stale-scope coverage (I2)**

Add a case that archives one of the seeded project scope nodes (via `ScopeService.archiveNode` or a direct repository update, whichever this test's existing seeding helpers make easiest) and then:

- attempts `AgentProfileSkillBindingService.addProjectScopedBinding` against the archived scope id and asserts it throws (Task 2);
- exercises `SkillCreateCompletionListener.applyOriginScope`/`tryAutoApplyScope` (via a real `skill_create` proposal completion, if the existing test infrastructure supports driving that path — otherwise call the listener's methods directly against a proposal fixture with `provenance.scope_id` set to the archived id) and asserts no frontmatter write occurs and no exception escapes (Task 3, fail-soft);
- exercises `SkillScopeConfirmationService.confirm` against a pending confirmation naming the archived project id and asserts it throws `BadRequestException` (Task 4, fail-loud).

- [ ] **Step 4: Run the integration test**

This test is gated on `INTEGRATION_TEST_DATABASE_URL` with the existing `assertNotApplicationDatabase` safety guard. Follow the same isolation discipline used when this test was first run for real: point it at a genuine throwaway scratch database (e.g. `CREATE DATABASE nexus_orchestrator_scratch_test;` against the local dev Postgres container), run it in isolation (not the whole `--project integration`), with extended hook/test timeouts if a fresh DB needs to run the full migration history:

```bash
INTEGRATION_TEST_DATABASE_URL=postgres://nexus:<pw>@localhost:5433/nexus_orchestrator_scratch_test \
  npm run test --workspace=apps/api -- skill-scope-model.integration.spec.ts --hookTimeout=180000 --testTimeout=180000
```

Expected: PASS. Drop the scratch database afterward.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/improvement/skill-scope-model.integration.spec.ts
git commit -m "test(improvement): cover ancestor-inclusive scope matching and stale scope_id rejection"
```

---

### Final Whole-Branch Review

After Task 5, dispatch the final whole-branch code reviewer (superpowers:requesting-code-review's `code-reviewer.md`, most capable available model) against the full diff from this plan's starting commit to `HEAD`, with these global constraints called out explicitly for its attention lens:

- I1's fix must not change behavior for any `scope.projects` entry that already names a project-leaf id (only newly-inert-becomes-live cases for ancestor ids should differ).
- I2's fail-soft vs fail-loud split must match: `applyOriginScope`/`tryAutoApplyScope` → fail-soft (log + skip/null, never throw out of `handleWorkflowCompleted`); `SkillScopeConfirmationService.confirm` → fail-loud (`BadRequestException`, no partial writes); `AgentProfileSkillBindingService` → throws, but only ever observed as a caught `unrouted` outcome by its two callers, never an unhandled rejection.
- No lint suppressions, no re-introduced core/kanban boundary residue, no new circular module imports (`ImprovementModule` → `ScopeModule` is one-directional; `ScopeModule` has no dependency back on `ImprovementModule` or `AiConfigModule`).

Once the final review is clean, use superpowers:finishing-a-development-branch to merge and clean up, matching the original feature's merge/rebuild/push discipline (rebuild + recreate the docker-compose stack if either fix's blast radius touches already-deployed data shapes — neither does here: no migration is introduced by this plan, so a plain rebuild without a destructive data reset is sufficient this time).
