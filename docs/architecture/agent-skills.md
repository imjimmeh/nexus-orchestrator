# Agent Skills Architecture

## Scope

This document describes the agent skills lifecycle and runtime synchronization model for EPIC-057, including filesystem-backed skills and runtime skill mounts.

## Storage Model

Skill content is filesystem-native.

- Skills library root is configured by `NEXUS_SKILLS_LIBRARY_PATH`.
- In docker compose, the API mounts `NEXUS_HOST_SKILLS_PATH` to `/data/nexus-skills`.
- Each skill uses directory layout:
  - `/data/nexus-skills/<skill-name>/SKILL.md`
  - `/data/nexus-skills/<skill-name>/<optional references/scripts/assets/...>`

Database persistence is limited to profile assignment state.

- Agent profiles store assigned skill names in `assigned_skills`.
- Skill records are not source-of-truth database rows.

## Identity and Authoring Contract

The canonical skill identifier is `<skill-name>`.

A skill stores full `SKILL.md` content with YAML frontmatter.

Validation expectations:

1. Frontmatter must be valid YAML object.
2. name and description must be present.
3. Frontmatter `name` must match directory name `<skill-name>`.
4. Name must follow lowercase kebab-case (`[a-z0-9-]` with no leading/trailing hyphens).
5. Resource file paths must be relative and cannot escape the skill root.

## EPIC-070 Skill Template Contract

EPIC-070 introduces a standardized skill authoring template at:

- `docs/templates/skill-template.md`

Required frontmatter fields:

1. `name`
2. `description`
3. `metadata.version` (semver)
4. `metadata.prerequisites` (array of skill names)
5. `metadata.tier` (`light` or `heavy`)
6. `metadata.estimated_duration`

Required sections in SKILL.md body:

1. `Overview`
2. `Prerequisites`
3. `Instructions`
4. `Output Format`

Recommended sections:

1. `Decision Points`
2. `Examples`
3. `Common Pitfalls`

## EPIC-066 Specialized Skill Contract

EPIC-066 skills follow a shared authoring contract and template at:

- `seed/skills/EPIC-066-SKILL-TEMPLATE.md`

Each EPIC-066 skill must include explicit sections for:

1. When to activate.
2. Required context and inputs.
3. Execution guidance.
4. Safety constraints.
5. Output expectations.
6. Language-agnostic discovery order.

Language-agnostic discovery order is fixed:

1. Project config and scripts first.
2. Lockfiles/workspace metadata second.
3. Command probing third (only when config is missing or ambiguous).

## API Surface

Skill CRUD:

- GET /ai-config/skills
- GET /ai-config/skills/:id
- POST /ai-config/skills
- PATCH /ai-config/skills/:id
- DELETE /ai-config/skills/:id

Skill files:

- GET /ai-config/skills/:id/files
- PUT /ai-config/skills/:id/files
- DELETE /ai-config/skills/:id/files?path=<relative-path>

Workflow-runtime skill lifecycle (agent callable):

- POST /workflow-runtime/skills
- PATCH /workflow-runtime/skills/:id
- POST /workflow-runtime/skills/:id/files/list
- PUT /workflow-runtime/skills/:id/files
- DELETE /workflow-runtime/skills/:id/files
- PUT /workflow-runtime/profiles/:id/skills

Profile assignment:

- GET /ai-config/agent-profiles/:id/skills
- PUT /ai-config/agent-profiles/:id/skills

## Runtime Sync

At execution/subagent container provisioning time:

1. Assigned skills are resolved from profile assignment.
2. Assigned skill directories are copied into an execution-scoped host mount directory.
3. Skills are mounted read-only at `/root/.pi/agent/skills` in the container.
4. A skill catalog is emitted for prompt context, including `SKILL.md` paths and discovered resource file paths.
5. Prompt guidance instructs agents to read `SKILL.md` first, then resolve referenced files relative to `/root/.pi/agent/skills/<skill-name>/`.

## Hybrid Authoring Mounts

EPIC-101 adds a second governed surface alongside the assigned-skill snapshot:

1. `/root/.pi/agent/skills` remains the read-only execution snapshot derived from profile assignment.
2. Persistent skill-library authoring uses the host-mount governance system and typically mounts alias `skills_library` under `/workspace/host-shares/skills_library`.
3. The `skills_library` alias should point at the same root as `NEXUS_SKILLS_LIBRARY_PATH`.
4. In nested Docker environments, the API container must also receive `NEXUS_HOST_SKILLS_PATH` so bind sources under `/data/nexus-skills` can be remapped back to the real host path during runner provisioning.
5. `mode: ro` is appropriate for reading/reference workflows; `mode: rw` is reserved for explicitly approved authoring flows.

## Skill Dependency Resolution

Startup assignment resolution includes prerequisite expansion:

1. Assigned profile skills are normalized.
2. Prerequisite chains from `metadata.prerequisites` are resolved recursively.
3. Circular prerequisite references fail fast.
4. Effective skills include prerequisites first, followed by directly assigned skills.

This behavior is implemented by `SkillDependencyResolverService` and consumed by profile skill assignment resolution.

## Stage-Specific Skill Policy

Runtime skill selection now supports profile-plus-stage resolution.

Primary behavior:

1. Resolve base profile skills from `assigned_skills`.
2. Resolve lifecycle stage from orchestration/work-item context.
3. Evaluate optional system setting `workflow_stage_skill_policy`.
4. Apply stage policy include/exclude rules.
5. Fallback to profile-only skills when policy is missing.

Policy model:

- System setting key: `workflow_stage_skill_policy`
- Value: JSON object keyed by lifecycle stage (`discovery`, `decomposition`, `implementation`, `review`, `merge`, `post_merge`, `import_assessment`, `import_ready`)
- Stage values: object keyed by agent profile (`ceo-agent`, `architect-agent`, `*`)
- Profile rule fields:
  - `include_skills: string[]`
  - `exclude_skills: string[]`
  - `fallback_to_profile_skills: boolean` (default true)

EPIC-066 default policy intent:

1. Discovery/decomposition stages avoid implementation-only skills (`test-driven-development`, `refactoring`, `dependency-updater`) for CEO orchestration.
2. Implementation/review stages include EPIC-066 specialist skills on implementation and QA profiles.
3. Merge/post-merge stages bias toward `dependency-updater`.

Diagnostics:

Run diagnostics expose:

1. `stage_skill_diagnostics.current_stage`
2. `stage_skill_diagnostics.profile`
3. `stage_skill_diagnostics.included_skills`
4. `stage_skill_diagnostics.excluded_skills`
5. `stage_skill_diagnostics.policy_source`
6. `stage_skill_diagnostics.effective_skills`
7. `stage_skill_diagnostics.missing_or_invalid_policy`

Startup/seed behavior now fails fast on unknown configured skill references to avoid silent profile drift.

EPIC-070 validation behavior:

1. Skill markdown is validated during seed import by `SkillValidationService`.
2. Missing required frontmatter/structure emits warnings by default.
3. Setting `STRICT_SKILL_VALIDATION=true` upgrades structural issues to startup failures.
4. Agent profile seed loading validates `assigned_skills` against known seeded skills.
5. Profiles without assigned skills emit explicit warnings to promote adoption.

## UI Integration

Primary route:

- /agent-skills

Capabilities:

1. Create/edit/delete skills.
2. Activate/deactivate skills.
3. Assign active skills to agent profiles.
4. Create/update/delete skill reference files.
5. Upload files via picker or drag-and-drop.

## Security and Governance Notes

1. Skill markdown is privileged execution guidance and should follow review standards.
2. Assignment changes should be auditable through normal API/auth controls.
3. Inactive skills should not be assignable for new profile assignments.
4. File path validation must prevent absolute paths and path traversal.
5. Workflow-runtime skill mutations must pass capability preflight and emit audited lifecycle outcomes.

## EPIC-128 Orchestrator Steering Skill

The `orchestrator-steering` skill governs how the CEO agent handles conversational project steering.

- **Location**: `seed/skills/orchestrator-steering/SKILL.md`
- **Assigned to**: `ceo-agent`
- **Trigger**: When CEO receives a steering request in a steering session

Key guidelines:

1. Always present plans for approval before execution.
2. Use V2 generic primitives (`amend_entity`, `invoke_agent_workflow`, `kanban.publish_specs`) for execution.
3. Handle artifact changes via worktree → edit → `kanban.publish_specs` canonical path.
4. Validate proposed changes align with V2 generic primitives (no bespoke mutation calls).
5. Maintain steering context across chat turns.

## Skill Discovery Mode

The `skill_discovery_mode` setting controls how assigned skills reach an agent. Two values are supported:

- **`native`** (default): The agent is scoped to its assigned set and the `search_skills` tool is suppressed. Nexus injects each assigned skill's **full SKILL.md content** inline into the system prompt — no file read is required. Skills are inlined greedily in assignment order up to a token budget controlled by `SKILL_CONTENT_BUDGET_TOKENS` (default `6000`). Any skills that would exceed the budget are listed by name and description only; their full content remains available via the on-disk mount at `/root/.pi/agent/skills/<skill-name>/SKILL.md`. This behavior is uniform across all harnesses — `read_skill_manifest` and `search_skills` are **not** part of the native discovery path.
- **`search`**: Skills are not listed. The agent uses `search_skills` to discover any active skill (the legacy behavior).

The mode is resolved at runtime from the most-specific setting available, in this precedence order: **step → workflow → agent profile → default (`native`)**.

### Setting the mode

| Level         | How to set                                                                         |
| ------------- | ---------------------------------------------------------------------------------- |
| Agent profile | `skill_discovery_mode` column on the `agent_profiles` table (via API or seed data) |
| Workflow      | `skill_discovery_mode:` top-level field in the workflow YAML                       |
| Job step      | `skill_discovery_mode:` field on an individual step in the workflow YAML           |

### Operator note — behavior change

Previously, all agents used search-only skill discovery (`search` mode): assigned skills were never listed in-prompt and `search_skills` was always available. The default is now **`native`**, which changes two things for agents that have assigned skills:

1. Assigned skill content is injected inline into the system prompt — the agent sees the full SKILL.md body (up to the token budget) without reading any file or calling any tool.
2. The `search_skills` tool is suppressed — the agent cannot reach skills outside its assigned set.

**To retain the previous behavior**, set `skill_discovery_mode: search` at the agent profile, workflow, or step level. Agents with no assigned skills are unaffected by the default change (neither mode emits a skill section when no skills are assigned).

### Operator note — `search_skills` no longer granted by default

The seed workflows no longer grant the `search_skills` tool in their `tool_policy` (the `workflows.seed.contract.spec.ts` guard enforces this). Agents rely on native harness discovery instead. The `search_skills` and `read_skill_manifest` tools, the `AgentSkillsService` search path, and the `search` discovery mode all remain in the codebase as an opt-in toggle — they are not removed.

The agent-profile ceilings still **allow** `search_skills`, so re-enabling search for a specific workflow is a deliberate, two-part action: add an `effect: allow` / `tool: search_skills` rule to that workflow (or job) `tool_policy`, and set `skill_discovery_mode: search` at the matching level. (`read_skill_manifest` is still granted in `create-skill.workflow.yaml` for skill authoring.)

## Related Docs

- docs/architecture/rest-api.md
- docs/plans/2026-04-06-agent-skills-filesystem-storage-plan.md
- docs/epics/EPIC-057-agent-skills-management-and-runner-sync.md
- docs/guide/06-workflow-engine.md — workflow YAML `skill_discovery_mode` field reference
