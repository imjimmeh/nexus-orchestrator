# EPIC: Nexus Build - Autonomous CI/CD Loop & Lifecycle Automation

**Epic ID:** EPIC-024  
**Status:** Proposed  
**Created:** 2026-03-25  
**Priority:** P0 - Critical  
**Theme:** Lifecycle Automation & CI/CD Gates

---

## 1. Executive Summary

### 1.1 Problem Statement
The Kanban board is currently "dumb" and requires humans to manage the transition from "Review" to "Merge". This slows down the autonomous ecosystem. We need the backend to handle the full lifecycle automatically.

### 1.2 Solution Overview
Implement **Automation Hooks** that map Kanban column transitions to specific backend YAML workflows. This creates an autonomous CI/CD loop:
1. `TO_DO` -> `IN_PROGRESS`: Spawns Dev Agent.
2. `IN_PROGRESS` -> `IN_REVIEW`: Pauses Dev Agent, spawns QA Agent.
3. `QA PASS`: Moves ticket to `READY_TO_MERGE`.
4. `READY_TO_MERGE` -> `DONE`: Merges branch, deletes worktree.

### 1.3 Success Criteria
- Backend triggers that detect status changes.
- Successful spawning of secondary "QA Reviewer" agents.
- Automated PR creation and merging using Git tools.
- Dehydration and cleanup of containers/worktrees after "Done".

---

## 2. Context & User Stories

### 2.1 Context
This is the "Autonomous CI/CD Loop" from Journey 4 of the PRD. It is the "Automation Hook" mentioned in Phase 1 Section 4 of the plan.

### 2.2 User Stories
- **As a Developer**, I want the agent to automatically submit its work for review when it's done.
- **As a Lead**, I want a QA agent to verify the code against my acceptance criteria before I see it.
- **As a User**, I want my tickets to "self-close" and self-cleanup when the code is merged.
- **As a QA Agent**, I want to be able to "Reject" a ticket and send it back to the Dev agent with feedback.

---

## 3. Technical Requirements

### 3.1 Backend (Trigger System)
- **Status Observer Service:** Monitors the `WorkItem` database for status changes.
- **Transition Mapping Registry:** Config mapping (e.g., `StatusChange.IN_REVIEW -> Workflow: QA_AGENT`).
- **QA Feedback Tool:** A tool for agents to write comments back to the ticket history.

### 3.2 Automated Git Tools
- **Merge Tool:** Service to merge the ticket's target branch into the project's base branch.
- **PR Tool:** Logic to create pull requests (GitHub/GitLab) if configured.
- **Prune Tool:** Final stage cleanup for worktrees and branches.

---

## 4. Tasks

### Phase 1: Triggers & Hooks
- [ ] Task 1: Create the `StatusObserverService` in the API.
- [ ] Task 2: Implement the mapping logic for YAML workflow triggers.
- [ ] Task 3: Implement the "Dev Container Dehydration" logic on status change.

### Phase 2: QA & Review Logic
- [ ] Task 4: Define the "QA Reviewer" Agent Profile and Workflow YAML.
- [ ] Task 5: Implement the "Accept/Reject" tools for the QA agent.
- [ ] Task 6: Implement logic to "rehydrate" a Dev agent if a ticket is rejected.

### Phase 3: Merging & Cleanup
- [ ] Task 7: Build the `GitMergeService` to merge branches.
- [ ] Task 8: Implement the "Auto-Merge" gate for the `READY_TO_MERGE` status.
- [ ] Task 9: Implement the "Finalize & Cleanup" task (deletes worktree, prunes branch).
- [ ] Task 10: Verify the end-to-end "Loop" with an automated functional test.

---

## 5. Acceptance Criteria
- [ ] Dragging a ticket to "In Review" automatically starts a new "QA" run.
- [ ] The QA agent's thoughts and terminal output appear in the Active Session.
- [ ] If QA rejects, the ticket moves back to "In Progress" and the original Dev agent is notified.
- [ ] If QA approves, the code is merged into the base branch automatically.
- [ ] The ticket moves to "Done" and the worktree folder is deleted.

---

## 6. Dependencies
- **EPIC-020 (Kanban Board):** For the source of status changes.
- **EPIC-022 (Active Session):** For observing the QA agent's work.
- **EPIC-023 (Git Worktree):** For merging and cleanup operations.

---

## 7. Risks & Mitigations
- **Risk:** Merge conflicts during the automated "Done" phase.
- **Mitigation:** If a merge fails, move the ticket to a "Blocked" column and notify a human.
- **Risk:** QA agents being too strict or too lenient.
- **Mitigation:** Provide the QA agent with the specific "Acceptance Criteria" from the ticket description as its grounding.
