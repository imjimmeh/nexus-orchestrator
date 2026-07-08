---
name: implementation-planning
description: "Turn an approved design into a sequenced implementation plan. Use when a design is approved and work must be broken into ordered, validated milestones."
version: 1.0.0
tier: light
estimated_duration: 15-45 minutes
category: planning
tags:
  - planning
  - implementation
  - milestones
prerequisites:
  - coding-standards
metadata: {}
---

# Implementation Planning

## Overview

- Produce deterministic plans before coding.
- Optimize for dependency order, testability, and rollback safety.

## Prerequisites

- Scope and acceptance criteria are defined.
- Existing architecture constraints are understood.

## Instructions

1. Split scope into milestones that can be validated independently.
2. Order tasks by dependency and risk, not by convenience.
3. For each milestone, define verification commands and expected signals.
4. Explicitly call out risky steps and rollback options.
5. Mark tasks as self, delegate, or coordination-required when relevant.

## Decision Points

1. Add a dedicated migration milestone when data/schema changes are involved.
2. Break large tasks into incremental slices if verification is ambiguous.
3. Escalate assumptions that block deterministic execution.

## Output Format

- Milestone list in execution order.
- Validation command per milestone.
- Risk and rollback notes.
- Open assumptions and owners.

## Examples

- Good: "Milestone 2: add parser guard; verify with targeted test and typecheck."
- Bad: "Implement everything, then test."

## Common Pitfalls

- Plans that skip validation details.
- Combining unrelated concerns in one milestone.
- Missing rollback strategy for migration steps.

## Additional Planning Rules

6. Produce subtask-ready plans: each milestone maps to one or more executable subtasks.
7. If scope is compound, recommend split before detailed execution plan finalization.
8. For trivial work, produce a lightweight plan with at least one milestone and one verification command.
