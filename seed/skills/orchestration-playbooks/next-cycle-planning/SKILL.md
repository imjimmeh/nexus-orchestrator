---
name: next-cycle-planning
description: >-
  Planning playbook for selecting the next executable batch when the active
  queue is clear.
version: 1.0.0
tier: light
estimated_duration: 10m
category: playbook
tags:
  - orchestration
  - planning
  - cycle
prerequisites: []
metadata: {}
---

# Next Cycle Planning

## Overview
Planning playbook for selecting the next executable batch when the active queue is clear.
Use when no work items are active and project health is strong.

## Prerequisites
- Active queue is clear.
- Project health is strong.

## Instructions
1. Review recently completed and blocked items.
2. Select next ready work-item batch.
3. Validate dependencies and capacity assumptions.
4. Persist strategy rationale and selected batch in orchestration state.
5. End the run with `yield_session` only when that tool is callable in the active session. In seeded event workflows that expose `step_complete` instead, persist the next-batch rationale and finish with `step_complete`.

## Tools
- Use: kanban.project_state, get_orchestration_state, update_orchestration_state
- Avoid: speculative delegation without readiness evidence

## Output Format
- Next batch and rationale persisted.
- recommended_next_playbook set if needed.
- The active session is ended with the correct completion primitive for that workflow (`yield_session` when available, otherwise `step_complete`).
