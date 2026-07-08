---
name: prd-to-issues
description: >-
  Break a PRD into canonical markdown work-item specs using execution-ready
  vertical slices. Use when user wants to convert a PRD into work items, create
  implementation tickets, or break down a PRD into delivery slices.
version: 1.0.0
tier: light
estimated_duration: 20 minutes
category: implementation
tags:
  - skill
prerequisites: []
metadata: {}
---

# PRD to Work Items

Break a PRD into independently-grabbable canonical work-item specs using vertical slices (tracer bullets).

## Process

### 1. Locate the PRD

Ask the user for the PRD path if it is not already known.

The canonical PRD location is `docs/specs/PRD-<feature-slug>.md`. Read the PRD and any adjacent SDD or architecture docs before slicing work.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code.

### 3. Draft vertical slices

Break the PRD into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

Slices may be 'HITL' or 'AFK'. HITL slices require human interaction, such as an architectural decision or a design review. AFK slices can be implemented and merged without human interaction. Prefer AFK over HITL where possible.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Prefer many thin slices over few thick ones
</vertical-slice-rules>

### 4. Review the slice plan

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Scope**: `standard` or `large`
- **Blocked by**: which other slices (if any) must complete first by stable `item_id`
- **User stories covered**: which user stories from the PRD this addresses

When relevant, call out whether the slice should go through a dedicated refinement pass before implementation because of ambiguity, architectural risk, or expected splitting.

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?
- Are the correct slices marked as HITL and AFK?

Iterate until the user approves the breakdown.

### 5. Create the canonical markdown work-item specs

For each approved slice, create one markdown file under `docs/work-items/`. Use the template below.

Create specs in dependency order (blockers first) so you can reference stable `item_id` values in the dependency field.

<issue-template>
---
item_id: <stable-item-id>
title: "<action-oriented work item title>"
priority: p2
scope: standard
depends_on_item_ids:
  - <upstream-item-id>
---

## Overview

Reference the relevant PRD/SDD sections and describe the end-to-end behavior this slice delivers.

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

## Acceptance criteria

- AC-1: Criterion 1
- AC-2: Criterion 2
- AC-3: Criterion 3

## Blocked by

- <item_id> (if any)

Or "None - can start immediately" if no blockers.

## User stories addressed

Reference by number from the parent PRD:

- User story 3
- User story 7

## Technical notes

- Key constraints, interfaces, or repo-specific considerations.

## Constraints

- Anything that affects refinement, rollout, testing, or dependency ordering.

</issue-template>

Do NOT create GitHub issues from this skill. Hydration into database work items happens later through `kanban.publish_specs`.

## Prerequisites
- TODO: Add Prerequisites content.

## Instructions
- TODO: Add Instructions content.

## Output Format
- TODO: Add Output Format content.
