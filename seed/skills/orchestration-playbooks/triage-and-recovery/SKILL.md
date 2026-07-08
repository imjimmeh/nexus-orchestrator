---
name: triage-and-recovery
description: >-
  Recovery playbook for repeated failures, no-op delegation, and stale
  orchestration state conditions.
version: 1.0.0
tier: light
estimated_duration: 10m
category: playbook
tags:
  - orchestration
  - recovery
  - failure
prerequisites: []
metadata: {}
---

# Triage And Recovery

## Overview
Recovery playbook for repeated failures, no-op delegation, and stale orchestration state conditions.
Use when recovery_needed is true or failure counters cross threshold.

## Prerequisites
- Orchestration state indicates recovery is needed or failures have crossed threshold.

## Instructions
1. Review recent decision log and failure counters.
2. Identify dominant failure class and corrective action.
3. Update recovery_plan and clear stale assumptions.
4. Do not retry failing action without a changed approach.
5. End the run with `yield_session` only when that tool is callable in the active session. In seeded event workflows that expose `step_complete` instead, persist the recovery result and finish with `step_complete`.

## Tools
- Use: get_orchestration_state, update_orchestration_state, list_path
- Avoid: repeating failing tool/action patterns in same session

## Output Format
- recovery_plan persisted with resume conditions.
- stale known_bad_paths/prior assumptions cleaned where applicable.
- The active session is ended with the correct completion primitive for that workflow (`yield_session` when available, otherwise `step_complete`).
