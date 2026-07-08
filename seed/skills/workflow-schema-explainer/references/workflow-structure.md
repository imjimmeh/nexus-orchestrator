# Workflow Structure

## Top-Level Fields
- workflow_id: Unique snake_case identifier.
- name: Human-readable workflow name.
- description: Optional explanatory text.
- trigger: Required launch contract.
- permissions: Optional workflow-level allow/deny tool policy.
- concurrency: Optional run conflict policy.
- global_env: Optional env map injected to jobs.
- jobs: Required DAG job list.

## Trigger
Supported trigger types:
- manual
- event
- webhook

Manual triggers can define launch context and input descriptors. Event/webhook triggers bind to named events.

## Jobs
Each job requires:
- id
- type
- tier

Common optional job fields:
- depends_on
- condition
- inputs
- permissions
- output_contract
- switch
- default
- for_each
- continue_on_error

Execution jobs include step arrays. Special job types encode behavior directly in job inputs/fields.

## Output Contract
- output_contract.required: required output keys that must be present at jobs.{jobId}.output.
- output_contract.optional: optional output keys for downstream consumers.
- Agent/runtime should use set_job_output to persist output data.

## YAML Enhancements
- switch: ordered case branches that merge branch inputs into base inputs.
- default: fallback branch for switch when no case matches.
- for_each: iterates a special job once per item in an array expression.
- continue_on_error: only valid with for_each; records item-level failures and continues.
- mapping transform object in inputs:
  - source: template expression or literal source value
  - mapping: lookup table for source values
  - default: fallback if source key is missing

## Step Model (execution jobs)
Supported step categories include:
- agent
- run_command
- special handlers implemented by the workflow module

Transition behavior:
- Transitions evaluate in order.
- If no transition matches, execution continues in sequence.

## Permissions
Resolution layers:
1. Agent profile allowed_tools
2. Workflow permissions
3. Job/step permissions

Policy can allow and deny tools. Deny takes precedence for that scope.

## Concurrency
Concurrency block can define:
- max_runs
- scope
- on_conflict: skip, queue, or cancel_running

## Can / Cannot Matrix
Can:
- Compose DAG workflows with explicit dependencies.
- Invoke child workflows.
- Register and publish tools through supported special handlers.
- Gate tool access with policy blocks.

Cannot:
- Use unsupported job/step types not registered in the engine.
- Assume regex route or controller-level behavior in YAML.
- Rely on undeclared runtime variables in expressions.
- Bypass policy checks by naming tools not in the manifest/registry.

## Validation Checklist
- workflow_id is present and stable.
- Every depends_on target exists.
- Every required output contract key is declared and produced.
- Trigger inputs match template usage.
- Mutating operations are intentional and policy-compliant.
