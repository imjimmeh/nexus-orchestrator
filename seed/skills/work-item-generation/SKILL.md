---
name: work-item-generation
description: "Generate structured work items (epics, stories, tasks) from PRDs/designs. Use when converting product docs into a groomed backlog."
version: 1.0.0
tier: heavy
estimated_duration: 10-20 minutes
category: planning
tags:
  - work-items
  - planning
  - product
  - ingestion
prerequisites:
  - prd-authoring
metadata: {}
---

# Work Item Generation

## Overview

Convert product requirements and design documents into structured, actionable work items for the development backlog.

## Prerequisites

- `docs/PRD.md` exists and contains user stories with acceptance criteria
- SDD or architecture documents are available for technical task breakdown
- The `kanban.propose_work_items` tool is available to submit generated items

## Instructions

Follow the generation process below to produce and submit work items:

## Work Item Hierarchy

- **Epic:** A large feature or capability spanning multiple sprints
- **Story:** A user-facing capability completable in one sprint
- **Task:** A technical work item supporting a story

## Generation Process

### 1. Read Source Documents

Read all PRDs, SDDs, and requirements documents.

### 2. Identify Epics

Group related user stories into epics by feature area or user journey.

### 3. Write Stories

For each user flow identified in the PRD:

- Title: `As a [user], I can [action]`
- Description: The full user story with context
- Acceptance criteria: Testable, specific criteria
- Estimate: Story points (1, 2, 3, 5, 8)

### 4. Break Down Technical Tasks

For each story, identify the technical tasks:

- Backend API endpoints
- Database schema changes
- Frontend components
- Test coverage requirements

### 5. Propose via Tool

Use `kanban.propose_work_items` to submit the generated work items for review.

## Output Format

- Work items submitted via the `kanban.propose_work_items` tool for stakeholder review
- Each epic contains one or more stories; each story contains one or more tasks
- Stories include title, description, acceptance criteria, and story point estimate
