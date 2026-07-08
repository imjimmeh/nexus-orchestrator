---
name: spec-generation
description: >-
  Spec authoring/delegation playbook for missing or stale PRD/SDD/work-item
  specification artifacts.
version: 1.0.0
tier: light
estimated_duration: 20 minutes
category: playbook
tags:
  - specification
  - planning
prerequisites: []
metadata: {}
---

# Spec Generation

Use when specs are not ready and investigation confidence is sufficient.

## Goals
- Delegate spec production to specialist workflows.
- Record expected outputs and acceptance criteria.

## Instructions
1. Identify missing or stale spec artifacts.
2. Delegate PRD/SDD/spec generation via invoke_agent_workflow.
3. If delegation has no capacity, mark blocked and stop.
4. Persist delegation records and output expectations.
5. End the run with `yield_session` only when that tool is callable in the active session. In seeded event workflows that expose `step_complete` instead, persist the delegation outcome and finish with `step_complete`.

## Tools
- Use: invoke_agent_workflow, update_orchestration_state, get_agent_profiles
- Avoid: writing spec files directly in this session

## Done Criteria
- Delegation outcome recorded with explicit accepted/no_capacity result.
- The active session is ended with the correct completion primitive for that workflow (`yield_session` when available, otherwise `step_complete`).

## Overview
- TODO: Add Overview content.

## Prerequisites
- TODO: Add Prerequisites content.

## Output Format
- TODO: Add Output Format content.
