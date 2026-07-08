# Epic 015: Workflow Intelligence — Context Injection, Tool Usage & Quality Gates

## Overview

Upgrade the workflow execution pipeline so that agents produce meaningful, grounded responses by: (1) injecting upstream step outputs into downstream system prompts, (2) writing detailed, structured prompts that instruct agents to produce specific outputs, and (3) introducing a quality-gate review step that evaluates and enriches synthesis output before publication.

## Motivation

Current workflows execute agents in isolated containers with no awareness of what previous steps produced. The `synthesize` step receives "Synthesize market opportunities and risks" but never sees the actual research output. Agents also run with vague one-line prompts, so they produce generic AI responses that don't reflect any real analysis.

## Goals

1. **Context continuity**: Downstream steps automatically receive upstream outputs in their system prompts
2. **Structured output**: Agents produce JSON summary blocks that enable rich step output metadata
3. **Quality assurance**: A review step pattern that evaluates output quality and enriches the pipeline
4. **End-to-end validation**: A comprehensive functional test workflow that exercises all of the above

## Dependencies

- Epic 014 (Pi-Runner SDK Migration) — completed
- Tool registry with seeded tools: `read`, `bash`, `query_memory`, `spawn_subagent`, `upsert_tool`
- Heavy-tier Docker image with curl, git, python3, jq

---

## Phase 1: Context Injection — Upstream Outputs in Downstream Prompts

**Priority: CRITICAL — this is why agents produce empty/vague answers.**

### Problem

When `handleStepComplete` runs, it stores the output in state variables:

```
steps.research_market.output = { ok: true, containerId, logsTail }
```

But the downstream step's system prompt is resolved by `resolveStepSettings()`, which only uses the static `step.inputs.system_prompt` string. No upstream context is ever injected.

### Step 1.1 — Build context from upstream outputs in StepExecutionConsumer

Add a `buildUpstreamContext()` method to `StepExecutionConsumer` that:

1. Reads `step.depends_on` from the step definition
2. For each dependency, fetches `steps.{depId}.output` from state variables
3. Extracts meaningful text: `output.logsTail` (which contains the agent's actual response from container logs)
4. Formats it as a structured context block:

   ```
   ## Context from previous steps

   ### research_market
   <output from research_market>

   ### research_risks
   <output from research_risks>
   ```

5. Prepends this context block to the resolved system prompt

Also handle **transition sources**: when a step is reached via a transition from step A, inject A's output even though it may not be in `depends_on`.

**Files**: `apps/api/src/workflow/step-execution.consumer.ts`

### Step 1.2 — Capture agent response text in step output

Currently the step output is:

```typescript
{
  ok: (true, containerId, stepId, logsTail);
}
```

The `logsTail` is raw container log output (last N lines). We should also capture the agent's final response text from telemetry. The `turn_end` event from the pi-runner's telemetry bridge includes the agent's cached response.

- In `TelemetryGateway.handleTurnEnd()`, extract `payload.output.response` (the agent's text response)
- Store it alongside the existing output so downstream steps get clean text rather than raw Docker logs

**Files**: `apps/api/src/telemetry/telemetry.gateway.ts`, `apps/api/src/workflow/step-execution.consumer.ts`

### Step 1.3 — Unit tests for context injection

- Test `buildUpstreamContext()` with single dependency, multiple dependencies, missing outputs
- Test that transition-source context is also injected
- Test that the context block is prepended to the system prompt

**Files**: `apps/api/src/workflow/step-execution.consumer.spec.ts` (new)

---

## Phase 2: Tool-Enabled Workflow Execution

### Step 2.1 — Upgrade functional test workflow to heavy tier with tools

Replace the toy functional test YAML with a meaningful workflow:

**Simple mode** — lightweight smoke test (keep existing):

- Single step, light tier, no tools

**Complex mode** — full capability test:

- `research_market`: heavy tier, tools: `["bash", "read"]`, system prompt instructs the agent to use curl or write analysis to a file
- `research_risks`: heavy tier, tools: `["bash", "read"]`, similar
- `synthesize`: heavy tier, tools: `["bash", "read"]`, prompt includes instruction to read previous outputs and produce consolidated analysis
- `review`: heavy tier, tools: `["read"]`, manager/quality-gate step that evaluates synthesize output (see Phase 3)
- `publish`: light tier, produces final output

**Files**: `packages/functional-tests/src/run-workflow.ts`

### Step 2.2 — Verify tool auto-discovery in pi-runner

The session factory already discovers extensions from `/app/extensions`. Verify that when tools are mounted:

1. The tool TypeScript files are correctly loaded by the SDK
2. The agent can see and invoke them
3. The tools appear in telemetry events

This is a verification step — may require no code changes if auto-discovery works.

**Files**: `packages/pi-runner/src/session-factory.ts` (verify only)

---

## Phase 3: Quality Gate — Review Step with Transition Loop

### Step 3.1 — Review step pattern in workflow YAML

Add a `review` step that:

- Depends on `synthesize`
- Receives synthesize output via context injection (Phase 1)
- Has transitions:
  - `steps.review.output.ok == true AND steps.review.output.approved == true` → `publish`
  - `steps.review.output.ok == true AND steps.review.output.approved != true` → `synthesize` (loop back)
- System prompt instructs the agent to evaluate quality, completeness, and accuracy
- The agent must output a structured response indicating approval or rejection with feedback

**Files**: `packages/functional-tests/src/run-workflow.ts`

### Step 3.2 — Support structured output extraction from transition evaluation

The `StateMachineService.evaluateTransition()` currently evaluates conditions against state variables. The step output contains `{ ok: true, logsTail }` — we need the `approved` field to be extractable.

Modify the output capture to parse the agent's response for structured JSON if present. When the agent outputs a JSON block, merge those fields into the step output so transitions can reference them (e.g., `steps.review.output.approved`).

**Files**: `apps/api/src/workflow/step-execution.consumer.ts`

### Step 3.3 — Unit tests for structured output extraction

- Test JSON extraction from agent response
- Test fallback when no JSON present
- Test transition evaluation with extracted fields

**Files**: `apps/api/src/workflow/step-execution.consumer.spec.ts`

---

## Phase 4: Functional Test Updates & Validation

### Step 4.1 — Update functional test harness

Update the test runner to:

- Support the new complex workflow shape (with review loop)
- Wait for the correct terminal step
- Validate that context injection worked (check telemetry for context blocks)
- Handle the review loop gracefully (may take 2+ iterations)

**Files**: `packages/functional-tests/src/run-workflow.ts`

### Step 4.2 — End-to-end validation

Run the full complex workflow and verify:

- [ ] Research steps produce substantive output using tools
- [ ] Synthesize step receives and references research outputs
- [ ] Review step evaluates quality and approves/loops
- [ ] Publish step produces a complete final deliverable
- [ ] All telemetry events flow correctly
- [ ] Workflow completes with status COMPLETED

---

## Acceptance Criteria

- [ ] Downstream steps receive upstream outputs in their system prompt context
- [ ] Agent response text is captured and stored in step output (not just raw Docker logs)
- [ ] Functional test complex workflow uses heavy tier with bash/read tools
- [ ] Review step pattern works with transition loop (approve → publish, reject → re-synthesize)
- [ ] Structured JSON extraction from agent responses enables rich transition conditions
- [ ] All existing unit tests continue to pass
- [ ] Complex functional test passes end-to-end
- [ ] No API keys or secrets exposed in Docker environment variables

## Risk & Mitigations

| Risk                                                   | Mitigation                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| Agent doesn't produce valid JSON for structured output | Parse best-effort; fall back to `ok: true` with no extra fields |
| Context injection makes prompts too long               | Truncate upstream outputs to last 2000 chars per dependency     |
| Review loop iterates endlessly                         | Existing loop protection (max 10 iterations) prevents this      |
| Heavy-tier containers slow down tests                  | Accept longer test runtime; heavy containers are ~10s startup   |
