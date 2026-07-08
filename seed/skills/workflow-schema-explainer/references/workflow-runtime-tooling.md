# Workflow Runtime Tooling

## Purpose
Use runtime tools to manage workflow definitions and schedules from agent contexts without direct admin route access.

## Workflow Definition Tools
- list_workflows
- get_workflow
- create_workflow_definition
- update_workflow_definition
- delete_workflow_definition

## Schedule Tools
- list_schedules
- get_schedule
- create_scheduled_job
- update_scheduled_job
- pause_scheduled_job
- resume_scheduled_job
- run_scheduled_job_now
- delete_scheduled_job
- list_schedule_runs

## Safety Expectations
- Prefer read operations before mutation.
- Confirm target IDs before write/delete operations.
- Treat mutating tools as approval-gated in supervised mode.
- Report validation failures with exact field-level guidance.

## Mutation Playbook
1. Read current object state.
2. Validate intended change.
3. Execute a single mutation.
4. Re-read object state to confirm effect.
5. Summarize resulting status and next action.
