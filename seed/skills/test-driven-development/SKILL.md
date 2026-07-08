---
name: test-driven-development
description: >-
  Drive implementation with Red-Green-Refactor. Use when building new behavior,
  fixing regressions, or refactoring with safety.
version: 1.0.0
tier: heavy
estimated_duration: 20-120 minutes
category: implementation
tags:
  - skill
prerequisites:
  - coding-standards
metadata: {}
---

# Test-Driven Development

## Overview
- Implement changes using Red-Green-Refactor.
- Keep tests focused on behavior, not implementation details.

## Prerequisites
- Failing behavior or acceptance criteria is identified.
- Relevant test runner is available.
- Existing tests pass before starting.

## Instructions
1. Detect test runner by reading project scripts/config first.
2. Red phase: add a single failing test for the next behavior increment.
3. Green phase: implement the minimal code needed to pass that test.
4. Refactor phase: improve design while keeping all tests green.
5. Repeat until all acceptance criteria are covered.
6. Run targeted tests first, then broader suite for impacted area.

## Decision Points
1. If behavior spans multiple layers, start with the smallest high-value unit test.
2. If a bug is not reproducible, write a failing regression test from logs or reproduction steps before coding.
3. If test runtime is slow, run focused tests per cycle and full suite before completion.

## Output Format
- Summary of each Red-Green-Refactor cycle.
- List of tests added or updated.
- Final verification commands and outcomes.

## Examples
- Good: Write a failing test for missing validation, add minimal guard, refactor shared validation helper.
- Bad: Implement full feature first, then add broad snapshot tests that always pass.

## Common Pitfalls
- Testing implementation details instead of user-observable behavior.
- Mocking too many internals, hiding integration regressions.
- Writing multiple failing tests at once and losing focus.
- Skipping final full-run verification for changed modules.
