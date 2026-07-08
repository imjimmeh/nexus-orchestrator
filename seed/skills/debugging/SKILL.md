---
name: debugging
description: >-
  Systematically isolate and fix defects. Use when behavior is incorrect, flaky,
  or inconsistent across environments.
version: 1.0.0
tier: heavy
estimated_duration: 20-90 minutes
category: debugging
tags:
  - debugging
  - troubleshooting
prerequisites:
  - coding-standards
metadata: {}
---

# Debugging

## Overview
- Use evidence-first debugging to find root cause quickly.
- Prefer deterministic reproduction before code changes.

## Prerequisites
- Error symptom, expected behavior, and actual behavior are documented.
- Relevant logs, failing tests, or reproduction steps are available.

## Instructions
1. Reproduce the issue consistently with a minimal scenario.
2. Isolate boundaries: input parsing, state changes, IO, async flow.
3. Form one hypothesis at a time and test it.
4. Instrument with temporary logs or debugger breakpoints based on uncertainty.
5. Confirm root cause with a focused failing test.
6. Apply the smallest safe fix and verify no regression.

## Decision Points
1. Use logging for distributed or timing-sensitive paths.
2. Use debugger/step-through for local deterministic logic errors.
3. Use property checks and assertions for data-shape corruption.

## Output Format
- Reproduction steps.
- Root-cause statement.
- Fix summary.
- Regression tests and verification commands.

## Examples
- Good: Reproduce async race with deterministic fixture, add guard and test for ordering.
- Bad: Add retries/timeouts without understanding the state transition bug.

## Common Pitfalls
- Fixing symptoms instead of cause.
- Mixing multiple hypotheses in one change.
- Keeping temporary debug logging in production paths.
- Declaring fixed without reproducing original failure.
