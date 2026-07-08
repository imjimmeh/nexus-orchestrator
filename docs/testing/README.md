# Testing and Quality Strategy

Nexus Orchestrator uses a multi-layered testing and analysis strategy to ensure reliability, security, and maintainability across the monorepo.

## Testing Levels

### 1. Unit Tests (Vitest)
Unit tests are co-located with the source code and focus on isolated logic (services, utilities, components).
- **API**: `npm run test --workspace=apps/api`
- **Kanban**: `npm run test --workspace=apps/kanban`
- **Web**: `npm run test:unit --workspace=apps/web`

### 2. Integration and E2E Tests
Tests that verify multiple components or full user flows within a single service.
- **API (Local/Mocked)**: `npm run test:e2e --workspace=apps/api` (runs against mocked AI providers)
- **Web (Playwright)**: `npm run test:e2e --workspace=apps/web` starts the Vite UI server via Playwright and fails fast unless the API is reachable at `PLAYWRIGHT_API_URL` or `http://localhost:3010/api`. Start the API first with `npm run start:api`.

### 3. Live E2E Tests (Real AI Execution)
Deterministic tests that run against a live stack with real LLM provider credentials.
- **API (Live)**: `RUN_LIVE_E2E=true npm run test:e2e --workspace=apps/api`
- **Orchestration/Kanban**: `npm run test:e2e:kanban:deterministic` (verifies full Kanban lifecycle)

### 4. Workflow Strategy Tests
Specialized tests that validate workflow DAGs and transitions without side effects.
- See `docs/testing/workflow-testing.md` for more details on the testing DSL.

## Quality Analysis and Linting

We enforce strict coding standards and analyze technical debt as part of our quality gate.

### Linting
We use ESLint for all TypeScript and React code.
- **Root Summary**: `npm run lint:summary`
- **Per-Service**: `npm run lint --workspace=<app-or-package>`

### Technical Debt and Duplication
We use `jscpd` for copy-paste detection and custom analysis scripts for domain conformance.
- **Web Quality**: `npm run analyze:web:quality`
- **Duplication (jscpd)**: `npm run analyze:web:quality:jscpd`

## CI Quality Gates

Our (planned) CI pipeline enforces the following rules:
1.  **Zero Lint Warnings**: New code must not introduce lint warnings.
2.  **No Critical Duplication**: `jscpd` must not find large duplicated blocks.
3.  **Test Pass Rate**: 100% of unit and E2E tests must pass.
4.  **Zod Validation**: All external API boundaries must be protected by Zod schemas.

## Test Data and Seeding

We use deterministic seed data for all test environments.
- **Seeding API**: `npm run validate:seed-data --workspace=apps/api`
- **Seed Source**: `seed/` directory in the root.

See `seed/README.md` for more information on how to manage and update seed data.
