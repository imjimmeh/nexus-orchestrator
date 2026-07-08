# EPIC: Nexus Build - Inception Flow & Architect Agent

**Epic ID:** EPIC-019  
**Status:** Proposed  
**Created:** 2026-03-25  
**Priority:** P0 - Critical  
**Theme:** Project Inception & Scoping

---

## 1. Executive Summary

### 1.1 Problem Statement
Starting a new software project requires significant manual effort to define requirements (PRD), design architecture (SDD), and break down work into actionable tasks. There is often a disconnect between the high-level vision and the initial backlog.

### 1.2 Solution Overview
Implement the **Inception Workspace**, a dual-pane interface where a user collaborates with an "Architect Agent" to generate project specifications. The agent streams `PRD.md` and `SDD.md` updates in real-time and automatically populates the Kanban board with proposed work items derived from these specs.

### 1.3 Success Criteria
- Interactive dual-pane UI: Chat (Left) and Markdown Preview (Right).
- Architect Agent successfully generates valid PRD and SDD documents.
- "Generate Work Items" feature accurately parses SDD into hierarchical Epics and Tasks.
- User can edit and approve proposed tasks before they are committed to the database.
- Initial specs are automatically committed to the repository's `main` branch.

---

## 2. Context & User Stories

### 2.1 Context
This epic is the first stage of the "Nexus Build" journey. It transforms an abstract idea into a structured project with a managed backlog. It leverages the existing `workflow-engine` to run the Architect Agent.

### 2.2 User Stories
- **As a User**, I want to describe my project idea to an AI architect so that I don't have to write the first draft of my specs manually.
- **As a User**, I want to see the PRD and SDD update live as I talk to the agent so that I can provide immediate feedback.
- **As a User**, I want the AI to propose a list of tasks based on the architecture so that I can start execution immediately.

---

## 3. Technical Requirements

### 3.1 Backend (API)
- **Project Model:** Create `Project` entity (Name, Repository URL, Base Path).
- **Inception Workflow:** Define a specialized workflow for the Architect Agent.
- **Spec Parser Service:** Logic to extract tasks (regex or LLM-based) from Markdown headings/lists.
- **Git Integration:** Tool for the agent to commit files to the `main` branch.

### 3.2 Frontend (Web)
- **InceptionPage Component:** Dual-pane layout using `react-resizable-panels`.
- **Chat Interface:** Real-time message streaming from the Architect Agent.
- **Markdown Previewer:** Syntax-highlighted and formatted rendering of the current spec drafts.
- **Task Proposal UI:** A "staging" list view for tasks before they become database records.

---

## 4. Tasks

### Phase 1: Data Models & Basic UI
- [ ] Task 1: Create `Project` and `WorkItem` database schemas/migrations.
- [ ] Task 2: Implement Project CRUD API.
- [ ] Task 3: Build the basic Inception Workspace layout in the React app.

### Phase 2: Architect Agent Integration
- [ ] Task 4: Define the "Architect" Agent Profile and Workflow YAML.
- [ ] Task 5: Implement WebSocket streaming for the inception chat.
- [ ] Task 6: Implement real-time markdown synchronization between backend state and frontend preview.

### Phase 3: Task Generation & Approval
- [ ] Task 7: Build the "Spec Parser" to identify Epics/Tasks in the SDD.
- [ ] Task 8: Create the Task Proposal UI component (Review/Edit/Approve list).
- [ ] Task 9: Implement the bulk-save logic to move tasks from "Proposed" to the Kanban database.
- [ ] Task 10: Implement the Git commit tool for the Architect Agent to save specs to the repo.

---

## 5. Acceptance Criteria
- [ ] Clicking "New Project" opens the Inception Workspace.
- [ ] The Architect Agent responds to chat and updates the Markdown pane.
- [ ] Markdown pane supports syntax highlighting for code blocks.
- [ ] "Generate Tasks" button parses the current SDD and shows a list of cards.
- [ ] Approving the tasks populates the project's Kanban board.
- [ ] `PRD.md` and `SDD.md` are found in the project's root directory after approval.

---

## 6. Dependencies
- **EPIC-005 (Workflow Engine):** Required for running the Architect Agent.
- **EPIC-009 (REST API):** Required for project/work item management.
- **EPIC-017 (Agent Capability Orchestration):** For managing the Architect persona.

---

## 7. Risks & Mitigations
- **Risk:** LLM produces poorly formatted tasks.
- **Mitigation:** Use structured output (JSON/Zod) for the task generation step instead of raw markdown parsing if necessary.
- **Risk:** Large PRDs exceeding token limits.
- **Mitigation:** Implement chunked updates and memory management for the Inception session.
