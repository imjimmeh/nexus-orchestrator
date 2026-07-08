# Skill Usage: Forced Content Injection + Library Curation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make assigned agent skills actually influence agent behavior by injecting their full content into the system prompt (instead of relying on agents to open mounted `SKILL.md` files), and curate the library by deleting redundant/orphan skills and fixing trigger-less descriptions.

**Architecture:** Skills are filesystem-native (library at `NEXUS_SKILLS_LIBRARY_PATH=/data/nexus-skills`, seeded from `seed/skills/<name>/SKILL.md`). Assignments live in `agent_profiles.assigned_skills` (seeded from `seed/agents/<name>/agent.json`). The resolver (`WorkflowStageSkillPolicyService.resolveAssignedSkills`) already returns full `SkillLibraryRecord[]` (incl. `skillMarkdown`) to both the step-agent and subagent prompt builders, which currently strip them to name/description and — for `pi`/`claude-code` — suppress the section entirely (deferring to the harness's `<available_skills>` names-only block). This plan changes the `native` discovery mode to render the full skill bodies inline, token-bounded, for every harness.

**Tech Stack:** NestJS (apps/api), TypeScript, Vitest, TypeORM seed loaders, YAML/JSON seed files.

## Global Constraints

- Strict lint policy: never suppress lint (`eslint-disable`, `@ts-ignore`, rule downgrades). Fix in code. (CLAUDE.md)
- No Kanban domain identifiers in `apps/api`/`packages/core` (`nexus-boundaries/no-core-kanban-residue`).
- TDD: Red → Green → Refactor for every behavioral change. Pure helpers get pure unit tests.
- Skill discovery mode default is `native` (`DEFAULT_SKILL_DISCOVERY_MODE`, `packages/core/src/skills/skill-discovery-mode.ts`). All 25 active profiles resolve to `native` (their `skill_discovery_mode` is NULL).
- `search` mode behavior must remain unchanged (it is the opt-in toggle).
- Deletions follow "Eliminate, Don't Deprecate": delete the skill directory AND every assignment referencing it; no leftover dead files.
- Seed changes take effect on `nexus-api` restart/reseed (no image rebuild). Engine (code) changes require a `nexus-api` rebuild + redeploy.
- Verify commands run from repo root. API tests: `npm run test --workspace=apps/api -- run <path>`. Lint: `npx eslint <files>`. Seed parse: `npm run validate:seed-data`.

---

## Phase 1 — Library curation (delete redundant skills, fix assignments)

Removes duplicate and orphan skills and the assignments that reference them. Pure seed/test work; no engine change. This shrinks what Phase 2 will inject.

**Disposition (decided):**

| Skill                     | Action                 | Reason                                                                             | Reassign                                                   |
| ------------------------- | ---------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `refactor-expert`         | **Delete**             | Duplicate of `refactoring`                                                         | `orchestrator` → drop (dispatch agent, not an implementer) |
| `test-generator`          | **Delete**             | Duplicate of `test-driven-development`                                             | `orchestrator` → drop                                      |
| `api-doc-sync`            | **Delete**             | Orphan — assigned to no active profile, 0 reads ever                               | —                                                          |
| `orchestration-playbooks` | **Conditional delete** | Orphan/0 reads; but may be referenced as a "collection entrypoint" by other skills | See Task 1.1                                               |

All other skills are KEPT (Phase 2 injects their content; Phase 3 fixes their descriptions).

### Task 1.1: Decide `orchestration-playbooks` fate

**Files:**

- Read-only investigation across `seed/skills/**` and `seed/agents/**`.

- [ ] **Step 1: Search for references to `orchestration-playbooks`**

Run:

```bash
grep -rn "orchestration-playbooks" seed/ apps/api/src/ packages/ docs/
```

- [ ] **Step 2: Apply the decision rule**

- If the ONLY hits are the skill's own directory (`seed/skills/orchestration-playbooks/`) and this plan file → treat it as an orphan and **add it to the delete list** in Task 1.2.
- If another skill's `SKILL.md` body or any `agent.json`/workflow references it by name → **keep it**, and remove it from this plan's deletions. Record the decision in the commit message.

- [ ] **Step 3: No commit** (investigation only; outcome feeds Task 1.2).

### Task 1.2: Delete redundant skill directories

**Files:**

- Delete: `seed/skills/refactor-expert/` (whole directory)
- Delete: `seed/skills/test-generator/` (whole directory)
- Delete: `seed/skills/api-doc-sync/` (whole directory)
- Delete (conditional, per Task 1.1): `seed/skills/orchestration-playbooks/`

- [ ] **Step 1: Confirm no profile still references the doomed skills**

Run:

```bash
grep -rn -E "refactor-expert|test-generator|api-doc-sync" seed/agents/
```

Expected: only matches are in `orchestrator/agent.json` (`refactor-expert`, `test-generator`). `api-doc-sync` should have zero matches. If any OTHER profile references them, note it and handle in Task 1.3.

- [ ] **Step 2: Delete the directories**

Run:

```bash
git rm -r seed/skills/refactor-expert seed/skills/test-generator seed/skills/api-doc-sync
# plus seed/skills/orchestration-playbooks ONLY if Task 1.1 decided delete
```

- [ ] **Step 3: Verify gone**

Run:

```bash
ls seed/skills | grep -E "refactor-expert|test-generator|api-doc-sync" || echo "DELETED"
```

Expected: `DELETED`

- [ ] **Step 4: Commit**

```bash
git add -A seed/skills
git commit -m "chore(skills): delete duplicate/orphan skills (refactor-expert, test-generator, api-doc-sync)"
```

### Task 1.3: Remove deleted skills from profile assignments

**Files:**

- Modify: `seed/agents/orchestrator/agent.json` (remove `test-generator`, `refactor-expert` from `assigned_skills`)
- Modify: any other `seed/agents/*/agent.json` flagged in Task 1.2 Step 1
- Modify (if it references any deleted skill): `seed/agents/skill-assignments.seed.json`

- [ ] **Step 1: Edit `orchestrator/agent.json`**

In `seed/agents/orchestrator/agent.json`, change the `assigned_skills` array from:

```json
  "assigned_skills": [
    "test-generator",
    "refactor-expert",
    "dependency-updater",
    "coding-standards",
    "task-progress-tracking"
  ],
```

to:

```json
  "assigned_skills": [
    "dependency-updater",
    "coding-standards",
    "task-progress-tracking"
  ],
```

- [ ] **Step 2: Reconcile `skill-assignments.seed.json`**

Run:

```bash
grep -nE "refactor-expert|test-generator|api-doc-sync|orchestration-playbooks" seed/agents/skill-assignments.seed.json
```

Remove any matched lines (preserving valid JSON). Note: this file also lists `ceo-agent` "skills" that are NOT library directories (`first-run`, `micro-planning`, `spec-generation`, …). Do NOT fix those here — record them as a finding for the Phase 4 follow-up (they are either playbook sub-entries or stale).

- [ ] **Step 3: Verify seed parses**

Run:

```bash
npm run validate:seed-data
```

Expected: PASS (7 tests).

- [ ] **Step 4: Verify no dangling references remain**

Run:

```bash
grep -rnE "refactor-expert|test-generator|api-doc-sync" seed/agents/ || echo "CLEAN"
```

Expected: `CLEAN`

- [ ] **Step 5: Commit**

```bash
git add seed/agents
git commit -m "chore(skills): drop assignments referencing deleted skills"
```

### Task 1.4: Add a contract test guarding assignment↔library integrity

Prevents future drift where a profile assigns a non-existent skill (the `ceo-agent` `skill-assignments.seed.json` bug shows this is real).

**Files:**

- Test: `apps/api/src/database/seeds/agent-profiles.seed.spec.ts` (add a new `it`)

- [ ] **Step 1: Write the failing test**

Add to `agent-profiles.seed.spec.ts`:

```typescript
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

it("every assigned skill resolves to a real seed/skills directory", () => {
  const service = new AgentProfilesFileSeedService();
  const skillsRoot = resolve(__dirname, "../../../../../../seed/skills");
  const { definitions } = service.loadDefinitions();

  const missing: string[] = [];
  for (const agent of definitions.filter((a) => a.is_active !== false)) {
    for (const skill of agent.assigned_skills ?? []) {
      if (!existsSync(join(skillsRoot, skill, "SKILL.md"))) {
        missing.push(`${agent.name} -> ${skill}`);
      }
    }
  }

  expect(missing).toEqual([]);
});
```

- [ ] **Step 2: Run it — expect PASS** (Phase 1.3 already removed the broken references)

Run:

```bash
npm run test --workspace=apps/api -- run "src/database/seeds/agent-profiles.seed.spec.ts" -t "resolves to a real seed/skills directory"
```

Expected: PASS. If it FAILS, the failure message lists the offending `profile -> skill`; fix the assignment in `seed/agents/<profile>/agent.json`, then re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/database/seeds/agent-profiles.seed.spec.ts
git commit -m "test(skills): guard assignments against missing skill directories"
```

---

## Phase 2 — Force-consumption engine (inject skill content into the prompt)

The core change. In `native` mode, render each assigned skill's full markdown body inline, bounded by a token budget; skills that don't fit are listed by name/description and remain mounted for on-demand reading.

### Task 2.1: Pure skill-content renderer

**Files:**

- Create: `apps/api/src/workflow/skill-content-injection.helpers.types.ts`
- Create: `apps/api/src/workflow/skill-content-injection.helpers.ts`
- Test: `apps/api/src/workflow/skill-content-injection.helpers.spec.ts`

**Interfaces:**

- Produces: `renderInjectedSkillContent(params: { skills: InjectableSkill[]; budgetTokens: number; countTokens?: (text: string) => number; }): string`, `interface InjectableSkill { name: string; description: string; skillMarkdown: string; }`, `const DEFAULT_SKILL_CONTENT_BUDGET_TOKENS = 6000`.

- [ ] **Step 1: Create the types file**

`skill-content-injection.helpers.types.ts`:

```typescript
export interface InjectableSkill {
  name: string;
  description: string;
  skillMarkdown: string;
}
```

- [ ] **Step 2: Write the failing test**

`skill-content-injection.helpers.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { renderInjectedSkillContent } from "./skill-content-injection.helpers";

const wordCount = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

describe("renderInjectedSkillContent", () => {
  it("returns empty string when no skills are assigned", () => {
    expect(renderInjectedSkillContent({ skills: [], budgetTokens: 100 })).toBe(
      "",
    );
  });

  it("inlines full skill bodies that fit within budget", () => {
    const out = renderInjectedSkillContent({
      skills: [
        {
          name: "debugging",
          description: "find bugs",
          skillMarkdown: "Step 1 isolate.",
        },
        {
          name: "tdd",
          description: "red green",
          skillMarkdown: "Write the test first.",
        },
      ],
      budgetTokens: 1000,
      countTokens: wordCount,
    });
    expect(out).toContain('<skill name="debugging">');
    expect(out).toContain("Step 1 isolate.");
    expect(out).toContain('<skill name="tdd">');
    expect(out).toContain("Write the test first.");
    expect(out).not.toContain("did not fit");
  });

  it("overflows skills that exceed the remaining budget to a name/description list", () => {
    const out = renderInjectedSkillContent({
      skills: [
        { name: "small", description: "d1", skillMarkdown: "tiny body" },
        { name: "huge", description: "d2", skillMarkdown: "word ".repeat(500) },
      ],
      budgetTokens: 5,
      countTokens: wordCount,
    });
    expect(out).toContain('<skill name="small">');
    expect(out).not.toContain('<skill name="huge">');
    expect(out).toContain("- huge — d2");
  });

  it("preserves assignment order in the inlined blocks", () => {
    const out = renderInjectedSkillContent({
      skills: [
        { name: "a", description: "da", skillMarkdown: "A" },
        { name: "b", description: "db", skillMarkdown: "B" },
      ],
      budgetTokens: 1000,
      countTokens: wordCount,
    });
    expect(out.indexOf('name="a"')).toBeLessThan(out.indexOf('name="b"'));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
npm run test --workspace=apps/api -- run "src/workflow/skill-content-injection.helpers.spec.ts"
```

Expected: FAIL — "renderInjectedSkillContent is not a function" / module not found.

- [ ] **Step 4: Implement the helper**

`skill-content-injection.helpers.ts`:

```typescript
import type { InjectableSkill } from "./skill-content-injection.helpers.types";

export const DEFAULT_SKILL_CONTENT_BUDGET_TOKENS = 6000;

const INJECT_HEADER =
  "Assigned skills — full instructions are included inline below. Apply them directly; you do not need to open any file to use a skill shown here.";
const OVERFLOW_HEADER =
  "These additional assigned skills did not fit inline and are mounted on disk — read their SKILL.md when a task calls for them:";

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * Render assigned skills as inline `<skill>` blocks containing their full
 * markdown body, greedily filling a token budget in assignment order. Skills
 * whose block would exceed the remaining budget are listed by name/description
 * instead (they remain available via the on-disk mount). Returns '' when no
 * skills are assigned.
 */
export function renderInjectedSkillContent(params: {
  skills: InjectableSkill[];
  budgetTokens: number;
  countTokens?: (text: string) => number;
}): string {
  const skills = params.skills ?? [];
  if (skills.length === 0) {
    return "";
  }

  const count = params.countTokens ?? estimateTokens;
  const blocks: string[] = [];
  const overflow: InjectableSkill[] = [];
  let used = 0;

  for (const skill of skills) {
    const block = `<skill name="${skill.name}">\n${skill.skillMarkdown.trim()}\n</skill>`;
    const cost = count(block);
    if (used + cost <= params.budgetTokens) {
      blocks.push(block);
      used += cost;
    } else {
      overflow.push(skill);
    }
  }

  const sections: string[] = [];
  if (blocks.length > 0) {
    sections.push([INJECT_HEADER, ...blocks].join("\n\n"));
  }
  if (overflow.length > 0) {
    const lines = overflow.map((s) => `- ${s.name} — ${s.description}`);
    sections.push([OVERFLOW_HEADER, ...lines].join("\n"));
  }
  return sections.join("\n\n");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npm run test --workspace=apps/api -- run "src/workflow/skill-content-injection.helpers.spec.ts"
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workflow/skill-content-injection.helpers.ts apps/api/src/workflow/skill-content-injection.helpers.types.ts apps/api/src/workflow/skill-content-injection.helpers.spec.ts
git commit -m "feat(skills): pure helper to render assigned-skill content inline within a token budget"
```

### Task 2.2: Wire injection into the step-agent prompt path

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts` (`buildAgentSystemPrompt`, ~lines 339-397; the `isHarnessAgent` block at 385-397)
- Test: `apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts` (existing `describe('buildStepRunnerConfigPayloadCore skill guidance', …)`)

**Interfaces:**

- Consumes: `renderInjectedSkillContent`, `DEFAULT_SKILL_CONTENT_BUDGET_TOKENS` (Task 2.1); `params.assignedSkills: SkillLibraryRecord[]` (already carries `skillMarkdown`); `params.skillDiscoveryMode`, `params.harnessId`.

- [ ] **Step 1: Update the failing test for the harness case**

In `step-agent-step-executor.helpers.spec.ts`, the test `omits skill catalog completely when harness is pi or claude-code` encodes the OLD behavior. Replace its assertions so that, in `native` mode with assigned skills carrying `skillMarkdown`, the prompt now CONTAINS the injected body. Set the test's assigned skills to include `skillMarkdown` (e.g. `{ id: 'debugging', name: 'debugging', description: 'find bugs', skillMarkdown: 'Systematic isolation steps.' }`) and a `pi` harness, then:

```typescript
expect(prompt).toContain('<skill name="debugging">');
expect(prompt).toContain("Systematic isolation steps.");
expect(prompt).not.toContain("read_skill_manifest");
```

Rename the test to `injects assigned skill content inline for pi/claude-code in native mode`.

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npm run test --workspace=apps/api -- run "src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts" -t "injects assigned skill content inline"
```

Expected: FAIL — prompt does not contain `<skill name="debugging">` (current code suppresses for `pi`).

- [ ] **Step 3: Add the import**

At the top of `step-agent-step-executor.helpers.ts`, add:

```typescript
import {
  renderInjectedSkillContent,
  DEFAULT_SKILL_CONTENT_BUDGET_TOKENS,
} from "../skill-content-injection.helpers";
```

- [ ] **Step 4: Replace the skill-section block**

Replace the existing block (the `const isHarnessAgent = …;` through the end of the `const skillSection = …;` assignment, ~lines 385-397) with:

```typescript
const skillDiscoveryMode =
  params.skillDiscoveryMode ?? DEFAULT_SKILL_DISCOVERY_MODE;
const isHarnessAgent =
  params.harnessId === "pi" || params.harnessId === "claude-code";

const skillSection =
  skillDiscoveryMode === "native"
    ? renderInjectedSkillContent({
        skills: (params.assignedSkills ?? []).map((s) => ({
          name: s.name,
          description: s.description,
          skillMarkdown: s.skillMarkdown,
        })),
        budgetTokens: resolveSkillContentBudgetTokens(),
      })
    : isHarnessAgent
      ? ""
      : renderSkillSection({
          mode: skillDiscoveryMode,
          assignedSkills: params.assignedSkills?.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
          })),
          availableCategories: params.availableCategories,
        });
```

- [ ] **Step 5: Add the budget resolver helper**

Add near the top of `step-agent-step-executor.helpers.ts` (module scope):

```typescript
function resolveSkillContentBudgetTokens(): number {
  const raw = process.env.SKILL_CONTENT_BUDGET_TOKENS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SKILL_CONTENT_BUDGET_TOKENS;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run:

```bash
npm run test --workspace=apps/api -- run "src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts"
```

Expected: PASS (update any sibling assertions in the same describe that referenced `read_skill_manifest` / names-only rendering for native mode).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.spec.ts
git commit -m "feat(skills): inject assigned-skill content into step-agent system prompt (native mode)"
```

### Task 2.3: Thread full skill bodies through the subagent prompt path

The subagent path strips skills to `{ name, description }` before prompt assembly. Carry `skillMarkdown` through and inject it the same way.

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts` (`SubagentConfigParams.assignedSkills` type ~lines 32-45; `buildSubagentSystemPrompt` ~lines 132-159; the call site that builds `SubagentConfigParams` from `resolveSubagentAssignedSkills`'s `SkillLibraryRecord[]`)
- Test: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.skills.spec.ts`

**Interfaces:**

- Consumes: `renderInjectedSkillContent`, `DEFAULT_SKILL_CONTENT_BUDGET_TOKENS`; `resolveSubagentAssignedSkills(...) : Promise<SkillLibraryRecord[]>` (already returns full records).

- [ ] **Step 1: Write the failing test**

In `subagent-orchestrator.container-config.skills.spec.ts`, add a test asserting `buildSubagentSystemPrompt` injects content for a `pi` subagent in native mode:

```typescript
it("injects full skill content into subagent prompt in native mode", () => {
  const prompt = buildSubagentSystemPrompt(
    /* context */ {} as never,
    {
      assignedSkills: [
        {
          name: "coding-standards",
          description: "SOLID",
          skillMarkdown: "Apply SOLID and DRY.",
        },
      ],
    } as never,
    "BASE",
    "native",
    "pi",
  );
  expect(prompt).toContain('<skill name="coding-standards">');
  expect(prompt).toContain("Apply SOLID and DRY.");
});
```

(Export `buildSubagentSystemPrompt` if it is not already exported.)

- [ ] **Step 2: Run it to verify it fails**

Run:

```bash
npm run test --workspace=apps/api -- run "src/workflow/workflow-subagents/subagent-orchestrator.container-config.skills.spec.ts" -t "injects full skill content"
```

Expected: FAIL (current code returns `baseSystemPrompt` for `pi`).

- [ ] **Step 3: Widen the `assignedSkills` type**

In `SubagentConfigParams`, change:

```typescript
  assignedSkills?: Array<{ name: string; description: string }>;
```

to:

```typescript
  assignedSkills?: Array<{ name: string; description: string; skillMarkdown: string }>;
```

- [ ] **Step 4: Inject in `buildSubagentSystemPrompt`**

Add the import:

```typescript
import {
  renderInjectedSkillContent,
  DEFAULT_SKILL_CONTENT_BUDGET_TOKENS,
} from "../skill-content-injection.helpers";
```

Replace the harness suppression + render block (lines ~139-159) with:

```typescript
if (skillDiscoveryMode === "native") {
  const injected = renderInjectedSkillContent({
    skills: (params.assignedSkills ?? []).map((s) => ({
      name: s.name,
      description: s.description,
      skillMarkdown: s.skillMarkdown,
    })),
    budgetTokens: DEFAULT_SKILL_CONTENT_BUDGET_TOKENS,
  });
  return injected ? `${baseSystemPrompt}\n\n${injected}` : baseSystemPrompt;
}

if (harnessId === "pi" || harnessId === "claude-code") {
  return baseSystemPrompt;
}

const skillSection = renderSkillSection({
  mode: skillDiscoveryMode,
  assignedSkills: params.assignedSkills,
  availableCategories,
});
return skillSection
  ? `${baseSystemPrompt}\n\n${skillSection}`
  : baseSystemPrompt;
```

- [ ] **Step 5: Stop stripping `skillMarkdown` at the call site**

Find where `SubagentConfigParams.assignedSkills` is populated from `resolveSubagentAssignedSkills(...)` (a `SkillLibraryRecord[]`). Change the mapping from `{ name, description }` to `{ name, description, skillMarkdown }`.

- [ ] **Step 6: Run the test to verify it passes**

Run:

```bash
npm run test --workspace=apps/api -- run "src/workflow/workflow-subagents/subagent-orchestrator.container-config.skills.spec.ts"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.skills.spec.ts
git commit -m "feat(skills): inject assigned-skill content into subagent system prompt (native mode)"
```

### Task 2.4: Full regression + lint for the engine change

**Files:** none (verification only)

- [ ] **Step 1: Run the skill/prompt/seed spec batch**

Run:

```bash
npm run test --workspace=apps/api -- run "skill-content-injection.helpers.spec.ts" "skill-catalog-prompt.helpers.spec.ts" "step-agent-step-executor.helpers.spec.ts" "subagent-orchestrator.container-config.skills.spec.ts" "workflows.seed.contract.spec.ts" "agent-profiles.seed.spec.ts" "seed-workflows.dry-run.spec.ts"
```

Expected: all PASS. Fix any sibling assertions still expecting names-only/`read_skill_manifest` rendering in native mode.

- [ ] **Step 2: Lint changed files**

Run:

```bash
npx eslint apps/api/src/workflow/skill-content-injection.helpers.ts apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts
```

Expected: no output.

- [ ] **Step 3: Build the API**

Run:

```bash
npm run build:api
```

Expected: success.

- [ ] **Step 4: Commit any fixups**

```bash
git add -A
git commit -m "test(skills): align skill prompt specs with inline content injection"
```

---

## Phase 3 — Trigger-quality descriptions

For native mode the body is now injected, but the frontmatter `description` still drives the harness `<available_skills>` names block and the overflow list. Rewrite trigger-less descriptions to state an explicit "Use when …" condition. One commit; small mechanical edits to `seed/skills/<name>/SKILL.md` frontmatter.

### Task 3.1: Rewrite trigger-less skill descriptions

**Files (each: the `description:` line in `seed/skills/<name>/SKILL.md` frontmatter):**

- [ ] **Step 1: Apply these exact descriptions**

| Skill                           | New `description`                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| decision-records                | `Capture architecture and orchestration decisions as durable ADR-style records. Use when a significant or hard-to-reverse technical/orchestration choice is made.` |
| project-analysis                | `Analyze project state, constraints, and execution readiness. Use before making an orchestration or dispatch decision.`                                            |
| orchestrator-steering           | `Guide conversational project steering via structured plan presentation and approval gates. Use when steering a project through a chat/CEO conversation.`          |
| implementation-planning         | `Turn an approved design into a sequenced implementation plan. Use when a design is approved and work must be broken into ordered, validated milestones.`          |
| prd-authoring                   | `Write a comprehensive PRD from analysis and requirements. Use when producing a PRD document during ingestion or product definition.`                              |
| sdd-authoring                   | `Write a Solution Design Document from a PRD and analysis. Use when translating an approved PRD into architecture, data models, and APIs.`                         |
| architecture-design             | `Design a scalable system architecture from requirements. Use when selecting components, interfaces, and technologies for a new system or major change.`           |
| architecture-review             | `Review an architecture proposal for correctness, risk, and maintainability. Use when evaluating a design or architecture update before approval.`                 |
| requirement-elicitation         | `Extract and structure functional/non-functional requirements. Use when turning documents, designs, or analysis into a structured requirement set.`                |
| document-parsing                | `Parse and extract structured information from PDFs, Word, markdown, and text. Use when ingesting source documents that need clean structured output.`             |
| qa-regression-check             | `Regression-focused QA checklist for workflow and API changes. Use when verifying a change for regressions before sign-off.`                                       |
| dependency-updater              | `Upgrade dependencies safely with risk-tiered validation and rollback. Use when bumping or auditing third-party dependencies.`                                     |
| capability-persistence-playbook | `Persist reusable instructions, scripts, and tool definitions across sessions. Use when a reusable capability should outlive the current run.`                     |
| searxng-web-search              | `Search the web via a self-hosted SearXNG instance. Use when a task needs current external information not in the workspace.`                                      |
| work-item-generation            | `Generate structured work items (epics, stories, tasks) from PRDs/designs. Use when converting product docs into a groomed backlog.`                               |

(Skills already carrying a usable "Use when/for" clause — `api-design`, `code-review`, `coding-standards`, `debugging`, `refactoring`, `test-driven-development`, `prd-to-issues`, `write-a-prd`, `software-architect`, `ux-evaluation`, `visual-analysis`, `workflow-schema-explainer`, `task-progress-tracking`, `git-commit-enforcement` — are left unchanged.)

- [ ] **Step 2: Verify each file still has valid frontmatter**

Run:

```bash
npm run validate:seed-data
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add seed/skills
git commit -m "docs(skills): add explicit 'Use when' triggers to skill descriptions"
```

---

## Phase 4 — Diagnostic: the June-8 read cliff (investigation, no code)

`project-analysis` (426 reads) and `orchestrator-steering` (206 reads) stop dead at 2026-06-08 while `orchestration-patterns` continued. Determine whether this is a workflow/profile change or a side effect of the harness drift, so we know whether Phase 2 fully restores their use.

### Task 4.1: Trace what changed around 2026-06-08

**Files:** read-only (DB + git history).

- [ ] **Step 1: Confirm the read timeline per skill**

Run:

```bash
docker exec nexus-postgres psql -U nexus nexus_orchestrator -c "SELECT date_trunc('day', occurred_at) d, count(*) FROM event_ledger WHERE domain='tool' AND tool_name='read' AND payload->'args'->>'path' LIKE '%/skills/project-analysis/SKILL.md' GROUP BY 1 ORDER BY 1;"
```

- [ ] **Step 2: Check whether the CEO workflow's skill assignments or steps changed around then**

Run:

```bash
git log --since=2026-06-01 --until=2026-06-12 --oneline -- seed/agents/ceo-agent seed/workflows/project-orchestration-cycle-ceo.workflow.yaml seed/agents/skill-assignments.seed.json
```

- [ ] **Step 3: Record findings + the `ceo-agent` `skill-assignments.seed.json` non-existent-skill list (from Task 1.3 Step 2)**

Write a short findings note to `docs/analysis/2026-06-23-skill-read-cliff.md` capturing: whether the cliff is a workflow change vs harness drift, and whether the 14-entry `ceo-agent` assignment list contains skills that don't exist in the library (and should be cleaned or mapped to playbook entries).

- [ ] **Step 4: Commit the findings note**

```bash
git add docs/analysis/2026-06-23-skill-read-cliff.md
git commit -m "docs(analysis): diagnose the 2026-06-08 skill read cliff"
```

---

## Phase 5 — Docs

### Task 5.1: Update the skills architecture doc

**Files:**

- Modify: `docs/architecture/agent-skills.md` (Skill Discovery Mode section)

- [ ] **Step 1: Document the injection behavior**

Update the `native` mode description to state that, for all harnesses, assigned-skill **content** is now injected inline into the system prompt (token-bounded by `SKILL_CONTENT_BUDGET_TOKENS`, default `6000`), with overflow skills listed by name/description and available via the on-disk mount. Note that `read_skill_manifest`/`search_skills` are no longer the discovery path in native mode. Keep the `search`-mode description unchanged.

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/agent-skills.md
git commit -m "docs(skills): document inline skill-content injection for native mode"
```

---

## Follow-up (separate effort, not in this plan)

**Per-skill body trimming.** With Phase 2 injecting bodies into every prompt, each kept skill's `SKILL.md` body becomes a recurring token cost. A separate content pass should trim every injected skill to high-signal, Nexus-specific guidance (remove generic boilerplate the model already knows; keep concrete repo commands, conventions, gotchas, examples). Criteria: a skill body earns its tokens only if it tells the agent something it would not already do correctly. Measure prompt-size impact per profile after Phase 2 and prioritize the most-assigned skills (`coding-standards` → 10 profiles, `task-progress-tracking` → 8). Also resolve the `ceo-agent` `skill-assignments.seed.json` entries that name non-existent skills (Task 4.1 finding).

---

## Self-Review

- **Spec coverage:** Phase 1 = delete redundant (Q2: delete) + fix assignments; Phase 2 = force consumption (Q1); Phase 3 = descriptions; Phase 4 = Jun-8 cliff diagnostic; Phase 5 = docs. Over-assignment trimming + body trimming are explicitly deferred to the Follow-up (they require content judgment and post-injection size measurement). All issues from the analysis are either addressed or explicitly deferred with rationale.
- **Placeholder scan:** All code steps contain full code; all descriptions are verbatim; deletion lists and file paths are exact. The two investigation tasks (1.1, 4.1) are conditional-with-commands, not placeholders.
- **Type consistency:** `InjectableSkill { name; description; skillMarkdown }` is defined in Task 2.1 and consumed identically in 2.2 and 2.3; `renderInjectedSkillContent` signature and `DEFAULT_SKILL_CONTENT_BUDGET_TOKENS` are used consistently across tasks; `SubagentConfigParams.assignedSkills` is widened to include `skillMarkdown` before it is read.
