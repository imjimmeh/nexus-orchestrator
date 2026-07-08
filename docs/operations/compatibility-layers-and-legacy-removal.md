# Compatibility Layers and Legacy Removal Plan

This document inventories active compatibility behavior after chat runtime was moved back into `apps/api`.

## Scope

This inventory focuses on migration leftovers from the split-service era (EPIC-088 to EPIC-094) and current cleanup priorities.

## Compatibility Inventory

| Layer                                    | Location                                                                                                                | Activation                 | Current Purpose                                                                                              | Removal Readiness                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Chat API compatibility proxy             | Removed from `apps/api/src/session/session-chat-proxy.service.ts` and API session controller wiring                     | N/A                        | Retired: chat runtime CRUD/message routes are served directly by API chat modules                            | Completed                                                                                  |
| Legacy in-process chat fallback          | Removed from `apps/api/src/session/session.controller.ts` and split-profile compose/env wiring                          | N/A                        | Retired: no chat proxy fallback remains                                                                      | Completed                                                                                  |
| Split-service doctor connectivity check  | `apps/api/src/operations/checks/split-service-health.check.ts`                                                          | Doctor report execution    | Detects `KANBAN_SERVICE_BASE_URL` misconfiguration and service health failures                               | Keep long-term (operational safety check, not technical debt)                              |
| Telemetry gateway compat helper wrappers | `apps/api/src/telemetry/telemetry.gateway.ts` and `telemetry-gateway-*.helpers.ts` with `*Compat` helpers               | Always active in telemetry | Preserves behavior while gateway responsibilities remain in API and handlers are split across helper modules | Candidate for consolidation after telemetry contracts and handler boundaries are finalized |
| Legacy session-tree read routes          | `apps/api/src/workflow/workflow-ad-hoc-session.controller.ts` (`GET /api/sessions/:id`, `GET /api/sessions/:id/events`) | Always active              | Backward compatibility for non-chat session consumers                                                        | Removable when verified unused and replaced by canonical run/chat APIs                     |

## High-Priority Cleanup Candidates

### 1. Telemetry compat helper consolidation

Target code:

- `apps/api/src/telemetry/telemetry.gateway.ts`
- `apps/api/src/telemetry/telemetry-gateway-*.helpers.ts`

Notes:

- This is primarily structural cleanup, not urgent migration risk.
- Keep until handler ownership and runtime boundaries are finalized.

### 2. Legacy generic session-tree reads

Target code:

- `apps/api/src/workflow/workflow-ad-hoc-session.controller.ts` (`GET /api/sessions/:id`, `GET /api/sessions/:id/events`)

Notes:

- Remove only after confirming no external/user-facing dependency.
- Ensure replacement APIs are documented before retirement.

## Recommended Validation Sequence

1. Ensure API and Kanban services are healthy (`GET /api/operations/doctor` includes split-service connectivity evidence for Kanban).
2. Validate chat runtime route health on API (`/api/sessions/chat*` and `/api/channel-adapters/telegram/webhook`).
3. Observe one to two stable release windows.
4. Remove remaining legacy session-tree compatibility routes when no consumers remain.

## Verification Checklist Before Removal PRs

1. Updated docs in `README.md`, `apps/api/README.md`, and architecture/runbook references.
2. Targeted tests for affected route behavior still pass.
3. Doctor split-service health check is green in target environments.
4. Rollback instructions for each removal are documented in the PR.
