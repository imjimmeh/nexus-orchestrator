# Analysis: Heartbeat / Idle-Timeout Duplicate-Container Bug

## Goal

Document the root cause and fix surface for a bug where `workflow_step` executions
never receive heartbeats, causing the ExecutionSupervisorService to spuriously reap
them after 15 minutes and trigger duplicate container launches.

## Analysis Tasks

- [ ] Task 1: Document `ExecutionSupervisorService` sweep and reaping logic
- [ ] Task 2: Document `ExecutionHeartbeatService` and how heartbeats reach subagent vs workflow_step executions
- [ ] Task 3: Document `StepExecutionOrchestratorService` – execution entity lifecycle and container log activity piping
- [ ] Task 4: Document `StepExecutionCompletionListener` – reaped-event → retry-scheduling flow
- [ ] Task 5: Summarise gaps and proposed fixes (A, B, C)

## Status

In Progress
