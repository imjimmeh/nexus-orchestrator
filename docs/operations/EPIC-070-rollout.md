# EPIC-070 Rollout Plan

## Rollout Phases

1. Phase 1 - Skills and Assignments (additive)
   - Add new developer and orchestration skills.
   - Update agent profile `assigned_skills`.
   - Remove wildcard tool access from staff engineer.

2. Phase 2 - External Prompt Extraction (backward compatible)
   - Introduce `prompt_file` support and prompt loader.
   - Extract prompts from major workflows.
   - Keep inline prompt fallback active.

3. Phase 3 - Validation Enforcement
   - Enable strict skill validation in staging first.
   - Resolve all skill template violations.
   - Promote strict validation in production.

4. Phase 4 - Workflow Testing Adoption
   - Add dry-run workflow tests for critical paths.
   - Gate workflow changes with harness-based CI checks.

## Feature Toggles

- `EXTERNAL_PROMPTS_ENABLED`
  - `true`: resolve external prompt files.
  - `false`: use inline prompts only.

- `STRICT_SKILL_VALIDATION`
  - `true`: fail startup on invalid skill contracts.
  - `false`: emit warnings for non-critical structure issues.

- `WORKFLOW_DRY_RUN`
  - Controls dry-run execution exposure in operational workflows.

## Rollback Procedures

1. Prompt extraction rollback
   - Set `EXTERNAL_PROMPTS_ENABLED=false`.
   - Restore inline prompt content for impacted workflows if needed.

2. Validation rollback
   - Set `STRICT_SKILL_VALIDATION=false`.
   - Continue startup with warnings while remediating skills.

3. Skill assignment rollback
   - Revert profile `assigned_skills` to previous known-good set.

## Monitoring

Track:

1. Startup seed validation errors/warnings for skills and profile assignments.
2. Workflow execution failures caused by prompt resolution errors.
3. Dry-run regression outcomes in CI for critical workflow definitions.
4. Orchestration dispatch throughput and deadlock/stall indicators after rollout.
