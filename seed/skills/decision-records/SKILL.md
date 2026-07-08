---
name: decision-records
description: "Capture architecture and orchestration decisions as durable ADR-style records. Use when a significant or hard-to-reverse technical/orchestration choice is made."
version: 1.0.0
tier: light
estimated_duration: 10-40 minutes
category: documentation
tags:
  - adr
  - decisions
  - architecture
prerequisites: []
metadata: {}
---

# Decision Records

## Overview

- Record why a decision was made, not only what changed.
- Keep decisions auditable and easy to revisit.

## Prerequisites

- Decision context and alternatives are known.
- Consequences and rollback options are identified.

## Instructions

1. State decision scope and status.
2. Describe context and constraints.
3. List alternatives considered and why they were rejected.
4. Capture consequences, risks, and follow-up actions.

## Decision Points

1. Create a new record for material architecture or policy changes.
2. Update existing record when revising an accepted decision.
3. Mark superseded records when replaced.

## Output Format

- Title and status.
- Context.
- Decision.
- Alternatives.
- Consequences.
- Follow-up and owner.

## Examples

- Good: ADR documenting explicit tool allowlist replacing wildcard policy.
- Bad: Vague note with no alternatives or trade-off rationale.

## Common Pitfalls

- Recording outcome without context.
- Missing migration or rollback impact.
