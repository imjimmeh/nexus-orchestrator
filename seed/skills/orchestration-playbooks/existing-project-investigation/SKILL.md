---
name: existing-project-investigation
description: >-
  Investigation playbook for projects with existing artifacts but incomplete
  orchestration context.
version: 1.0.0
tier: light
estimated_duration: 20 minutes
category: implementation
tags:
  - skill
prerequisites: []
metadata: {}
---

# Existing Project Investigation

Use when confidence is low or investigation_needed is true.

## Goals
- Build an accurate current-state model.
- Identify gaps between artifacts and execution state.
- Prefer persisted probe evidence when available.

## Instructions
1. Read AGENTS.md policy before strategic decisions.
2. Review epics/specs and classify status.
3. Review work-item lifecycle distribution and active blockers.
4. Cross-reference epics to work items and note gaps.
5. Persist project health summary and recommendation.
6. Batch ambiguities into one ask_user_questions call.
7. End the run with `yield_session` only when that tool is callable in the active session. In seeded event workflows that expose `step_complete` instead, persist the same summary and finish with `step_complete`.

## Tools
- Use: kanban.project_state, get_orchestration_state, update_orchestration_state
- Avoid: mutating actions unless explicitly required by current playbook scope

## Done Criteria
- Health summary and coverage gaps persisted.
- recommended_next_playbook set.
- The active session is ended with the correct completion primitive for that workflow (`yield_session` when available, otherwise `step_complete`).

## Overview
- TODO: Add Overview content.

## Prerequisites
- TODO: Add Prerequisites content.

## Output Format
- TODO: Add Output Format content.
