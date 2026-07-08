---
name: git-commit-enforcement
description: >-
  Ensure all created or modified files are committed to the repository before
  completing any task. Never leave uncommitted work.
version: 1.0.0
tier: light
estimated_duration: 1-3 minutes
category: quality
tags:
  - git
  - commits
  - workflow
prerequisites: []
metadata: {}
---

# Git Commit Enforcement

## Overview

Use this skill at the end of any task that creates or modifies files. It ensures all work is committed to the repository before the task is reported as complete, preventing lost work and maintaining a clean working tree.

## Prerequisites

- A git repository has been initialised and is accessible
- All file creation and modification work is complete

## Instructions

Follow the commit protocol below to verify and commit all outstanding changes.

## Core Rule

**You must commit all files you create or modify before reporting your task as complete.** Uncommitted work is lost work.

## Commit Protocol

After completing any work:

### 1. Check Status
```bash
git status --short
```

If the output is empty, all files are committed. You may proceed.

### 2. Stage and Commit Any Remaining Files
```bash
git add <files or directories>
git commit -m "<type>(<scope>): <description>"
```

Use conventional commits format:
- `analysis: visual analysis of login mockups`
- `docs: add PRD for user authentication`
- `requirements: extract from process documentation`

### 3. Verify
```bash
git status --short
```

Output must be empty before you complete your task.

## For git_verifier Agents

When your sole purpose is commit verification:
1. Run `git status --short`
2. If empty: report `{ "status": "verified", "uncommitted_files": [] }`
3. If not empty: stage and commit all files, then re-verify
4. Set job output: `set_job_output({ status, uncommitted_files })`
5. Never allow the workflow to proceed with uncommitted files

## Output Format

- `git status --short` returns empty output, confirming a clean working tree
- All created or modified files appear in `git log` as part of a commit
- For `git_verifier` agents: job output is set with `{ "status": "verified", "uncommitted_files": [] }`
