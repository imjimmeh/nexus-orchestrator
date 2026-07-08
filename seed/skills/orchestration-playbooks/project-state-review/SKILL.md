---
name: project-state-review
description: >-
  Active delivery review playbook for progressing ready work and handling
  blocked/stalled items.
version: 1.0.0
tier: light
estimated_duration: 10m
category: playbook
tags:
  - orchestration
  - review
  - delivery
prerequisites: []
metadata: {}
---

# Project State Review

## Overview
Active delivery review playbook for progressing ready work and handling blocked/stalled items.
Use when work items are active.

## Prerequisites
- Work items are active in the current project.

## Instructions
1. Group work items by status and priority.
2. Inspect recent run outcomes for active items.
3. Identify blocked, stalled, and ready candidates.
4. Record dispatch/escalation recommendations in state.
5. End the run with `yield_session` only when that tool is callable in the active session. In seeded event workflows that expose `step_complete` instead, persist the review summary and finish with `step_complete`.

## Tools
- Use: kanban.project_state, get_orchestration_state, update_orchestration_state
- Avoid: broad spec regeneration unless evidence requires it

## Output Format
- Review summary and recommended actions persisted.
- The active session is ended with the correct completion primitive for that workflow (`yield_session` when available, otherwise `step_complete`).
