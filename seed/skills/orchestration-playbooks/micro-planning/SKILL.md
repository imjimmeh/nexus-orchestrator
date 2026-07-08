---
name: micro-planning
description: >-
  Narrow-scope planning playbook for focused user requests without full-project
  orchestration churn.
version: 1.0.0
tier: light
estimated_duration: 20 minutes
category: implementation
tags:
  - skill
prerequisites: []
metadata: {}
---

# Micro Planning

Use when project is healthy and user request scope is narrow.

## Goals
- Execute a focused spec/work-item delta for a single request.
- Avoid full-project scans.

## Instructions
1. Identify affected epic/spec only.
2. Update or create only the required spec scope.
3. Run validate_specs and kanban.publish_specs for affected scope.
4. Persist narrow delta in orchestration state.
5. End the run with `yield_session` only when that tool is callable in the active session. In seeded event workflows that expose `step_complete` instead, persist the same narrow delta and finish with `step_complete`.

## Tools
- Use: kanban.project_state, validate_specs, kanban.publish_specs, update_orchestration_state
- Avoid: broad project-wide review/generation actions

## Done Criteria
- Narrow delta persisted.
- No unrelated epics/specs touched.
- The active session is ended with the correct completion primitive for that workflow (`yield_session` when available, otherwise `step_complete`).

## Overview
- TODO: Add Overview content.

## Prerequisites
- TODO: Add Prerequisites content.

## Output Format
- TODO: Add Output Format content.
