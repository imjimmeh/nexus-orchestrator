# EPIC-070: Agent Capability Enhancement - Skills Expansion and Prompt Management

Status: Proposed
Priority: P1 (High)
Created: 2026-04-10
Last Updated: 2026-04-10
Owner: TBD
Theme: Agent effectiveness, maintainability, and developer experience

---

## 1. Executive Summary

EPIC-070 addresses critical gaps in the Nexus Orchestrator's agent ecosystem by expanding the skills framework, improving prompt management, and standardizing skill quality. Currently, the skill system is underutilized with most agents having zero skill assignments, and prompts are embedded directly in workflows making them difficult to maintain and iterate on.

This epic delivers:

1. **Essential developer skills** - TDD, debugging, code review, refactoring, and API design patterns
2. **Strategic skill assignments** - Proper skill-to-agent mappings for CEO, Architect, and all developer tiers
3. **Prompt extraction and versioning** - Move prompts from YAML workflows to separate, versioned files
4. **Skill quality standardization** - A consistent skill template with prerequisites, tier requirements, and output formats
5. **Workflow testing framework** - Unit and integration tests for workflow logic

The net-new work builds on existing foundations:
- Filesystem-backed mounted skills (`seed/skills/`)
- Agent profile skill assignment (`seed/agents/*/agent.json`)
- Workflow engine and orchestration primitives
- DAG execution and job scheduling

---

## 2. Context and Codebase Analysis

### 2.1 Existing capabilities we can leverage

1. **Filesystem-backed mounted skills and profile assignment**
   - Skills are stored at `seed/skills/` and mounted read-only in runner containers
   - Agent profiles reference skills via `assigned_skills` array in `agent.json`
   - Seeding infrastructure validates skill assignments on startup
   - References:
     - `docs/architecture/agent-skills.md`
     - `seed/skills/*/SKILL.md`
     - `apps/api/src/database/seeds/agent-profiles/`

2. **Workflow engine supports external file references**
   - Handlebars templating for dynamic prompt generation
   - Job-based execution with DAG resolution
   - References:
     - `apps/api/src/workflow/workflow-engine.service.ts`
     - `docs/architecture/workflow-engine.md`

3. **Agent profile tier system and tool permissions**
   - `tier_preference` (light/heavy) for resource allocation
   - `allowed_tools` for capability gating
   - References:
     - `seed/agents/*/agent.json`

### 2.2 Gaps EPIC-070 must close

1. **Most agents have zero skills assigned:**
   - CEO agent: `assigned_skills: []`
   - Senior dev: `assigned_skills: []`
   - Junior dev: `assigned_skills: []`
   - QA automation: `assigned_skills: []`
   - Only Architect (3 skills) and Product Manager (3 skills) have meaningful coverage

2. **Skill quality is inconsistent:**
   - `implementation-planning`: 15 lines
   - `write-a-prd`: 77 lines
   - No standardized template for skill authoring
   - No prerequisite chains or dependency management

3. **Prompts are embedded in workflow YAML:**
   - `work-item-in-progress-default.workflow.yaml`: 232 lines of mixed logic + prompts
   - No versioning or A/B testing capability
   - Difficult to maintain and iterate

4. **Staff engineer has wildcard tool access:**
   - `"allowed_tools": ["*"]` is a security concern
   - No explicit capability contract

5. **No workflow testing framework:**
   - No unit tests for individual job logic
   - No integration tests for workflow execution paths
   - Skills are not validated for required sections

6. **No prompt management system:**
   - No versioning for prompts
   - No analytics on prompt effectiveness
   - No easy way to iterate and improve prompts

### 2.3 Design constraints to preserve

1. Preserve AI config precedence behavior (step override -> profile -> DB defaults -> env fallback).
2. Preserve orchestration safety guardrails and stage-aware skill selection.
3. Preserve existing bounded contexts:
   - `apps/api`: workflow runtime, orchestration, seeding, validation
   - `apps/web`: UI for workflow visualization and management
   - `seed/`: filesystem-based agent and skill definitions
4. Keep skill system language-agnostic where possible.
5. Maintain backward compatibility with existing workflow definitions.

---

## 3. Goals

1. Provide essential, reusable mounted skills for development workflows (TDD, debugging, code review, refactoring, API design).
2. Assign appropriate skills to all agent profiles to improve effectiveness and consistency.
3. Extract and version workflow prompts separately from workflow logic for better maintainability.
4. Standardize skill authoring with a consistent template including prerequisites, tier requirements, and output formats.
5. Build a workflow testing framework for unit and integration testing of workflow logic.
6. Improve developer experience with prompt analytics and iteration capabilities.

---

## 4. Non-Goals

1. Replacing the core skills runtime or skill architecture (EPIC-057 remains the source of truth).
2. Adding new model/provider orchestration semantics.
3. Building a public marketplace for external skill distribution.
4. Replacing existing lifecycle workflows (refinement, in-progress, review, merge).
5. Introducing complex natural language prompt optimization (keep it simple and deterministic).

---

## 5. Scope Overview

This epic is delivered in six workstreams:

1. **WS1: Essential Developer Skills Authoring**
2. **WS2: Skill Assignment and Profile Updates**
3. **WS3: Prompt Extraction and Management**
4. **WS4: Skill Quality Standardization**
5. **WS5: Workflow Testing Framework**
6. **WS6: Documentation and Rollout**

---

## 6. Workstreams and Detailed Tasks

### WS1: Essential Developer Skills Authoring

Objective: Create production-ready mounted skills for common development workflows.

#### Task E070-001: Define skill authoring template and contract

Description:
Create a standard template for EPIC-070 skills that enforces consistency across frontmatter, prerequisites, execution guidance, and output format.

Acceptance Criteria:

1. A reusable skill template exists in `docs/templates/skill-template.md`.
2. Each skill has explicit sections for:
   - Overview and when to activate
   - Prerequisites (required knowledge/context)
   - Step-by-step instructions
   - Decision points
   - Output format expectations
   - Examples
   - Common pitfalls
3. Frontmatter includes:
   - `name`, `description`
   - `metadata.version` (semver)
   - `metadata.prerequisites` (skill dependencies)
   - `metadata.tier` (light/heavy)
   - `metadata.estimated_duration`

References:

1. `docs/architecture/agent-skills.md`
2. `seed/skills/*/SKILL.md`

#### Task E070-002: Implement `test-driven-development` mounted skill

Description:
Add a `test-driven-development` skill pack that guides agents through the Red-Green-Refactor cycle with language-agnostic patterns.

Acceptance Criteria:

1. New skill exists at `seed/skills/test-driven-development/SKILL.md` with valid frontmatter.
2. Skill covers:
   - Red phase: Writing failing tests before implementation
   - Green phase: Minimal code to pass tests
   - Refactor phase: Improving design while keeping tests green
3. Includes language-agnostic test runner detection (jest, vitest, pytest, etc.)
4. Provides examples of good vs bad test patterns
5. Includes anti-patterns checklist (testing implementation details, mocking too much, etc.)

References:

1. `docs/architecture/agent-skills.md`
2. `AGENTS.md` (TDD section)
3. `packages/e2e-tests/`

#### Task E070-003: Implement `debugging` mounted skill

Description:
Add a `debugging` skill that provides systematic debugging methodology for identifying and resolving issues.

Acceptance Criteria:

1. New skill exists at `seed/skills/debugging/SKILL.md` with valid frontmatter.
2. Skill covers:
   - Reproduction and isolation
   - Hypothesis formation and testing
   - Root cause analysis techniques
   - Fix verification and regression prevention
3. Includes decision tree for choosing debugging approaches
4. Provides patterns for common error types (null reference, async issues, state corruption, etc.)
5. Includes guidance on when to add logging vs when to use debugger

References:

1. `docs/architecture/workflow-engine.md`
2. `AGENTS.md` (debugging principles)

#### Task E070-004: Implement `code-review` mounted skill

Description:
Add a `code-review` skill for systematic pull request review with focus on maintainability, correctness, and standards compliance.

Acceptance Criteria:

1. New skill exists at `seed/skills/code-review/SKILL.md` with valid frontmatter.
2. Skill covers:
   - Review checklist (correctness, readability, test coverage, security)
   - Feedback delivery patterns (constructive, specific, actionable)
   - Common code smell identification
   - Standards compliance verification
3. Includes language-agnostic review patterns
4. Provides examples of good vs problematic review comments
5. Includes guidance on review scope (what to focus on, what to defer)

References:

1. `AGENTS.md` (code quality standards)
2. `docs/architecture/`

#### Task E070-005: Implement `refactoring` mounted skill

Description:
Add a `refactoring` skill for safe structural improvements with focus on small surface area changes and behavior preservation.

Acceptance Criteria:

1. New skill exists at `seed/skills/refactoring/SKILL.md` with valid frontmatter.
2. Skill covers:
   - Pre-refactoring safety checks (tests, typecheck, lint)
   - Incremental refactoring patterns (extract method, rename, inline, etc.)
   - Behavior preservation verification
   - Rollback strategies
3. Includes Martin Fowler refactoring catalog references
4. Provides decision tree: when to refactor vs when to rewrite
5. Includes anti-patterns (large unrelated rewrites, refactoring without tests)

References:

1. `docs/architecture/workflow-engine.md`
2. `seed/skills/refactor-expert/` (if EPIC-066 creates it)

#### Task E070-006: Implement `api-design` mounted skill

Description:
Add an `api-design` skill for designing RESTful and GraphQL APIs with focus on consistency, discoverability, and evolvability.

Acceptance Criteria:

1. New skill exists at `seed/skills/api-design/SKILL.md` with valid frontmatter.
2. Skill covers:
   - RESTful resource naming and URL patterns
   - HTTP methods and status codes
   - Request/response payload design
   - Pagination, filtering, sorting patterns
   - Versioning strategies
3. Includes GraphQL-specific guidance (schema design, resolver patterns)
4. Provides examples of good vs bad API designs
5. Includes guidance on OpenAPI/Swagger documentation

References:

1. `docs/architecture/rest-api.md`
2. `apps/api/src/`

#### Task E070-007: Implement `coding-standards` mounted skill

Description:
Add a `coding-standards` skill that captures AGENTS.md principles (SOLID, DRY, KISS, static typing, etc.) for consistent code quality.

Acceptance Criteria:

1. New skill exists at `seed/skills/coding-standards/SKILL.md` with valid frontmatter.
2. Skill covers:
   - SOLID principles application
   - Naming conventions
   - Function design (small, single-purpose, pure where possible)
   - Static typing best practices
   - Constants over magic numbers/strings
3. Includes language-agnostic patterns with language-specific examples
4. Provides code smell identification checklist
5. Links to existing codebase examples that follow standards

References:

1. `AGENTS.md`
2. `docs/architecture/`

---

### WS2: Skill Assignment and Profile Updates

Objective: Update agent profiles to leverage the new skills effectively.

#### Task E070-008: Update CEO agent skill assignments

Description:
Assign strategic skills to the CEO agent to improve orchestration decision-making and project analysis.

Acceptance Criteria:

1. `seed/agents/ceo-agent/agent.json` updated with:
   ```json
   "assigned_skills": [
     "project-analysis",
     "decision-records",
     "orchestration-patterns"
   ]
   ```
2. Create new skills if they don't exist:
   - `project-analysis`: How to analyze project state effectively
   - `decision-records`: ADR authoring and management
   - `orchestration-patterns`: Common dispatch and coordination patterns
3. Seeding validation passes for all skill references
4. Update CEO PROMPT.md to reference skill capabilities

References:

1. `seed/agents/ceo-agent/`
2. `seed/workflows/project-orchestration-cycle-ceo.workflow.yaml`

#### Task E070-009: Update Senior Developer skill assignments

Description:
Assign comprehensive development skills to senior developer profile.

Acceptance Criteria:

1. `seed/agents/senior_dev/agent.json` updated with:
   ```json
   "assigned_skills": [
     "test-driven-development",
     "debugging",
     "code-review",
     "refactoring",
     "api-design",
     "coding-standards"
   ]
   ```
2. Seeding validation passes for all skill references
3. Update PROMPT.md to leverage skill guidance
4. Verify skills align with `allowed_tools` (tools enable skill execution)

References:

1. `seed/agents/senior_dev/`

#### Task E070-010: Update Junior Developer skill assignments

Description:
Assign foundational skills to junior developer profile, focusing on TDD and debugging basics.

Acceptance Criteria:

1. `seed/agents/junior_dev/agent.json` updated with:
   ```json
   "assigned_skills": [
     "test-driven-development",
     "debugging",
     "coding-standards"
   ]
   ```
2. Seeding validation passes for all skill references
3. Junior dev skills are a subset of senior dev skills (progression path)
4. Update PROMPT.md to reference foundational skills

References:

1. `seed/agents/junior_dev/`

#### Task E070-011: Update QA Automation skill assignments

Description:
Assign testing and quality-focused skills to QA automation profile.

Acceptance Criteria:

1. `seed/agents/qa_automation/agent.json` updated with:
   ```json
   "assigned_skills": [
     "test-driven-development",
     "code-review",
     "qa-regression-check"
   ]
   ```
2. Seeding validation passes for all skill references
3. Update PROMPT.md to reference quality assurance skills

References:

1. `seed/agents/qa_automation/`

#### Task E070-012: Fix Staff Engineer wildcard tool access

Description:
Replace wildcard tool access with explicit tool list and appropriate skills.

Acceptance Criteria:

1. `seed/agents/staff_engineer/agent.json` updated to remove `"allowed_tools": ["*"]`
2. Replace with comprehensive explicit tool list
3. Assign appropriate senior-level skills
4. Update PROMPT.md to reflect explicit capabilities

References:

1. `seed/agents/staff_engineer/`
2. Security best practices

#### Task E070-013: Add startup validation for skill assignments

Description:
Enhance seeding service to validate skill-to-profile assignments on startup.

Acceptance Criteria:

1. `AgentProfilesFileSeedService` validates that all `assigned_skills` reference existing skills
2. Validation fails fast with clear error messages for unknown skills
3. Warning logged when profiles have no skills assigned (encourage skill adoption)
4. Diagnostics endpoint includes skill assignment validation results

References:

1. `apps/api/src/database/seeds/agent-profiles/`
2. `apps/api/src/database/seeds/skills/`

---

### WS3: Prompt Extraction and Management

Objective: Move prompts from workflow YAML to separate, versioned files.

#### Task E070-014: Design prompt file structure and naming convention

Description:
Define directory structure and naming convention for extracted workflow prompts.

Acceptance Criteria:

1. Directory structure defined:
   ```
   seed/workflows/prompts/
     {workflow-id}/
       {job-id}-{step-id}.md
   ```
2. Naming convention documented in `docs/architecture/workflow-engine.md`
3. Supports Handlebars templating in prompt files
4. Backward compatibility: workflows can still embed prompts inline

References:

1. `seed/workflows/`
2. `docs/architecture/workflow-engine.md`

#### Task E070-015: Implement prompt file loader service

Description:
Create a service to load prompts from external files with caching and versioning support.

Acceptance Criteria:

1. `PromptLoaderService` created in `apps/api/src/workflow/`
2. Service loads prompts from `seed/workflows/prompts/` directory
3. Supports hot-reload in development mode
4. Caches prompts in production for performance
5. Validates prompt files exist before workflow execution
6. Graceful fallback to inline prompts if external file missing

References:

1. `apps/api/src/workflow/workflow-parser.service.ts`
2. `apps/api/src/workflow/step-execution.service.ts`

#### Task E070-016: Update workflow schema to support external prompts

Description:
Extend workflow YAML schema to allow referencing external prompt files.

Acceptance Criteria:

1. Workflow schema supports `prompt_file` field as alternative to inline `prompt`:
   ```yaml
   steps:
     - id: implement
       type: agent
       prompt_file: "prompts/work-item-in-progress/implement.md"
   ```
2. Schema validation enforces mutual exclusivity (prompt OR prompt_file, not both)
3. Parser service handles both inline and external prompt loading
4. Error messages clearly indicate which prompt file failed to load

References:

1. `apps/api/src/workflow/workflow-parser.service.ts`
2. `apps/api/src/workflow/workflow-validation.service.ts`

#### Task E070-017: Extract prompts from `work-item-in-progress-default` workflow

Description:
Move prompts from `work-item-in-progress-default.workflow.yaml` to external files.

Acceptance Criteria:

1. Create `seed/workflows/prompts/work-item-in-progress-default/` directory
2. Extract each step prompt to separate file:
   - `implement.md` (main implementation prompt)
   - `commit.md` (commit message generation)
3. Update workflow YAML to use `prompt_file` references
4. Workflow execution produces identical results
5. All existing tests pass

References:

1. `seed/workflows/work-item-in-progress-default.workflow.yaml`
2. `apps/api/src/workflow/step-execution.service.ts`

#### Task E070-018: Extract prompts from other major workflows

Description:
Extract prompts from remaining major workflows.

Acceptance Criteria:

1. Extract prompts from:
   - `project-orchestration-cycle-ceo.workflow.yaml`
   - `project-discovery-ceo.workflow.yaml`
   - `work-item-refinement-default.workflow.yaml`
2. Each workflow has its own prompts subdirectory
3. Complex prompts split into logical sections
4. All existing tests pass

References:

1. `seed/workflows/*.yaml`

---

### WS4: Skill Quality Standardization

Objective: Standardize skill quality and validation across the skill library.

#### Task E070-019: Implement skill validation service

Description:
Create a service to validate skill files against the standard template.

Acceptance Criteria:

1. `SkillValidationService` created in `apps/api/src/database/seeds/skills/`
2. Validates required frontmatter fields (name, description, metadata)
3. Validates required sections (Overview, Prerequisites, Instructions, Output Format)
4. Checks skill name format (kebab-case)
5. Validates prerequisite skills exist
6. Seeding fails fast on validation errors with clear messages

References:

1. `apps/api/src/database/seeds/skills/skill-seed.service.ts`
2. `docs/templates/skill-template.md`

#### Task E070-020: Update existing skills to meet quality standard

Description:
Refactor existing skills to meet the new quality template.

Acceptance Criteria:

1. Update `implementation-planning/SKILL.md` (currently 15 lines)
2. Update `architecture-review/SKILL.md`
3. Update `software-architect/SKILL.md`
4. Each skill includes:
   - Full frontmatter with metadata
   - All required sections
   - Examples and anti-patterns
5. Validation passes for all updated skills

References:

1. `seed/skills/*/SKILL.md`
2. `docs/templates/skill-template.md`

#### Task E070-021: Add skill dependency resolution

Description:
Implement prerequisite chain resolution for skills.

Acceptance Criteria:

1. `SkillDependencyResolver` created to resolve skill prerequisite chains
2. Skills can declare prerequisites (other skills that should be loaded first)
3. Circular dependency detection and error reporting
4. Prerequisites automatically included in agent effective skills
5. Diagnostics show resolved skill hierarchy

References:

1. `apps/api/src/database/seeds/skills/`
2. `docs/architecture/agent-skills.md`

---

### WS5: Workflow Testing Framework

Objective: Build testing capabilities for workflow logic.

#### Task E070-022: Design workflow testing DSL

Description:
Create a domain-specific language for writing workflow unit tests.

Acceptance Criteria:

1. Testing DSL documented in `docs/testing/workflow-testing.md`
2. Supports:
   - Workflow dry-run mode (parse and validate without execution)
   - Mock job execution with defined outputs
   - State variable assertions
   - Transition path testing
3. Example test structure:
   ```typescript
   describe('work-item-in-progress', () => {
     it('should transition to review after implementation', async () => {
       const result = await workflowTest('work_item_in_progress_default')
         .withTrigger({ workItemId: 'test-123' })
         .mockJob('provision_worktree', { ok: true })
         .mockJob('implement_and_commit', { ok: true })
         .run();
       
       expect(result.transitions).toContain('in-review');
     });
   });
   ```

References:

1. `docs/architecture/workflow-engine.md`
2. `packages/e2e-tests/`

#### Task E070-023: Implement workflow dry-run mode

Description:
Add dry-run capability to workflow engine for testing without side effects.

Acceptance Criteria:

1. `WorkflowEngineService.startWorkflow()` accepts `dryRun: true` option
2. Dry-run validates workflow schema and job dependencies
3. Dry-run executes jobs in "mock mode" without container spawning
4. Returns execution path and state transitions without persisting to DB
5. Useful for CI validation of workflow changes

References:

1. `apps/api/src/workflow/workflow-engine.service.ts`
2. `apps/api/src/workflow/workflow-run-job-execution.service.ts`

#### Task E070-024: Implement workflow test utilities

Description:
Create utility functions and fixtures for workflow testing.

Acceptance Criteria:

1. `WorkflowTestHarness` class in `apps/api/src/workflow/testing/`
2. Provides:
   - `mockJob(jobId, output)` - define mock job outputs
   - `withTrigger(data)` - set trigger data
   - `withState(variables)` - set initial state
   - `run()` - execute workflow
   - Assertions for transitions, state changes, tool calls
3. Includes common test fixtures (sample work items, projects, etc.)
4. Works with existing test infrastructure (Jest/Vitest)

References:

1. `apps/api/src/workflow/`
2. `apps/api/vitest.config.ts`

#### Task E070-025: Write unit tests for key workflows

Description:
Create comprehensive unit tests for critical workflow paths.

Acceptance Criteria:

1. Unit tests for `work-item-in-progress-default`:
   - Success path (provision → implement → review)
   - Delta replanning path (after QA rejection)
   - Planning path (for large scope items)
   
2. Unit tests for `project-orchestration-cycle-ceo`:
   - Dispatch decision making
   - Orchestration completion detection
   - Restart continuity
   
3. Unit tests for `project-discovery-ceo`:
   - Discovery workflow execution
   - PRD generation path
   
4. All tests use dry-run mode and mocked job outputs
5. Tests run in CI pipeline

References:

1. `seed/workflows/*.yaml`
2. `apps/api/src/workflow/workflow-engine.service.ts`

#### Task E070-026: Add skill validation tests

Description:
Create tests to validate all skills meet quality standards.

Acceptance Criteria:

1. Test that iterates all `seed/skills/*/SKILL.md` files
2. Validates each skill against template requirements
3. Validates skill names follow conventions
4. Validates prerequisite chains (no circular deps, all exist)
5. Fails CI if any skill is invalid
6. Reports which skills need attention

References:

1. `seed/skills/`
2. `apps/api/src/database/seeds/skills/`

---

### WS6: Documentation and Rollout

Objective: Document changes and plan safe rollout.

#### Task E070-027: Update architecture documentation

Description:
Update docs to reflect skill system enhancements and prompt management.

Acceptance Criteria:

1. Update `docs/architecture/agent-skills.md`:
   - Skill template standard
   - Prerequisite chains
   - Quality validation
   
2. Update `docs/architecture/workflow-engine.md`:
   - External prompt files
   - Dry-run mode
   - Testing framework
   
3. Create `docs/testing/workflow-testing.md`:
   - DSL reference
   - Example tests
   - Best practices

References:

1. `docs/architecture/`
2. `docs/testing/` (create if needed)

#### Task E070-028: Create skill authoring guide

Description:
Document how to create new skills following the standard.

Acceptance Criteria:

1. Create `docs/guides/skill-authoring.md`
2. Covers:
   - Skill template usage
   - Frontmatter requirements
   - Content structure
   - Examples and anti-patterns
   - Testing the skill
3. Includes step-by-step example of creating a new skill
4. Links to existing skill examples

References:

1. `docs/templates/skill-template.md`
2. `seed/skills/`

#### Task E070-029: Create prompt management guide

Description:
Document how to extract and manage workflow prompts.

Acceptance Criteria:

1. Create `docs/guides/prompt-management.md`
2. Covers:
   - When to extract prompts
   - Directory structure
   - Naming conventions
   - Handlebars templating
   - Versioning and iteration
3. Includes migration guide from inline to external prompts
4. Best practices for prompt organization

References:

1. `seed/workflows/prompts/`
2. `docs/architecture/workflow-engine.md`

#### Task E070-030: Define rollout sequence and feature toggles

Description:
Plan safe rollout of EPIC-070 changes.

Acceptance Criteria:

1. Rollout plan defined:
   - Phase 1: New skills and assignments (additive, safe)
   - Phase 2: Prompt extraction (backward compatible)
   - Phase 3: Validation enforcement (breaking if invalid)
   - Phase 4: Testing framework adoption
   
2. Feature toggles identified:
   - `EXTERNAL_PROMPTS_ENABLED` - Use external prompt files
   - `STRICT_SKILL_VALIDATION` - Fail on invalid skills
   - `WORKFLOW_DRY_RUN` - Enable dry-run mode
   
3. Rollback procedures documented
4. Monitoring and alerting defined

References:

1. `docs/operations/`
2. `.env.example`

---

## 7. Cross-Cutting Acceptance Criteria

1. All seven new developer skills exist as valid mounted skills with consistent contracts.
2. All agent profiles (CEO, senior_dev, junior_dev, qa_automation, staff_engineer) have appropriate skill assignments.
3. Staff engineer no longer has wildcard tool access.
4. Prompt files can be loaded externally from `seed/workflows/prompts/` directory.
5. At least three major workflows have prompts extracted to external files.
6. Skill validation service enforces template compliance.
7. Workflow dry-run mode works for testing without side effects.
8. Unit tests exist for critical workflow paths.
9. All existing tests remain green after EPIC-070 changes.
10. Documentation is updated for skills, prompts, and testing.

---

## 8. Delivery Sequence (Recommended)

1. **WS1 first**: Author essential developer skills (parallelizable across skills).
2. **WS4 second**: Establish skill quality standard and validation (blocks WS2).
3. **WS2 third**: Update agent profiles with skill assignments.
4. **WS3 fourth**: Extract prompts from workflows (backward compatible).
5. **WS5 fifth**: Build and adopt workflow testing framework.
6. **WS6 last**: Finalize documentation and rollout plan.

---

## 9. Risks and Mitigations

1. **Risk: Agent behavior changes with new skills**
   - Mitigation: Gradual rollout with monitoring; skills are additive guidance, not mandates
   - Fallback: Remove skill assignments if issues arise

2. **Risk: Prompt extraction breaks existing workflows**
   - Mitigation: Maintain backward compatibility (inline prompts still work)
   - Validation: Extensive testing of extracted workflows
   - Fallback: Quick revert to inline prompts

3. **Risk: Skill validation too strict breaks seeding**
   - Mitigation: Start with warnings, upgrade to errors after cleanup
   - Feature toggle: `STRICT_SKILL_VALIDATION`
   - Gradual adoption: Fix existing skills before enforcing

4. **Risk: Workflow testing framework adds complexity**
   - Mitigation: Optional adoption, not mandatory for all workflows
   - Focus on high-value workflows first
   - Good documentation and examples

5. **Risk: Staff engineer tool restriction breaks workflows**
   - Mitigation: Comprehensive tool list based on current usage analysis
   - Test all staff engineer workflows before deployment
   - Gradual transition: Add explicit list alongside wildcard, then remove wildcard

---

## 10. Dependencies

1. **EPIC-057**: Agent skill lifecycle architecture must remain stable.
2. **EPIC-065**: Stage-aware orchestration semantics should be preserved.
3. **EPIC-066**: If EPIC-066 creates skills (test-generator, refactor-expert), coordinate to avoid duplication.
4. Existing workflow seeding and validation tooling must support external prompt references.

---

## 11. Open Questions

1. Should we create a skill for every major workflow pattern, or keep skills focused on cross-cutting concerns?
2. Should prompts support versioning (v1, v2) or rely on git history?
3. Should we add prompt analytics to track which prompts lead to better outcomes?
4. Do we need a skill marketplace/registry interface in v1, or keep it filesystem-based?
5. Should workflow tests be co-located with workflows or in a separate test directory?

---

## 12. Definition of Done

EPIC-070 is done when all of the following are true:

1. Seven new developer skills (`test-driven-development`, `debugging`, `code-review`, `refactoring`, `api-design`, `coding-standards`, plus strategic CEO skills) are seeded and operational.
2. All agent profiles have appropriate skill assignments and no wildcard tool access.
3. Skill validation service enforces template compliance and fails fast on invalid skills.
4. External prompt loading works for at least three major workflows.
5. Workflow dry-run mode is functional and documented.
6. Unit tests exist for critical workflow paths using the testing framework.
7. All existing tests remain green after EPIC-070 changes.
8. Architecture and developer guides are updated with skill authoring and prompt management guidance.
9. Rollout plan with feature toggles is documented and staged for production.
10. No regressions in existing orchestration or workflow behavior.

---

## 13. Success Metrics

1. **Skill adoption**: All agents have at least 2 skills assigned (baseline: 60% have 0)
2. **Skill quality**: 100% of skills pass validation (baseline: inconsistent)
3. **Prompt maintainability**: 50% of workflow prompts extracted (baseline: 0%)
4. **Test coverage**: 80% of critical workflows have unit tests (baseline: 0%)
5. **Developer experience**: Time to create new skill < 30 minutes
6. **Agent effectiveness**: Reduced iteration loops in work item implementation (measure via telemetry)
