---
name: work-item-generation
description: Hydration playbook for publishing canonical specs into work items.
version: 1.0.0
tier: light
estimated_duration: 20 minutes
category: playbook
tags:
  - hydration
  - work-items
prerequisites: []
metadata: {}
---

# Work Item Generation

Use when specs are ready and hydration has not been completed.

## Goals
- Hydrate work items only through kanban.publish_specs path.
- Persist hydration and validation outcomes.

## Instructions
1. Validate canonical specs.
2. Publish specs through kanban.publish_specs to hydrate work items.
3. Record created/updated work items and any failures.
4. Write hydration summary to orchestration state.
5. End the run with `yield_session` only when that tool is callable in the active session. In seeded event workflows that expose `step_complete` instead, persist the hydration summary and finish with `step_complete`.

## Tools
- Use: validate_specs, kanban.publish_specs, update_orchestration_state
- Avoid: manual work item creation APIs for canonical hydration paths

## Done Criteria
- Hydration summary persisted.
- Validation failures explicitly captured.
- The active session is ended with the correct completion primitive for that workflow (`yield_session` when available, otherwise `step_complete`).

## Overview
- TODO: Add Overview content.

## Prerequisites
- TODO: Add Prerequisites content.

## Output Format
- TODO: Add Output Format content.
