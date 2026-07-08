# EPIC: Nexus Build - Task Configuration & Dispatch System

**Epic ID:** EPIC-021  
**Status:** Proposed  
**Created:** 2026-03-25  
**Priority:** P1 - High  
**Theme:** Task Dispatch & Parameters

---

## 1. Executive Summary

### 1.1 Problem Statement
Before an agent can begin working on a ticket, it needs specific execution parameters: Which branch should it work on? Which persona is best? What existing files provide the best context? Without this, agents may waste tokens on discovery.

### 1.2 Solution Overview
Implement a **Task Configuration Modal** that appears before a ticket enters the "In Progress" column. It allows users to select an Agent Profile, a Base Branch, Target Branch, and "@-mention" specific files or documentation for the agent. It also includes cost and loop limit guards.

### 1.3 Success Criteria
- Modal UI triggered by clicking a ticket or moving it to "To Do"/"In Progress".
- Agent Profile Selector (Populated from the `AgentProfile` DB).
- Branch Picker fetching real-time remote branches from the project's repository.
- File/Context Attachment UI for injecting specific starting context.
- Cost/Limit Guards (Max tokens, max loop count).

---

## 2. Context & User Stories

### 2.1 Context
This is the "Task Dispatch" from Journey 2 of the PRD. It bridges the gap between the static ticket and the dynamic agent execution environment.

### 2.2 User Stories
- **As a User**, I want to choose a "Frontend Specialist" agent for my UI ticket.
- **As a User**, I want to specify that a task should branch off `feature/auth-v2` instead of `main`.
- **As a User**, I want to attach `@auth/service.ts` to the ticket so the agent knows the existing logic.
- **As a User**, I want to set a $2.00 limit on a ticket to prevent runaway costs.

---

## 3. Technical Requirements

### 3.1 Backend (API)
- **Branch API:** Implement a service to fetch remote branches for a given project/repo.
- **Agent Profile API:** Endpoint to fetch available agent personas.
- **Execution Payload Generator:** Service that compiles the Modal inputs into a standardized JSON for the Workflow Engine.

### 3.2 Frontend (Web)
- **TaskConfigModal Component:** Multi-tab or multi-step form.
- **BranchSelector Component:** Searchable dropdown for branches.
- **ContextPicker Component:** Tree-view or search-bar for files (fetched from the project's worktree).
- **LimitGuardInputs:** Form fields for max tokens/loops with validation.

---

## 4. Tasks

### Phase 1: API & Basic Modal
- [ ] Task 1: Create `ExecutionConfig` schema to store ticket-specific run parameters.
- [ ] Task 2: Implement "List Remote Branches" API for projects.
- [ ] Task 3: Build the basic Task Configuration Modal UI.
- [ ] Task 4: Connect Agent Profile selection to the modal.

### Phase 2: Context & Files
- [ ] Task 5: Implement File Tree API for projects to support context selection.
- [ ] Task 6: Build the "Context Attachment" UI (drag-and-drop or tag-based).
- [ ] Task 7: Implement "Documentation URL" attachment logic.

### Phase 3: Limits & Validation
- [ ] Task 8: Build the "Cost/Limit Guards" UI section.
- [ ] Task 9: Implement validation to ensure a target branch name is valid.
- [ ] Task 10: Integrate the configuration into the "Start Agent" workflow trigger.

---

## 5. Acceptance Criteria
- [ ] Clicking a "Configure" button on a ticket opens the modal.
- [ ] Branch dropdown shows branches currently in the Git repository.
- [ ] Agent Profile dropdown shows all registered agents (e.g., Frontend, Backend, QA).
- [ ] Users can type "@file" to select specific files from the project.
- [ ] Saving the configuration persists it to the `work_items` table.
- [ ] Dragging to "In Progress" uses these exact parameters for the backend container.

---

## 6. Dependencies
- **EPIC-020 (Kanban Board):** For the ticket interaction points.
- **EPIC-017 (Agent Capability Orchestration):** For agent profiles.
- **EPIC-023 (Git Worktree):** Required for fetching real-time repository metadata.

---

## 7. Risks & Mitigations
- **Risk:** Fetching branch lists for large repos could be slow.
- **Mitigation:** Cache branch lists on the server; use background refresh.
- **Risk:** Users selecting incompatible files/folders for context.
- **Mitigation:** Add "Context Size" estimator to warn the user if they exceed context window limits.
