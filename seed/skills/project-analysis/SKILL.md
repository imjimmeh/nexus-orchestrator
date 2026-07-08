---
name: project-analysis
description: "Analyze project state, constraints, and execution readiness. Use before making an orchestration or dispatch decision."
version: 1.0.0
tier: heavy
estimated_duration: 20-60 minutes
category: implementation
tags:
  - skill
prerequisites:
  - orchestration-patterns
metadata: {}
---

# Project Analysis

## Overview

- Build an evidence-based snapshot of project health.
- Identify blockers, capacity, and next highest-value actions.

## Prerequisites

- Access to current project state and orchestration timeline.
- Clear understanding of project goals and phase.

## Instructions

1. Read current state, active work, and dependency graph.
2. Compare planned outcomes versus completed outcomes.
3. Identify critical blockers, risk clusters, and capacity gaps.
4. Propose prioritized actions tied to concrete evidence.

## Decision Points

1. Dispatch when ready work exists and capacity is available.
2. Escalate clarification only when requirements are contradictory.
3. Close orchestration only when goals and quality gates are complete.

## Output Format

- Situation summary.
- Evidence list.
- Decision recommendation.
- Risks and mitigation actions.

## Examples

- Good: Dispatch topologically ready work items and document rationale.
- Bad: Delay dispatch without explicit dependency or capacity reason.

## Common Pitfalls

- Ignoring timeline continuity from previous orchestration cycles.
- Re-running discovery/spec tasks that are already complete.
