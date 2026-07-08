# Skill Discovery Mode — Design

**Date:** 2026-06-13
**Status:** Approved (ready for implementation plan)

## Problem

Today, assigned skills are never exposed to an agent the "normal" way. Even when a
profile has `assigned_skills`, the agent's system prompt only receives
`SKILL_DISCOVERY_GUIDANCE` ("use `search_skills` to find relevant guidance…") plus a
bare "available categories" line. The skills are **not** listed by name, and the only
real discovery path is the `search_skills` / `read_skill_manifest` internal tools —
API callbacks back to the Nexus host that query the host skill library.

(The skill files mounted into the container at `/root/.pi/agent/skills/` with a
`skill-catalog.json` are **not** read by any harness engine. The PI engine's
`DefaultResourceLoader` only sees `cwd=/workspace` and `agentDir=/opt/harness-runtime/agent`;
the Claude Code engine receives a pre-governed tool catalog from the kernel. The mount is
effectively dead for discovery. No filesystem-native discovery exists today.)

> **Follow-up (2026-06-19):** filesystem-native discovery for `pi`/`claude-code`
> was subsequently enabled by aligning the mount target with the directory each
> harness already scans (`PI_CAPABILITIES.skillsContainerPath` →
> `${CONTAINER_AGENT_DIR}/skills`; claude-code already used `/root/.claude/skills`
> = `~/.claude/skills`). The harness now enumerates the mount and injects the
> assigned skills into the system prompt itself, and the per-harness Nexus skill
> section is suppressed for `pi`/`claude-code` to avoid a duplicate listing. See
> `docs/plans/2026-06-19-pi-harness-skill-autodetection.md`.

We want the **default** behavior to expose assigned skills directly (the "normal" way),
while keeping the ability to opt back into today's search-only behavior **per agent,
per step, or per workflow**.

## Solution Overview

Introduce a `skill_discovery_mode` setting with two values:

- **`native`** (new default): list the agent's assigned skills as a visible catalog in
  the system prompt (`name — description`, plus the skill id and a one-line instruction
  to load full content via `read_skill_manifest`). The agent is **assigned-only**: the
  `search_skills` tool is suppressed, so it cannot reach unassigned skills.
- **`search`** (opt-in, = today's behavior): emit `SKILL_DISCOVERY_GUIDANCE` + the
  available-categories line; do **not** list assigned skills; keep `search_skills`
  available so the agent can discover any active skill.

`read_skill_manifest` remains available in **both** modes (native needs it to load the
full content of a listed skill; search needs it to load a searched skill).

This is deliberately a **prompt-assembly + tool-gating** change. It does **not**
introduce filesystem-native harness discovery (`.claude/skills/`, settings.json, plugin
manifests), does not change the existing skill mount, and does not add a third "both"
mode. (YAGNI.)

## Configuration Model

New shared type in `@nexus/core`:

```ts
export type SkillDiscoveryMode = "native" | "search";
export const DEFAULT_SKILL_DISCOVERY_MODE: SkillDiscoveryMode = "native";
```

Settable at three levels, each as an **optional** field (absence = inherit / fall through):

| Level         | Type / location                                                                                 | Storage                                     |
| ------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Agent profile | `IAgentProfile.skill_discovery_mode?` (`agent-profile.types.ts`) + `AgentProfile` entity column | DB column (migration)                       |
| Workflow      | `IWorkflowDefinition.skill_discovery_mode?` (`workflow-legacy.types.ts`)                        | Parsed from workflow YAML (top-level field) |
| Job step      | `IJobStep.skill_discovery_mode?` (`workflow-legacy.types.ts`)                                   | Parsed from workflow YAML (per-step field)  |

### Precedence

First-defined-wins cascade, matching the existing model/provider/tool override ordering:

```
step → workflow → agent profile → DEFAULT_SKILL_DISCOVERY_MODE ("native")
```

i.e. a step's explicit value overrides the workflow's, which overrides the agent
profile's; if none is set, the mode is `native`.

### Resolver

One pure, independently-testable helper (no I/O):

```ts
function resolveSkillDiscoveryMode(inputs: {
  step?: SkillDiscoveryMode | null;
  workflow?: SkillDiscoveryMode | null;
  agentProfile?: SkillDiscoveryMode | null;
}): SkillDiscoveryMode;
```

Returns the first defined value in step → workflow → agentProfile order, else
`DEFAULT_SKILL_DISCOVERY_MODE`. This is the single source of truth for the cascade and is
consumed by both the prompt builders and the tool-set assembly.

## Behavioral Differences

|                            | `native` (default)                                                                                     | `search` (today's behavior)        |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| Assigned skills in prompt  | Listed: `name — description` (+ id) with a one-line "load full instructions via `read_skill_manifest`" | **Not** listed                     |
| Discovery guidance text    | Omitted                                                                                                | `SKILL_DISCOVERY_GUIDANCE` emitted |
| Available-categories line  | Omitted (the agent already sees its full assigned set)                                                 | Emitted                            |
| `search_skills` tool       | **Suppressed**                                                                                         | Available                          |
| `read_skill_manifest` tool | Available                                                                                              | Available                          |

When no skills are assigned, neither mode emits a skill section (nothing to list,
nothing to search), exactly as today.

## Touch Points

1. **Core types** (`packages/core`):
   - Add `SkillDiscoveryMode` + `DEFAULT_SKILL_DISCOVERY_MODE`.
   - Add optional `skill_discovery_mode` to `IAgentProfile`, `IWorkflowDefinition`,
     `IJobStep`.
   - Add the `resolveSkillDiscoveryMode` resolver (core util) with unit tests.

2. **Agent profile persistence** (`apps/api/src/ai-config`):
   - New nullable column on the `AgentProfile` entity + TypeORM migration
     (per `adding-entity-migration` conventions).
   - Surface the field through the agent-profile read path so the resolver can read it
     (and through create/update DTOs if profiles are authored via API/seed).

3. **Workflow YAML schema** (`workflow-yaml-authoring`):
   - Allow `skill_discovery_mode` at workflow root and per job-step in the Zod schema,
     validated against `"native" | "search"`. Parse into `IWorkflowDefinition` /
     `IJobStep`.

4. **Prompt assembly** (both agent execution paths):
   - `step-agent-step-executor.helpers.ts → appendSkillCatalogToPrompt`
   - `subagent-orchestrator.skills.helpers.ts → appendSkillCatalogToSystemPrompt`
   - Both take the resolved mode and branch: render the assigned-skill catalog
     (`native`) vs. the existing guidance + categories (`search`).

5. **Tool-set gating** (`search_skills` suppression in `native`):
   - Thread the resolved mode into the place where `search_skills` enters the callable
     tool set for a step and for a subagent, and drop it when mode is `native`.
     `read_skill_manifest` is never gated.

6. **Mode plumbing**:
   - Read the three optional values (step from `IJobStep`, workflow from the workflow
     definition, agent profile from the profile record) at both the step-agent and
     subagent assembly points and feed them through `resolveSkillDiscoveryMode`.

## Testing Strategy (TDD)

- **Resolver unit tests**: every precedence combination — each level set alone, all
  combinations of two, all three set, none set (→ `native`), and that `step` beats
  `workflow` beats `agentProfile`.
- **Prompt-builder tests** (both helpers): `native` lists assigned skills and omits the
  search guidance; `search` emits guidance + categories and omits the list; no skills
  assigned → no section in either mode.
- **Tool-gating tests**: `native` removes `search_skills` from the resolved tool set;
  `search` keeps it; `read_skill_manifest` present in both.
- **YAML schema tests**: valid values parse at workflow + step level; invalid value
  rejected; absence parses as undefined (inherits).
- **Migration test / agent-profile round-trip**: column persists and reads back; default
  (null) resolves to `native` via the resolver.
- Update the existing `step-agent-step-executor.helpers.spec.ts` and the search-skills
  tool/discovery specs that assert the current always-search behavior.

## Risks / Notes

- **Default flip is a behavior change**: existing deployments that relied on search-only
  exposure will now see assigned skills listed and `search_skills` suppressed for agents
  with assigned skills. Profiles/workflows that need the old behavior set
  `skill_discovery_mode: search`. Call this out in operator docs / changelog.
- **Suppressing `search_skills` in native mode** is the one place mode affects the tool
  set (not just prompt text); ensure it is gated at a single, well-tested choke point to
  avoid drift between the step and subagent paths.
- Keep the rendered catalog deterministic (stable ordering) so prompt snapshots/tests
  are stable.
