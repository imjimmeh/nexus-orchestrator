---
name: architecture-review
description: "Review an architecture proposal for correctness, risk, and maintainability. Use when evaluating a design or architecture update before approval."
version: 1.0.0
tier: heavy
estimated_duration: 20-60 minutes
category: architecture
tags:
  - review
  - architecture
prerequisites:
  - coding-standards
metadata: {}
---

# Architecture Review

## Overview

- Evaluate architecture changes with a risk-first lens.
- Focus on boundaries, contracts, operations, and rollback posture.

## Prerequisites

- Design context is available (PRD, SDD, requirements, constraints).
- Affected modules, data contracts, and migration plan are identified.

## Instructions

1. Validate module ownership and bounded context boundaries.
2. Check data contracts, backward compatibility, and migration safety.
3. Review runtime concerns: observability, resilience, and rollback strategy.
4. Verify security, access control, and sensitive data handling.
5. Capture unresolved assumptions and required follow-ups.

## Decision Points

1. Block changes that risk data loss, auth bypass, or unsafe migrations.
2. Request follow-up tasks for non-blocking quality gaps.
3. Defer style-only concerns unless they conflict with architecture standards.

## Output Format

- Findings grouped by severity.
- Concrete remediation recommendations.
- Residual risks and dependency assumptions.

## Examples

- Good: "High risk: migration requires dual-read period to prevent downtime during cutover."
- Bad: "Architecture seems complex" without citing impact or fix.

## Common Pitfalls

- Reviewing in isolation without deployment/rollback constraints.
- Missing cross-service contract compatibility checks.
- Ignoring observability gaps for new critical paths.
