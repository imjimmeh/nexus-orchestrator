# EPIC-194: Bundled Plugin Migration and Internal Capability Extraction

**Status:** Proposed
**Priority:** P1
**Created:** 2026-05-17
**Updated:** 2026-05-17
**Owner:** Platform Extensibility / API Architecture
**Parent:** EPIC-188
**Depends on:** EPIC-189, EPIC-191, EPIC-193
**Related:** EPIC-127, EPIC-173, EPIC-181, EPIC-182, EPIC-186

## Summary

Move selected existing API capabilities into bundled plugins after the plugin kernel and contribution adapters are stable, proving that Nexus can ship default plugins while keeping core platform primitives in the API.

## Problem Statement

The plugin platform should not only support third-party additions. It should also provide a path to modularize built-in functionality into bundled plugins where that improves ownership, testability, and replacement. Doing this too early would cause a rewrite. Doing it after stable contribution contracts gives Nexus a safe migration path.

## Goals

- Extract selected built-in capabilities into bundled plugins using the same contribution contracts available to third-party plugins.
- Keep `none` isolation available for bundled plugins when appropriate.
- Prefer extraction where it reduces module coupling or turns a hardcoded provider into a replaceable provider.
- Preserve existing API routes, workflow YAML compatibility, tool names where required, and runtime behavior.
- Delete old hardcoded paths once pluginized replacements have parity and no compatibility need remains.

## Non-Goals

- Move core orchestration, auth, persistence primitives, policy, audit, registry, or the plugin kernel into plugins.
- Preserve obsolete hardcoded implementations after migration is complete.
- Add compatibility re-export files to hide stale internal paths.
- Extract every service just because it is technically possible.

## Candidate Bundled Plugins

High-value candidates:

- Postgres memory provider.
- Honcho memory provider.
- Built-in workflow special steps.
- Built-in notification providers.
- LLM provider adapters and model catalogs where practical.
- Built-in trigger sources and schedule-driven launchers.
- Seeded tools or workflow packages that are better represented as default plugin contributions.

Low-value or non-candidate areas:

- Authentication and authorization.
- Database module and migrations.
- Plugin kernel, policy, audit, and registry.
- Core workflow persistence and run state.
- Controller transport contracts.

## Migration Pattern

Each bundled extraction should follow this pattern:

1. Add contribution contract support and tests.
2. Add bundled plugin implementation beside the existing implementation.
3. Add parity tests proving both paths produce equivalent behavior.
4. Switch default registration to bundled plugin contribution.
5. Remove old hardcoded registration after compatibility requirements are satisfied.
6. Update docs and examples to point to the pluginized source of truth.

## Workstreams

### 1. Bundled Plugin Loader

- Define a configured bundled plugin directory or package list.
- Ensure bundled plugins can use `none`, `worker_process`, or `container` according to policy.
- Ensure bundled plugin manifests still go through validation and contribution registration.

### 2. Memory Provider Extraction

- Convert Postgres and Honcho memory backends into bundled memory provider plugins or plugin-shaped adapters.
- Preserve existing memory API and runtime tool contracts.

### 3. Workflow Special-Step Extraction

- Convert built-in special-step handlers into bundled `workflow.step` contributions where beneficial.
- Preserve current workflow YAML behavior.

### 4. Notification, Trigger, Schedule, and Model Extraction

- Extract provider-style built-ins after provider contribution contracts are stable.

### 5. Cleanup and Deletion

- Remove hardcoded registrations and dead code after pluginized paths prove parity.
- Update imports to canonical plugin locations.

## Backlog

- [ ] E194-001 Add bundled plugin discovery and load order policy.
- [ ] E194-002 Convert Postgres memory backend to bundled provider plugin or plugin-shaped adapter.
- [ ] E194-003 Convert Honcho memory backend to bundled provider plugin or plugin-shaped adapter.
- [ ] E194-004 Convert selected built-in workflow special steps to bundled contributions.
- [ ] E194-005 Convert built-in notification providers to bundled contributions.
- [ ] E194-006 Convert selected LLM provider adapters to bundled contributions.
- [ ] E194-007 Convert selected trigger and schedule sources to bundled contributions.
- [ ] E194-008 Delete replaced hardcoded registrations and update docs.

## Acceptance Criteria

- At least one existing built-in capability runs as a bundled plugin contribution with parity tests.
- Existing API contracts and workflow behavior are preserved during extraction.
- Old hardcoded paths are deleted once the bundled plugin path is the source of truth.
- Bundled plugins are inspectable through the plugin registry and clearly identified as `bundled` trust level.
