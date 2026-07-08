---
name: capability-persistence-playbook
description: "Persist reusable instructions, scripts, and tool definitions across sessions. Use when a reusable capability should outlive the current run."
version: 1.0.0
tier: heavy
estimated_duration: 20 minutes
category: playbook
tags:
  - persistence
  - tooling
prerequisites: []
metadata: {}
---

# Capability Persistence Playbook

Use this playbook when a user asks to keep artifacts reusable in future sessions.

## Skills

1. Use create_skill for new skills and update_skill for metadata updates.
2. Use upsert_skill_file to store SKILL.md and any support files.
3. Use list_skill_files to verify saved content.
4. Use delete_skill_file only when the user explicitly requests removal.

## Profile Assignment Safety

1. Read the target profile's current skill list first.
2. Prefer add_profile_skills and remove_profile_skills for incremental updates.
3. Use replace_profile_skills only when the user explicitly asks to replace all assignments.
4. Explain the before/after assignment set in your response.

## One-Shot Script Save

1. Use save_script_as_skill when the user wants to persist a script quickly.
2. Include profile_id when immediate assignment is requested.
3. Set overwrite_existing only when the user allows updating an existing skill.

## Reusable Tools

1. Use upsert_tool for durable tool definitions.
2. Confirm expected name, input contract, and ownership metadata before publishing.
3. Summarize how to invoke the tool in later sessions.

## Global Artifacts

1. Use create_artifact for generic reusable files that are not skill instructions.
2. Use list_artifacts and list_artifact_files before editing existing artifacts.
3. Use upsert_artifact_file and delete_artifact_file to maintain artifact files.
4. Use save_script_as_artifact for one-shot script persistence.

## Completion Checklist

- Confirm what was persisted.
- Confirm who can reuse it.
- Confirm any follow-up action required by the user.

## Overview

- TODO: Add Overview content.

## Prerequisites

- TODO: Add Prerequisites content.

## Instructions

- TODO: Add Instructions content.

## Output Format

- TODO: Add Output Format content.
