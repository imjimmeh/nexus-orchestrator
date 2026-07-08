# 11 - Workflow Catalog

The Nexus Orchestrator ships with 30 seeded workflow definitions organized into five categories. Each workflow is a YAML file in `seed/workflows/` that is upserted into the database by `WorkflowSeedService` during `StartupSeedService.seedOnStartup()`.

---

## Workflow Categories

| Category                       | Count | Purpose                                                                              |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------ |
| Chat/Agent Workflows           | 3     | Direct agent interaction, conversational steering, ad-hoc agent invocation           |
| Kanban Orchestration Workflows | 10    | Board state management, CEO decision cycles, work-item lifecycle automation          |
| Project Management Workflows   | 5     | Discovery, planning, implementation, codebase analysis, agent configuration          |
| User-Driven Workflows          | 1     | Conversational intake flows triggered manually by a user on a project page           |
| Automation Workflows           | 4     | Scheduled jobs, quality checks, web testing                                          |
| Repair/Infrastructure          | 3     | Failure diagnosis, environment repair, workflow enhancement                          |
| Memory / Learning              | 1     | Skill materialization from approved improvement proposals                            |
| Blueprint Workflows            | 4     | Composite workflows combining multiple phases (feature, hotfix, documentation, todo) |

---

## Chat/Agent Workflows

### `chat_direct_agent_default`

- **Trigger:** Manual (via chat channel ingress)
- **Key step:** `direct_response` — routes user message to the selected agent profile without explicit orchestration
- **What it accomplishes:** Standard chat interaction. The agent receives the user message, optional memory context, and task instructions, then produces a direct response. Supports skill/artifact/tool creation commands.
- **Agent profile:** Resolved from `trigger.agent_profile`
- **Why it exists:** Default entry point for all chat channel interactions

### `orchestration_invoke_agent_default`

- **Trigger:** Manual
- **Key step:** `invoke_agent` — invokes the default agent with orchestration context
- **What it accomplishes:** Standard agent invocation with orchestration session integration
- **Agent profile:** `default`
- **Why it exists:** Generic agent invocation for ad-hoc requests

### `conversational_artifact_steering`

- **Trigger:** Manual
- **Key step:** `steer_artifact` — conversationally steers artifact creation/modification
- **What it accomplishes:** Interactive artifact creation with user feedback loops
- **Why it exists:** Enables conversational refinement of artifacts (skills, tools, configurations)

---

## Kanban Orchestration Workflows

These workflows drive the autonomous project management cycle. They are triggered by Kanban domain events or CEO orchestration decisions.

### `project_orchestration_cycle_ceo`

- **Trigger:** Event — `ProjectOrchestrationCycleRequestedEvent`
- **Concurrency:** `max_runs: 1`, scope per project, on_conflict: `skip`
- **Key steps:** CEO agent evaluates board state and decides whether to dispatch work, refine specs, or close orchestration
- **Mandate:** When `autonomous_mode=true`, `todo_count=0`, and `backlog_count>0`, the CEO MUST promote backlog items or create new work items
- **Agent profile:** `ceo`
- **Why it exists:** Central autonomous orchestration loop — runs after work-item completions to keep projects moving

### `project_orchestration_refinement_ceo`

- **Trigger:** Event
- **Key steps:** Refinement CEO reviews pending items, refines specifications, splits large items
- **Agent profile:** `ceo`
- **Why it exists:** Handles refinement phase of orchestration — breaking down large work items, clarifying specs

### `project_orchestration_advisor`

- **Trigger:** Event
- **Key steps:** Advisor reviews board health, suggests improvements, identifies blockers
- **Agent profile:** `orchestration_advisor`
- **Why it exists:** Advisory role providing board health insights to the CEO

### `project_discovery_ceo`

- **Trigger:** Manual / Event
- **Key steps:** CEO-driven project discovery — explores codebase, identifies scope, generates initial understanding
- **Agent profile:** `ceo`
- **Why it exists:** Initial project discovery phase — understanding codebase structure, identifying key files

### `project_work_item_generation_ceo`

- **Trigger:** Event
- **Key steps:** Generates work items from refinement output or discovery results
- **Agent profile:** `ceo`
- **Why it exists:** Converts project understanding into actionable work items

### `project_spec_revision_ceo`

- **Trigger:** Event
- **Key steps:** CEO revises specifications based on new information, feedback, or changed requirements
- **Agent profile:** `ceo`
- **Why it exists:** Spec lifecycle management — keeps specifications current

### `project_goal_backlog_planning`

- **Trigger:** Event
- **Key steps:** Plans backlog items from project goals, prioritizes, estimates
- **Agent profile:** `ceo`
- **Why it exists:** Goal-to-backlog pipeline — converts high-level goals into concrete backlog items
- **Specialist delegation:** May call `delegate_web_research` for a concrete external-research question whose cited result materially affects backlog choices; raw web search/fetch tools stay denied.

### `work_item_todo_dispatch_default`

- **Trigger:** Event (work-item enters Todo status)
- **Key steps:** Prepares work context, assigns agent, initiates execution
- **What it accomplishes:** Dispatches a work item from Todo to In Progress with full execution context
- **Why it exists:** Work-item lifecycle automation — the "dispatch" phase

### `work_item_in_progress_default`

- **Trigger:** Event (work-item enters In Progress status)
- **Key steps:** Agent executes the work item's implementation tasks
- **What it accomplishes:** Core execution of work items
- **Why it exists:** The primary execution workflow for development work
- **Specialist delegation:** The orchestration job can pass `delegate_ui_ux_testing` and `delegate_web_research` to implementation or QA subagents for bounded digressions that durably await and return a child workflow result.

### `work_item_refinement_default`

- **Trigger:** Event (work-item needs refinement)
- **Key steps:** Agent refines the work item — clarifies requirements, breaks down tasks, adds specifications
- **What it accomplishes:** Refinement phase of individual work items
- **Why it exists:** Ensures work items are well-defined before execution

### `work_item_in_review_default`

- **Trigger:** Event (work-item enters Review status)
- **Key steps:** Agent reviews completed work — runs tests, checks quality, verifies acceptance criteria
- **What it accomplishes:** Automated code review and quality verification
- **Why it exists:** Quality gate for work items before merge
- **Specialist delegation:** Review agents may call `delegate_ui_ux_testing` or `delegate_web_research` for concrete validation questions, then incorporate the returned result into the required QA decision.

### `work_item_ready_to_merge_default`

- **Trigger:** Event (work-item enters Ready to Merge status)
- **Key steps:** Agent prepares merge — resolves conflicts, updates changelog, creates merge request
- **What it accomplishes:** Merge preparation and execution
- **Why it exists:** Final stage of work-item lifecycle automation

### `work_item_split_default`

- **Trigger:** Event (work-item needs splitting)
- **Key steps:** Agent analyzes large work item and splits into smaller, independently executable items
- **What it accomplishes:** Work breakdown for oversized items
- **Why it exists:** Prevents oversized items from blocking progress

### `work_item_post_merge_spec_hydration`

- **Trigger:** Event (work-item is merged)
- **Key steps:** Updates project specifications based on what was actually implemented
- **What it accomplishes:** Post-merge spec synchronization — keeps docs in sync with code
- **Why it exists:** Prevents spec drift after implementation

---

## Project Management Workflows

### `project_codebase_deep_investigation`

- **Trigger:** Manual
- **Key steps:** Deep analysis of codebase — architecture, dependencies, patterns, technical debt
- **What it accomplishes:** Comprehensive codebase understanding for discovery and planning
- **Why it exists:** Provides depth of understanding for informed decision-making

### `project_generate_agents_md`

- **Trigger:** Manual
- **Key steps:** Generates or updates `AGENTS.md` file for a project
- **What it accomplishes:** Creates project-specific agent instructions
- **Why it exists:** Bootstraps agent configuration for new projects

### `imported_repo_synthesis_and_hydration`

- **Trigger:** Manual
- **Key steps:** Synthesizes imported repository structure, generates initial project understanding
- **What it accomplishes:** Onboarding for newly imported repositories
- **Why it exists:** Repository import pipeline

---

## User-Driven Workflows

These workflows are triggered manually from a project page and involve back-and-forth interaction with the user via `ask_user_questions`.

### `project_idea_intake`

- **Trigger:** Manual or chat-launchable. Target `workflow_id: project_idea_intake` from a chat channel; the first message in the conversation automatically seeds the idea.
- **Inputs:** `scopeId` (required), `ideaSeed` (optional — pre-fills the idea when launching from a form; superseded by `trigger.message` when launched from chat)
- **Concurrency:** `max_runs: 1` per project, on_conflict: `queue`
- **Key step:** `ideate` — adaptive deep-brainstorm session. The `idea-partner` agent probes scope with 2–5 targeted questions, scales depth to idea complexity, then confirms a plan before creating work items. Depth is adaptive: a small, clear request gets a short focused intake; a complex architectural idea gets a thorough multi-turn brainstorm.
- **Output contract:** `required: [initiative_id, created_work_item_ids, session_summary, feature_brief_artifact_id]`
- **Agent profile:** `idea-partner`
- **What it accomplishes:** Turns a rough idea into implementation-ready backlog items (each with explicit Acceptance Criteria, priority, and dependency links) plus a persistent feature-brief artifact. A kanban initiative is created as the top-level "idea note" and all work items are linked to it.
- **Why it exists:** Low-friction, conversational entry point for user-driven backlog capture — no pre-planning required. Work items produced here are sufficiently specified to flow directly into the kanban execution lifecycle.

---

## Automation Workflows

### `automated_quality_check`

- **Trigger:** Event — `QualityCheckRequestedEvent`
- **Key steps:** `quality_check` — detects project tooling, runs tests and linting from `AGENTS.md` or auto-detected config, emits `AutomatedQualityCheckCompletedEvent`
- **Output contract:** `required: [summary, pass_fail_status]`
- **Agent profile:** `qa_automation`
- **What it accomplishes:** Automated quality verification for any project
- **Why it exists:** Reusable QA building block invoked by blueprints and orchestration cycles

### `ui_ux_smoke_test`

- **Trigger:** Manual or CEO delegate (`delegate_ui_ux_testing`)
- **Inputs:** `scopeId` (optional), `objective` (required), `target_url` (optional), `app_start_command` (optional), `flows` (optional)
- **Key steps:** `run_smoke_test` — browser-driven UX validation with screenshots and issue classification
- **Output contract:** `required: [pass_fail_status, summary, issues, tested_routes]`
- **Agent profile:** `ui-ux-tester`
- **What it accomplishes:** Governed browser-based smoke testing for local or remote apps
- **Why it exists:** Repeatable UX verification with structured findings and artifacts

### `web_research`

- **Trigger:** Manual, CEO delegate, or seeded specialist digression (`delegate_web_research`)
- **Inputs:** `scopeId` (optional), `objective` (required), `questions` (optional), `must_include_domains` (optional), `avoid_domains` (optional)
- **Key steps:** `gather_and_summarize` — governed web search, primary-source fetching, and cited synthesis
- **Output contract:** `required: [summary, findings, sources, open_questions]`
- **Agent profile:** `web-researcher`
- **What it accomplishes:** Governed external research with bounded, cited findings
- **Why it exists:** Reusable specialist research workflow for project decisions, review evidence gathering, backlog planning, and roadmap planning

### `web_search_tool_test`

- **Trigger:** Manual
- **Key steps:** Web search tool validation and testing
- **What it accomplishes:** Validates web search tool integration
- **Why it exists:** Tool testing and validation

### `workflow_yaml_enhancements_demo`

- **Trigger:** Manual
- **Key steps:** Demonstrates YAML workflow enhancements and features
- **What it accomplishes:** Showcase and testing of new workflow capabilities
- **Why it exists:** Development/testing harness for workflow features

---

## Repair/Infrastructure Workflows

### `workflow_failure_doctor`

- **Trigger:** Manual (dispatched by repair system)
- **Inputs:** `failed_workflow_run_id`, `failed_workflow_id`, `failed_job_id`, `failure_reason`, `source_context`
- **Key step:** `doctor_diagnosis` — analyzes failure evidence and classifies as `fixable` or `not_fixable`
- **Output contract:** `required: [decision, confidence, rationale]`
- **Agent profile:** `qa_automation`
- **Why it exists:** Automated failure triage — determines if a failed run can be repaired

### `workflow_environment_repair`

- **Trigger:** Manual (dispatched by repair system)
- **Key steps:** Environment repair actions — adding dependencies, fixing configuration
- **What it accomplishes:** Automated environment fixes (missing packages, config files)
- **Why it exists:** Sysadmin repair executor for environment-level failures

---

## Memory / Learning Workflows

### `create_skill`

**Trigger:** Dispatched automatically when a skill improvement proposal is approved. Also callable directly with `target_skill_name`, `patch_markdown`, `proposal_summary`, `source_proposal_id`, and `scope_id`.

**Purpose:** Materialises or updates a `SKILL.md` file on disk via the `skill-author` agent persona. The agent applies the patch, selects an appropriate scope, and writes the result. On completion, the `SkillProposalCompletionListener` writes `status='applied'` and `scope_confirmation` diagnostics back to the originating proposal.

**Key steps:**

1. `skill-author` agent persona applies the patch markdown to produce updated skill content
2. Agent determines `recommended_scope` (projects/agents/workflows) and `scope_rationale`
3. SKILL.md is written to disk with provenance metadata (`source_proposal_id`)
4. Completion listener writes `applied_at` and `scope_confirmation.pending=true` to the proposal

**Related:** `SkillProposalApprovedListener`, `SkillProposalCompletionListener`, `POST /skills/proposals/:id/confirm-scope`

---

## Blueprint Workflows

Blueprint workflows compose multiple phases into end-to-end delivery pipelines.

### `standard_feature_flow`

- **Trigger:** Manual
- **Inputs:** `scopeId`, `objective`, `requested_by`, `orchestrationId`, `scope_boundaries`, `risk_level`, `artifact_paths`
- **Jobs (DAG):**
  1. `run_discovery` → `project_discovery_ceo`
  2. (parallel) `run_spec_revision` → `project_spec_revision_ceo` (depends on discovery)
  3. (parallel) `run_implementation` → `project_work_item_generation_ceo` (depends on spec)
  4. `run_quality_gate` → `automated_quality_check` (depends on implementation)
  5. `run_review_gate` → `project_orchestration_refinement_ceo` (depends on quality)
  6. Emit events at each stage for lifecycle tracking
- **What it accomplishes:** End-to-end feature delivery: discovery → spec → implementation → QA → review
- **Why it exists:** Reference blueprint for standard software delivery lifecycle

### `hotfix_flow`

- **Trigger:** Manual
- **Key steps:** Accelerated fix pipeline — bypasses some refinement stages for urgent fixes
- **What it accomplishes:** Quick fix delivery with appropriate guardrails
- **Why it exists:** Hotfix delivery blueprint

### `documentation_audit`

- **Trigger:** Manual
- **Key steps:** Audits project documentation for completeness, consistency, and accuracy
- **What it accomplishes:** Documentation quality assurance
- **Why it exists:** Maintains project documentation quality

### `todo_web_app`

- **Trigger:** Manual
- **Key steps:** Full-stack web application development workflow
- **What it accomplishes:** End-to-end web application delivery
- **Why it exists:** Specialized blueprint for web application projects

---

## Agent Profiles Used by Workflows

| Profile                 | Used By                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `default`               | `chat_direct_agent_default`, `orchestration_invoke_agent_default`                                                                                                  |
| `ceo`                   | All `project_orchestration_*` workflows, `project_discovery_ceo`, `project_work_item_generation_ceo`, `project_spec_revision_ceo`, `project_goal_backlog_planning` |
| `qa_automation`         | `automated_quality_check`, `workflow_failure_doctor`                                                                                                               |
| `orchestration_advisor` | `project_orchestration_advisor`                                                                                                                                    |
| `skill-author`          | `create_skill`                                                                                                                                                     |
| `idea-partner`          | `project_idea_intake`                                                                                                                                              |

---

## Workflow Seeding Process

Workflows are seeded at API startup via `StartupSeedService.seedOnStartup()`:

```
1. DatabaseModule.onModuleInit()
   ↓
2. StartupSeedService.seedOnStartup()
   ↓
3. Seeds roles → secrets → providers → models → skills → profiles → skill assignments → approval rules
   ↓
4. WorkflowSeedService.seed()
   ↓
5. Reads all .yaml files from seed/workflows/
   ↓
6. Upserts each workflow into the workflow table (by workflow_id)
   ↓
7. IAMPolicyService.refreshPolicies()
```

`WorkflowSeedService` reads YAML files, parses them into `IWorkflowDefinition` structures, and upserts them into the `workflow` table. The upsert ensures that existing workflows are updated if the seed file changes, and new workflows are created if they don't exist.

The seed directory path `seed/workflows/` is relative to the repository root. Workflows use Handlebars template syntax (`{{ trigger.field }}`, `{{json inputs.field }}`) for dynamic values resolved at runtime.
