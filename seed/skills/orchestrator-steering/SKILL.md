---
name: orchestrator-steering
description: "Guide conversational project steering via structured plan presentation and approval gates. Use when steering a project through a chat/CEO conversation."
version: 1.0.0
tier: heavy
estimated_duration: 10-45 minutes
category: implementation
tags:
  - skill
prerequisites:
  - orchestration-patterns
metadata: {}
---

# Orchestrator Steering Skill

## Overview

Enable the CEO agent to steer projects conversationally by parsing user intent, presenting structured plans, collecting approvals, and routing changes through V2 generic primitives. This skill ensures all mutations go through approved channels with explicit user consent.

## Prerequisites

- The `kanban.project_state` and kanban MCP mutation tools must be available in the agent's capability manifest.
- The `conversational_artifact_steering` workflow must be seeded and active.
- The agent must be operating in a project context with an active chat session.

## Instructions

### Core Rule: Always Present Plans Before Execution

NEVER execute changes without explicit user approval. The steering workflow is:

1. **Parse** — Call `steer_project` with the user's request
2. **Present** — Show the structured plan with proposed changes and confidence
3. **Clarify** — If confidence < 0.7, ask questions before presenting actions
4. **Approve** — Wait for user confirmation (Approve/Modify/Reject/Clarify)
5. **Execute** — Route to the appropriate V2 primitive

### V2-Compliant Execution Routing

After approval, route changes through V2 generic primitives:

| Change Type                                    | Tool/Workflow                                                |
| ---------------------------------------------- | ------------------------------------------------------------ |
| Inspect one existing work item before deciding | `kanban.work_item`                                           |
| Create/update work item                        | `kanban.work_item_create` or `kanban.work_item_update`       |
| Transition work item status                    | `kanban.work_item_transition_status`                         |
| Modify PRD/SDD (artifact)                      | `conversational_artifact_steering` workflow                  |
| Publish new specs                              | `kanban.publish_specs`                                       |
| Delegate to specialist                         | `invoke_agent_workflow`                                      |
| Create/update subtask                          | `kanban.work_item_subtask_upsert`                            |
| Resume/cancel execution                        | Use workflow runtime controls exposed for the active session |

### Forbidden Actions

- Do NOT use raw git operations outside of workflows
- Do NOT bypass kanban MCP tools for kanban state mutations
- Do NOT skip the approval gate for mutating actions
- Do NOT create bespoke mutation tools — always use V2 primitives

### Context Gathering

Before generating a plan:

1. Call `kanban.project_state` with `query_type: work_items` to understand current state
2. If the request or current context references one specific existing item, call `kanban.work_item` for that UUID to inspect focused metadata and feedback fields such as `feedbackNeeded`, `decisionPrompt`, and `humanDecisionResponse` before proposing mutations.
3. Call `kanban.project_state` with `query_type: artifacts` to check existing specs
4. Use the context summary returned by `steer_project` to inform the user

### Steering Session Behavior

- Maintain context across turns: approved plans, rejected changes, pending questions
- If the user rejects a plan, ask what they'd like to change
- If the user modifies a plan, regenerate using `steer_project` with the modified request
- After execution completes, summarize outcomes in chat

## Output Format

Present plans in this structured format:

```
## Steering Plan: [title]

**Confidence**: [0.0–1.0]
**Intent**: [parsed intent category]

### Proposed Actions
1. [action type]: [description] → [target entity]
2. [action type]: [description] → [target entity]

### Risk Assessment
- [risk level]: [description]

Awaiting approval: ✓ Approve / ✏ Modify / ✗ Reject / ? Clarify
```
