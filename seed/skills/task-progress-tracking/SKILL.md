---
name: task-progress-tracking
description: >-
  Keep workflow run todo lists accurate with manage_todo_list while executing
  multi-step work.
version: 1.0.0
tier: light
estimated_duration: 5-20 minutes
category: implementation
tags:
  - skill
prerequisites:
  - coding-standards
metadata: {}
---

# Task Progress Tracking

## Overview
- Maintain a concise, ordered run todo list while working.
- Use `manage_todo_list` whenever plan state changes.

## Prerequisites
- You have identified execution steps for the current task.
- The runtime has `manage_todo_list` capability available.

## Instructions
1. Create an initial todo list as soon as the implementation approach is clear.
2. Use statuses exactly as: `not-started`, `in-progress`, `completed`.
3. Keep at most one item in `in-progress` at any time.
4. On every status transition, call `manage_todo_list` with the full updated list.
5. Preserve existing item IDs when provided by previous responses.
6. If a todo item maps to a work-item subtask, keep `subtask_id` in the payload.

## Decision Points
1. If the current task splits into new work, append new `not-started` items.
2. If scope shrinks, remove irrelevant todo entries from the next full update.
3. If blocked, keep the todo item as `in-progress` only while actively working the blocker; otherwise move it back to `not-started` and document the blocker in your response.

## Output Format
- Briefly summarize progress after each meaningful update.
- Include any blocker or dependency that prevents completion.

## Common Pitfalls
- Sending partial lists instead of full replacement payloads.
- Marking multiple tasks as `in-progress`.
- Forgetting to update todo status after tests or validation complete.
