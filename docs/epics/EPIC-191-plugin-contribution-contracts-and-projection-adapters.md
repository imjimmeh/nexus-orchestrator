# EPIC-191: Plugin Contribution Contracts and Projection Adapters

**Status:** Implemented
**Priority:** P0
**Created:** 2026-05-17
**Updated:** 2026-05-18
**Owner:** Platform Extensibility / Capability Platform
**Parent:** EPIC-188
**Depends on:** EPIC-189, EPIC-190
**Related:** EPIC-106, EPIC-125, EPIC-127, EPIC-140, EPIC-181, EPIC-182

## Summary

Define typed plugin contribution contracts and projection adapters that let plugins register capabilities into existing Nexus systems without exposing NestJS internals or requiring each feature module to understand plugin runtime details.

EPIC-191 implemented SDK contribution contracts, API contribution inventory and registry services, tool projection and the tool invocation bridge, workflow special-step projection, workflow hook projection with delivery helpers and inventory, projection orchestrator cleanup/refresh coordination, lifecycle paths that can safely rerun projection cleanup or refresh after failures, and regression coverage for existing tool and special-step behavior.

## Problem Statement

Existing extension surfaces are system-specific. Tools use `tool_registry`. Workflow special-step plugins have their own loader. MCP/ACP project external capabilities into tools. Internal tools are registered through internal handler providers. There is no shared model for validating plugin contributions and projecting them into the owning subsystem.

## Goals

- Define typed contribution contracts for practical first-class extension points.
- Add `PluginContributionRegistry` as the central validated inventory of active plugin contributions.
- Add projection adapters into existing modules rather than rewriting those modules.
- Start with `tool`, `workflow.step`, and `workflow.hook` as the first demoable third-party path.
- Ensure disabling or quarantining a plugin removes or hides its projected contributions.

## Non-Goals

- Provider extension points such as memory and model providers are covered by EPIC-193.
- The generic event bus and capability endpoint escape hatches are covered by EPIC-192.
- UI management is covered by EPIC-195.
- Full marketplace/package execution is outside EPIC-191.

## Contribution Types

Initial typed contribution contracts:

- `tool`: registers executable tools into `tool_registry`, using existing governance and runtime execution paths.
- `workflow.step`: registers workflow job types and replaces the current special-step-only plugin surface over time.
- `workflow.hook`: declares hook subscription inventory for SDK-approved workflow lifecycle event names: `workflow.run.started`, `workflow.run.completed`, `workflow.run.failed`, `workflow.run.cancelled`, `workflow.step.started`, `workflow.step.completed`, and `workflow.step.failed`.
- `event.subscription`: parsed for future generic event-bus projection work in EPIC-192.
- `special_step`: retained for EPIC-190 compatibility while `workflow.step` provides the typed plugin contribution path.

Provider contribution contracts for memory, models, triggers, notifications, context, and secrets are tracked in EPIC-193.

## Workstreams

### 1. Contribution Registry

Create a registry that derives active contribution inventory by plugin id, contribution id, type, schema, runtime target, permissions, and computed validation/projection metadata; adapters and the orchestrator return structured projection results.

Acceptance criteria:

- Contributions are validated against manifest declarations.
- Duplicate contribution ids are rejected within a plugin.
- Conflicting global capability names are rejected or namespaced consistently.
- Contribution inventory is inspectable without invoking plugin code.

### 2. Tool Projection Adapter

Project `tool` contributions into `tool_registry`.

Acceptance criteria:

- Plugin tools appear in the existing tool catalog and use existing governance.
- Plugin tool invocation routes through the plugin kernel, not directly to plugin code.
- Disabling or quarantining a plugin removes or hides its tool registry projections.

### 3. Workflow Step Projection Adapter

Project `workflow.step` contributions into the workflow special-step execution path.

Acceptance criteria:

- Plugin workflow job types can be used in workflow YAML.
- Workflow execution invokes the plugin through the kernel and receives normalized output.
- Existing in-process special-step plugins continue to work during migration.

### 4. Workflow Hook Projection Inventory And Delivery Helper

Project `workflow.hook` contributions into inspectable hook subscription inventory and provide an explicit delivery helper for approved workflow lifecycle event names.

Acceptance criteria:

- Plugins can declare subscriptions for approved workflow lifecycle event names.
- When a caller invokes the delivery helper, delivery uses the plugin runtime policy activity check and applies hook event-name and subscription filters before runtime delivery; EPIC-191 does not add hook-specific permission enforcement.
- Delivery helper failures are normalized, including a distinct blocking-failure result for blocking hook subscriptions.
- Workflow-engine dispatch wiring for hook delivery is not part of EPIC-191.

## Backlog

- [x] E191-001 Define contribution type schemas in the plugin SDK/shared contracts.
- [x] E191-002 Add plugin contribution registry service and tests.
- [x] E191-003 Add tool contribution projection into `tool_registry`.
- [x] E191-004 Add plugin-kernel tool invocation bridge.
- [x] E191-005 Add workflow step contribution projection into special-step registry.
- [x] E191-006 Add workflow hook contribution projection.
- [x] E191-007 Add disable/quarantine cleanup for projected contributions.
- [x] E191-008 Add migration tests for existing tool and special-step behavior.

## Acceptance Criteria

- At least one third-party plugin can contribute a tool and a workflow step through sandboxed runtime execution.
- Contributions are validated, projected, inspectable, removable, and referenced by existing lifecycle/runtime audit coverage where those operations run.
- Owning modules call the plugin kernel or a narrow resolver, not plugin runtime code directly.
- Existing dynamic tools, MCP projections, ACP projections, and special-step handlers remain functional.
- Generic event-bus/capability endpoints remain EPIC-192, and provider extension points remain EPIC-193.
- EPIC-191 does not provide full marketplace/package execution, UI management, or provider extension support.
