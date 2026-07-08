---
name: refactoring
description: >-
  Improve structure safely while preserving behavior. Use when reducing
  complexity, duplication, or coupling in existing code.
version: 1.0.0
tier: heavy
estimated_duration: 20-120 minutes
category: implementation
tags:
  - skill
prerequisites:
  - test-driven-development
  - coding-standards
metadata: {}
---

# Refactoring

## Overview
- Change structure, not behavior.
- Make incremental, verifiable improvements with rollback safety.

## Prerequisites
- Baseline tests pass.
- Impacted paths are covered by tests or can be covered first.

## Instructions
1. Start with safety checks: tests, lint, and typecheck status.
2. Choose small refactoring moves: extract method, rename, inline, split module.
3. Run targeted tests after each small change.
4. Keep behavior-preserving commits small and isolated.
5. Re-run broader validations before completion.

## Decision Points
1. Refactor when design pain is local and behavior is understood.
2. Rewrite only when constraints make incremental change unsafe or impractical.
3. Stop and reassess when scope expands beyond original objective.

## Output Format
- Refactoring intent and boundaries.
- Sequence of small transformations.
- Validation evidence after each milestone.

## Examples
- Good: Extract duplicated parsing logic into utility with existing behavior snapshots.
- Bad: Large unrelated rewrite across modules without tests.

## Common Pitfalls
- Combining refactor with feature changes in the same diff.
- Renaming and moving too many symbols at once.
- Refactoring code with no behavioral safety net.

## References
- Martin Fowler catalog: Extract Function, Rename Variable, Move Function, Inline Function.
