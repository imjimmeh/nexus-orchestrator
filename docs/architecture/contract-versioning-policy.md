# Contract Versioning Policy (Service Split)

Defines compatibility rules for cross-service contracts published from `@nexus/core`.

## Scope

Applies to:

1. Workflow run request/status/control contracts.
2. Inter-service event envelope and domain event payload schemas.
3. Core/Kanban/chat-runtime client interface contracts.

## Versioning Rules

1. Contract versions are explicit in the type and event names (for example, `WorkflowRunRequestV1`, `*.v1` event types).
2. Once published, a version is immutable for breaking semantics.
3. Breaking changes require a new major contract version (`V2`) and explicit migration plan.

## Additive-Only Rules for Active Version

For the active version (`v1` at present), allowed changes:

1. Add new optional fields.
2. Add new event types in the same family where existing ones are unchanged.
3. Add new client methods without changing existing method signatures.

Disallowed changes:

1. Remove required fields.
2. Rename existing fields.
3. Change field types incompatibly.
4. Reinterpret existing enum values/semantics.

## Validation Expectations

1. `packages/core` schema tests must validate baseline required fields and accepted envelopes.
2. Consumer tests in `apps/api` must parse and use published contracts in real call-site flows.
3. Compatibility failures block epic progression until fixed or versioned.

## Deprecation and Migration

1. Mark old contracts as deprecated in code comments and migration docs.
2. Keep old and new versions available during migration windows.
3. Remove deprecated versions only after consumers are migrated and release gates pass.
