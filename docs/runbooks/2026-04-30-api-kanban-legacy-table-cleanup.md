# API Kanban Legacy Table Cleanup Runbook

Use this after apps/kanban has been verified as the source of truth and backups have been captured.

1. Confirm `apps/api` is deployed with EPIC-157 and no longer registers project/work-item/goals entities in `DatabaseModule`.
2. Confirm `apps/kanban` serves project, work-item, goals, dispatch, review, and MCP routes.
3. Take a PostgreSQL backup of the API database.
4. Archive legacy API tables if retention is required: `projects`, `project_members`, `project_agent_capacities`, `project_orchestrations`, `project_orchestration_action_requests`, `project_goals`, `project_goal_worklogs`, `work_items`, `work_item_dependencies`, and `work_item_subtasks`.
5. Drop the archived legacy API kanban tables only after the backup and apps/kanban verification are complete.
6. Roll back by restoring the backup; do not rewrite historical API migrations.
