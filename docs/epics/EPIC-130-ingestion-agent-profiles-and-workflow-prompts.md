# EPIC-130: Ingestion Agent Profiles & Workflow Prompts

**Epic ID:** EPIC-130  
**Status:** Proposed  
**Priority:** P0 - Critical  
**Theme:** Agent Specialization, Prompt Engineering, Skill Authoring  
**Created:** 2026-04-19  
**Depends On:** EPIC-128 (Steering Foundation), EPIC-129 (Ingestion Tools), EPIC-057 (Agent Skills)

---

## 1. Context

With the steering framework (EPIC-128) providing intent parsing and orchestration, and the ingestion tools (EPIC-129) enabling multi-modal input processing, we now need specialized agent personas and workflow prompts for the design ingestion pipeline. When the CEO parses a "ingest these designs" intent, it will spawn these specialized agents to handle the analysis and artifact generation.

**Current State:**
- Agent profiles exist in `seed/agent-profiles/` and database
- Skills framework exists (EPIC-057)
- System prompts are configurable per profile
- No ingestion-specific profiles exist

**Target State:**
- 6 new agent profiles seeded: `design_analyst`, `requirements_extractor`, `technical_architect_ingestion`, `product_manager_ingestion`, `ingestion_runner`, `git_verifier`
- Workflow prompt files for analysis, artifact generation, and commit verification
- Agent skills for design analysis, requirements extraction, and PRD/SDD authoring
- All profiles respect existing capability orchestration
- Steering framework can spawn these agents for ingestion intents

---

## 2. References

**Architecture:**
- `docs/architecture/agent-capability-orchestration.md`
- `docs/guides/skill-authoring.md`
- `docs/epics/EPIC-057-agent-skills-management-and-runner-sync.md`
- `docs/epics/EPIC-128-conversational-orchestrator-steering-foundation.md`
- `docs/epics/EPIC-129-multi-modal-ingestion-tools.md`

**Implementation Files:**
- `apps/api/src/database/seeds/agent-profiles/` — Profile seeding
- `seed/agent-profiles/` — Profile definitions
- `seed/skills/` — Skill library
- `seed/workflows/prompts/` — Workflow prompt files
- `apps/api/src/ai-config/services/agent-skills.service.ts` — Skill management

**Related Skills:**
- `seed-workflow-patterns` — For workflow prompt patterns
- `skill-creator` — For creating new skills

---

## 3. PR-Ready Tasks

### Task 1: Create `design_analyst` Agent Profile

**Scope:** Profile for analyzing visual designs and producing structured findings.

**Files:**
- Create: `seed/agent-profiles/design-analyst.profile.yaml`
- Create: `apps/api/src/database/seeds/agent-profiles/design-analyst.seed.ts`
- Create: `apps/api/src/database/seeds/agent-profiles/design-analyst.seed.spec.ts`

**Acceptance Criteria:**
- System prompt instructs agent to:
  - Analyze UI mockups, wireframes, and screenshots
  - Identify user flows, navigation patterns, components
  - Extract text content and layout information
  - Produce structured analysis document
- Model: vision-capable (gpt-4.1 or equivalent)
- Allowed tools: analyze_image, fetch_url, read_document, extract_figma, create_artifact
- Skills: visual-analysis, ux-evaluation

**Definition of Done:**
- [ ] Profile seed file created
- [ ] Seeding tests pass
- [ ] Profile appears in admin UI
- [ ] Agent can be assigned to sessions

---

### Task 2: Create `requirements_extractor` Agent Profile

**Scope:** Profile for extracting functional requirements from documents and analysis.

**Files:**
- Create: `seed/agent-profiles/requirements-extractor.profile.yaml`
- Create: `apps/api/src/database/seeds/agent-profiles/requirements-extractor.seed.ts`

**Acceptance Criteria:**
- System prompt instructs agent to:
  - Read and parse documents (PDF, DOCX, MD)
  - Extract functional and non-functional requirements
  - Categorize requirements (user stories, acceptance criteria, constraints)
  - Identify dependencies and relationships
  - Produce structured requirements document
- Model: standard (gpt-4.1-mini or equivalent)
- Allowed tools: read_document, fetch_url, create_artifact
- Skills: document-parsing, requirement-elicitation

**Definition of Done:**
- [ ] Profile seed file created
- [ ] Seeding tests pass
- [ ] Profile appears in admin UI

---

### Task 3: Create `ingestion_runner` Agent Profile

**Scope:** Profile for handling file placement and basic git operations.

**Files:**
- Create: `seed/agent-profiles/ingestion-runner.profile.yaml`
- Create: `apps/api/src/database/seeds/agent-profiles/ingestion-runner.seed.ts`

**Acceptance Criteria:**
- System prompt instructs agent to:
  - Copy files to correct directories in worktree
  - Organize inputs by type and source
  - Save URL references with metadata
  - Commit files with descriptive messages
  - Report on what was placed where
- Model: light (cost-effective)
- Allowed tools: create_artifact, bash (for git operations)
- Skills: file-management, git-operations

**Definition of Done:**
- [ ] Profile seed file created
- [ ] Seeding tests pass
- [ ] Profile appears in admin UI

---

### Task 4: Create `git_verifier` Agent Profile

**Scope:** Profile for verifying all work is committed before proceeding.

**Files:**
- Create: `seed/agent-profiles/git-verifier.profile.yaml`
- Create: `apps/api/src/database/seeds/agent-profiles/git-verifier.seed.ts`

**Acceptance Criteria:**
- System prompt instructs agent to:
  - Check git status in worktree
  - Identify uncommitted files
  - Commit remaining files with descriptive messages
  - Report verification status
  - Never proceed if uncommitted files remain
- Model: light
- Allowed tools: bash (for git commands)
- Skills: git-operations, commit-validation

**Definition of Done:**
- [ ] Profile seed file created
- [ ] Seeding tests pass
- [ ] Profile appears in admin UI

---

### Task 5: Create `product_manager_ingestion` Agent Profile

**Scope:** Profile for creating PRDs and work items from analysis.

**Files:**
- Create: `seed/agent-profiles/product-manager-ingestion.profile.yaml`
- Create: `apps/api/src/database/seeds/agent-profiles/product-manager-ingestion.seed.ts`

**Acceptance Criteria:**
- System prompt instructs agent to:
  - Read analysis and requirements documents
  - Create comprehensive PRDs
  - Define epics, user stories, and acceptance criteria
  - Generate work item proposals
  - Ensure business logic is captured
- Model: standard
- Allowed tools: read_document, create_artifact, propose_work_items
- Skills: prd-authoring, work-item-generation

**Definition of Done:**
- [ ] Profile seed file created
- [ ] Seeding tests pass
- [ ] Profile appears in admin UI

---

### Task 6: Create `technical_architect_ingestion` Agent Profile

**Scope:** Profile for creating SDDs and technical plans from PRDs.

**Files:**
- Create: `seed/agent-profiles/technical-architect-ingestion.profile.yaml`
- Create: `apps/api/src/database/seeds/agent-profiles/technical-architect-ingestion.seed.ts`

**Acceptance Criteria:**
- System prompt instructs agent to:
  - Read PRDs and analysis documents
  - Create technical solution designs
  - Define architecture, data models, APIs
  - Identify technical risks and mitigations
  - Produce structured SDD
- Model: standard
- Allowed tools: read_document, create_artifact
- Skills: sdd-authoring, architecture-design

**Definition of Done:**
- [ ] Profile seed file created
- [ ] Seeding tests pass
- [ ] Profile appears in admin UI

---

### Task 7: Create Ingestion Skills

**Scope:** Skills for design analysis, requirements extraction, and artifact authoring.

**Files:**
- Create: `seed/skills/visual-analysis/SKILL.md`
- Create: `seed/skills/requirement-elicitation/SKILL.md`
- Create: `seed/skills/prd-authoring/SKILL.md`
- Create: `seed/skills/sdd-authoring/SKILL.md`
- Create: `seed/skills/git-commit-enforcement/SKILL.md`

**Acceptance Criteria:**
- `visual-analysis` skill: Guidelines for analyzing UI mockups, wireframes, screenshots
- `requirement-elicitation` skill: Patterns for extracting requirements from documents
- `prd-authoring` skill: Template and guidelines for writing PRDs
- `sdd-authoring` skill: Template and guidelines for writing SDDs
- `git-commit-enforcement` skill: Instructions for committing all work before completion
- All skills follow `docs/guides/skill-authoring.md` format
- Skills validated on startup (`STRICT_SKILL_VALIDATION`)

**Definition of Done:**
- [ ] All 5 skills created
- [ ] Skills pass validation
- [ ] Skills assigned to appropriate profiles
- [ ] Skill tests pass

---

### Task 8: Create Workflow Prompt Files

**Scope:** Prompt files for the ingestion workflow steps.

**Files:**
- Create: `seed/workflows/prompts/design-ingestion/analyze.md`
- Create: `seed/workflows/prompts/design-ingestion/generate-prd.md`
- Create: `seed/workflows/prompts/design-ingestion/generate-sdd.md`
- Create: `seed/workflows/prompts/design-ingestion/delta-analysis.md`
- Create: `seed/workflows/prompts/design-ingestion/verify-commits.md`

**Acceptance Criteria:**
- `analyze.md`: Guides agent to analyze all inputs, produce structured findings
- `generate-prd.md`: Guides agent to create PRD from analysis and requirements
- `generate-sdd.md`: Guides agent to create SDD from PRD and analysis
- `delta-analysis.md`: Guides agent to compare new inputs against existing artifacts
- `verify-commits.md`: Guides agent to check git status and commit remaining files
- All prompts reference skills for detailed instructions
- Prompts use existing prompt management system (EPIC-070)

**Definition of Done:**
- [ ] All 5 prompt files created
- [ ] Prompts follow project conventions
- [ ] Prompts validated in test workflow runs
- [ ] Lint passes

---

### Task 9: Write Profile and Prompt Documentation

**Scope:** Document the new agent profiles and prompt authoring.

**Files:**
- Create: `docs/guides/ingestion-agent-profiles.md`
- Modify: `docs/guides/skill-authoring.md`

**Acceptance Criteria:**
- Document covers:
  - Each profile's purpose and capabilities
  - Assigned skills and tools
  - When to use each profile
  - How to customize prompts
  - How to add new profiles
- Skill authoring guide updated with ingestion examples
- Example workflow showing profile selection

**Definition of Done:**
- [ ] Documentation complete
- [ ] Examples included
- [ ] Peer reviewed

---

## 4. Definition of Done (Epic Level)

- [ ] 6 new agent profiles seeded and tested
- [ ] 5 new skills created and validated
- [ ] 5 workflow prompt files authored
- [ ] All profiles appear in admin UI
- [ ] Skills are assignable to profiles
- [ ] Prompts work in test workflow executions
- [ ] All tests pass (`npm run test`)
- [ ] Lint passes (`npm run lint`)
- [ ] Documentation updated
- [ ] No E2E tests required (deferred to future epic)

---

## 5. Dependencies

- **EPIC-128 (Steering Foundation):** Provides orchestration that spawns these agents
- **EPIC-129 (Ingestion Tools):** Profiles need tools to exist first
- **EPIC-057 (Agent Skills):** Skill framework must be stable
- **EPIC-130 depends on:** EPIC-128, EPIC-129
- **Blocks:** EPIC-131, EPIC-132, EPIC-133

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Prompts too vague | Iterate with real designs; add examples |
| Agents don't follow commit instructions | Strong git_verifier profile + workflow loops |
| Profile proliferation | Group by function; clear naming |
| Skill validation failures | Test skills before committing |
