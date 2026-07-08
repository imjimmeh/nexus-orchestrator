# EPIC-098: Non-Kanban Chat Agent Seeding and Runtime Capability Enablement (V1 + V2)

Status: Planned
Priority: P1
Depends On: EPIC-092, EPIC-095, EPIC-096, EPIC-097
Related:

1. docs/architecture/chat-sessions.md
2. docs/architecture/agent-capability-orchestration.md
3. docs/architecture/agent-skills.md
4. docs/guides/telegram-chat-setup.md
5. seed/workflows/orchestration-invoke-agent-default.workflow.yaml
   Last Updated: 2026-04-14

---

## 1. Epic Summary

Deliver a complete non-kanban chat agent baseline by combining:

1. V1: Seed and route new general-purpose agent profiles for Telegram/chat usage.
2. V2: Expose governed runtime capabilities so chat agents can create/publish tools and create/save skills from within chat workflows.

This epic removes the current mismatch where seeded profiles are mostly kanban-oriented and therefore perform poorly for ad-hoc Telegram conversations.

---

## 2. Problem Statement

Current chat behavior has three blockers:

1. Most seeded prompts and behavior are orchestration/project-centric.
2. The chat invoke workflow allowlist is too narrow for practical coding/general assistant work.
3. Tool/skill authoring lifecycle exists in the platform but is not fully exposed to agent runtime paths used by chat.

As a result, users can switch agents in Telegram but still get low-utility responses or missing-capability behavior for common ad-hoc tasks.

---

## 3. Goals

1. Provide at least three seeded, non-kanban-first agent profiles for chat.
2. Make one profile explicitly software-engineering focused with coding tools.
3. Make one profile explicitly friendly general assistant with shell and execution abilities.
4. Enable subagent orchestration, war-room actions, and memory access where policy allows.
5. Enable governed runtime tool lifecycle actions (candidate create/validate/publish/upsert).
6. Enable governed runtime skill lifecycle actions (create/update/files/assignment paths as approved).
7. Keep defaults safe and explicit for Telegram ingress routing.

---

## 4. Non-Goals

1. Implementing full browser interaction runtime capability in this epic.
2. Replacing workflow-level web_automation job architecture.
3. Redesigning chat session architecture boundaries across services.
4. Building broad cross-channel parity for non-Telegram adapters.

---

## 5. Scope

### 5.1 V1 Scope (Agent Seeding + Chat Routing Usability)

1. Add new seeded profiles under seed/agents with non-kanban prompts:
   - software-engineer-assistant
   - friendly-general-assistant
   - research-and-automation-assistant
2. Assign baseline skills to each profile (reuse existing skills where possible).
3. Expand permissions for orchestration_invoke_agent_default workflow to allow practical ad-hoc execution tools.
4. Add IAM policy entries for newly seeded profiles to prevent runtime tool mount denial.
5. Update Telegram setup defaults/docs to recommend a non-kanban default profile.
6. Add/adjust targeted tests for seed loading and profile access behavior.

### 5.2 V2 Scope (Runtime Capability Enablement)

1. Add workflow-runtime callable endpoints/capabilities for tool candidate lifecycle:
   - create_tool_candidate
   - validate_tool_candidate
   - publish_tool_candidate
   - upsert_tool
2. Add workflow-runtime callable endpoints/capabilities for skill lifecycle operations required for agent self-improvement workflows.
3. Ensure all new runtime mutation paths are governance-aware and auditable.
4. Ensure Agent-role execution path works through runtime endpoints used by chat workflows.
5. Add policy/approval checks for privileged actions where required.
6. Add documentation for runtime contracts and safe usage patterns.

---

## 6. Proposed New Seeded Agents

1. software-engineer-assistant
   - Persona: pragmatic software engineer who helps implement, debug, refactor, and explain code.
   - Baseline tools: read_file, write_file, bash, manage_todo_list, query_memory, get_capabilities, get_agent_profiles, nexus_orchestrator, spawn_subagent, spawn_subagent_async, wait_for_subagents, check_subagent_status.
2. friendly-general-assistant
   - Persona: friendly and highly helpful general assistant.
   - Baseline tools: read_file, write_file, bash, manage_todo_list, query_memory, get_capabilities, get_agent_profiles, nexus_orchestrator.
3. research-and-automation-assistant
   - Persona: evidence-first research and reusable-automation specialist.
   - Baseline tools: read_file, write_file, bash, query_memory, manage_todo_list, get_capabilities, nexus_orchestrator, spawn_subagent, wait_for_subagents.

Notes:

1. Final tool lists are constrained by profile + workflow + job policies.
2. New profiles must be represented in IAM policy config to avoid mount-time denials.

---

## 7. Architecture and Component Changes

### 7.1 Seed Assets

1. Add new seed profile folders and files:
   - seed/agents/<profile>/agent.json
   - seed/agents/<profile>/PROMPT.md
2. Ensure assigned_skills are explicit in each profile definition.

### 7.2 Chat Invoke Workflow Policy

1. Update seed/workflows/orchestration-invoke-agent-default.workflow.yaml permissions.allow_tools to include the curated runtime baseline needed for ad-hoc chat assistants.
2. Keep deny list explicit and least-privilege where possible.

### 7.3 IAM and Tool Mount Alignment

1. Add profile entries to apps/api/src/security/iam-policy.service.ts.
2. Add/update corresponding tests in iam-policy.service.spec.ts.
3. Verify SDK allowlist generation and mounted registry tool enforcement continue to align with policy.

### 7.4 Runtime Tool Lifecycle Exposure

1. Add runtime-facing routes under workflow-runtime for tool candidate lifecycle wrappers.
2. Add orchestration/runtime service methods and contracts.
3. Ensure event ledger audit coverage for attempt/success/denied/failure outcomes.

### 7.5 Runtime Skill Lifecycle Exposure

1. Add runtime-facing routes for skill lifecycle actions required by delegated agents.
2. Route through existing admin/domain services with runtime-safe input validation and policy checks.
3. Ensure assignment and file operations remain constrained to approved contexts.

### 7.6 Telegram/Chat Defaults and Docs

1. Keep CHAT_TELEGRAM_DEFAULT_PROJECT_ID optional (null by default) for project-agnostic chat.
2. Set and document recommended default profile to friendly-general-assistant for ad-hoc conversational use.
3. Update setup/operations docs accordingly.

---

## 8. Actionable Tasks

- [ ] E098-001 Define final profile contracts for software-engineer-assistant, friendly-general-assistant, and research-and-automation-assistant.
- [ ] E098-002 Add seed profile assets (agent.json + PROMPT.md) for all new profiles.
- [ ] E098-003 Add or refine assigned skills for the new profiles.
- [ ] E098-004 Update invoke-agent workflow allow_tools policy for ad-hoc chat capabilities.
- [ ] E098-005 Add IAM policy entries for new profiles.
- [ ] E098-006 Add/update IAM policy tests for new profiles and denied tool cases.
- [ ] E098-007 Add/update seed loader tests to cover new profile definitions.
- [ ] E098-008 Update Telegram setup docs and defaults for non-kanban chat routing.
- [ ] E098-009 Add runtime endpoint for create_tool_candidate.
- [ ] E098-010 Add runtime endpoint for validate_tool_candidate.
- [ ] E098-011 Add runtime endpoint for publish_tool_candidate.
- [ ] E098-012 Add runtime endpoint for upsert_tool.
- [ ] E098-013 Add runtime capability contracts and preflight integration for tool lifecycle actions.
- [ ] E098-014 Add runtime endpoints/contracts for skill lifecycle actions (create/update/file operations as approved).
- [ ] E098-015 Add runtime governance checks and approval handling for privileged operations.
- [ ] E098-016 Add event/audit telemetry for runtime tool/skill lifecycle mutations.
- [ ] E098-017 Add integration/unit tests for runtime lifecycle paths in Agent execution context.
- [ ] E098-018 Update architecture and guide docs for new runtime capabilities.

---

## 9. Acceptance Criteria

1. Three new non-kanban seeded profiles are active and selectable via chat/Telegram.
2. software-engineer-assistant can perform coding-task baseline flows (read/write/bash + verification) in ad-hoc chat runs.
3. friendly-general-assistant provides project-agnostic conversational support without kanban-only assumptions.
4. research-and-automation-assistant can perform evidence-based and delegation-oriented tasks with approved tools.
5. New profiles have working IAM mappings and do not fail due to mount-time policy mismatch.
6. Chat invoke workflow policy allows the intended baseline runtime tools for ad-hoc assistant usage.
7. Runtime tool lifecycle actions are callable through workflow-runtime by agent workflows with governance enforcement.
8. Runtime skill lifecycle actions are callable through workflow-runtime by agent workflows with governance enforcement.
9. Denied or approval-required actions return explicit, auditable outcomes.
10. Telegram default routing can be configured to a non-kanban profile and validated through /new and /agent flows.
11. Documentation and runbooks are updated for operators and contributors.
12. Touched tests pass and lint/type checks remain clean.

---

## 10. Test and Quality Gates

Recommended verification commands from repository root:

1. npm run lint:api
2. npm run lint --workspace=apps/chat
3. npm run build:api
4. npm run test --workspace=apps/api -- src/database/seeds/agent-profiles.seed.spec.ts
5. npm run test --workspace=apps/api -- src/database/seeds/agent-profiles/agent-profiles-file-seed.service.spec.ts
6. npm run test --workspace=apps/api -- src/security/iam-policy.service.spec.ts
7. npm run test --workspace=apps/api -- src/workflow/workflow-runtime-tools.controller.spec.ts
8. npm run test --workspace=apps/chat -- src/channel-adapters/telegram/telegram-command-router.service.spec.ts
9. npm run test --workspace=apps/chat -- src/channel-adapters/telegram/telegram-runtime-settings.service.spec.ts

---

## 11. Risks and Mitigations

1. Risk: Over-permissioning chat agents.
   Mitigation: enforce least privilege by profile, workflow, and job policy layers; use explicit allowlists.
2. Risk: New profiles break at runtime due to IAM mismatch.
   Mitigation: require IAM + seed profile parity tests as merge gate.
3. Risk: Runtime lifecycle actions bypass governance.
   Mitigation: route through workflow-runtime governance paths with approval and audit.
4. Risk: Prompt drift back to kanban assumptions.
   Mitigation: prompt review checklist with ad-hoc/general chat scenarios before enabling defaults.
5. Risk: Operator confusion on default profile behavior.
   Mitigation: explicit Telegram setup docs and safe defaults.

---

## 12. Exit Criteria

1. Non-kanban assistants are seeded, active, and usable in Telegram/ad-hoc chat.
2. Runtime tool and skill lifecycle actions are available through governed agent runtime paths.
3. Policy, telemetry, documentation, and tests are complete enough for production rollout.
