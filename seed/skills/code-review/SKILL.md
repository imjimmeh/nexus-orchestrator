---
name: code-review
description: >-
  Perform high-signal review for correctness, maintainability, and safety. Use
  when reviewing pull requests or generated code changes.
version: 1.0.0
tier: light
estimated_duration: 15-60 minutes
category: quality
tags:
  - review
  - code
prerequisites:
  - coding-standards
metadata: {}
---

# Code Review

## Overview
- Review for behavior risk first, then quality and style.
- Deliver actionable, specific feedback with clear severity.

## Prerequisites
- Change scope and requirements are known.
- Test evidence is available (unit/integration/e2e where relevant).

## Instructions
1. Validate functional correctness against requirements.
2. Check regression risk in adjacent flows and edge cases.
3. Evaluate test coverage for success, failure, and boundary cases.
4. Verify security and data-handling risks (validation, auth, secrets).
5. Confirm maintainability (naming, complexity, modularity, duplication).

## Decision Points
1. Block when correctness, safety, or data integrity is at risk.
2. Request follow-up when improvement is valuable but non-blocking.
3. Defer stylistic preference when it conflicts with local conventions.

## Output Format
- Findings ordered by severity.
- File and line references.
- Clear recommended fix for each finding.
- Residual risks and missing tests.

## Examples
- Good: "High: Null handling can throw in retry path; add guard and test for empty payload."
- Bad: "Looks odd" without impact, location, or remedy.

## Common Pitfalls
- Over-focusing on style while missing behavioral defects.
- Vague feedback without reproducible steps.
- Ignoring migration/backward compatibility risks.
