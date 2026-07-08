# CEO Restart Continuity Runbook

## Scope

Operational runbook for EPIC-058 restart continuity behavior.

## Expected Behavior

On orchestration restart:

1. ProjectOrchestrationStartedEvent includes isRestart and stateSummary.
2. Discovery and cycle workflows receive restart context inputs.
3. CEO prompting uses restart-aware guidance to continue from current state.

Restart session continuity policy:

4. CEO restart uses summary-first continuity (isRestart + stateSummary) and starts a fresh session container.
5. Session-tree restoration for CEO orchestration restart is intentionally deferred; see ADR-0001.

## Verification Steps

1. Start orchestration for a project with existing artifacts (for example PRD or work items).
2. Restart orchestration.
3. Inspect run inputs/event payload and confirm isRestart and stateSummary are present.
4. Verify CEO behavior continues from current phase and does not re-run completed discovery/spec work.

## High-Signal Checks

1. stateSummary includes current artifact/work-item/decision context.
2. Prompt templates include restart-aware branch logic.
3. Decision log progression remains consistent after restart.

## Common Failure Patterns

1. Restart behaves like first start

- Missing or empty restart payload fields.
- Workflow templates not consuming mapped restart inputs.

2. Context summary present but ignored

- Prompt branch conditions not wired to restart flag.
- Overly generic prompt text overriding restart guidance.

3. Session continuity mismatches

- Session-tree linkage policy not implemented or intentionally disabled.
- Restart policy behavior differs across workflow entry points.

## Recovery Actions

1. Confirm event payload wiring in orchestration start path.
2. Confirm workflow job-input mapping for state_summary and is_restart.
3. Confirm seeded CEO profile prompt guidance includes restart instructions.
4. If session linkage is optional/deferred, document policy and use fresh-session fallback.

## Policy Reference

- docs/adrs/0001-orchestration-restart-session-policy.md

## Operational Caveat

Restart continuity is a behavioral contract that spans event payloads, prompts, and workflow routing. It is not solely a REST API contract.

## Related Docs

- docs/epics/EPIC-058-ceo-agent-context-continuity-on-restart.md
- docs/architecture/workflow-engine.md
- docs/architecture/rest-api.md
- docs/adrs/0001-orchestration-restart-session-policy.md
