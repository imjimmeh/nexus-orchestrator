# EPIC-163: Deterministic Imported Repository Orchestration E2E

Status: Proposed
Priority: P0
Depends On: EPIC-138, EPIC-162
Related: docs/plans/2026-05-09-imported-repo-orchestration-contract-hardening.md
Last Updated: 2026-05-09

---

## 1. Summary

Create a separate deterministic orchestration integration-test project that runs the imported-repository bootstrap process end to end against the local Nexus stack using a scripted fake LLM server.

The suite should prove that a newly imported repository can move from project creation through investigation, probe artifact generation, synthesis, hydration, and orchestration-cycle readiness without relying on live AI or the outdated legacy E2E lifecycle scripts.

---

## 2. Problem Statement

The imported-repository orchestration failure on project `dad09d35-4e5a-47fa-9dc0-ffa3b8960af4` was not caught by existing tests because unit tests covered isolated pieces and older E2E suites do not deterministically exercise the full orchestration path.

The current E2E surface is fragmented:

1. `apps/api/test/*.e2e-spec.ts` contains NestJS-style API tests, many with mocked dependencies.
2. `packages/e2e-tests` contains older lifecycle runners and live-stack tests that are broad, slow, and partly outdated.
3. `apps/api/test/helpers/fake-llm-server.ts` exists, but it is scoped to API tests and only supports a simple queued next-response model.

The orchestration system needs a deterministic integration suite that can script LLM tool calls, inspect workflow state, and assert domain outcomes across service boundaries.

---

## 3. Goals

1. Add a separate workspace for deterministic orchestration E2E tests, independent from the legacy `packages/e2e-tests` lifecycle runner.
2. Use a scripted fake LLM server to drive agent turns deterministically.
3. Test the imported-repository bootstrap path from project import through work-item hydration.
4. Assert that probe artifacts with `## Narrative Summary` produce canonical work items.
5. Assert that invalid probe artifacts produce visible blocked diagnostics instead of silent completion.
6. Make the suite runnable locally and in CI without live provider credentials.
7. Keep the suite small enough to diagnose failures quickly.

---

## 4. Non-Goals

1. Rewriting all legacy E2E tests.
2. Replacing unit tests for parser, synthesis, workflow routing, or dispatch.
3. Testing live provider behavior.
4. Testing browser UI flows.
5. Building a full workflow simulation engine outside the product.
6. Making fake LLM scripts smart or probabilistic.

---

## 5. Proposed Test Project

Create a new workspace:

```text
packages/orchestration-e2e/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    fake-llm/
      scripted-fake-llm-server.ts
      scripted-fake-llm-server.spec.ts
    infra/
      api-client.ts
      config.ts
      polling.ts
      test-repository.ts
      workflow-state.ts
    imported-repo-bootstrap/
      fixtures/
        minimal-imported-repo/
      imported-repo-bootstrap.e2e-spec.ts
      imported-repo-blocked-hydration.e2e-spec.ts
```

Add root scripts:

```json
{
  "test:e2e:orchestration": "npm run test --workspace=packages/orchestration-e2e",
  "test:e2e:orchestration:imported-repo": "npm run test:imported-repo --workspace=packages/orchestration-e2e"
}
```

---

## 6. Fake LLM Design

The existing `apps/api/test/helpers/fake-llm-server.ts` should inspire the implementation, but the orchestration E2E suite needs a deeper fake.

### Required Behavior

1. Serve OpenAI-compatible endpoints:
   - `GET /v1/models`
   - `POST /v1/chat/completions`
2. Support non-streaming and streaming responses.
3. Match requests by ordered script step, prompt substring, tool availability, or explicit test label.
4. Return deterministic assistant messages and tool calls.
5. Record every request and response for failure diagnostics.
6. Fail fast when no script step matches the current request.

### Script Shape

```ts
export interface FakeLlmScriptStep {
  id: string;
  match?: {
    promptIncludes?: string[];
    toolNamesInclude?: string[];
  };
  response:
    | { type: 'text'; content: string }
    | {
        type: 'tool_call';
        toolName: string;
        arguments: Record<string, unknown>;
      };
}
```

### Why This Is a Separate Module

The fake LLM is an integration-test adapter. It should not live in production code, and it should not remain trapped under `apps/api/test/helpers` if a separate workspace needs it.

---

## 7. Primary Imported-Repo Happy Path Test

### Scenario

1. Start local stack with API, kanban, Postgres, Redis, and runner support.
2. Start scripted fake LLM server on a random port.
3. Configure AI provider/model/profile records to use the fake LLM server.
4. Create a local git fixture repository with enough files for discovery.
5. Import the fixture repository as a new project.
6. Start project orchestration with goals.
7. Fake LLM drives the investigation and hydration path with deterministic tool calls.
8. Wait for linked workflow runs to settle.
9. Assert:
   - project has at least one work item;
   - work item source metadata points to generated specs;
   - workflow runs are completed;
   - orchestration has no blocked hydration diagnostic;
   - probe artifacts contain `## Narrative Summary`;
   - synthesis/hydration accepted those artifacts.

### Acceptance Criteria

1. The test fails before the artifact-contract fix because hydration blocks on `invalid_probe_results`.
2. The test passes after the artifact-contract fix.
3. No live provider key is required.
4. The test output includes fake LLM request logs when it fails.

---

## 8. Blocked Hydration Regression Test

### Scenario

1. Create/import a fixture repository.
2. Drive the investigation step to write one intentionally invalid successful probe artifact with no narrative section.
3. Run synthesis/hydration.
4. Assert:
   - no work items are published from invalid probes;
   - hydration summary is `ok:false`, `status:"blocked"`, `reason:"invalid_probe_results"`;
   - project orchestration exposes blocked diagnostics;
   - downstream cycle request is not emitted;
   - the project state makes the blocked reason visible to callers.

### Acceptance Criteria

1. The test proves blocked output is visible, not silently buried in a completed workflow.
2. The test does not require a workflow run status of `FAILED`.
3. The test identifies the invalid probe file path in diagnostics.

---

## 9. Implementation Tasks

- [ ] E163-001 Create `packages/orchestration-e2e` workspace with Vitest and TypeScript config.
- [ ] E163-002 Add scripted fake LLM server with ordered script matching and request logs.
- [ ] E163-003 Add orchestration E2E API client helpers for auth, project creation/import, AI config, workflow polling, and work-item queries.
- [ ] E163-004 Add local git fixture setup helper for imported repositories.
- [ ] E163-005 Add happy-path imported-repository bootstrap test.
- [ ] E163-006 Add blocked-hydration regression test.
- [ ] E163-007 Add root npm scripts for the new suite.
- [ ] E163-008 Add CI/local documentation for running the suite against Docker Compose.
- [ ] E163-009 Emit fake LLM request/response logs and workflow run IDs on test failure.

---

## 10. Suggested Implementation Plan

### Phase 1: Test Workspace Skeleton

1. Create `packages/orchestration-e2e/package.json` with `test`, `test:imported-repo`, and `typecheck` scripts.
2. Add `packages/orchestration-e2e/vitest.config.ts` with serial execution and long timeouts.
3. Add `packages/orchestration-e2e/src/infra/config.ts` with `ORCH_E2E_API_URL`, `ORCH_E2E_WS_URL`, `ORCH_E2E_RUN`, and timeout settings.
4. Add root scripts in `package.json`.
5. Verify `npm run test --workspace=packages/orchestration-e2e` runs an empty smoke test.

### Phase 2: Scripted Fake LLM

1. Port the OpenAI-compatible basics from `apps/api/test/helpers/fake-llm-server.ts`.
2. Add script-step matching and failure diagnostics.
3. Add unit tests for text response, tool-call response, stream response, and unmatched request failure.

### Phase 3: Stack Integration Helpers

1. Add auth token helper using the configured JWT secret.
2. Add API client wrapper with retries and useful assertion errors.
3. Add AI config helper that points provider/model/profile records to the fake LLM base URL.
4. Add workflow polling helper that waits on workflow run status and extracts state variables.
5. Add work-item query helper for project work-item counts and metadata.

### Phase 4: Imported Repo Fixture

1. Create a minimal local repository fixture with `package.json`, `README.md`, and small `src` files.
2. Add helper to copy fixture into a temp directory and initialize git.
3. Ensure fixture cleanup runs after tests.

### Phase 5: Happy Path Test

1. Script fake LLM responses for investigation, finalization, synthesis/hydration, and orchestration cycle readiness.
2. Create/import the fixture project.
3. Start orchestration.
4. Poll until discovery and hydration settle.
5. Assert work items exist and blocked diagnostics are absent.

### Phase 6: Blocked Path Test

1. Script fake LLM responses that produce an invalid successful probe.
2. Start orchestration.
3. Poll until discovery settles.
4. Assert blocked hydration diagnostics are present and no cycle dispatch occurred.

---

## 11. Quality Gates

1. `npm run test --workspace=packages/orchestration-e2e`
2. `npm run typecheck --workspace=packages/orchestration-e2e`
3. `npm run test:e2e:orchestration`
4. `npm run validate:seed-data`
5. `npm run test:kanban`

---

## 12. Risks

1. Risk: full orchestration E2E remains slow or flaky because it depends on Docker services and async queues.
   Mitigation: keep tests serial, poll conditionally, record run IDs, and avoid arbitrary sleeps.
2. Risk: fake LLM scripts become too coupled to exact prompt wording.
   Mitigation: match on stable tool availability and workflow phase markers where possible, not full prompt bodies.
3. Risk: the suite duplicates legacy `packages/e2e-tests` helpers.
   Mitigation: copy only the minimum initially; extract shared infra later if both suites become healthy.
4. Risk: orchestration workflow prompts are hard to script because the agent may choose different tool-call ordering.
   Mitigation: use deterministic system prompts and fake responses that force required tool calls one at a time.
5. Risk: CI cannot run the full Docker stack reliably.
   Mitigation: gate the suite behind `ORCH_E2E_RUN=true` initially, but make local execution deterministic and documented.

---

## 13. Definition of Done

1. A developer can run `npm run test:e2e:orchestration` against the local Docker stack.
2. The suite uses fake LLM responses only; no live provider credentials are required.
3. The happy path proves imported repository bootstrap creates work items from probe artifacts.
4. The blocked path proves invalid probe artifacts surface blocked diagnostics.
5. Test failure output includes project ID, workflow run IDs, fake LLM transcript path, and relevant API responses.
