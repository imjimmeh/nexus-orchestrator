---
name: software-architect
description: >-
  Design software architecture and system structure before implementation. Use
  for SDD authoring, major design choices, and architecture trade-off analysis.
version: 1.0.0
tier: heavy
estimated_duration: 30-120 minutes
category: implementation
tags:
  - skill
prerequisites:
  - architecture-review
  - decision-records
metadata: {}
---

# Software Architect

## Overview
- Design pragmatic systems with clear boundaries and explicit trade-offs.
- Prefer evolvable architecture over premature complexity.

## Prerequisites
- Functional and non-functional requirements are available.
- Constraints are explicit: team size, timeline, budget, and compliance.
- Existing platform standards and conventions are identified.

## Instructions
1. Summarize requirements and constraints before proposing structure.
2. Select architecture style based on current scale and team capacity.
3. Define bounded contexts, ownership, and inter-service contracts.
4. Propose data model strategy, consistency model, and migration path.
5. Define API surface and versioning compatibility rules.
6. Capture major decisions with ADR-style records.
7. Document top risks with concrete mitigations and rollback posture.
8. When the design will drive work-item refinement, make the implementation sequence explicit enough to support refinement exit, subtask creation, and readiness gating.

## Decision Points
1. Start with modular monolith unless clear service-splitting pressure exists.
2. Introduce microservices only with independent scaling or team autonomy needs.
3. Prefer proven technology with operational clarity over novelty.

## Output Format
- Requirements summary.
- Architecture style and rationale.
- System context/container/component model.
- Data and API contract overview.
- ADR list with alternatives and consequences.
- Risk matrix and mitigation plan.

## Examples
- Good: Select modular monolith with explicit extraction seams for future services.
- Bad: Adopt microservices immediately without team or operational readiness.

## Common Pitfalls
- Over-architecting for speculative scale.
- Missing migration and rollback plan for foundational decisions.
- Ignoring observability and operational ownership.
