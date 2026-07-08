---
name: write-a-prd
description: >-
  Create a repository-native PRD through focused discovery, codebase
  exploration, and product clarification. Use when user wants to write a PRD,
  create a product requirements document, or plan a new feature.
version: 1.0.0
tier: light
estimated_duration: 20 minutes
category: implementation
tags:
  - skill
prerequisites: []
metadata: {}
---

Use this skill when authoring or revising a PRD for Nexus Orchestrator. The canonical output is a markdown document in `docs/specs/PRD-<feature-slug>.md`, not a GitHub issue.

1. Gather the user problem statement, business outcome, and any constraints that already exist.

2. Explore the repository to verify the current state, existing docs, and any platform constraints that should shape scope.

3. Ask focused clarification questions only for the decisions that materially affect scope, rollout, or acceptance criteria.

4. Identify the user-facing flows, major capability areas, and key constraints. Reference system boundaries at a high level without hard-coding implementation details that belong in the SDD.

5. Define the MVP boundary clearly: what is in scope now, what is deferred, and what assumptions remain open.

6. Write the PRD using the template below and save it under `docs/specs/PRD-<feature-slug>.md`.

Do not create GitHub issues from this skill. Downstream decomposition into canonical work-item specs happens in `docs/work-items/`.

<prd-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## Goals And Non-Goals

- Goals that this PRD must achieve.
- Explicit non-goals or deferred scope.

## User Stories

A numbered list of user stories. Each user story should be in the format of:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

Cover the meaningful slices of the MVP without padding the document with speculative future stories.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They become stale quickly and belong in the SDD or work-item plan instead.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this PRD.

## Risks And Dependencies

- Key delivery risks, external dependencies, compliance constraints, or rollout caveats.

## Further Notes

Any further notes about the feature.

</prd-template>

## Overview
- TODO: Add Overview content.

## Prerequisites
- TODO: Add Prerequisites content.

## Instructions
- TODO: Add Instructions content.

## Output Format
- TODO: Add Output Format content.
