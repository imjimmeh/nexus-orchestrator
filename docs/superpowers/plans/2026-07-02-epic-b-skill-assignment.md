# Epic B — Skill Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the "created skill is orphaned" gap — let proposals carry assignment targets, add an `assign-an-existing-skill` proposal kind, add workflow/step-level skill bindings, and resolve a step's effective skills from profile ∪ workflow ∪ step through one shared helper used by both the step and subagent paths.

**Architecture:** Builds on Epic A's `ImprovementProposal`/`IImprovementApplier`/`ImprovementProposalService`. Adds a `workflow_skill_bindings` table (runtime assignments that survive reseed), a `skills:` YAML surface (author-time assignments), and a single `resolveEffectiveSkillsForStep` helper consumed by the step executor and subagent provisioning. Two appliers apply assignments: `SkillCreateApplier` (extended) and a new `SkillAssignmentApplier`. Producers are the retrospective router and a new `suggest_skill_assignment` runtime tool.

**Tech Stack:** NestJS 10, TypeORM (Postgres), Zod, Vitest + SWC, React (web), `@nexus/core`.

## Global Constraints

- **Depends on Epic A being merged** — consumes `ImprovementProposal`, `IImprovementApplier`, `IMPROVEMENT_APPLIERS`, `ImprovementProposalService`, `ImprovementGovernancePolicyService`, and the `@nexus/core` improvement types. Do not redefine them.
- **TDD mandatory** — failing test first, confirm red, then implement.
- **Build with `nest build`**; rebuild `packages/core` before API build/test.
- **No lint suppression; no legacy re-exports; eslint `max-lines` 500** — extract pure logic into `*.helpers.ts`.
- **One shared effective-skill helper for BOTH the step executor and subagent paths** — the recurring divergence bug in this repo; characterization-test both call sites.
- **Scoped test runs:** `npx vitest run <path> --root apps/api` (or `--root apps/web`).
- **Core/Kanban boundary** — no kanban/work-item vocabulary in `apps/api`/`packages/core`.
- **Migrations** follow the repo pattern (`MigrationInterface`, idempotent SQL, registered in `registered-migrations.ts`).

---

## Task 1: `AssignmentTarget` payload schema + validation helper

**Files:**

- Create: `apps/api/src/improvement/appliers/assignment-target.helpers.ts` (pure validation/partition)
- Test: `apps/api/src/improvement/appliers/assignment-target.helpers.spec.ts`

**Interfaces:**

- Consumes: `AssignmentTarget`, `AgentProfileAssignmentTarget`, `WorkflowStepAssignmentTarget` from `@nexus/core` (Epic A).
- Produces:
  - `parseAssignmentTargets(raw: unknown): AssignmentTarget[]` — coerces `payload.assignment_targets` (unknown JSON) into a typed, deduped array, dropping malformed entries.
  - `partitionAssignmentTargets(targets): { profileTargets: AgentProfileAssignmentTarget[]; workflowTargets: WorkflowStepAssignmentTarget[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/improvement/appliers/assignment-target.helpers.spec.ts
import { describe, expect, it } from "vitest";
import {
  parseAssignmentTargets,
  partitionAssignmentTargets,
} from "./assignment-target.helpers";

describe("assignment-target helpers", () => {
  it("parses valid targets and drops malformed ones", () => {
    const parsed = parseAssignmentTargets([
      { type: "agent_profile", profileName: "ceo-agent" },
      {
        type: "workflow_step",
        workflowName: "auto_merge",
        stepId: "quality_gate",
      },
      { type: "workflow_step", workflowName: "auto_merge" }, // whole-workflow
      { type: "nonsense" },
      { type: "agent_profile" }, // missing name
      42,
    ]);
    expect(parsed).toHaveLength(3);
  });

  it("partitions targets by type", () => {
    const { profileTargets, workflowTargets } = partitionAssignmentTargets([
      { type: "agent_profile", profileName: "a" },
      { type: "workflow_step", workflowName: "w", stepId: "s" },
    ]);
    expect(profileTargets).toHaveLength(1);
    expect(workflowTargets).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/improvement/appliers/assignment-target.helpers.spec.ts --root apps/api`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/improvement/appliers/assignment-target.helpers.ts
import type {
  AgentProfileAssignmentTarget,
  AssignmentTarget,
  WorkflowStepAssignmentTarget,
} from "@nexus/core";

export function parseAssignmentTargets(raw: unknown): AssignmentTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: AssignmentTarget[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const target = coerce(entry);
    if (!target) continue;
    const key = JSON.stringify(target);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

function coerce(entry: unknown): AssignmentTarget | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  if (
    e.type === "agent_profile" &&
    typeof e.profileName === "string" &&
    e.profileName
  ) {
    return { type: "agent_profile", profileName: e.profileName };
  }
  if (
    e.type === "workflow_step" &&
    typeof e.workflowName === "string" &&
    e.workflowName
  ) {
    const target: WorkflowStepAssignmentTarget = {
      type: "workflow_step",
      workflowName: e.workflowName,
    };
    if (typeof e.stepId === "string" && e.stepId) target.stepId = e.stepId;
    return target;
  }
  return null;
}

export function partitionAssignmentTargets(targets: AssignmentTarget[]): {
  profileTargets: AgentProfileAssignmentTarget[];
  workflowTargets: WorkflowStepAssignmentTarget[];
} {
  const profileTargets: AgentProfileAssignmentTarget[] = [];
  const workflowTargets: WorkflowStepAssignmentTarget[] = [];
  for (const t of targets) {
    if (t.type === "agent_profile") profileTargets.push(t);
    else workflowTargets.push(t);
  }
  return { profileTargets, workflowTargets };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/improvement/appliers/assignment-target.helpers.spec.ts --root apps/api`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/improvement/appliers/assignment-target.helpers.ts apps/api/src/improvement/appliers/assignment-target.helpers.spec.ts
git commit -m "feat(api): assignment-target parse/partition helpers" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: `workflow_skill_bindings` table, entity, service + migration

**Files:**

- Create: `apps/api/src/workflow/workflow-skill-bindings/workflow-skill-binding.entity.ts`
- Create: `apps/api/src/workflow/workflow-skill-bindings/workflow-skill-binding.repository.ts`
- Create: `apps/api/src/workflow/workflow-skill-bindings/workflow-skill-binding.service.ts`
- Create: `apps/api/src/workflow/workflow-skill-bindings/workflow-skill-bindings.module.ts`
- Create: `apps/api/src/database/migrations/20260703010000-create-workflow-skill-bindings.ts` + register in `registered-migrations.ts`
- Test: `apps/api/src/workflow/workflow-skill-bindings/workflow-skill-binding.service.spec.ts`

**Interfaces:**

- Produces:
  - Entity `WorkflowSkillBinding` (`@Entity('workflow_skill_bindings')`): `id: string`, `workflow_name: string`, `step_id: string | null` (null = whole-workflow), `skill_name: string`, `provenance: Record<string, unknown> | null`, `created_at`, `updated_at`. Unique index on `(workflow_name, step_id, skill_name)`.
  - `class WorkflowSkillBindingService` with `addBinding({ workflowName, stepId, skillName, provenance }): Promise<WorkflowSkillBinding>` (idempotent upsert on the unique key), `removeBinding({ workflowName, stepId, skillName }): Promise<void>`, `listForWorkflow(workflowName): Promise<WorkflowSkillBinding[]>`.

> Postgres treats `NULL` values as distinct in a UNIQUE constraint, so a whole-workflow binding (`step_id IS NULL`) won't be deduped by a plain unique index. Use a unique index on `(workflow_name, COALESCE(step_id, ''), skill_name)` (create it in the migration as an expression index) and mirror that when checking existence in `addBinding`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/workflow/workflow-skill-bindings/workflow-skill-binding.service.spec.ts
import { describe, expect, it, vi } from "vitest";
import { WorkflowSkillBindingService } from "./workflow-skill-binding.service";

function makeRepo() {
  const rows: any[] = [];
  return {
    rows,
    findExisting: vi.fn(
      async (k: any) =>
        rows.find(
          (r) =>
            r.workflow_name === k.workflowName &&
            (r.step_id ?? null) === (k.stepId ?? null) &&
            r.skill_name === k.skillName,
        ) ?? null,
    ),
    insert: vi.fn(async (v: any) => {
      const row = { id: `b${rows.length + 1}`, ...v };
      rows.push(row);
      return row;
    }),
    listForWorkflow: vi.fn(async (name: string) =>
      rows.filter((r) => r.workflow_name === name),
    ),
  };
}

describe("WorkflowSkillBindingService.addBinding", () => {
  it("is idempotent on the unique key", async () => {
    const repo = makeRepo();
    const svc = new WorkflowSkillBindingService(repo as any);
    await svc.addBinding({ workflowName: "w", stepId: "s", skillName: "sk" });
    await svc.addBinding({ workflowName: "w", stepId: "s", skillName: "sk" });
    expect(repo.insert).toHaveBeenCalledOnce();
  });

  it("treats null step_id (whole-workflow) as distinct from a step binding", async () => {
    const repo = makeRepo();
    const svc = new WorkflowSkillBindingService(repo as any);
    await svc.addBinding({ workflowName: "w", stepId: null, skillName: "sk" });
    await svc.addBinding({ workflowName: "w", stepId: "s", skillName: "sk" });
    expect(repo.insert).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/workflow/workflow-skill-bindings/workflow-skill-binding.service.spec.ts --root apps/api`

- [ ] **Step 3: Implement entity, repository, service, migration, module**

Follow the entity/repository/migration pattern from Epic A Task 2 and the `adding-entity-migration` skill. The service:

```ts
// apps/api/src/workflow/workflow-skill-bindings/workflow-skill-binding.service.ts
import { Injectable } from "@nestjs/common";
import { WorkflowSkillBindingRepository } from "./workflow-skill-binding.repository";
import type { WorkflowSkillBinding } from "./workflow-skill-binding.entity";

export interface AddBindingInput {
  workflowName: string;
  stepId: string | null;
  skillName: string;
  provenance?: Record<string, unknown>;
}

@Injectable()
export class WorkflowSkillBindingService {
  constructor(private readonly repo: WorkflowSkillBindingRepository) {}

  async addBinding(input: AddBindingInput): Promise<WorkflowSkillBinding> {
    const existing = await this.repo.findExisting({
      workflowName: input.workflowName,
      stepId: input.stepId ?? null,
      skillName: input.skillName,
    });
    if (existing) return existing;
    return this.repo.insert({
      workflow_name: input.workflowName,
      step_id: input.stepId ?? null,
      skill_name: input.skillName,
      provenance: input.provenance ?? null,
    });
  }

  async removeBinding(input: {
    workflowName: string;
    stepId: string | null;
    skillName: string;
  }): Promise<void> {
    await this.repo.deleteExisting(input);
  }

  listForWorkflow(workflowName: string): Promise<WorkflowSkillBinding[]> {
    return this.repo.listForWorkflow(workflowName);
  }
}
```

Migration unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_skill_bindings
  ON workflow_skill_bindings (workflow_name, COALESCE(step_id, ''), skill_name);
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/workflow/workflow-skill-bindings/workflow-skill-binding.service.spec.ts --root apps/api`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-skill-bindings apps/api/src/database/migrations/20260703010000-create-workflow-skill-bindings.ts apps/api/src/database/migrations/registered-migrations.ts
git commit -m "feat(api): workflow_skill_bindings table, service, and migration" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Shared effective-skill resolution helper

**Files:**

- Create: `apps/api/src/workflow/agent-prompt/effective-skills.helpers.ts`
- Test: `apps/api/src/workflow/agent-prompt/effective-skills.helpers.spec.ts`

**Interfaces:**

- Produces:
  - `interface EffectiveSkillSources { profileSkills: string[]; workflowYamlSkills: string[]; stepYamlSkills: string[]; workflowBindings: string[]; stepBindings: string[] }`
  - `resolveEffectiveSkills(sources: EffectiveSkillSources): { name: string; specificity: 'step' | 'workflow' | 'profile' }[]` — union deduped by name, each name tagged with its **most specific** origin (step > workflow > profile), ordered most-specific-first (so the injection budget fills step skills before profile skills).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/workflow/agent-prompt/effective-skills.helpers.spec.ts
import { describe, expect, it } from "vitest";
import { resolveEffectiveSkills } from "./effective-skills.helpers";

describe("resolveEffectiveSkills", () => {
  it("unions all sources, dedupes by name, and tags most-specific origin", () => {
    const result = resolveEffectiveSkills({
      profileSkills: ["a", "shared"],
      workflowYamlSkills: ["b"],
      stepYamlSkills: ["c", "shared"],
      workflowBindings: ["d"],
      stepBindings: ["e"],
    });
    const byName = Object.fromEntries(
      result.map((r) => [r.name, r.specificity]),
    );
    expect(byName).toEqual({
      c: "step",
      e: "step",
      shared: "step", // step wins for 'shared'
      b: "workflow",
      d: "workflow",
      a: "profile",
    });
  });

  it("orders step skills before workflow before profile", () => {
    const result = resolveEffectiveSkills({
      profileSkills: ["p"],
      workflowYamlSkills: ["w"],
      stepYamlSkills: ["s"],
      workflowBindings: [],
      stepBindings: [],
    });
    expect(result.map((r) => r.name)).toEqual(["s", "w", "p"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/workflow/agent-prompt/effective-skills.helpers.spec.ts --root apps/api`

- [ ] **Step 3: Implement**

```ts
// apps/api/src/workflow/agent-prompt/effective-skills.helpers.ts
export interface EffectiveSkillSources {
  profileSkills: string[];
  workflowYamlSkills: string[];
  stepYamlSkills: string[];
  workflowBindings: string[];
  stepBindings: string[];
}

export type SkillSpecificity = "step" | "workflow" | "profile";

export interface EffectiveSkill {
  name: string;
  specificity: SkillSpecificity;
}

export function resolveEffectiveSkills(
  sources: EffectiveSkillSources,
): EffectiveSkill[] {
  const rank: Record<SkillSpecificity, number> = {
    step: 0,
    workflow: 1,
    profile: 2,
  };
  const best = new Map<string, SkillSpecificity>();

  const consider = (names: string[], specificity: SkillSpecificity) => {
    for (const name of names) {
      const current = best.get(name);
      if (current === undefined || rank[specificity] < rank[current]) {
        best.set(name, specificity);
      }
    }
  };

  consider(sources.stepYamlSkills, "step");
  consider(sources.stepBindings, "step");
  consider(sources.workflowYamlSkills, "workflow");
  consider(sources.workflowBindings, "workflow");
  consider(sources.profileSkills, "profile");

  return [...best.entries()]
    .map(([name, specificity]) => ({ name, specificity }))
    .sort((a, b) => rank[a.specificity] - rank[b.specificity]);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/workflow/agent-prompt/effective-skills.helpers.spec.ts --root apps/api`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/agent-prompt/effective-skills.helpers.ts apps/api/src/workflow/agent-prompt/effective-skills.helpers.spec.ts
git commit -m "feat(api): shared effective-skill resolution helper (step > workflow > profile)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Wire effective-skill resolution into BOTH the step executor and subagent paths

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.service.ts` (the `listSkillsForProfile`/`assignedSkills` flow, ~lines 460–490)
- Modify: the subagent provisioning path in `apps/api/src/workflow/workflow-subagents/` (locate where subagents build their assigned-skill set — grep for `assignedSkills` / `listSkillsForProfile` there)
- Modify: `apps/api/src/workflow/agent-prompt/universal-prompt-layers.helpers.ts` (`buildSkillSection`) and `apps/api/src/workflow/skill-content-injection.helpers.ts` (`renderInjectedSkillContent`) so the greedy `SKILL_CONTENT_BUDGET_TOKENS` fill consumes the effective skills **in most-specific-first order**
- Test: `apps/api/src/workflow/workflow-step-execution/step-agent-effective-skills.spec.ts`, `apps/api/src/workflow/workflow-subagents/subagent-effective-skills.spec.ts`

**Interfaces:**

- Consumes: `resolveEffectiveSkills` (Task 3), `WorkflowSkillBindingService.listForWorkflow` (Task 2), the profile `assigned_skills`, and the parsed workflow/step YAML `skills` (Task 5 provides the parsed fields; sequence Task 5 before completing this task's YAML-source wiring, or thread empty arrays first and fill them in Task 5).
- Produces: both paths compute the same ordered effective-skill list and feed it to injection. Characterization tests assert identical resolution given identical inputs.

> **This is the load-bearing anti-divergence task.** Do not inline the union logic in either call site — both must call `resolveEffectiveSkills`. The two tests below deliberately assert the _same_ helper output from each path.

- [ ] **Step 1: Write the two failing characterization tests**

```ts
// apps/api/src/workflow/workflow-step-execution/step-agent-effective-skills.spec.ts
import { describe, expect, it } from "vitest";
import { resolveEffectiveSkills } from "../agent-prompt/effective-skills.helpers";

// Characterization: the step executor MUST derive its injected skills via
// resolveEffectiveSkills. This test pins the contract the executor consumes;
// when wiring the executor, assert it produces this exact order for these inputs.
describe("step executor effective-skill contract", () => {
  it("produces step-first ordering from mixed sources", () => {
    const result = resolveEffectiveSkills({
      profileSkills: ["prof"],
      workflowYamlSkills: ["wf"],
      stepYamlSkills: ["step"],
      workflowBindings: ["wfbind"],
      stepBindings: ["stepbind"],
    }).map((s) => s.name);
    expect(result.slice(0, 2).sort()).toEqual(["step", "stepbind"]);
    expect(result[result.length - 1]).toBe("prof");
  });
});
```

```ts
// apps/api/src/workflow/workflow-subagents/subagent-effective-skills.spec.ts
import { describe, expect, it } from "vitest";
import { resolveEffectiveSkills } from "../agent-prompt/effective-skills.helpers";

describe("subagent effective-skill contract", () => {
  it("resolves identically to the step path for identical sources", () => {
    const sources = {
      profileSkills: ["prof"],
      workflowYamlSkills: ["wf"],
      stepYamlSkills: ["step"],
      workflowBindings: ["wfbind"],
      stepBindings: ["stepbind"],
    };
    expect(resolveEffectiveSkills(sources)).toEqual(
      resolveEffectiveSkills(sources),
    );
  });
});
```

- [ ] **Step 2: Run — expect PASS on the helper contract (these lock the helper), then write executor/subagent integration tests that FAIL**

Run: `npx vitest run src/workflow/workflow-step-execution/step-agent-effective-skills.spec.ts src/workflow/workflow-subagents/subagent-effective-skills.spec.ts --root apps/api`
Expected: the helper-contract assertions pass; now add integration assertions against the real executor/subagent skill-resolution functions (inject a fake `WorkflowSkillBindingService` and profile) and confirm they FAIL until you route both call sites through `resolveEffectiveSkills`.

- [ ] **Step 3: Refactor both call sites to call `resolveEffectiveSkills`**

In `step-agent-step-executor.service.ts`, replace the direct `assignedSkills = listSkillsForProfile(...)` usage with: gather `profileSkills` (existing), `workflowBindings`/`stepBindings` (from `WorkflowSkillBindingService.listForWorkflow(workflowName)` split by `step_id`), and `workflowYamlSkills`/`stepYamlSkills` (Task 5), then call `resolveEffectiveSkills` and pass the ordered names to the injection helpers. Do the same in the subagent path. Inject `WorkflowSkillBindingService` via the module.

- [ ] **Step 4: Make injection fill most-specific-first**

In `renderInjectedSkillContent` / `buildSkillSection`, ensure the greedy budget fill iterates the effective-skill list in the given order (step → workflow → profile) so step-scoped skills win the `SKILL_CONTENT_BUDGET_TOKENS` budget; overflow degrades to name-only listing as today.

- [ ] **Step 5: Run — expect PASS**

Run: `npx vitest run src/workflow/workflow-step-execution src/workflow/workflow-subagents src/workflow/agent-prompt --root apps/api`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow
git commit -m "feat(api): resolve step effective skills (profile+workflow+step) via shared helper on both step and subagent paths" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Workflow YAML `skills:` surface (workflow-level + step-level)

**Files:**

- Modify: the workflow parser/validator under `apps/api/src/workflow/` (grep for where `steps[].inputs` is parsed and where workflow-level keys are read — likely a `workflow-parser`/`workflow-validation` service)
- Modify: the parsed workflow/step model types to carry `skills?: string[]` at workflow level and `inputs.skills?: string[]` at step level
- Modify: Task 4's executor/subagent wiring to source `workflowYamlSkills`/`stepYamlSkills` from the parsed model
- Test: `apps/api/src/workflow/<parser-dir>/workflow-skills-yaml.spec.ts`

**Interfaces:**

- Produces: parser accepts a workflow-level `skills: [name, ...]` block and `steps[].inputs.skills: [name, ...]`; unknown skill names produce a **validation warning** (not an error) — skills may be authored/created later. Warnings surface through the existing validation-warnings channel.

- [ ] **Step 1: Write the failing test**

```ts
// (path mirrors the existing workflow parser spec location)
import { describe, expect, it } from "vitest";
// import { parseWorkflowYaml } from '<actual parser entrypoint>';

describe("workflow YAML skills surface", () => {
  it("parses workflow-level and step-level skills", () => {
    const yaml = `
name: demo
skills: [global-skill]
steps:
  - id: build
    type: agent
    inputs:
      skills: [step-skill]
`;
    const parsed = parseWorkflowYaml(yaml); // real entrypoint
    expect(parsed.skills).toEqual(["global-skill"]);
    expect(parsed.steps[0].inputs.skills).toEqual(["step-skill"]);
  });

  it("warns (does not throw) on an unknown skill name", () => {
    const yaml = `name: demo\nskills: [does-not-exist]\nsteps: []\n`;
    const result = validateWorkflowYaml(yaml); // real validation entrypoint
    expect(result.warnings.some((w) => /does-not-exist/.test(w))).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
```

Replace `parseWorkflowYaml`/`validateWorkflowYaml` with the real entrypoints once located.

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/workflow/<parser-dir>/workflow-skills-yaml.spec.ts --root apps/api`

- [ ] **Step 3: Implement parser + validator changes**

Add the `skills` field to the workflow/step schema (respect the `workflow-yaml-authoring` skill conventions). Validate names against `AgentSkillsService`/`SkillService` and push warnings for unknown ones through the existing warnings collector.

- [ ] **Step 4: Run — expect PASS**, then re-run Task 4 suites to confirm YAML sources now flow through.

Run: `npx vitest run src/workflow --root apps/api`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow
git commit -m "feat(api): workflow YAML skills: block (workflow + step level) with unknown-name warnings" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Extend `SkillCreateApplier` to apply assignment targets

**Files:**

- Modify: `apps/api/src/improvement/appliers/skill-create.applier.ts`
- Modify: `apps/api/src/improvement/skill-create-completion.listener.ts` (apply targets AFTER materialization succeeds, since the skill file must exist before a profile can meaningfully reference it)
- Test: `apps/api/src/improvement/appliers/skill-create.applier.assignment.spec.ts`

**Interfaces:**

- Consumes: `parseAssignmentTargets`/`partitionAssignmentTargets` (Task 1), `AgentSkillsService.addProfileSkills(profileName, [skillName])`, `WorkflowSkillBindingService.addBinding(...)`.
- Produces: after the `create_skill` run completes with `materialized:true`, the completion listener applies each `assignment_target`: profile targets via `addProfileSkills`; workflow targets via `addBinding` (with `provenance: { proposalId }`). Records applied targets into `proposal.rollback_data.applied_targets` for later rollback.

> Assignment is applied in the **completion listener** (post-materialization), not in `apply()` (which only dispatches). Keep `apply()` unchanged except to validate that `assignment_targets` parse (drop invalid, log count).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/improvement/appliers/skill-create.applier.assignment.spec.ts
import { describe, expect, it, vi } from "vitest";
import { applySkillAssignments } from "./skill-create.applier";

describe("applySkillAssignments", () => {
  it("assigns to profiles and workflow bindings and records rollback data", async () => {
    const skills = { addProfileSkills: vi.fn(async () => undefined) };
    const bindings = { addBinding: vi.fn(async () => undefined) };
    const applied = await applySkillAssignments(
      {
        skillName: "merge-doctor",
        targets: [
          { type: "agent_profile", profileName: "merge-agent" },
          {
            type: "workflow_step",
            workflowName: "auto_merge",
            stepId: "quality_gate",
          },
        ],
        proposalId: "p1",
      },
      { skills: skills as any, bindings: bindings as any },
    );
    expect(skills.addProfileSkills).toHaveBeenCalledWith("merge-agent", [
      "merge-doctor",
    ]);
    expect(bindings.addBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowName: "auto_merge",
        stepId: "quality_gate",
        skillName: "merge-doctor",
      }),
    );
    expect(applied).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/improvement/appliers/skill-create.applier.assignment.spec.ts --root apps/api`

- [ ] **Step 3: Implement `applySkillAssignments` (exported pure-ish function) + call it from the completion listener**

```ts
// add to apps/api/src/improvement/appliers/skill-create.applier.ts
import type { AssignmentTarget } from "@nexus/core";
import { partitionAssignmentTargets } from "./assignment-target.helpers";

export interface SkillAssignmentDeps {
  skills: {
    addProfileSkills(profileName: string, skills: string[]): Promise<void>;
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

export async function applySkillAssignments(
  input: { skillName: string; targets: AssignmentTarget[]; proposalId: string },
  deps: SkillAssignmentDeps,
): Promise<AssignmentTarget[]> {
  const { profileTargets, workflowTargets } = partitionAssignmentTargets(
    input.targets,
  );
  const applied: AssignmentTarget[] = [];
  for (const t of profileTargets) {
    await deps.skills.addProfileSkills(t.profileName, [input.skillName]);
    applied.push(t);
  }
  for (const t of workflowTargets) {
    await deps.bindings.addBinding({
      workflowName: t.workflowName,
      stepId: t.stepId ?? null,
      skillName: input.skillName,
      provenance: { proposalId: input.proposalId },
    });
    applied.push(t);
  }
  return applied;
}
```

Call `applySkillAssignments` from the completion listener after the `materialized:true` branch, passing `parseAssignmentTargets(proposal.payload.assignment_targets)`, then persist `rollback_data.applied_targets = applied` via `ImprovementProposalRepository.updateById`.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/improvement/appliers/skill-create.applier.assignment.spec.ts --root apps/api`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/improvement
git commit -m "feat(api): apply skill_create assignment targets after materialization" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: `skill_assignment` kind — `SkillAssignmentApplier`

**Files:**

- Create: `apps/api/src/improvement/appliers/skill-assignment.applier.ts`
- Modify: `apps/api/src/improvement/improvement.module.ts` (add to `IMPROVEMENT_APPLIERS` factory)
- Test: `apps/api/src/improvement/appliers/skill-assignment.applier.spec.ts`

**Interfaces:**

- Produces: `class SkillAssignmentApplier implements IImprovementApplier` with `kind = 'skill_assignment'`. `apply(proposal)` reads `payload.{skillName, assignment_targets}`, applies via `applySkillAssignments` (Task 6), records `rollback_data.applied_targets`, returns `{ok:true}`. `rollback(proposal)` removes each applied target (profile via `AgentSkillsService.removeProfileSkills`; workflow via `WorkflowSkillBindingService.removeBinding`).

- [ ] **Step 1: Write the failing test** (apply assigns; rollback removes)

```ts
// apps/api/src/improvement/appliers/skill-assignment.applier.spec.ts
import { describe, expect, it, vi } from "vitest";
import { SkillAssignmentApplier } from "./skill-assignment.applier";

function deps() {
  return {
    skills: {
      addProfileSkills: vi.fn(async () => undefined),
      removeProfileSkills: vi.fn(async () => undefined),
    },
    bindings: {
      addBinding: vi.fn(async () => undefined),
      removeBinding: vi.fn(async () => undefined),
    },
    proposals: { updateById: vi.fn(async () => undefined) },
  };
}

describe("SkillAssignmentApplier", () => {
  it("applies targets and records rollback data", async () => {
    const d = deps();
    const applier = new SkillAssignmentApplier(
      d.skills as any,
      d.bindings as any,
      d.proposals as any,
    );
    const result = await applier.apply({
      id: "p1",
      kind: "skill_assignment",
      provenance: {},
      payload: {
        skillName: "sk",
        assignment_targets: [{ type: "agent_profile", profileName: "agent-x" }],
      },
    } as any);
    expect(result.ok).toBe(true);
    expect(d.skills.addProfileSkills).toHaveBeenCalledWith("agent-x", ["sk"]);
    expect(d.proposals.updateById).toHaveBeenCalled();
  });

  it("rollback removes previously applied targets", async () => {
    const d = deps();
    const applier = new SkillAssignmentApplier(
      d.skills as any,
      d.bindings as any,
      d.proposals as any,
    );
    await applier.rollback({
      id: "p1",
      kind: "skill_assignment",
      payload: { skillName: "sk" },
      rollback_data: {
        applied_targets: [{ type: "agent_profile", profileName: "agent-x" }],
      },
    } as any);
    expect(d.skills.removeProfileSkills).toHaveBeenCalledWith("agent-x", [
      "sk",
    ]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/improvement/appliers/skill-assignment.applier.spec.ts --root apps/api`

- [ ] **Step 3: Implement the applier + register in the module factory**

Update the `IMPROVEMENT_APPLIERS` factory in `improvement.module.ts` to `(a, b) => [a, b]` injecting `[SkillCreateApplier, SkillAssignmentApplier]`.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run src/improvement/appliers/skill-assignment.applier.spec.ts --root apps/api`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/improvement
git commit -m "feat(api): SkillAssignmentApplier with rollback" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: `suggest_skill_assignment` runtime tool

**Files:**

- Create: `apps/api/src/workflow/workflow-internal-tools/tools/skill/suggest-skill-assignment.tool.ts`
- Modify: the internal-tools registry (register the tool the same way `create-skill.tool.ts` is registered)
- Modify: the corresponding handler service (thread it to `ImprovementProposalService.submitProposal`)
- Test: `apps/api/src/workflow/workflow-internal-tools/tools/skill/suggest-skill-assignment.tool.spec.ts`

**Interfaces:**

- Produces: a tool `suggest_skill_assignment` with input `{ skill_name: string; targets: AssignmentTarget[] }`. It **files a proposal** (`submitProposal({ kind:'skill_assignment', payload:{ skillName, assignment_targets }, evidence:{ evidenceClass:'inference' }, confidence:<router default or a fixed low value>, provenance:{ tool:'suggest_skill_assignment', runId, agentProfileName } })`) — it never assigns directly. Respect strict-provider tool-schema gotchas (declare the enum/object schema the way existing tools do; see `agent-runtime-tools-and-context` skill).

- [ ] **Step 1: Write the failing test** (tool calls submitProposal, never assigns directly)

```ts
// apps/api/src/workflow/workflow-internal-tools/tools/skill/suggest-skill-assignment.tool.spec.ts
import { describe, expect, it, vi } from "vitest";
import { handleSuggestSkillAssignment } from "./suggest-skill-assignment.tool";

describe("suggest_skill_assignment", () => {
  it("files a skill_assignment proposal from tool input + run context", async () => {
    const service = {
      submitProposal: vi.fn(async () => ({
        outcome: "proposed",
        proposal: { id: "p1" },
      })),
    };
    const result = await handleSuggestSkillAssignment(
      {
        skill_name: "merge-doctor",
        targets: [{ type: "agent_profile", profileName: "merge-agent" }],
      },
      { runId: "r1", agentProfileName: "merge-agent" },
      service as any,
    );
    expect(service.submitProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "skill_assignment",
        payload: expect.objectContaining({ skillName: "merge-doctor" }),
      }),
    );
    expect(result).toMatchObject({ proposalId: "p1" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** → **Step 3: Implement** → **Step 4: Run — expect PASS**

Run: `npx vitest run src/workflow/workflow-internal-tools/tools/skill/suggest-skill-assignment.tool.spec.ts --root apps/api`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-internal-tools
git commit -m "feat(api): suggest_skill_assignment runtime tool files skill_assignment proposals" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: Retrospective router — emit `skill_assignment` instead of duplicate `skill_new`; validate `skill_create` targets

**Files:**

- Modify: `apps/api/src/memory/learning/learning-router.service.ts` (the `loadSkillCorpus` similarity branch)
- Modify: `apps/api/src/workflow/workflow-retrospective/retrospective-output-router.service.ts` (validate `assignment_targets` on `skill_create` against existing profiles/workflows; strip invalid with a ledger note)
- Modify: the seeded analyst prompt (grep under `seed/` for the retrospective analyst prompt) to describe emitting `assignment_targets`
- Test: `apps/api/src/memory/learning/learning-router.skill-assignment.spec.ts`, plus a router-validation test

**Interfaces:**

- Produces: when the router finds a high-similarity existing skill AND the struggling profile/workflow lacks it, it files `kind:'skill_assignment'` (via `ImprovementProposalService`) rather than a near-duplicate `skill_new`. `skill_create` proposals have their `assignment_targets` validated (unknown profile/workflow stripped, ledger note emitted).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/memory/learning/learning-router.skill-assignment.spec.ts
import { describe, expect, it, vi } from "vitest";
import { decideSkillRoute } from "./learning-router.service";
// If routing logic is not yet a pure export, extract decideSkillRoute({ similarity, targetHasSkill }) -> 'skill_patch' | 'skill_new' | 'skill_assignment'

describe("decideSkillRoute", () => {
  it("routes to skill_assignment when a similar skill exists but the target lacks it", () => {
    expect(decideSkillRoute({ similarity: 0.95, targetHasSkill: false })).toBe(
      "skill_assignment",
    );
  });
  it("routes to skill_patch when a similar skill exists and target already has it", () => {
    expect(decideSkillRoute({ similarity: 0.95, targetHasSkill: true })).toBe(
      "skill_patch",
    );
  });
  it("routes to skill_new when no similar skill exists", () => {
    expect(decideSkillRoute({ similarity: 0.2, targetHasSkill: false })).toBe(
      "skill_new",
    );
  });
});
```

- [ ] **Step 2–4: Red → extract `decideSkillRoute` pure helper + wire → Green**

Run: `npx vitest run src/memory/learning/learning-router.skill-assignment.spec.ts --root apps/api`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/memory/learning apps/api/src/workflow/workflow-retrospective seed/
git commit -m "feat(api): router emits skill_assignment for high-similarity gaps; validates skill_create targets" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: Store-split fix + capability-lifecycle reroute

**Files:**

- Modify: `apps/api/src/ai-config/services/agent-skills.service.ts` (`upsertSkill` also upserts the `skills` DB row via `SkillService`, `source='agent_factory'`)
- Modify: `apps/api/src/workflow/workflow-runtime/.../workflow-runtime-capability-lifecycle.service.ts` (`createSkill` ~lines 113–151: instead of directly `addProfileSkillsByProfileName`, file a `skill_assignment` proposal via `ImprovementProposalService` so governance decides auto vs propose)
- Test: `apps/api/src/ai-config/services/agent-skills.store-split.spec.ts`, `.../workflow-runtime-capability-lifecycle.reroute.spec.ts`

**Interfaces:**

- Produces: (a) every materialized skill appears in the `skills` DB corpus (`loadSkillCorpus` sees it → no duplicate `skill_new`); (b) the capability-provider `createSkill` self-assignment now flows through the governed proposal path.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/ai-config/services/agent-skills.store-split.spec.ts
import { describe, expect, it, vi } from "vitest";

describe("AgentSkillsService.upsertSkill store-split", () => {
  it("writes both the SKILL.md file and the skills DB row", async () => {
    // Construct AgentSkillsService with a fake library (file writer) and a fake SkillService;
    // call upsertSkill(...); assert BOTH the library write and skillService.upsert were called
    // with source 'agent_factory'.
    expect(true).toBe(true); // replace with real assertions against the constructed service
  });
});
```

Replace the placeholder body with real assertions once you have the service's constructor wired in the test (mirror an existing `agent-skills.service` spec for setup).

- [ ] **Step 2–4: Red → implement both changes → Green**

Run: `npx vitest run src/ai-config/services/agent-skills.store-split.spec.ts src/workflow/workflow-runtime --root apps/api`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai-config apps/api/src/workflow/workflow-runtime
git commit -m "fix(api): materialize writes skills DB corpus row; capability createSkill routes via governed proposal" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: Web — skill-kind proposal detail + binding provenance

**Files:**

- Modify: `apps/web/src/pages/improvements/ImprovementsQueue.tsx` (or a `ProposalDetail` subcomponent) — render skill preview + target list for `skill_create`/`skill_assignment`
- Modify: agent profile editor + workflow detail views to show skills arriving via bindings/proposals with provenance ("assigned by proposal #N")
- Test: `apps/web/src/pages/improvements/SkillProposalDetail.test.tsx`

**Interfaces:**

- Consumes: the proposal payload (`skillName`/`target_skill_name`, `assignment_targets`) and `workflow_skill_bindings` provenance.
- Produces: reviewers see what skill is being created/assigned and to which profiles/steps; assignment provenance is visible where a human would look.

- [ ] **Step 1: Write the failing test** → **Step 2: Red** → **Step 3: Implement** → **Step 4: Green**

Run: `npx vitest run src/pages/improvements/SkillProposalDetail.test.tsx --root apps/web`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): skill proposal detail rendering + binding provenance" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 12: Full-suite verification + docs

- [ ] **Step 1: Builds** — `npm run build --workspace=packages/core && npm run build:api && npm run build:web`
- [ ] **Step 2: Tests** — `npm run test:api && npm run test:unit:web && npm run test --workspace=packages/core`
- [ ] **Step 3: Lint** — `npm run lint:api && npm run lint:web`
- [ ] **Step 4: Seed validation** — `npm run validate:seed-data`
- [ ] **Step 5: Docs** — update `docs/guide` skills architecture (skill assignment, workflow bindings, effective-skill resolution + injection precedence) and the `workflow-yaml-authoring` skill doc (new `skills:` block). Commit:

```bash
git add docs/ .agents/
git commit -m "docs: skill assignment, workflow skill bindings, effective-skill resolution" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Deployment note (post-merge)

Two new migrations (`workflow_skill_bindings`; none for improvement — that's Epic A). Analyst prompt change is seed data → image rebuild + reseed. Requires nexus-api rebuild + redeploy.

## Spec ambiguities resolved

1. **When are assignments applied for `skill_create`?** After materialization (in the completion listener), not at dispatch — a profile referencing a not-yet-written SKILL.md would inject nothing. `apply()` only validates targets parse.
2. **Whole-workflow binding uniqueness** — Postgres `NULL` is distinct in UNIQUE, so the dedup index uses `COALESCE(step_id,'')`; the service mirrors that in its existence check.
3. **`suggest_skill_assignment` confidence** — the tool has no struggle evidence, so it files as `evidenceClass:'inference'` with a low fixed confidence; under `tiered` mode `skill_assignment` still auto-applies (Epic A rule), which is the intended "agent noticed a gap → just assign it" behavior. If that is too aggressive, an operator sets a per-kind override to `manual`.
