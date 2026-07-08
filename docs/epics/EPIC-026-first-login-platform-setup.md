# EPIC-026: First-Login Platform Setup Flow

## Summary
Introduce a guided first-login setup flow for the first admin user so a new installation can become operational without manual database edits. The flow must configure the initial AI provider, secret, model, and ensure the architect agent is available.

This epic complements (not replaces) environment-driven bootstrap seeding.

## Problem Statement
Today, initial AI configuration is spread across seed defaults, environment variables, and optional manual admin/API steps. This creates onboarding friction and uncertainty for new installs.

## Goals
- Add an explicit, user-facing setup experience for first admin login.
- Ensure a usable provider + secret + model exist before normal platform usage.
- Ensure `architect-agent` exists and is configured against the selected provider/model.
- Keep setup idempotent and safe to retry.
- Keep env bootstrap support for local/CI scenarios.

## Non-Goals
- Full multi-step wizard with advanced UX branching.
- Multi-provider setup in first run (single-provider MVP only).
- Full migration system for historical AI config cleanup.

## User Stories
- As the first admin, I am redirected to setup after login if the platform is not initialized.
- As an admin, I can submit provider/base URL/secret/model details once and start using the platform immediately.
- As an operator, I can still use env bootstrap in CI/local automation.

## Scope

### Backend
- Add setup status API:
  - `GET /setup/status` (authenticated)
- Add setup initialize API:
  - `POST /setup/initialize` (admin only)
- Setup status must report:
  - presence of active provider(s)
  - presence of active model(s)
  - presence of any secret
  - presence of `architect-agent`
  - `requiresSetup` decision for admin users
- Setup initialize must upsert:
  - secret (`secret_store`)
  - provider (`llm_providers`)
  - model (`llm_models`, defaults set)
  - architect profile (`agent_profiles`, linked to provider/model)

### Frontend
- Add setup page route (protected): `/setup`
- Redirect authenticated admin users to `/setup` when `requiresSetup=true`
- Allow submit of initial provider + secret + model configuration
- Return to normal app route after successful initialization

### Documentation
- Update API docs with setup endpoints and payloads
- Update operator/developer docs with first-run setup behavior
- Keep env bootstrap docs and describe interplay with setup flow

## Proposed Phases

### Phase 1: Epic + design alignment
- Create this epic and lock scope for MVP.

### Phase 2: Backend setup APIs
- Implement setup module/controller/service
- Add unit tests for setup state and initialization behavior
- Ensure architect profile upsert/linking behavior

### Phase 3: Frontend setup flow
- Implement `/setup` page and route guard behavior
- Add unit/component tests for redirect and submit behavior

### Phase 4: Documentation and verification
- Update README and setup docs
- Run focused tests and build verification

## Acceptance Criteria
- First admin login to an uninitialized install is redirected to setup.
- Setup can create provider + secret + model + architect profile in one operation.
- Setup is idempotent; repeated submissions update same logical records.
- Non-admin users are not blocked by setup flow.
- Env bootstrap remains available and documented.
- Unit tests cover success path, idempotency, and access control.

## Risks
- Redirect loops if setup status checks are not cached/guarded.
- Inconsistent provider naming conventions across existing environments.
- Secret handling safety if plaintext or weak fallback paths are used.

## Mitigations
- Route guard bypass for `/setup` itself and explicit post-success state refresh.
- Normalize provider naming in setup payload validation.
- Reuse existing encryption path and avoid exposing encrypted payloads.

## Test Strategy
- Backend unit tests:
  - setup status requires/does-not-require setup
  - initialize creates missing resources
  - initialize updates existing resources (idempotent)
  - initialize rejects non-admin access
- Frontend tests:
  - protected route redirects admin to setup when required
  - setup submit calls API and navigates to app

## Rollout Plan
- Merge backend and frontend in phased commits.
- Ship behind straightforward runtime behavior (no feature flag for MVP).
- Validate in local docker-compose fresh DB scenario.
