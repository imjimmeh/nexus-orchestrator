---
name: dependency-updater
description: "Upgrade dependencies safely with risk-tiered validation and rollback. Use when bumping or auditing third-party dependencies."
version: 1.0.0
tier: light
estimated_duration: 20 minutes
category: implementation
tags:
  - dependencies
  - maintenance
  - upgrade
prerequisites: []
metadata: {}
---

# Dependency Updater

## Overview

1. Dependencies must be patched, upgraded, or consolidated.
2. Security advisories require package updates.
3. Build/test/lint drift indicates outdated tooling dependencies.

## Required context and inputs

1. Dependency targets and current versions.
2. Upgrade intent by risk tier (patch, minor, major).
3. Workspace/package boundaries and lockfile ownership.

## Instructions

1. Classify each update:
   - patch: backwards-compatible fixes
   - minor: additive changes, low behavior risk
   - major: possible breaking changes
2. Apply validation depth by class:
   - patch: targeted tests + typecheck
   - minor: targeted tests + lint + typecheck
   - major: targeted tests + lint + typecheck + broader regression suite
3. Keep lockfile integrity:
   - update lockfiles in the same change
   - avoid mixed package manager lockfile churn
4. Evaluate workspace impact:
   - shared package consumers
   - duplicated version ranges
   - build tool/plugin compatibility

## Safety constraints

1. Do not batch unrelated high-risk major upgrades together.
2. Do not hand-edit lockfiles except for deterministic conflict resolution.
3. Do not suppress failing checks after upgrade.

## Rollback guidance (required for non-trivial risk)

1. Record prior versions for each upgraded package.
2. Capture quick rollback commands or git restore steps.
3. Document known breakpoints discovered during validation.

## Output Format

1. Upgrade table (package, from, to, risk tier).
2. Validation commands run and outcome summary.
3. Explicit rollback notes for medium/high-risk updates.

## Language-agnostic discovery order

1. Package manifest and workspace config first:
   - package.json/package-lock.json/pnpm-lock.yaml/yarn.lock
   - pyproject.toml/poetry.lock/requirements\*.txt
   - pom.xml/build.gradle\*/gradle.lockfile
   - go.mod/go.sum
   - \*.csproj/packages.lock.json
2. Dependency tooling scripts second.
3. Command probing only when config does not define update workflow.

## Prerequisites

- TODO: Add Prerequisites content.
