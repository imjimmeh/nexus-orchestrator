# Service Topology Cutover Runbook

Operational runbook for current service topology hardening and cutover.

## 1. Scope

Use this runbook when validating or operating the `api` and `kanban` topology.

This runbook covers:

1. Startup and health validation.
2. Internal service identity and scope validation.
3. Correlation and causation propagation checks.
4. Doctor diagnostics for cross-service health.
5. Cutover and rollback playbook.

## 2. Preconditions

1. Local or staging environment has Docker and Compose available.
2. Root dependencies are installed (`npm install`).
3. Shared JWT secret is configured consistently across services.

## 3. Startup

1. Build and start topology:

```bash
docker compose up -d --build api kanban
```

2. Validate service health endpoints:

```bash
curl -sS http://localhost:3010/api/health
curl -sS http://localhost:3012/api/health
```

3. Confirm services are healthy:

```bash
docker compose ps
```

## 4. Required Environment Variables

### API

1. `CHAT_SERVICE_BEARER_TOKEN` (trusted chat client/internal auth)
2. `CHAT_SERVICE_JWT_AUDIENCE`
3. `CHAT_SERVICE_JWT_ISSUER`
4. `CHAT_SERVICE_JWT_TTL`
5. `KANBAN_SERVICE_BASE_URL`
6. `KANBAN_SERVICE_BEARER_TOKEN`
7. `DOCTOR_SPLIT_SERVICE_TIMEOUT_MS`

### Kanban

1. `KANBAN_CORE_BASE_URL`
2. `KANBAN_CORE_BEARER_TOKEN` (optional static fallback)
3. `KANBAN_CORE_JWT_AUDIENCE`
4. `KANBAN_CORE_JWT_ISSUER`
5. `KANBAN_CORE_JWT_TTL`
6. `KANBAN_SERVICE_BEARER_TOKEN` (optional static fallback)
7. `KANBAN_SERVICE_JWT_AUDIENCE`
8. `KANBAN_SERVICE_JWT_ISSUER`

## 5. Internal Auth and Scope Validation

1. Internal core workflow endpoints in API require service scopes:
   - `core.workflow-runs:read`
   - `core.workflow-runs:write`
2. Chat internal routes in API require service scopes:
   - `chat.sessions:read`
   - `chat.sessions:write`
   - `chat.memory:read`
3. Kanban internal core event routes require service scopes:
   - `kanban.core-events:read`
   - `kanban.core-events:write`

If scope validation fails, downstream endpoints return `403` with missing-scope details.

## 6. Correlation and Causation Propagation

Verify `X-Correlation-ID` and `X-Causation-ID` on cross-boundary calls:

1. UI ingress -> API chat route surface.
2. API chat action dispatch -> API internal core workflow endpoints.
3. Kanban workflow submissions -> API internal core workflow endpoints.

Expected behavior:

1. Correlation IDs are preserved end-to-end.
2. Causation IDs are preserved when present, or derived deterministically by caller.

## 7. Doctor Diagnostics

Use operations doctor machine output:

```bash
curl -sS "http://localhost:3010/api/operations/doctor?format=machine"
```

Check these diagnostics explicitly:

1. `contract_schema_version_mismatch_check`
2. `queue_lag_and_dead_letter_detector`
3. `split_service_connectivity_check`

## 8. Chat Route Behavior

Chat runtime CRUD/message routes are served directly by API chat modules.

## 9. Canary Checklist

1. Start API/Kanban and validate health endpoints.
2. Run doctor diagnostics and confirm no `fail` status.
3. Run deterministic integration checks:
   - `npm run test:e2e:kanban:deterministic`
4. Enforce canary SLO thresholds for each canary window:

| Metric                                                                 | Target   | Abort Threshold                       |
| ---------------------------------------------------------------------- | -------- | ------------------------------------- |
| API + Kanban healthcheck success                                       | 100%     | Any failed healthcheck for >5 minutes |
| Core -> Kanban lifecycle fanout success (`POST /internal/core/events`) | >= 99.5% | < 99% over rolling 15 minutes         |
| Chat runtime route 5xx rate (`/api/sessions/chat*`)                    | <= 0.5%  | > 1% over rolling 15 minutes          |
| Doctor split-service connectivity status                               | `ok`     | Any `fail` status                     |

5. Keep static-token compatibility available during canary for JWT rollback.

## 10. Rollback Playbook

1. Switch service auth to static token mode if JWT claims are failing:
   - Set `*_BEARER_TOKEN` values for relevant services.
2. If needed, stop Kanban and keep API-only operation:

```bash
docker compose stop kanban
```

3. Validate API health and doctor output after rollback.

## 11. Evidence to Record

For each cutover window, capture:

1. `docker compose ps` output.
2. Doctor machine report payload.
3. Deterministic test run result references.
4. Any auth scope or correlation propagation incident notes.
