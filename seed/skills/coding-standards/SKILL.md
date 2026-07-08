---
name: coding-standards
description: >-
  Apply SOLID, DRY, KISS, and strong typing consistently. Use for any
  implementation, review, or refactoring task.
version: 1.0.0
tier: light
estimated_duration: 10-45 minutes
category: implementation
tags:
  - standards
  - quality
prerequisites: []
metadata: {}
---

# Coding Standards

## Overview
- Keep code readable, modular, and predictable.
- Enforce consistent quality across languages and modules.

## Prerequisites
- Identify local project conventions first.
- Confirm lint/type rules and architecture boundaries.

## Instructions
1. Prefer small single-purpose functions and modules.
2. Use descriptive names; avoid cryptic abbreviations.
3. Eliminate duplication via shared abstractions.
4. Favor explicit static types and narrow interfaces.
5. Replace magic strings/numbers with named constants.
6. Keep side effects isolated and error handling specific.

## Decision Points
1. Introduce abstraction only when duplication or coupling justifies it.
2. Prefer composition over inheritance for cross-cutting behavior.
3. Keep public interfaces stable; refactor internals first.

## Output Format
- Standards applied summary.
- Any exceptions with rationale.
- Validation commands run.

## Examples
- Good: Extract policy validation helper reused across controllers/services.
- Bad: Duplicate parsing logic in each endpoint handler.

## Common Pitfalls
- Over-abstraction before stable patterns emerge.
- Broad exception handling that hides root cause.
- Inconsistent naming across bounded contexts.
