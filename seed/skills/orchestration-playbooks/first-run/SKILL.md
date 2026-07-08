---
name: first-run
description: >-
  First orchestration session playbook for project orientation and deterministic
  next-playbook recommendation.
version: 1.0.0
tier: light
estimated_duration: 5m
category: playbook
tags:
  - orchestration
  - startup
  - orientation
prerequisites: []
metadata: {}
---

# First Run

## Overview
First orchestration session playbook for project orientation and deterministic next-playbook recommendation.
Use when this project has no existing orchestration session state.

## Prerequisites
- Project brief and high-level goals are available.
- Repository is accessible.

## Instructions
1. Read project brief and high-level goals.
2. Determine import vs greenfield context from repository shape.
3. Record artifact inventory and blocking open questions.
4. Write state via update_orchestration_state.
5. End the run with `yield_session` only when that tool is callable in the active session. In seeded event workflows that expose `step_complete` instead, persist the same inventory summary and finish with `step_complete`.

## Tools
- Use: kanban.project_state, get_orchestration_state, update_orchestration_state, list_path
- Avoid: dispatch/delegation actions, invoke_agent_workflow, kanban.publish_specs

## Output Format
- Inventory is captured in orchestration state.
- Recommended next playbook is set.
- The active session is ended with the correct completion primitive for that workflow (`yield_session` when available, otherwise `step_complete`).
