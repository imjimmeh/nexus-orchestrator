---
name: orchestration-playbooks
description: >-
  Collection entrypoint for CEO orchestration playbooks that cover first-run
  discovery, investigation, spec generation, recovery, and cycle planning.
version: 1.0.0
tier: light
estimated_duration: 20 minutes
category: implementation
tags:
  - skill
prerequisites: []
metadata: {}
---

# Orchestration Playbooks

This directory groups CEO-oriented orchestration playbooks.

Use the focused playbook under this folder that matches the current orchestration need:

- `first-run` for initial project orientation
- `existing-project-investigation` for incomplete or contradictory project state
- `spec-generation` for delegated PRD/SDD/work-item authoring
- `work-item-generation` for canonical spec hydration
- `project-state-review` for active delivery review
- `next-cycle-planning` for selecting the next ready batch
- `triage-and-recovery` for failure recovery
- `micro-planning` for narrow-scope orchestration updates
- `imported-repo-bootstrap` and `imported-repo-synthesis-and-hydration` for imported repository flows

Session completion rule:

- Use `yield_session` only when it is callable in the active session.
- In seeded event workflows that expose `step_complete` instead, persist the same outcome and finish with `step_complete`.

## Overview
- TODO: Add Overview content.

## Prerequisites
- TODO: Add Prerequisites content.

## Instructions
- TODO: Add Instructions content.

## Output Format
- TODO: Add Output Format content.
