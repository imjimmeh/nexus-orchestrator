---
name: orchestration-patterns
description: >-
  Apply safe dispatch and coordination patterns for multi-agent workflow
  orchestration.
version: 1.0.0
tier: heavy
estimated_duration: 20-60 minutes
category: orchestration
tags:
  - orchestration
  - patterns
  - multi-agent
prerequisites: []
metadata: {}
---

# Orchestration Patterns

## Overview
- Execute orchestration cycles that avoid deadlock and drift.
- Keep decisions aligned with scheduling, capacity, and lifecycle stage.

## Prerequisites
- Current orchestration state and timeline are available.
- Dispatch constraints and policy settings are known.

## Instructions
1. Check orchestration activity and lifecycle state.
2. Evaluate dispatch candidates with dependency and capacity context.
3. Dispatch ready work explicitly when capacity exists.
4. Persist strategic reasoning through a decision record event.
5. Reconcile outcomes before the next cycle.

## Decision Points
1. Use scheduling recommendation as default dispatch baseline.
2. Deviation from recommendation requires explicit reasoning.
3. Trigger strategy updates only for material scope or risk changes.

## Output Format
- Cycle objective.
- Actions executed.
- Dispatch outcome.
- Decision rationale.
- Next-cycle checks.

## Examples
- Good: Dispatch selected items, then log reasoning and projected impact.
- Bad: Submit decision metadata without performing dispatch action.

## Common Pitfalls
- Deferring dispatch with no future trigger guarantee.
- Repeating completed discovery/spec orchestration steps.
- Ignoring dependency readiness when selecting work.

## Additional Readiness Rules
6. Apply readiness gating before execution dispatch: refined once, planned, and subtasked.
7. Reroute unready todo items to refinement with explicit reason tags.
8. Treat split-pending parent items as non-executable.
