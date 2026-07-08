# War Room and Retrospective Runbook

## Purpose

Operational guide for:

1. Managing project-scoped War Room sessions from the orchestration UI.
2. Validating deterministic War Room workflow hooks.
3. Monitoring retrospective diagnostics and replaying retrospectives.

## Prerequisites

1. API and web services are running.
2. User has `Admin` or `Developer` role for retrospective replay.
3. Project orchestration has an active or recent workflow run.

## UI Operations

1. Open project workspace -> Orchestration tab.
2. Use `War Room Manager` to:

- Open a session.
- Select an existing session for the current run.
- Invite participants.
- Post a message.
- Close the session.

3. Use `Runtime Capability Health` card to review retrospective status and trigger replay.

## REST Endpoints

War Room endpoints (project scoped):

1. `POST /projects/:projectId/orchestration/war-room/sessions/open`
2. `GET /projects/:projectId/orchestration/war-room/sessions`
3. `GET /projects/:projectId/orchestration/war-room/sessions/:sessionId`
4. `POST /projects/:projectId/orchestration/war-room/sessions/:sessionId/invite`
5. `POST /projects/:projectId/orchestration/war-room/sessions/:sessionId/messages`
6. `POST /projects/:projectId/orchestration/war-room/sessions/:sessionId/blackboard`
7. `POST /projects/:projectId/orchestration/war-room/sessions/:sessionId/signoffs`
8. `POST /projects/:projectId/orchestration/war-room/sessions/:sessionId/close`

Retrospective replay endpoint:

1. `POST /projects/:projectId/orchestration/retrospective/replay` with optional body `{ "mode": "append" | "replace" }`.

## Deterministic Workflow Hooks

Verify these seed workflows include explicit War Room alignment jobs:

1. `project-spec-revision-ceo.workflow.yaml` -> `war_room_revision_alignment`
2. `work-item-refinement-default.workflow.yaml` -> `war_room_refinement_alignment`
3. `work-item-in-progress-default.workflow.yaml` -> `war_room_plan_alignment`

## Key System Settings

War Room policy defaults:

1. `agent_war_room_required_signoff_roles`
2. `agent_war_room_deadlock_signoff_threshold`
3. `agent_war_room_auto_ceo_tie_break`
4. `agent_war_room_max_message_chars`
5. `agent_war_room_auto_open_enabled`
6. `agent_war_room_auto_open_rules`

Retrospective visibility mirrors:

1. `retrospective_autorun_enabled`
2. `retrospective_context_injection_enabled`
3. `retrospective_org_mirror_enabled`

## Verification Checklist

1. Open and close a War Room session from UI for an active run.
2. Confirm War Room session appears in list and state endpoints.
3. Trigger retrospective replay from UI and confirm diagnostics refresh.
4. Confirm decision log and workflow events contain War Room lifecycle entries.
5. Run targeted tests:

- `apps/web/src/pages/project-workspace/OrchestrationTab.spec.tsx`
- `apps/api/src/database/seeds/workflows.seed.contract.spec.ts`
- `apps/api/src/settings/system-settings.service.spec.ts`
