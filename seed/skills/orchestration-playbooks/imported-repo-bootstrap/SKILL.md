---
name: imported-repo-bootstrap
description: >-
  Bootstrap playbook for imported repositories to establish reliable artifact
  coverage before planning.
version: 1.0.0
tier: light
estimated_duration: 20 minutes
category: implementation
tags:
  - skill
prerequisites: []
metadata: {}
---

# Imported Repository Bootstrap

Use when import status is pending, or repository files exist but inventory is empty.

## Goals
- Build trustworthy repository inventory.
- Avoid directory read errors by using list_path.
- Dispatch probe contracts for asynchronous evidence gathering.
- Recommend next playbook based on persisted probe state.

## Instructions
1. List repository root with list_path.
2. Enumerate docs, specs, epics, workflows, and app/package roots.
3. Create probe delegation contracts for documentation, repository structure, and domain completion scopes.
4. Persist pending probe contracts and move import phase to probe_waiting.
5. End the run with `yield_session` only when that tool is callable in the active session. In seeded event workflows that expose `step_complete` instead, persist the same blocked/partial state and finish with `step_complete`.

## Tools
- Use: list_path, get_orchestration_state, update_orchestration_state, submit_resource_artifact, kanban.project_state
- Avoid: read on directory paths, dispatch/delegation actions

## Done Criteria
- committed project-context artifacts exist under docs/project-context/, including SCOPE_MANIFEST.json, aggregate context docs, and per-scope probe files under docs/project-context/probe-results/.
- Probe contracts persisted with deterministic idempotency keys.
- Import phase transitioned to probe_waiting.
- The active session is ended with the correct completion primitive for that workflow (`yield_session` when available, otherwise `step_complete`).

## Overview
- TODO: Add Overview content.

## Prerequisites
- TODO: Add Prerequisites content.

## Output Format
- TODO: Add Output Format content.
