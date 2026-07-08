---
name: imported-repo-synthesis-and-hydration
description: >-
  Synthesis playbook for imported repositories after probe completion. Uses
  persisted probe evidence, applies confidence-gated hydration, and batches
  unresolved clarifications.
version: 1.0.0
tier: light
estimated_duration: 20 minutes
category: implementation
tags:
  - skill
prerequisites: []
metadata: {}
---

# Imported Repository Synthesis And Hydration

Use when import phase is `probe_synthesis` or `completion_hydration`.

## Goals
- Synthesize an evidence-based reality map from persisted probe results.
- Hydrate completed and missing work safely using confidence gates.
- Batch ambiguities into one clarification interaction.
- Use docs/project-context/probe-results/*.md as the primary synthesis input. Treat DB probe state as recovery/index metadata. Block synthesis if required imported-repo probe artifacts are missing or invalid.

## Instructions
1. Load orchestration state and inspect `probes_stale`.
2. If stale, dispatch affected probes and then end the run with `yield_session` only when that tool is callable in the active session. In seeded event workflows that expose `step_complete` instead, persist the blocked/partial result and finish with `step_complete`.
3. If fresh, synthesize completion map from `probe_results` only.
4. Apply confidence-gated hydration:
   - High or medium confidence -> in-review with `pending_review: true`.
   - Low confidence -> backlog.
5. Ask one batched clarification set for unresolved ambiguity.
6. Persist recommendation and end the run with the correct completion primitive for the active workflow (`yield_session` when available, otherwise `step_complete`).

## Tools
- Use: get_orchestration_state, update_orchestration_state, submit_resource_artifact, kanban.project_state, ask_user_questions, step_complete
- Use `yield_session` only when it is callable in the active session; in seeded event workflows, finish with `step_complete`.
- Avoid: rediscovery loops when `probe_results` are fresh

## Done Criteria
- Synthesis completed from persisted probe state using docs/project-context/probe-results/*.md as the primary synthesis input.
- DB probe state treated as recovery/index metadata only.
- Hydration metadata includes evidence references and confidence.
- One clarification batch maximum for the cycle.

## Overview
- TODO: Add Overview content.

## Prerequisites
- TODO: Add Prerequisites content.

## Output Format
- TODO: Add Output Format content.
