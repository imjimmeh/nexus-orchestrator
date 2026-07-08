# Seed Assets

This directory contains repository-owned seed inputs for startup and CLI seeding.

## Layout

- `seed/agents/`: Agent profile seed definitions.
  - `seed/agents/<agent-name>/agent.json`: profile metadata (`name`, `tier_preference`, `allowed_tools`, optional `assigned_skills`, optional `model_name`, optional `provider_name`, optional `is_active`).
  - `seed/agents/<agent-name>/PROMPT.md`: system prompt content for `agent_profiles.system_prompt`.
- `seed/skills/`: Canonical skill folders (`<skill-name>/SKILL.md` plus optional resources).
- `seed/workflows/`: Workflow YAML seed definitions (`*.workflow.yaml`).

## Notes

- Runtime skill storage remains configurable via `NEXUS_SKILLS_LIBRARY_PATH`.
- Skill preseeding imports from `seed/skills` into the runtime skills library.
- Startup agent profile seeding uses folder-based definitions from `seed/agents/<agent-name>/` as the sole source of truth.
- `assigned_skills` should be configured in each `agent.json`.
- Legacy compatibility: if an agent omits `assigned_skills`, startup can still read `seed/agents/skill-assignments.seed.json`.
- When folder-based agent seeds are present, the standalone assignment seeder is skipped and logs a deprecation warning.
