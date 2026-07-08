# EPIC-120 - Output Tool and Job Output Contract Evolution

Status: Implementation-Ready Design  
Created: 2026-04-18  
Updated: 2026-04-18  
Related Epics: EPIC-050, EPIC-053, EPIC-119  

---

## Executive Summary

Replace the tool-name-centric job completion model with a **state-driven output contract** system. Eliminate `output_tool` and `required_tool_calls` in favor of `output_contract` validated against workflow state. Consolidate 15 bespoke special step handlers into ~7 generic handlers, and make workflow YAML expressive enough to encode domain logic declaratively.

**Target State:**
- Agents call `set_job_output(data)` to persist structured output to workflow state
- Runtime validates `output_contract` after container exit, retrying if unmet
- Domain logic lives in workflow YAML (conditions, switch/case, for_each, mappings)
- Special handlers are generic infrastructure primitives, not bespoke business logic

---

## Current Architecture (Detailed)

### Job Completion Model

**File:** `packages/core/src/interfaces/workflow-legacy.types.ts:201-231`

```typescript
interface IBaseJob {
  id: string;
  type: WorkflowJobType;
  tier: string;
  condition?: string;
  depends_on?: string[];
  inputs?: Record<string, unknown>;
  workflow_id?: string;
  wait_for_completion?: boolean;
  permissions?: IToolPermissionPolicy;
  host_mounts?: IHostMountRequest[];
  tools?: string[];
  transitions?: IWorkflowTransition[];
  required_tool_calls?: string[];  // Array of tool names that MUST be called
  max_retries?: number;
  retry_prompt?: string;
  max_step_loops?: number;
  output_tool?: string;  // Tool name whose arguments become job output
}
```

### Output Capture Mechanism

**File:** `apps/api/src/workflow/tool-output-capture.service.ts`

The runtime registers `output_tool` before container execution:

```typescript
// step-execution-orchestrator.service.ts:90-98
if (job.output_tool) {
  this.toolOutputCapture.registerOutputTool(
    workflowRunId,
    jobId,
    job.output_tool,
  );
}
```

When the agent calls the output tool (e.g., `submit_preflight_artifacts`), capture happens via:
1. **Synchronous path** (api_callback): HTTP POST writes directly to `jobs.{jobId}.output`
2. **Telemetry path** (WebSocket): `tool_execution_end` event triggers `captureIfMatch()`

**Race condition:** The telemetry path is fire-and-forget. Required-tool satisfaction is checked via in-memory `wasToolCalled()` tracker, which can miss calls if telemetry arrives late.

### Retry/Satisfaction Logic

**File:** `apps/api/src/workflow/step-required-tool-retry.service.ts:132-157`

```typescript
private async resolveUnsatisfiedRequiredTools(
  workflowRunId: string,
  jobId: string,
  job: IJob,
  requiredTools: string[],
): Promise<string[]> {
  const outputStateKey = `jobs.${jobId}.output`;
  const outputCaptured = await this.stateManager.getVariable(workflowRunId, outputStateKey);
  const hasOutput = outputCaptured !== null && outputCaptured !== undefined;
  const outputTool = job.output_tool;

  return requiredTools.filter((tool) => {
    if (tool === outputTool && hasOutput) {
      return false; // satisfied via state
    }
    if (this.toolOutputCapture.wasToolCalled(workflowRunId, jobId, tool)) {
      return false; // satisfied via telemetry
    }
    return true; // missing
  });
}
```

### Special Step Handlers (15 Total)

**File:** `apps/api/src/workflow/step-*-special-step.handler.ts`

| Handler | Domain | Purpose |
|---------|--------|---------|
| `register_tool` | core | Dynamic tool registration |
| `invoke_workflow` | core | Child workflow calls |
| `attempt_merge` | kanban | Git merge with conflict detection |
| `run_command` | core | Shell execution |
| `web_automation` | core | Browser automation |
| `transition_status` | kanban | Work item status transitions |
| `record_metadata` | kanban | Complex metadata mutations (10+ actions) |
| `manage_container` | chat | Container pause/resume/dehydrate |
| `manage_execution` | kanban | Execution lifecycle |
| `manage_worktree` | kanban | Git worktree management |
| `emit_event` | core | Event emission |
| `hydrate_work_items_from_specs` | kanban | Historical removed spec reconciliation handler; current path is Kanban resource publishing via `kanban.publish_specs` |
| `check_orchestration_status` | kanban | Status checking |
| `validate_tool_candidate` | core | Tool validation |
| `publish_tool_candidate` | core | Tool publishing |

### Domain-Specific Output Tools

**File:** `apps/api/src/tool/capability-manifest.*.ts`

Tools like `submit_preflight_artifacts`, `submit_qa_decision`, `submit_orchestration_decision` mix two concerns:
1. **Output emission** (writing to `jobs.{jobId}.output`)
2. **Domain mutation** (updating work items, projects, etc.)

This tight coupling means workflow completion depends on specific tool names and their side effects.

---

## Target Architecture

### Core Principles

1. **Job completion = output contract satisfaction**, not tool calls
2. **Domain logic lives in workflow YAML**, not handler code
3. **Handlers are generic primitives**, not bespoke business logic
4. **State is the single source of truth** for inter-job communication
5. **Agents are stateless** - they read inputs from state, write outputs to state

### System Overview

```
Workflow Definition (YAML)
  |
  v
Job declares: output_contract (required output keys)
              condition (when to run)
              inputs (from state via templates)
  |
  v
Agent executes in container
  |
  v
Agent calls set_job_output({key: value, ...})  <-- Generic tool, no domain logic
  |
  v
Runtime validates output_contract against jobs.{jobId}.output
  |
  v
If satisfied -> mark job complete -> evaluate transitions
If unsatisfied -> retry with prompt -> agent runs again
  |
  v
Downstream jobs read from state via template substitution
Special handlers read from state, apply generic operations
```

---

## Detailed Design

### 1. Job Output Contracts

#### 1.1 `set_job_output` Tool

**New capability manifest entry:**

```typescript
// apps/api/src/tool/capability-manifest.core.entries.ts
export const SET_JOB_OUTPUT_ENTRY: CapabilityManifestEntry = {
  name: 'set_job_output',
  tierRestriction: 1, // Available to all tiers
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['context'],
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/jobs/{job_id}/output',
    bodyMapping: {
      data: 'data', // Object with arbitrary keys
    },
  },
  description: 'Persist structured output data for the current job. This data becomes available to downstream jobs via template substitution.',
};
```

**Endpoint:**

```typescript
// apps/api/src/workflow/workflow-runtime-lifecycle.controller.ts
@Post('jobs/:jobId/output')
async setJobOutput(
  @Param('workflowRunId') workflowRunId: string,
  @Param('jobId') jobId: string,
  @Body() body: { data: Record<string, unknown> },
): Promise<void> {
  await this.workflowRuntimeService.setJobOutput(workflowRunId, jobId, body.data);
}
```

**Service implementation:**

```typescript
// apps/api/src/workflow/workflow-runtime-set-job-output.service.ts
@Injectable()
export class WorkflowRuntimeSetJobOutputService {
  constructor(private readonly stateManager: StateManagerService) {}

  async setJobOutput(
    workflowRunId: string,
    jobId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const stateKey = `jobs.${jobId}.output`;
    const existing = await this.stateManager.getVariable(workflowRunId, stateKey);
    
    // Merge with existing output (last-write-wins per key)
    const merged = existing && typeof existing === 'object'
      ? { ...(existing as Record<string, unknown>), ...data }
      : data;
    
    await this.stateManager.setVariable(workflowRunId, stateKey, merged);
  }
}
```

**Behavior:**
- Synchronous HTTP callback (no WebSocket telemetry race)
- Multiple calls merge (last-write-wins per key)
- No schema validation at write time (validated at job completion)
- Agent can call it multiple times during execution

#### 1.2 `output_contract` Field

**Type definition:**

```typescript
// packages/core/src/interfaces/workflow-legacy.types.ts
interface OutputContract {
  required: string[];           // Required top-level keys
  optional?: string[];          // Optional keys (for documentation)
}

interface IBaseJob {
  // ... existing fields ...
  output_contract?: OutputContract;  // Replaces output_tool
  // output_tool?: string;           // DEPRECATED - remove in Phase 5
  // required_tool_calls?: string[]; // DEPRECATED - remove in Phase 5
}
```

**Validation:**

```typescript
// apps/api/src/workflow/validation/workflow-validation.job-rules.ts
function validateOutputContract(job: IJob, collector: ValidationCollector): void {
  if (job.output_contract !== undefined) {
    if (!Array.isArray(job.output_contract.required)) {
      collector.add(`Job '${job.id}' output_contract.required must be an array`);
      return;
    }
    if (job.output_contract.required.length === 0) {
      collector.add(`Job '${job.id}' output_contract.required cannot be empty`);
    }
    for (const key of job.output_contract.required) {
      if (!isNonEmptyString(key)) {
        collector.add(`Job '${job.id}' output_contract.required contains invalid key: '${key}'`);
      }
      if (key.includes('.')) {
        collector.add(`Job '${job.id}' output_contract keys must be flat (no nesting): '${key}'`);
      }
    }
  }
  
  // Mutually exclusive with deprecated fields
  if (job.output_contract && job.output_tool) {
    collector.add(`Job '${job.id}' cannot have both output_contract and output_tool (output_tool is deprecated)`);
  }
}
```

**Contract validation at job completion:**

```typescript
// apps/api/src/workflow/workflow-output-contract.service.ts
@Injectable()
export class WorkflowOutputContractService {
  constructor(private readonly stateManager: StateManagerService) {}

  async validateOutputContract(
    workflowRunId: string,
    jobId: string,
    contract: OutputContract,
  ): Promise<{ valid: boolean; missing: string[] }> {
    const output = await this.stateManager.getVariable(
      workflowRunId,
      `jobs.${jobId}.output`,
    );

    if (!output || typeof output !== 'object') {
      return { valid: false, missing: contract.required };
    }

    const outputObj = output as Record<string, unknown>;
    const missing = contract.required.filter(key => !(key in outputObj));

    return { valid: missing.length === 0, missing };
  }
}
```

#### 1.3 Retry Logic (Replaces Required Tool Calls)

**File:** `apps/api/src/workflow/step-required-tool-retry.service.ts` (refactored)

```typescript
// New logic replaces resolveUnsatisfiedRequiredTools
async checkOutputContractAndRetry(
  workflowRunId: string,
  jobId: string,
  job: IJob,
): Promise<'proceed' | 'retried'> {
  // If no contract, proceed (backward compat)
  if (!job.output_contract) {
    return this.legacyCheckRequiredTools(workflowRunId, jobId, job);
  }

  const { valid, missing } = await this.outputContractService.validateOutputContract(
    workflowRunId,
    jobId,
    job.output_contract,
  );

  if (valid) {
    this.logger.info(`Job ${jobId} output contract satisfied`);
    return 'proceed';
  }

  // Check retry limits
  const retryCount = await this.stateManager.getVariable(
    workflowRunId,
    `_internal.retries.${jobId}`,
  ) ?? 0;

  const maxRetries = job.max_retries ?? 0;
  if (retryCount >= maxRetries) {
    throw new Error(
      `Job ${jobId} output contract unsatisfied after ${maxRetries} retries. ` +
      `Missing keys: ${missing.join(', ')}`
    );
  }

  // Build retry prompt
  const retryPrompt = job.retry_prompt ?? this.buildDefaultRetryPrompt(missing);
  
  // Save session for resume
  await this.saveSessionTreeForResume(workflowRunId, jobId);
  
  // Increment retry counter
  await this.stateManager.setVariable(
    workflowRunId,
    `_internal.retries.${jobId}`,
    (retryCount as number) + 1,
  );

  // Re-enqueue job with retry message
  await this.workflowEngine.retryJobWithMessage(
    workflowRunId,
    jobId,
    retryPrompt,
  );

  return 'retried';
}

private buildDefaultRetryPrompt(missing: string[]): string {
  return `The job output is incomplete. You must provide the following required fields: ${missing.join(', ')}. ` +
    `Use the set_job_output tool to persist these values.`;
}
```

---

### 2. Generic Special Handlers

Reduce 15 handlers to 7 by consolidating domain-specific handlers into generic primitives.

#### 2.1 Handler Inventory

| Handler | Status | Replaces |
|---------|--------|----------|
| `amend_entity` | **NEW** | `transition_status`, `record_metadata`, `manage_execution`, `manage_container`, `check_orchestration_status` |
| `git_operation` | **NEW** | `attempt_merge`, `manage_worktree` |
| `manage_tool_candidate` | **NEW** | `validate_tool_candidate`, `publish_tool_candidate` |
| `run_command` | Keep | (no change) |
| `web_automation` | Keep | (no change) |
| `invoke_workflow` | Keep | (no change) |
| `emit_event` | Keep | (no change) |
| `register_tool` | **DEPRECATED** | Migrate to `amend_entity` with `entity_type: tool` |
| `hydrate_work_items_from_specs` | **REMOVED/SUPERSEDED** | Replace with Kanban-owned `kanban.publish_specs` resource publishing, or agent diff + `for_each` loops only where explicitly required |

#### 2.2 `amend_entity` Handler

**File:** `apps/api/src/workflow/step-amend-entity-special-step.handler.ts`

```typescript
interface AmendEntityInputs {
  entity_type: 'work_item' | 'project' | 'execution' | 'container' | 'tool';
  action: 'create' | 'update' | 'upsert' | 'delete' | 'archive' | 'append_to_array';
  match_key?: string;           // For upsert: key to match existing entities
  entity_id?: string;           // For update/delete: specific entity ID
  parent_id?: string;           // For create: parent entity ID
  updates?: Record<string, unknown>;  // Field updates
  array_field?: string;         // For append_to_array
  array_value?: unknown;        // For append_to_array
}

@SpecialStepHandler({ type: 'amend_entity' })
export class StepAmendEntitySpecialStepHandler implements ISpecialStepHandler {
  constructor(
    private readonly workItemDomainPort: WorkItemDomainPort,
    private readonly projectDomainPort: ProjectDomainPort,
    private readonly executionService: ExecutionService,
    private readonly containerService: ContainerService,
    private readonly toolRegistryService: ToolRegistryService,
  ) {}

  async execute(context: ISpecialStepContext): Promise<Record<string, unknown>> {
    const inputs = context.inputs as AmendEntityInputs;
    
    switch (inputs.entity_type) {
      case 'work_item':
        return this.handleWorkItem(inputs);
      case 'project':
        return this.handleProject(inputs);
      case 'execution':
        return this.handleExecution(inputs);
      case 'container':
        return this.handleContainer(inputs);
      case 'tool':
        return this.handleTool(inputs);
      default:
        throw new Error(`Unknown entity_type: ${inputs.entity_type}`);
    }
  }

  private async handleWorkItem(inputs: AmendEntityInputs): Promise<Record<string, unknown>> {
    switch (inputs.action) {
      case 'create':
        const workItem = await this.workItemDomainPort.create({
          projectId: inputs.parent_id!,
          ...inputs.updates,
        });
        return { id: workItem.id, status: 'created' };

      case 'update':
        await this.workItemDomainPort.update(inputs.entity_id!, inputs.updates!);
        return { id: inputs.entity_id, status: 'updated' };

      case 'upsert':
        const existing = await this.workItemDomainPort.findByKey(
          inputs.match_key!,
          inputs.updates![inputs.match_key!],
        );
        if (existing) {
          await this.workItemDomainPort.update(existing.id, inputs.updates!);
          return { id: existing.id, status: 'updated' };
        } else {
          const created = await this.workItemDomainPort.create({
            projectId: inputs.parent_id!,
            ...inputs.updates,
          });
          return { id: created.id, status: 'created' };
        }

      case 'archive':
        await this.workItemDomainPort.archive(inputs.entity_id!);
        return { id: inputs.entity_id, status: 'archived' };

      case 'append_to_array':
        await this.workItemDomainPort.appendToArray(
          inputs.entity_id!,
          inputs.array_field!,
          inputs.array_value!,
        );
        return { id: inputs.entity_id, status: 'appended' };

      default:
        throw new Error(`Unsupported action '${inputs.action}' for work_item`);
    }
  }

  // ... similar for project, execution, container, tool
}
```

#### 2.3 `git_operation` Handler

**File:** `apps/api/src/workflow/step-git-operation-special-step.handler.ts`

```typescript
interface GitOperationInputs {
  action: 'merge' | 'create_worktree' | 'remove_worktree' | 'create_branch';
  project_id: string;
  base_branch?: string;
  target_branch?: string;
  work_item_id?: string;
}

@SpecialStepHandler({ type: 'git_operation' })
export class StepGitOperationSpecialStepHandler implements ISpecialStepHandler {
  constructor(
    private readonly gitMergeService: GitMergeService,
    private readonly gitWorktreeService: GitWorktreeService,
  ) {}

  async execute(context: ISpecialStepContext): Promise<Record<string, unknown>> {
    const inputs = context.inputs as GitOperationInputs;
    
    switch (inputs.action) {
      case 'merge':
        return this.gitMergeService.mergeWithConflictDetection({
          projectId: inputs.project_id,
          baseBranch: inputs.base_branch!,
          targetBranch: inputs.target_branch!,
        });

      case 'create_worktree':
        return this.gitWorktreeService.create({
          projectId: inputs.project_id,
          workItemId: inputs.work_item_id!,
          baseBranch: inputs.base_branch,
        });

      case 'remove_worktree':
        await this.gitWorktreeService.remove({
          projectId: inputs.project_id,
          workItemId: inputs.work_item_id!,
        });
        return { status: 'removed' };

      case 'create_branch':
        return this.gitWorktreeService.createBranch({
          projectId: inputs.project_id,
          branchName: inputs.target_branch!,
          baseBranch: inputs.base_branch,
        });

      default:
        throw new Error(`Unknown git action: ${inputs.action}`);
    }
  }
}
```

#### 2.4 `manage_tool_candidate` Handler

**File:** `apps/api/src/workflow/step-manage-tool-candidate-special-step.handler.ts`

```typescript
interface ManageToolCandidateInputs {
  action: 'validate' | 'publish';
  artifact_id: string;
}

@SpecialStepHandler({ type: 'manage_tool_candidate' })
export class StepManageToolCandidateSpecialStepHandler implements ISpecialStepHandler {
  constructor(private readonly toolCandidateService: ToolCandidateService) {}

  async execute(context: ISpecialStepContext): Promise<Record<string, unknown>> {
    const inputs = context.inputs as ManageToolCandidateInputs;
    
    switch (inputs.action) {
      case 'validate':
        const validation = await this.toolCandidateService.validateCandidate(inputs.artifact_id);
        return { 
          validation_run_id: validation.runId,
          status: validation.status,
        };

      case 'publish':
        const published = await this.toolCandidateService.publishCandidate(inputs.artifact_id);
        return {
          tool_name: published.name,
          version: published.version,
          status: 'published',
        };

      default:
        throw new Error(`Unknown action: ${inputs.action}`);
    }
  }
}
```

---

### 3. Workflow YAML Enhancements

#### 3.1 `condition` on Jobs

**Current:** Jobs have `condition?: string` but it's basic.

**Enhanced:** Full Handlebars expression support with helpers:

```yaml
jobs:
  - id: run_tests
    type: execution
    condition: "{{ trigger.run_tests }} == true"
    output_contract:
      required: [test_results]
```

#### 3.2 `switch` / `case` Routing

**New feature:** Branching within a single job based on state values.

```yaml
jobs:
  - id: apply_qa_decision
    type: special
    handler: amend_entity
    inputs:
      entity_type: work_item
      entity_id: "{{ trigger.work_item_id }}"
    switch:
      - case: "{{ jobs.qa_review.output.decision }} == 'approved'"
        inputs:
          action: update
          updates:
            status: ready_to_merge
            qa_feedback: "{{ jobs.qa_review.output.feedback }}"
      - case: "{{ jobs.qa_review.output.decision }} == 'rejected'"
        inputs:
          action: update
          updates:
            status: in_progress
            qa_feedback: "{{ jobs.qa_review.output.feedback }}"
      - case: "{{ jobs.qa_review.output.decision }} == 'needs_changes'"
        inputs:
          action: update
          updates:
            status: in_progress
            qa_feedback: "{{ jobs.qa_review.output.feedback }}"
            needs_rework: true
      - default:
        inputs:
          action: update
          updates:
            status: needs_review
```

**Type definition:**

```typescript
interface ISwitchCase {
  case: string;              // Handlebars expression
  inputs: Record<string, unknown>;
}

interface IJob {
  // ... existing fields ...
  switch?: ISwitchCase[];
  default?: { inputs: Record<string, unknown> };
}
```

**Execution:** The handler evaluates `switch` cases in order, uses the first match, falls back to `default`. The selected inputs are merged with base `inputs`.

#### 3.3 `for_each` Loops

**New feature:** Execute handler once per item in an array.

```yaml
jobs:
  - id: create_subtasks
    type: special
    handler: amend_entity
    for_each: "{{ jobs.refinement.output.subtasks }}"
    inputs:
      entity_type: work_item
      action: create
      parent_id: "{{ trigger.work_item_id }}"
      updates:
        title: "{{ item.title }}"
        description: "{{ item.description }}"
        priority: "{{ item.priority }}"
```

**Type definition:**

```typescript
interface IJob {
  // ... existing fields ...
  for_each?: string;  // Handlebars expression resolving to array
}
```

**Execution behavior:**
- Evaluate `for_each` expression to get array
- Execute handler once per array element
- `item` variable is available in template context for each iteration
- `item_index` variable contains 0-based index
- Output is array of iteration results: `[{id: "wi-1"}, {id: "wi-2"}, ...]`
- Stored at `jobs.{jobId}.output`

**Error handling:**
- Default: fail-fast (one iteration fails = job fails)
- Optional: `continue_on_error: true` - collect errors, return `{results: [...], errors: [...]}`

```yaml
jobs:
  - id: batch_update
    type: special
    handler: amend_entity
    for_each: "{{ items }}"
    continue_on_error: true
    inputs:
      entity_type: work_item
      action: update
      entity_id: "{{ item.id }}"
      updates:
        status: "{{ item.status }}"
```

#### 3.4 `mapping` Transforms

**New feature:** Value translation in inputs without separate handler logic.

```yaml
jobs:
  - id: transition_status
    type: special
    handler: amend_entity
    inputs:
      entity_type: work_item
      action: update
      entity_id: "{{ trigger.work_item_id }}"
      updates:
        status:
          source: "{{ jobs.qa_review.output.decision }}"
          mapping:
            approved: ready_to_merge
            rejected: in_progress
            needs_changes: in_progress
        review_count:
          source: "{{ jobs.qa_review.output.review_count }}"
          default: 0
```

**Type definition:**

```typescript
interface IMappingTransform {
  source: string;           // Template expression
  mapping: Record<string, unknown>;  // Value translations
  default?: unknown;        // Fallback if source not in mapping
}
```

**Execution:** The runtime resolves `source`, looks up in `mapping`, falls back to `default`. If no match and no default, throws error.

---

## YAML Examples: Before vs After

### Example 1: QA Review Workflow

#### Before (Tool-Centric)

```yaml
jobs:
  - id: qa_review
    type: execution
    output_tool: submit_qa_decision
    required_tool_calls: [submit_qa_decision]
    max_retries: 2
    retry_prompt: "You must call submit_qa_decision with your verdict"
```

#### After (State-Driven)

```yaml
jobs:
  - id: qa_review
    type: execution
    output_contract:
      required: [decision, feedback]
    max_retries: 2
    retry_prompt: "Your review is incomplete. Provide decision (approved/rejected/needs_changes) and feedback."

  - id: apply_decision
    type: special
    handler: amend_entity
    depends_on: [qa_review]
    inputs:
      entity_type: work_item
      action: update
      entity_id: "{{ trigger.work_item_id }}"
      updates:
        status:
          source: "{{ jobs.qa_review.output.decision }}"
          mapping:
            approved: ready_to_merge
            rejected: in_progress
            needs_changes: in_progress
        qa_feedback: "{{ jobs.qa_review.output.feedback }}"
        last_reviewed_at: "{{ now }}"
```

### Example 2: Preflight Workflow

#### Before

```yaml
jobs:
  - id: preflight
    type: execution
    output_tool: submit_preflight_artifacts
    required_tool_calls: [submit_preflight_artifacts]
```

#### After

```yaml
jobs:
  - id: preflight
    type: execution
    output_contract:
      required:
        - pm_summary
        - acceptance_clarifications
        - architect_summary
        - sdd_targets
        - implementation_plan

  - id: persist_preflight
    type: special
    handler: amend_entity
    depends_on: [preflight]
    inputs:
      entity_type: work_item
      action: update
      entity_id: "{{ trigger.work_item_id }}"
      updates:
        preflight_artifacts: "{{ jobs.preflight.output }}"
```

### Example 3: Spec Hydration (Complex, Legacy)

The bespoke hydration special step shown below is historical and removed. Current spec publishing and hydration should use the Kanban-owned `kanban.publish_specs` resource publishing boundary.

#### Before (Historical Bespoke Handler - Removed/Superseded)

```yaml
jobs:
  - id: hydrate_specs
    type: special
    handler: hydrate_work_items_from_specs
    inputs:
      dry_run: false
```

#### After (Agent Diff + for_each)

```yaml
jobs:
  - id: scan_specs
    type: execution
    output_contract:
      required: [spec_files]
    # Agent scans docs/work_items/*.md, reads existing work items, computes diff

  - id: create_new_items
    type: special
    handler: amend_entity
    depends_on: [scan_specs]
    for_each: "{{ jobs.scan_specs.output.spec_files.to_create }}"
    inputs:
      entity_type: work_item
      action: create
      parent_id: "{{ trigger.project_id }}"
      updates:
        title: "{{ item.title }}"
        slug: "{{ item.slug }}"
        priority: "{{ item.priority }}"
        description: "{{ item.description }}"

  - id: update_existing_items
    type: special
    handler: amend_entity
    depends_on: [scan_specs]
    for_each: "{{ jobs.scan_specs.output.spec_files.to_update }}"
    inputs:
      entity_type: work_item
      action: update
      entity_id: "{{ item.id }}"
      updates:
        title: "{{ item.title }}"
        priority: "{{ item.priority }}"
        description: "{{ item.description }}"

  - id: archive_removed_items
    type: special
    handler: amend_entity
    depends_on: [scan_specs]
    for_each: "{{ jobs.scan_specs.output.spec_files.to_archive }}"
    inputs:
      entity_type: work_item
      action: archive
      entity_id: "{{ item.id }}"
```

### Example 4: Git Merge + Worktree

#### Before

```yaml
jobs:
  - id: provision_worktree
    type: special
    handler: manage_worktree
    inputs:
      action: provision

  - id: attempt_merge
    type: special
    handler: attempt_merge
    depends_on: [provision_worktree]
```

#### After

```yaml
jobs:
  - id: provision_worktree
    type: special
    handler: git_operation
    inputs:
      action: create_worktree
      project_id: "{{ trigger.project_id }}"
      work_item_id: "{{ trigger.work_item_id }}"
      base_branch: "{{ trigger.base_branch }}"

  - id: attempt_merge
    type: special
    handler: git_operation
    depends_on: [provision_worktree]
    inputs:
      action: merge
      project_id: "{{ trigger.project_id }}"
      base_branch: "{{ jobs.provision_worktree.output.base_branch }}"
      target_branch: "{{ jobs.provision_worktree.output.target_branch }}"
```

### Example 5: Orchestration Decision

#### Before

```yaml
jobs:
  - id: orchestration_review
    type: execution
    output_tool: submit_orchestration_decision
    required_tool_calls: [submit_orchestration_decision]
```

#### After

```yaml
jobs:
  - id: orchestration_review
    type: execution
    output_contract:
      required: [decision, reasoning]

  - id: apply_decision
    type: special
    handler: amend_entity
    depends_on: [orchestration_review]
    switch:
      - case: "{{ jobs.orchestration_review.output.decision }} == 'proceed'"
        inputs:
          entity_type: project
          action: update
          entity_id: "{{ trigger.project_id }}"
          updates:
            orchestration_status: active
            last_decision: "{{ jobs.orchestration_review.output.reasoning }}"
      - case: "{{ jobs.orchestration_review.output.decision }} == 'pause'"
        inputs:
          entity_type: project
          action: update
          entity_id: "{{ trigger.project_id }}"
          updates:
            orchestration_status: paused
            pause_reason: "{{ jobs.orchestration_review.output.reasoning }}"
      - default:
        inputs:
          entity_type: project
          action: update
          entity_id: "{{ trigger.project_id }}"
          updates:
            orchestration_status: needs_review
```

---

## Implementation Plan

### Phase 1: Foundation (Week 1-2)

**Goal:** Add `set_job_output` tool and `output_contract` field, keep backward compatibility.

#### Task 1.1: Add `set_job_output` capability manifest entry

**Files:**
- Create: `apps/api/src/tool/capability-manifest.core.entries.ts`
- Modify: `apps/api/src/tool/capability-manifest.ts` (register entry)

**Code:**
```typescript
export const SET_JOB_OUTPUT_ENTRY: CapabilityManifestEntry = {
  name: 'set_job_output',
  tierRestriction: 1,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['context'],
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/jobs/{job_id}/output',
    bodyMapping: { data: 'data' },
  },
  description: 'Persist structured job output to workflow state',
};
```

#### Task 1.2: Create `set_job_output` endpoint and service

**Files:**
- Create: `apps/api/src/workflow/workflow-runtime-set-job-output.service.ts`
- Modify: `apps/api/src/workflow/workflow-runtime-lifecycle.controller.ts` (add endpoint)
- Modify: `apps/api/src/workflow/workflow.module.ts` (register service)

**Code:** (see Detailed Design section 1.1)

#### Task 1.3: Add `output_contract` to job types

**Files:**
- Modify: `packages/core/src/interfaces/workflow-legacy.types.ts`

**Code:**
```typescript
interface OutputContract {
  required: string[];
  optional?: string[];
}

interface IBaseJob {
  // ... existing fields ...
  output_contract?: OutputContract;
  // Keep deprecated fields for now:
  output_tool?: string;
  required_tool_calls?: string[];
}
```

#### Task 1.4: Add validation for `output_contract`

**Files:**
- Modify: `apps/api/src/workflow/validation/workflow-validation.job-rules.ts`

**Code:** (see Detailed Design section 1.2)

#### Task 1.5: Create output contract validation service

**Files:**
- Create: `apps/api/src/workflow/workflow-output-contract.service.ts`

**Code:** (see Detailed Design section 1.2)

#### Task 1.6: Update retry logic to check output contracts

**Files:**
- Modify: `apps/api/src/workflow/step-required-tool-retry.service.ts`

**Changes:**
- Add `WorkflowOutputContractService` dependency
- Modify `checkRequiredToolCallsAndRetry` to check `output_contract` first
- Fall back to legacy `required_tool_calls` logic if no contract

**Code:** (see Detailed Design section 1.3)

#### Task 1.7: Add tests for output contract validation

**Files:**
- Create: `apps/api/src/workflow/workflow-output-contract.service.spec.ts`

**Tests:**
- Valid contract (all required keys present)
- Missing required key
- Empty output object
- Null/undefined output
- Multiple calls to set_job_output (merge behavior)

#### Task 1.8: Update seed workflows to use output_contract

**Files:**
- Modify: `apps/api/src/database/seeds/workflows/*.yaml`
- Modify: `test/*.e2e-spec.ts` (test workflow definitions)

**Example change:**
```yaml
# Before:
output_tool: submit_preflight_artifacts
required_tool_calls: [submit_preflight_artifacts]

# After:
output_contract:
  required: [pm_summary, acceptance_clarifications, architect_summary, sdd_targets, implementation_plan]
```

#### Task 1.9: Update agent prompts to reference set_job_output

**Files:**
- Modify: `apps/api/src/database/seeds/workflows/prompts/*/system.md`
- Modify: `apps/api/src/database/seeds/workflows/prompts/*/step-*.md`

**Changes:**
- Replace "call submit_qa_decision" with "use set_job_output"
- Replace "call submit_preflight_artifacts" with "use set_job_output"
- Add explicit `set_job_output` usage examples in prompts
- Update retry prompts to reference output fields, not tool names

**Example:**
```markdown
# Before:
When complete, call submit_qa_decision with decision and feedback.

# After:
When complete, use set_job_output to persist your results.
Required fields: decision (approved/rejected/needs_changes), feedback (string).
Example: {"tool": "set_job_output", "arguments": {"data": {"decision": "approved", "feedback": "..."}}}
```

#### Task 1.10: Update agent skills for state-driven output

**Files:**
- Modify: `.agents/skills/*/SKILL.md` (any skill referencing output tools)
- Modify: `.agents/skills/*/.prompt.md`

**Changes:**
- Replace tool-specific output instructions with `set_job_output` instructions
- Add validation reminder: "The workflow runtime checks that required fields are present"
- Update examples to show `set_job_output` JSON structure

### Phase 2: Generic Handlers (Week 3-4)

**Goal:** Create `amend_entity`, `git_operation`, `manage_tool_candidate` handlers. Deprecate old handlers.

#### Task 2.1: Create `amend_entity` handler

**Files:**
- Create: `apps/api/src/workflow/step-amend-entity-special-step.handler.ts`
- Modify: `apps/api/src/workflow/workflow.module.ts` (register handler)

**Code:** (see Detailed Design section 2.2)

#### Task 2.2: Create `git_operation` handler

**Files:**
- Create: `apps/api/src/workflow/step-git-operation-special-step.handler.ts`
- Modify: `apps/api/src/workflow/workflow.module.ts`

**Code:** (see Detailed Design section 2.3)

#### Task 2.3: Create `manage_tool_candidate` handler

**Files:**
- Create: `apps/api/src/workflow/step-manage-tool-candidate-special-step.handler.ts`
- Modify: `apps/api/src/workflow/workflow.module.ts`

**Code:** (see Detailed Design section 2.4)

#### Task 2.4: Add handler tests

**Files:**
- Create: `apps/api/src/workflow/step-amend-entity-special-step.handler.spec.ts`
- Create: `apps/api/src/workflow/step-git-operation-special-step.handler.spec.ts`
- Create: `apps/api/src/workflow/step-manage-tool-candidate-special-step.handler.spec.ts`

**Tests:**
- All entity types and actions
- Error cases (unknown entity type, unsupported action)
- Upsert behavior (create vs update)

#### Task 2.5: Update seed workflows to use generic handlers

**Files:**
- Modify: `apps/api/src/database/seeds/workflows/*.yaml`

**Migration examples:** (see YAML Examples section)

#### Task 2.6: Mark old handlers as deprecated

**Files:**
- Modify: All old handler files (add `@deprecated` JSDoc)
- Modify: `apps/api/src/workflow/step-special-step.types.ts` (add deprecation notice)

```typescript
/**
 * @deprecated Use amend_entity instead
 */
@SpecialStepHandler({ type: 'transition_status' })
export class StepTransitionStatusSpecialStepHandler { ... }
```

### Phase 3: Workflow YAML Enhancements (Week 5-6)

**Goal:** Add `switch`, `for_each`, and `mapping` to workflow YAML.

#### Task 3.1: Add `switch` / `case` support

**Files:**
- Modify: `packages/core/src/interfaces/workflow-legacy.types.ts` (add types)
- Modify: `apps/api/src/workflow/step-special-step-executor.service.ts` (evaluate switch)

**Code:**
```typescript
// In step-special-step-executor.service.ts
private async evaluateSwitch(
  job: IJob,
  context: WorkflowContext,
): Promise<Record<string, unknown>> {
  if (!job.switch) return job.inputs ?? {};
  
  for (const caseBranch of job.switch) {
    const condition = await this.templateService.render(caseBranch.case, context);
    if (condition === 'true' || condition === true) {
      return { ...job.inputs, ...caseBranch.inputs };
    }
  }
  
  if (job.default) {
    return { ...job.inputs, ...job.default.inputs };
  }
  
  throw new Error(`No switch case matched for job ${job.id}`);
}
```

#### Task 3.2: Add `for_each` loop support

**Files:**
- Modify: `apps/api/src/workflow/step-special-step-executor.service.ts`

**Code:**
```typescript
private async executeForEach(
  job: IJob,
  handler: ISpecialStepHandler,
  context: WorkflowContext,
): Promise<Record<string, unknown>> {
  const arrayExpr = await this.templateService.render(job.for_each!, context);
  const items = JSON.parse(arrayExpr);
  
  if (!Array.isArray(items)) {
    throw new Error(`for_each expression must resolve to array, got: ${typeof items}`);
  }
  
  const results = [];
  const errors = [];
  
  for (let i = 0; i < items.length; i++) {
    const itemContext = {
      ...context,
      item: items[i],
      item_index: i,
    };
    
    try {
      const result = await handler.execute({ ...context, inputs: itemContext });
      results.push(result);
    } catch (error) {
      if (job.continue_on_error) {
        errors.push({ index: i, error: error.message });
      } else {
        throw error;
      }
    }
  }
  
  return job.continue_on_error 
    ? { results, errors }
    : results;
}
```

#### Task 3.3: Add `mapping` transform support

**Files:**
- Modify: `apps/api/src/workflow/workflow-input-processor.service.ts` (new or existing)

**Code:**
```typescript
private async processMapping(
  value: unknown,
  context: WorkflowContext,
): Promise<unknown> {
  if (!value || typeof value !== 'object' || !('source' in value)) {
    return value;
  }
  
  const mapping = value as IMappingTransform;
  const sourceValue = await this.templateService.render(mapping.source, context);
  
  if (sourceValue in mapping.mapping) {
    return mapping.mapping[sourceValue];
  }
  
  if (mapping.default !== undefined) {
    return mapping.default;
  }
  
  throw new Error(`Mapping error: value '${sourceValue}' not found in mapping and no default provided`);
}
```

#### Task 3.4: Add YAML validation for new features

**Files:**
- Modify: `apps/api/src/workflow/validation/workflow-validation.job-rules.ts`

**Validations:**
- `switch` cases must have valid Handlebars expressions
- `for_each` must be a valid template expression
- `mapping` must have `source` and `mapping` fields
- `continue_on_error` only valid with `for_each`

#### Task 3.5: Add tests for YAML enhancements

**Files:**
- Create: `apps/api/src/workflow/workflow-yaml-enhancements.spec.ts`

**Tests:**
- Switch case matching
- Switch default fallback
- for_each sequential execution
- for_each with continue_on_error
- Mapping transforms
- Nested mappings

#### Task 3.6: Update seed workflows with new YAML features

**Files:**
- Modify: `apps/api/src/database/seeds/workflows/*.yaml`

Replace multiple conditional jobs with single switch job. Replace bespoke handlers with for_each loops.

### Phase 4: Migration & Cleanup (Week 7-8)

**Goal:** Remove deprecated fields and handlers. Update documentation.

#### Task 4.1: Remove `output_tool` and `required_tool_calls` from types

**Files:**
- Modify: `packages/core/src/interfaces/workflow-legacy.types.ts`

```typescript
interface IBaseJob {
  // ... existing fields ...
  output_contract?: OutputContract;
  // REMOVED: output_tool?: string;
  // REMOVED: required_tool_calls?: string[];
}
```

#### Task 4.2: Remove deprecated handlers

**Files:**
- Delete: `apps/api/src/workflow/step-transition-status-special-step.handler.ts`
- Delete: `apps/api/src/workflow/step-record-metadata-special-step.handler.ts`
- Delete: `apps/api/src/workflow/step-manage-execution-special-step.handler.ts`
- Delete: `apps/api/src/workflow/step-manage-container-special-step.handler.ts`
- Delete: `apps/api/src/workflow/step-manage-worktree-special-step.handler.ts`
- Delete: `apps/api/src/workflow/step-attempt-merge-special-step.handler.ts`
- Delete: `apps/api/src/workflow/step-check-orchestration-status-special-step.handler.ts`
- Delete: `apps/api/src/workflow/step-validate-tool-candidate-special-step.handler.ts`
- Delete: `apps/api/src/workflow/step-publish-tool-candidate-special-step.handler.ts`
- Delete: `apps/api/src/workflow/step-hydrate-work-items-special-step.handler.ts`

#### Task 4.3: Remove deprecated capability manifest entries

**Files:**
- Modify: Relevant `capability-manifest.*.ts` files

Remove entries for:
- `submit_qa_decision` (if it only did output + side effect)
- `submit_preflight_artifacts` (if it only did output)
- Any other output-only tools

**Note:** Keep tools that do pure domain mutations (e.g., `git_commit`, `create_pull_request`) but remove ones that were only for job output.

#### Task 4.4: Remove `ToolOutputCaptureService`

**Files:**
- Delete: `apps/api/src/workflow/tool-output-capture.service.ts`
- Modify: `apps/api/src/workflow/workflow.module.ts`
- Modify: `apps/api/src/workflow/step-execution-orchestrator.service.ts`
- Modify: `apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts`

#### Task 4.5: Update documentation

**Files:**
- Create: `docs/guides/workflow-authoring-v2.md`
- Modify: `README.md` (workflow section)

Document:
- `output_contract` usage
- `set_job_output` tool
- Generic handlers
- `switch`, `for_each`, `mapping` syntax
- Migration guide from old format

#### Task 4.6: Update e2e tests

**Files:**
- Modify: `test/*.e2e-spec.ts`

Ensure all e2e tests pass with new workflow format.

#### Task 4.7: Update database audit view

**Files:**
- Create: `apps/api/src/database/migrations/202604XX0000-update-workflow-run-audit-view-for-output-contract.ts`
- Modify: `docs/operations/workflow-required-tools-audit-runbook.md`

**Migration:**
```typescript
export class UpdateWorkflowRunAuditViewForOutputContract implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP VIEW IF EXISTS workflow_run_required_tools_audit_v1;
      
      CREATE VIEW workflow_run_required_tools_audit_v1 AS
      SELECT
        we.workflow_run_id,
        we.job_id,
        we.payload->>'status' AS job_status,
        we.payload->'outputContract' AS output_contract,
        we.payload->>'outputContractValidation' AS validation_status,
        we.created_at
      FROM workflow_event we
      WHERE we.event_type = 'job_completed'
        AND we.payload->'outputContract' IS NOT NULL;
    `);
  }
  
  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore old view
  }
}
```

#### Task 4.8: Update event ledger and telemetry

**Files:**
- Modify: `apps/api/src/telemetry/telemetry.gateway.spec.ts`
- Modify: `apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts`

**Changes:**
- Replace mock tool names (`submit_qa_decision`) with `set_job_output` in tests
- Add new event types for output contract validation
- Update telemetry payloads to include contract validation state

#### Task 4.9: Update capability manifest and preflight

**Files:**
- Modify: `apps/api/src/tool/capability-manifest.preflight.entry.ts` (remove deprecated entry)
- Modify: `apps/api/src/tool/capability-manifest.execution.approvals.entries.ts`
- Modify: `apps/api/src/tool/capability-manifest.runtime.orchestration.entries.ts`
- Modify: `apps/api/src/tool/capability-preflight.service.ts`
- Modify: `apps/api/src/tool/capability-preflight.service.spec.ts`

**Changes:**
- Remove deprecated capability entries
- Update preflight validation to check `output_contract` and `set_job_output`
- Replace error messages and reason codes

#### Task 4.10: Update workflow parser and audit payloads

**Files:**
- Modify: `apps/api/src/workflow/workflow-parser.service.ts`
- Modify: `apps/api/src/workflow/workflow-parser.service.spec.ts`
- Modify: `apps/api/src/workflow/workflow-job-audit-payload.utils.ts`

**Changes:**
- Parser copies `output_contract` instead of `required_tool_calls`
- Audit payload emits `outputContract` instead of `outputTool`/`requiredToolCalls`

#### Task 4.11: Update frontend types and UI

**Files:**
- Modify: `apps/web/src/lib/api/types.ts`
- Modify: `apps/web/src/pages/workflows/WorkflowRunDetailContent.tsx`

**Changes:**
- Add `outputContract` to job type definitions
- Remove deprecated fields from types
- Update UI to display output contract info

#### Task 4.12: Update OpenAPI/Swagger docs

**Files:**
- Modify: `apps/api/src/workflow/workflow-runtime-lifecycle.controller.ts`
- Modify: `apps/api/src/workflow/workflow-runtime-tools.controller.ts`

**Changes:**
- Add Swagger annotations for `set_job_output` endpoint
- Remove/deprecate Swagger docs for deprecated endpoints

#### Task 4.13: Update error messages

**Files:**
- Modify: `apps/api/src/workflow/step-required-tool-retry.service.ts`
- Modify: `apps/api/src/tool/capability-preflight.service.ts`
- Modify: `apps/api/src/workflow/validation/workflow-validation.job-rules.ts`
- Modify: `apps/api/src/workflow/step-agent-step-executor.service.spec.ts`

**Changes:**
- Replace all tool-name references with contract/field references
- Update test assertions for new error messages

#### Task 4.14: Update all documentation

**Files:**
- Modify: `README.md`
- Modify: `apps/api/README.md`
- Modify: `docs/SDD.md`
- Modify: `docs/architecture/ARCH-kanban-workflow.md`
- Modify: `docs/architecture/observability.md`
- Modify: `docs/operations/workflow-required-tools-audit-runbook.md`
- Modify: `seed/skills/workflow-schema-explainer/references/workflow-structure.md`
- Modify: `seed/skills/workflow-schema-explainer/references/workflow-schema-examples.md`
- Modify: `.agents/skills/workflow-yaml-authoring/SKILL.md`

**Changes:**
- Replace all references to `output_tool` with `output_contract`
- Replace `required_tool_calls` with output contract validation
- Update examples and code snippets
- Update architecture descriptions

#### Task 4.15: Update workflow schema explainer skill

**Files:**
- Modify: `seed/skills/workflow-schema-explainer/references/workflow-structure.md`
- Modify: `seed/skills/workflow-schema-explainer/references/workflow-schema-examples.md`

**Changes:**
- Document `output_contract` field
- Document `set_job_output` tool
- Remove references to `output_tool` and `required_tool_calls`

#### Task 4.16: Update workflow YAML authoring skill

**Files:**
- Modify: `.agents/skills/workflow-yaml-authoring/SKILL.md`

**Changes:**
- Document `output_contract` instead of `output_tool`
- Add examples of `set_job_output` usage
- Document new YAML features (switch, for_each, mapping)

---

## Edge Cases & Failure Modes

### 1. Agent Never Calls `set_job_output`

**Behavior:** Job output remains empty. Output contract validation fails. Retry logic triggers.

**Mitigation:**
- Clear retry prompt: "You must call set_job_output with the following required fields: ..."
- After max retries, job fails with explicit error: "Missing required output keys: ..."

### 2. Agent Calls `set_job_output` Multiple Times

**Behavior:** Multiple calls merge (last-write-wins per key). Each call overwrites previous values for the same keys.

**Example:**
```typescript
// Call 1
set_job_output({ status: 'in_progress', progress: 50 })

// Call 2
set_job_output({ status: 'complete', result: 'done' })

// Final output:
{ status: 'complete', progress: 50, result: 'done' }
```

**Mitigation:** This is expected behavior. Agents should call once at the end, or incrementally update different keys.

### 3. Agent Calls `set_job_output` with Wrong Keys

**Behavior:** Extra keys are allowed (forward compatibility). Missing required keys trigger retry.

**Mitigation:** Validation only checks required keys, ignores extras.

### 4. `for_each` Array is Empty

**Behavior:** Job succeeds immediately with empty array output: `[]`.

**Mitigation:** No special handling needed. Empty array is valid.

### 5. `for_each` Expression is Not an Array

**Behavior:** Runtime error, job fails.

**Mitigation:** Validate expression type at workflow load time if possible. Otherwise, clear runtime error: "for_each expression must resolve to array, got: ..."

### 6. Switch Case Expression Error

**Behavior:** Handlebars rendering fails. Job fails.

**Mitigation:** Validate expressions at workflow load time. Provide clear error messages with the expression and context.

### 7. Mapping Value Not Found

**Behavior:** If no match and no default, runtime error.

**Mitigation:** Always provide `default` in mappings, or use switch/case for complex branching.

### 8. Legacy Workflow with `output_tool` During Transition

**Behavior:** Phase 1-3: Both `output_tool` and `output_contract` supported. Phase 4+: `output_tool` removed.

**Mitigation:** Clear migration guide. Validation errors during Phase 4 if deprecated fields used.

### 9. `amend_entity` Action Not Supported for Entity Type

**Behavior:** Runtime error: "Unsupported action 'X' for entity_type 'Y'".

**Mitigation:** Comprehensive validation at workflow load time. Document supported actions per entity type.

### 10. Nested Template Resolution in `for_each`

**Behavior:** `item` variable must be available in template context for each iteration.

**Example:**
```yaml
for_each: "{{ jobs.parent.output.items }}"
inputs:
  entity_id: "{{ item.id }}"  # item is injected per iteration
  name: "{{ item.name }}"
```

**Mitigation:** Template service must support per-iteration context injection.

---

## Agent Prompts, Skills, and Capability Updates

Changing from tool-centric to state-driven output requires updating everything that tells agents **how** to produce output.

### Agent Prompt Updates

Currently, agents are instructed to call specific tools like `submit_qa_decision` or `submit_preflight_artifacts`. These prompts must be rewritten to instruct agents to use `set_job_output` instead.

#### System Prompt Changes

**Before:**
```markdown
When you have completed your review, you must call the submit_qa_decision tool with:
- decision: "approved" | "rejected" | "needs_changes"
- feedback: string
- reviewer_agent_id: string
- failed_deliverables: string[] (if rejected)
```

**After:**
```markdown
When you have completed your review, you must use the set_job_output tool to persist your results.

Required output fields:
- decision: "approved" | "rejected" | "needs_changes"
- feedback: string (detailed review feedback)
- reviewer_agent_id: string (your agent ID)
- failed_deliverables: string[] (required if decision is "rejected")

Example:
```json
{
  "tool": "set_job_output",
  "arguments": {
    "data": {
      "decision": "approved",
      "feedback": "Code meets all acceptance criteria. Good work.",
      "reviewer_agent_id": "qa-agent-1",
      "failed_deliverables": []
    }
  }
}
```

Do not call submit_qa_decision - that tool has been deprecated.
```

#### Retry Prompt Changes

**Before:**
```yaml
retry_prompt: "You must call submit_qa_decision with your verdict"
```

**After:**
```yaml
retry_prompt: "Your review output is incomplete. You must use set_job_output to provide: decision (approved/rejected/needs_changes), feedback (string), and reviewer_agent_id (string). If rejected, also provide failed_deliverables (array of strings)."
```

### Workflow Prompt Files

**Files to update:**
- `apps/api/src/database/seeds/workflows/prompts/*/system.md`
- `apps/api/src/database/seeds/workflows/prompts/*/step-*.md`
- Any `.prompt.md` or `.md` files in workflow prompt directories

**Search pattern:**
```bash
# Find all prompts mentioning output tools
grep -r "submit_preflight_artifacts\|submit_qa_decision\|submit_orchestration_decision" apps/api/src/database/seeds/workflows/prompts/
```

### Agent Skills Updates

Skills that reference specific output tools need updating.

**Example skill update:**

**File:** `.agents/skills/qa-review-workflow/SKILL.md` (example)

**Before:**
```markdown
## Output

Call submit_qa_decision with:
- decision
- feedback
```

**After:**
```markdown
## Output

Use set_job_output to persist:
- decision (required)
- feedback (required)
- reviewer_agent_id (required)
- failed_deliverables (required if decision == "rejected")

The workflow runtime will validate that all required fields are present before marking the job complete.
```

### Capability Manifest Updates

**Add:**
- `set_job_output` capability (see Phase 1 Task 1.1)

**Deprecate (Phase 3):**
- `submit_preflight_artifacts` - output-only, replaced by `set_job_output`
- `submit_qa_decision` - output-only, replaced by `set_job_output` + `amend_entity`
- `submit_orchestration_decision` - output-only, replaced by `set_job_output` + `amend_entity`

**Keep (domain mutation only):**
- `git_commit` - pure side effect, no output capture
- `create_pull_request` - pure side effect
- Any tool that performs an action but doesn't capture job output

### Tool Registry / Policy Updates

If tools are dynamically registered or governed by policy:

1. Update policy to allow `set_job_output` for all execution jobs
2. Remove policy rules requiring specific output tools
3. Update capability preflight to not validate `output_tool` (Phase 4)

---

## Workflow Definition Updates

### Seed Workflows

**Files:** `apps/api/src/database/seeds/workflows/*.yaml`

**All seed workflows must be updated:**

1. Replace `output_tool` with `output_contract`
2. Remove `required_tool_calls`
3. Replace bespoke special handlers with generic ones
4. Add explicit downstream jobs for side effects

**Example migration for preflight workflow:**

```yaml
# Before:
jobs:
  - id: preflight
    type: execution
    output_tool: submit_preflight_artifacts
    required_tool_calls: [submit_preflight_artifacts]

# After:
jobs:
  - id: preflight
    type: execution
    output_contract:
      required:
        - pm_summary
        - acceptance_clarifications
        - architect_summary
        - sdd_targets
        - implementation_plan

  - id: persist_preflight
    type: special
    handler: amend_entity
    depends_on: [preflight]
    inputs:
      entity_type: work_item
      action: update
      entity_id: "{{ trigger.work_item_id }}"
      updates:
        preflight_artifacts: "{{ jobs.preflight.output }}"
```

### E2E Test Workflows

**Files:** `test/*.e2e-spec.ts` (workflow definitions in test setup)

Update all test workflow definitions to use new format.

---

## Additional Systems Requiring Updates

### Database Audit View Migration

**File:** `apps/api/src/database/migrations/20260408220000-create-workflow-run-required-tools-audit-view.ts`

The existing audit view queries `output_tool` and `required_tool_calls` from workflow definitions and execution payloads. This must be rewritten for `output_contract`.

**Current view queries:**
```sql
-- Selects requiredToolCalls and outputTool from payload
COALESCE(we.payload->'requiredToolCalls', '[]'::jsonb) AS required_tool_calls
NULLIF(we.payload->>'outputTool', '') AS output_tool
```

**New view should query:**
```sql
-- Selects outputContract from payload
we.payload->'outputContract' AS output_contract
```

**Migration task:**
- Create new migration to drop old view and recreate with `output_contract` field
- Update runbook queries that select from this view

**Files:**
- Create: `apps/api/src/database/migrations/202604XX0000-update-workflow-run-audit-view-for-output-contract.ts`
- Modify: `docs/operations/workflow-required-tools-audit-runbook.md`

### Event Ledger and Telemetry Updates

**Files:**
- `apps/api/src/telemetry/telemetry.gateway.ts` — WebSocket handler for `tool_execution_end`
- `apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts` — Emits event ledger records
- `apps/api/src/telemetry/telemetry.gateway.spec.ts` — Tests use `submit_qa_decision` as mock tool

**Required changes:**
1. Keep telemetry for `set_job_output` tool calls (observability)
2. Remove tests/assertions that check for specific deprecated tools
3. Update event ledger payloads to include `output_contract_validation` events
4. Add new event type: `output_contract_validated` / `output_contract_failed`

**New event types:**
```typescript
// Event ledger entries for output contract validation
{
  event_type: 'output_contract_validated',
  payload: {
    jobId: string,
    workflowRunId: string,
    contract: OutputContract,
  }
}

{
  event_type: 'output_contract_failed',
  payload: {
    jobId: string,
    workflowRunId: string,
    contract: OutputContract,
    missing: string[],
  }
}
```

### Capability Manifest Entries

**Files:**
- `apps/api/src/tool/capability-manifest.preflight.entry.ts` — `SUBMIT_PREFLIGHT_ARTIFACTS_ENTRY`
- `apps/api/src/tool/capability-manifest.execution.approvals.entries.ts` — `submit_qa_decision`
- `apps/api/src/tool/capability-manifest.execution.submit-implementation-plan.entry.ts` — `submit_implementation_plan`
- `apps/api/src/tool/capability-manifest.runtime.orchestration.entries.ts` — `submit_orchestration_decision`
- `apps/api/src/tool/capability-manifest.execution.nexus-orchestrator.entry.ts` — References `step_complete`

**Required changes:**
1. **Phase 1:** Add `SET_JOB_OUTPUT_ENTRY` to core manifest
2. **Phase 3:** Mark deprecated entries with `@deprecated` JSDoc
3. **Phase 4:** Remove deprecated entries entirely
4. Update capability manifest aggregation/registration

### Capability Preflight Service

**File:** `apps/api/src/tool/capability-preflight.service.ts:226-265`

**Current logic:**
```typescript
validateOutputTool(job: IJob, ...): PreflightResult {
  if (job.output_tool) {
    const capability = this.getCapabilityByName(job.output_tool);
    if (!capability) {
      return { valid: false, reasonCode: 'output_tool_undefined' };
    }
    if (!this.isCallable(capability, context)) {
      return { valid: false, reasonCode: 'output_tool_not_callable' };
    }
  }
}
```

**New logic:**
```typescript
validateOutputContract(job: IJob, ...): PreflightResult {
  if (job.output_contract) {
    // Validate that set_job_output capability is available
    const setJobOutput = this.getCapabilityByName('set_job_output');
    if (!setJobOutput) {
      return { valid: false, reasonCode: 'set_job_output_undefined' };
    }
    if (!this.isCallable(setJobOutput, context)) {
      return { valid: false, reasonCode: 'set_job_output_not_callable' };
    }
    
    // Validate contract structure
    if (!job.output_contract.required || job.output_contract.required.length === 0) {
      return { valid: false, reasonCode: 'output_contract_empty' };
    }
  }
}
```

**Files:**
- Modify: `apps/api/src/tool/capability-preflight.service.ts`
- Modify: `apps/api/src/tool/capability-preflight.service.spec.ts`

### Workflow Parser Service

**File:** `apps/api/src/workflow/workflow-parser.service.ts:294`

**Current logic:**
```typescript
// Copies required_tool_calls from step to job
job.required_tool_calls = step.required_tool_calls;
```

**New logic:**
```typescript
// Copies output_contract from step to job
job.output_contract = step.output_contract;
```

**Files:**
- Modify: `apps/api/src/workflow/workflow-parser.service.ts`
- Modify: `apps/api/src/workflow/workflow-parser.service.spec.ts`

### Workflow Audit Payload Utilities

**File:** `apps/api/src/workflow/workflow-job-audit-payload.utils.ts:11-12`

**Current:**
```typescript
buildQueuedJobAuditPayload(job: IJob) {
  return {
    outputTool: readNonEmptyString(job.output_tool),
    requiredToolCalls: normalizeToolNames(job.required_tool_calls),
    // ...
  };
}
```

**New:**
```typescript
buildQueuedJobAuditPayload(job: IJob) {
  return {
    outputContract: job.output_contract,
    // Remove: outputTool, requiredToolCalls
    // ...
  };
}
```

**Files:**
- Modify: `apps/api/src/workflow/workflow-job-audit-payload.utils.ts`
- Modify: `apps/api/src/workflow/workflow-job-audit-payload.utils.spec.ts` (if exists)

### Frontend / UI Types

**Files:**
- `apps/web/src/lib/api/types.ts` — Frontend API types
- `apps/web/src/pages/workflows/WorkflowRunDetailContent.tsx` — Workflow run display

**Required changes:**
1. Update TypeScript types to include `output_contract` field on job types
2. Remove or deprecate `outputTool` / `requiredToolCalls` from types
3. Update UI components to display output contract info instead of tool names

```typescript
// Before:
interface WorkflowJob {
  outputTool?: string;
  requiredToolCalls?: string[];
}

// After:
interface WorkflowJob {
  outputContract?: {
    required: string[];
    optional?: string[];
  };
}
```

### OpenAPI / Swagger Documentation

**Files:**
- `apps/api/src/workflow/workflow-runtime-lifecycle.controller.ts` — Preflight endpoint docs
- `apps/api/src/workflow/workflow-runtime-tools.controller.ts` — Runtime tool docs

**Required changes:**
1. Add Swagger annotations for new `POST /api/workflow-runtime/jobs/{job_id}/output` endpoint
2. Remove or deprecate Swagger docs for `POST /api/workflow-runtime/preflight/submit`
3. Update DTOs to document `output_contract` instead of `output_tool`

```typescript
@ApiOperation({ summary: 'Persist job output from agent container' })
@ApiResponse({ status: 200, description: 'Output persisted' })
@Post('jobs/:jobId/output')
async setJobOutput(...) { ... }
```

### Error Messages and User-Facing Strings

**Files:**
- `apps/api/src/workflow/step-required-tool-retry.service.ts:116,218,260`
  - `"missing required tools [${missingTools.join(', ')}]"`
  - `"You have not called them yet. Please call them now."`
- `apps/api/src/tool/capability-preflight.service.ts:240-260`
  - `"Output tool ${outputTool} is not defined"`
  - `reasonCode: 'output_tool_undefined'`
- `apps/api/src/workflow/validation/workflow-validation.job-rules.ts:105,112,131-132`
  - `"required_tool_calls must be an array"`
  - `"output_tool must be a non-empty string"`

**New error messages:**
```typescript
// Retry service
`Job ${jobId} output contract not satisfied. Missing required fields: ${missing.join(', ')}`
`Your job output is incomplete. Use set_job_output to provide the required fields.`

// Preflight service
`set_job_output capability not available in current context`
`Output contract has no required fields`

// Validation
`output_contract.required must be an array of non-empty strings`
```

### Documentation

**Files requiring comprehensive updates:**
- `README.md:342` — Mentions `output_tool`
- `apps/api/README.md:560` — Documents `output_tool`
- `docs/SDD.md:217` — Documents output tool capture mechanism
- `docs/architecture/ARCH-kanban-workflow.md:181` — Documents `submit_qa_decision`
- `docs/architecture/observability.md:73-74` — Documents `requiredToolCalls` and `outputTool`
- `docs/operations/workflow-required-tools-audit-runbook.md` — Runbook for debugging
- `seed/skills/workflow-schema-explainer/references/workflow-structure.md:32-33` — Lists deprecated fields
- `seed/skills/workflow-schema-explainer/references/workflow-schema-examples.md:64-65` — Shows deprecated examples
- `.agents/skills/workflow-yaml-authoring/SKILL.md:74` — Documents `output_tool`

**Required changes:**
1. Replace all references to `output_tool` with `output_contract`
2. Replace references to `required_tool_calls` with output contract validation
3. Update examples to show `set_job_output` usage
4. Update architecture diagrams if they show tool-call-centric flow
5. Update runbook queries for new audit view schema

### Workflow Schema Explainer Skill

**File:** `seed/skills/workflow-schema-explainer/references/workflow-structure.md`

**Current:**
```markdown
## Job Fields

- `output_tool` — The tool that captures job output
- `required_tool_calls` — Tools the agent must call
```

**New:**
```markdown
## Job Fields

- `output_contract` — Declares required output fields the agent must provide
  - `required`: Array of required field names (e.g., `["decision", "feedback"]`)
  - `optional`: Array of optional field names

## Output Tool

Agents use `set_job_output` to persist structured output:
```json
{
  "tool": "set_job_output",
  "arguments": {
    "data": {
      "decision": "approved",
      "feedback": "Looks good"
    }
  }
}
```
```

### Workflow YAML Authoring Skill

**File:** `.agents/skills/workflow-yaml-authoring/SKILL.md`

**Current:**
```markdown
### output_tool

Specifies which tool call captures the job's output.
```yaml
output_tool: submit_result
```
```

**New:**
```markdown
### output_contract

Declares the required output fields for the job.
```yaml
output_contract:
  required: [decision, feedback]
  optional: [notes]
```

The agent must use `set_job_output` to provide these fields.
```

---

## Migration Strategy

### For Existing Workflows

1. **Identify output tools:** Find all `output_tool` and `required_tool_calls` usages.
2. **Replace with contract:** Determine required output keys from tool schemas.
3. **Update agent prompts:** Replace "Call submit_qa_decision" with "Use set_job_output to provide decision and feedback".
4. **Add downstream jobs:** Replace implicit side effects with explicit `amend_entity` jobs.
5. **Test:** Run workflows in staging to verify behavior.

### Migration Script (Conceptual)

```typescript
// scripts/migrate-workflow-v1-to-v2.ts
function migrateJob(job: IJob): IJob {
  if (!job.output_tool) return job;
  
  // Map known output tools to contracts
  const contractMap: Record<string, string[]> = {
    'submit_preflight_artifacts': ['pm_summary', 'acceptance_clarifications', 'architect_summary', 'sdd_targets', 'implementation_plan'],
    'submit_qa_decision': ['decision', 'feedback'],
    'submit_orchestration_decision': ['decision', 'reasoning'],
  };
  
  const required = contractMap[job.output_tool];
  if (!required) {
    console.warn(`Unknown output_tool: ${job.output_tool}. Manual migration required.`);
    return job;
  }
  
  return {
    ...job,
    output_contract: { required },
    // Remove deprecated fields
    output_tool: undefined,
    required_tool_calls: undefined,
  };
}
```

### Backward Compatibility

- **Phase 1-3:** Both old and new fields accepted. Validation warns about deprecated fields.
- **Phase 4:** Old fields rejected at validation time. Migration script provided.
- **Phase 5:** Deprecated code removed.

---

## Testing Strategy

### Unit Tests

1. **Output contract validation:**
   - Valid/invalid contracts
   - Missing keys
   - Empty output
   - Type checking

2. **`set_job_output` service:**
   - Single call
   - Multiple calls (merge)
   - Overwrite behavior

3. **Generic handlers:**
   - All entity types × actions
   - Error cases
   - Upsert logic

4. **YAML enhancements:**
   - Switch case matching
   - for_each iteration
   - Mapping transforms

### Integration Tests

1. **End-to-end workflow:**
   - Execution job with output contract
   - Downstream special job reading output
   - Retry on missing output
   - for_each batch processing

2. **Migration scenarios:**
   - Old workflow with output_tool
   - Mixed old/new fields
   - Fully migrated workflow

### E2E Tests

1. **QA workflow:**
   - Agent calls set_job_output
   - amend_entity transitions status
   - Switch case routing

2. **Preflight workflow:**
   - Complex output contract
   - Metadata persistence

3. **Spec hydration:**
   - Agent computes diff
   - for_each creates/updates/archives

---

## Success Criteria

1. **Zero tool-name coupling:** Job completion depends only on `output_contract` satisfaction, not tool calls.
2. **Explicit contracts:** All execution jobs declare what output they produce.
3. **Generic handlers:** ≤7 special step handlers (down from 15).
4. **Declarative workflows:** Domain logic (conditions, branching, loops) lives in YAML, not handler code.
5. **No regression:** All existing workflows continue to work during transition (Phase 1-3).
6. **Clear migration path:** Existing workflows can be migrated incrementally with documented steps.
7. **Comprehensive tests:** >90% code coverage for new services and handlers.
8. **Updated documentation:** New workflow authoring guide with YAML examples.
9. **Database consistency:** Audit view migrated to query `output_contract` instead of deprecated fields.
10. **Telemetry updated:** Event ledger tracks output contract validation, not tool call names.
11. **Frontend synced:** UI types and displays updated for new job fields.
12. **Agent guidance updated:** All prompts, skills, and documentation reference `set_job_output`.

---

## Open Questions

1. **Should `output_contract` support nested key paths (e.g., `artifacts.plan`)?**
   - Current: Flat keys only
   - Consideration: Nested paths add complexity but are more expressive
   - Recommendation: Start flat, add nesting later if needed

2. **Should `for_each` support parallel execution?**
   - Current: Sequential only
   - Consideration: Parallel is faster but introduces ordering/race complexity
   - Recommendation: Add `parallelism: N` option in Phase 3 if needed

3. **How should we handle entity permissions in `amend_entity`?**
   - Current: Not addressed
   - Consideration: Should `amend_entity` respect the job's `permissions` field?
   - Recommendation: Yes, enforce permissions check before entity mutation

4. **Should we support `output_contract` on special jobs?**
   - Current: Only execution jobs produce output
   - Consideration: Special jobs could also declare contracts
   - Recommendation: Yes, for consistency and validation

5. **What happens to `transitions` field?**
   - Current: Transitions define next jobs based on conditions
   - Consideration: With `switch` and `condition`, are transitions redundant?
   - Recommendation: Keep transitions for DAG structure, use `condition` for dynamic skipping

---

## Appendix A: File Inventory

### New Files
- `apps/api/src/workflow/workflow-runtime-set-job-output.service.ts`
- `apps/api/src/workflow/workflow-output-contract.service.ts`
- `apps/api/src/workflow/step-amend-entity-special-step.handler.ts`
- `apps/api/src/workflow/step-git-operation-special-step.handler.ts`
- `apps/api/src/workflow/step-manage-tool-candidate-special-step.handler.ts`
- `apps/api/src/workflow/workflow-output-contract.service.spec.ts`
- `apps/api/src/workflow/step-amend-entity-special-step.handler.spec.ts`
- `apps/api/src/workflow/step-git-operation-special-step.handler.spec.ts`
- `apps/api/src/workflow/step-manage-tool-candidate-special-step.handler.spec.ts`
- `apps/api/src/workflow/workflow-yaml-enhancements.spec.ts`
- `docs/guides/workflow-authoring-v2.md`

### Modified Files
- `packages/core/src/interfaces/workflow-legacy.types.ts`
- `apps/api/src/workflow/validation/workflow-validation.job-rules.ts`
- `apps/api/src/workflow/workflow-runtime-lifecycle.controller.ts`
- `apps/api/src/workflow/workflow.module.ts`
- `apps/api/src/workflow/step-required-tool-retry.service.ts`
- `apps/api/src/workflow/step-execution-orchestrator.service.ts`
- `apps/api/src/workflow/step-special-step-executor.service.ts`
- `apps/api/src/workflow/workflow-parser.service.ts`
- `apps/api/src/workflow/workflow-job-audit-payload.utils.ts`
- `apps/api/src/tool/capability-manifest.core.entries.ts`
- `apps/api/src/tool/capability-manifest.ts`
- `apps/api/src/tool/capability-manifest.preflight.entry.ts`
- `apps/api/src/tool/capability-manifest.execution.approvals.entries.ts`
- `apps/api/src/tool/capability-manifest.runtime.orchestration.entries.ts`
- `apps/api/src/tool/capability-preflight.service.ts`
- `apps/api/src/telemetry/telemetry.gateway.spec.ts`
- `apps/api/src/telemetry/telemetry-gateway-compat.helpers.ts`
- `apps/api/src/database/seeds/workflows/*.yaml`
- `apps/api/src/database/seeds/workflows/prompts/**/*.md`
- `apps/web/src/lib/api/types.ts`
- `apps/web/src/pages/workflows/WorkflowRunDetailContent.tsx`
- `test/*.e2e-spec.ts`
- `README.md`
- `apps/api/README.md`
- `docs/SDD.md`
- `docs/architecture/ARCH-kanban-workflow.md`
- `docs/architecture/observability.md`
- `docs/operations/workflow-required-tools-audit-runbook.md`
- `seed/skills/workflow-schema-explainer/references/workflow-structure.md`
- `seed/skills/workflow-schema-explainer/references/workflow-schema-examples.md`
- `.agents/skills/workflow-yaml-authoring/SKILL.md`

### Deleted Files (Phase 4)
- `apps/api/src/workflow/tool-output-capture.service.ts`
- `apps/api/src/workflow/step-transition-status-special-step.handler.ts`
- `apps/api/src/workflow/step-record-metadata-special-step.handler.ts`
- `apps/api/src/workflow/step-manage-execution-special-step.handler.ts`
- `apps/api/src/workflow/step-manage-container-special-step.handler.ts`
- `apps/api/src/workflow/step-manage-worktree-special-step.handler.ts`
- `apps/api/src/workflow/step-attempt-merge-special-step.handler.ts`
- `apps/api/src/workflow/step-check-orchestration-status-special-step.handler.ts`
- `apps/api/src/workflow/step-validate-tool-candidate-special-step.handler.ts`
- `apps/api/src/workflow/step-publish-tool-candidate-special-step.handler.ts`
- `apps/api/src/workflow/step-hydrate-work-items-special-step.handler.ts`

---

## Appendix B: Complete Type Definitions

```typescript
// packages/core/src/interfaces/workflow-legacy.types.ts

interface OutputContract {
  required: string[];
  optional?: string[];
}

interface ISwitchCase {
  case: string;
  inputs: Record<string, unknown>;
}

interface IJob {
  id: string;
  type: WorkflowJobType;
  tier: string;
  condition?: string;
  depends_on?: string[];
  inputs?: Record<string, unknown>;
  workflow_id?: string;
  wait_for_completion?: boolean;
  permissions?: IToolPermissionPolicy;
  host_mounts?: IHostMountRequest[];
  tools?: string[];
  transitions?: IWorkflowTransition[];
  max_retries?: number;
  retry_prompt?: string;
  max_step_loops?: number;
  
  // NEW: Output contract (replaces output_tool + required_tool_calls)
  output_contract?: OutputContract;
  
  // NEW: Switch/case routing
  switch?: ISwitchCase[];
  default?: { inputs: Record<string, unknown> };
  
  // NEW: Looping
  for_each?: string;
  continue_on_error?: boolean;
  
  // DEPRECATED: Remove in Phase 4
  output_tool?: string;
  required_tool_calls?: string[];
}
```

---

*End of EPIC-120 Implementation Design*
