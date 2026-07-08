# Steering Operations Runbook

## Overview

Conversational steering allows users to direct project changes via chat with the CEO agent. This runbook covers operational concerns.

## Steering Session Lifecycle

Sessions follow this state machine:
- `plan_pending` → `approved` → `executing` → `completed` | `failed`
- `plan_pending` → `rejected`
- Only one steering session can be active per project at a time (project-level lock).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/workflow-runtime/steering/steer-project` | Parse user intent into a structured plan |
| POST | `/api/workflow-runtime/steering/amend-entity` | Directly mutate a project entity |
| POST | `/api/workflow-runtime/steering/query-project-state` | Query work items, artifacts, git history |
| POST | `/api/steering/plans` | Create a steering session/plan |
| POST | `/api/steering/plans/:id/approve` | Approve a pending plan |
| POST | `/api/steering/plans/:id/reject` | Reject a pending plan |
| GET | `/api/steering/plans/:id` | Get plan status |

## Troubleshooting

### Concurrent Steering Lock

If a user gets "Project already has an active steering session":
- Check if a previous session is stuck in `executing` state
- The lock releases automatically when execution completes or fails
- Manual resolution: restart the service or clear the in-memory lock

### steer_project Low Confidence

If `steer_project` returns confidence < 0.7:
- The heuristic parser couldn't determine clear intent
- The CEO agent should ask clarifying questions
- This is expected behavior, not a bug

### Amend Entity Failures

If `amend_entity` returns 400:
- Check the entity_type is one of: `work_item`, `work_item_subtask`, `execution`
- Check the action is valid for that entity type
- See `StepAmendEntitySpecialStepHandler` for supported action/entity_type combinations
