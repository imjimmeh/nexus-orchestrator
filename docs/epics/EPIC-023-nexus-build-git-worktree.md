# EPIC: Nexus Build - Git Worktree & Agent Sandboxing

**Epic ID:** EPIC-023  
**Status:** Proposed  
**Created:** 2026-03-25  
**Priority:** P0 - Critical  
**Theme:** Infrastructure & Git Orchestration

---

## 1. Executive Summary

### 1.1 Problem Statement
In a multi-agent environment, agents may work on the same repository concurrently. Standard Git cloning is inefficient for this and causes locking issues. Agents also need isolated filesystems to prevent cross-contamination.

### 1.2 Solution Overview
Implement **Git Worktree Orchestration**. For every active ticket, the backend provisions a dedicated Git worktree on the host filesystem. This worktree is then mounted as a volume into the agent's "Heavy" DevContainer. This allows 5 agents to work on 5 different branches in the same repo simultaneously without conflicts.

### 1.3 Success Criteria
- Automated `git worktree add -b <branch> <path>` when a ticket starts.
- Successful mounting of the specific worktree path into a Docker container.
- Automated `git worktree remove` and branch cleanup when a ticket is finished.
- Support for concurrent worktrees for the same repository.

---

## 2. Context & User Stories

### 2.1 Context
This is the "Agent Sandbox" from Section 2 of the PRD. It is the infrastructure foundation that enables "Nexus Build" to scale beyond a single-threaded agent.

### 2.2 User Stories
- **As an Agent**, I want my own isolated workspace so that my file changes don't interfere with other agents.
- **As a System**, I want to use Git Worktrees to avoid the storage overhead of cloning the entire repo for every ticket.
- **As a Developer**, I want to see the agent's worktree on my local machine so I can inspect the code it's writing.

---

## 3. Technical Requirements

### 3.1 Backend (API/Worker)
- **Git Worktree Service:** A Node.js service wrapping shell commands for `git worktree`.
- **Path Management:** Deterministic path generation (e.g., `data/worktrees/<project-id>/<ticket-id>`).
- **Docker Mount Logic:** Extend the `docker-orchestration` service to include the worktree as a bind mount.

### 3.2 Git Operations
- **Branch Creation:** Create the target branch from the specified base branch before adding the worktree.
- **Cleanup Logic:** Prune worktrees that are no longer associated with active tickets.

---

## 4. Tasks

### Phase 1: Git Service
- [ ] Task 1: Create the `GitWorktreeService` in `apps/api/src/common/git`.
- [ ] Task 2: Implement `provisionWorktree(projectId, ticketId, baseBranch, targetBranch)`.
- [ ] Task 3: Implement `removeWorktree(projectId, ticketId)`.

### Phase 2: Docker Integration
- [ ] Task 4: Modify `ContainerOrchestrator` to accept a `worktreePath` parameter.
- [ ] Task 5: Implement the volume mount configuration (Host Path -> Container `/workspace`).
- [ ] Task 6: Verify file permission mapping between Host and Container.

### Phase 3: Lifecycle Management
- [ ] Task 7: Integrate worktree provisioning into the "In Progress" workflow trigger.
- [ ] Task 8: Implement cleanup listeners for ticket "Done" or "Aborted" states.
- [ ] Task 9: Implement a "Reconciler" to cleanup orphaned worktrees on system startup.

---

## 5. Acceptance Criteria
- [ ] Moving a ticket to "In Progress" results in a new folder in `data/worktrees`.
- [ ] Running `git worktree list` on the host shows the new worktree.
- [ ] The agent inside the container can see and edit the files in that folder.
- [ ] Committing inside the container correctly updates the Git status of that worktree.
- [ ] Moving the ticket to "Done" deletes the folder and the worktree reference.

---

## 6. Dependencies
- **EPIC-003 (Docker Orchestration):** Required for mounting the worktree.
- **EPIC-020 (Kanban Board):** Triggers the provisioning.
- **EPIC-021 (Task Config):** Provides the branch names.

---

## 7. Risks & Mitigations
- **Risk:** SSH keys / Git credentials not available inside the container.
- **Mitigation:** Mount the host's `~/.ssh` or use a Git credential helper bridge.
- **Risk:** Worktree folder collisions if ticket IDs are reused.
- **Mitigation:** Use UUIDs for the worktree folder naming.
- **Risk:** Git locks if two processes access the main `.git` folder simultaneously.
- **Mitigation:** Use a Mutex or Queue for Git operations on a per-repository basis.
