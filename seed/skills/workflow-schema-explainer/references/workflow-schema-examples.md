# Workflow Schema Examples

## Minimal Manual Workflow
```yaml
workflow_id: hello_world
name: Hello World
trigger:
  type: manual
jobs:
  - id: greet
    type: execution
    tier: light
    steps:
      - id: say_hello
        type: run_command
        command: "echo hello"
```

## Event Workflow With Dependency
```yaml
workflow_id: on_spec_merged
name: On Spec Merged
trigger:
  type: event
  name: InceptionSpecsMergedEvent
jobs:
  - id: analyze
    type: execution
    tier: heavy
    steps:
      - id: read_specs
        type: agent
        prompt: |
          Analyze the merged specs and summarize implementation impact.
  - id: notify
    type: emit_event
    tier: light
    depends_on: [analyze]
    inputs:
      event_name: ImplementationAnalysisReadyEvent
      payload:
        source: on_spec_merged
```

## Workflow With Concurrency and Permissions
```yaml
workflow_id: safe_review_cycle
name: Safe Review Cycle
trigger:
  type: manual
permissions:
  allow_tools: [query_memory, invoke_agent_workflow, set_job_output]
  deny_tools: [bash]
concurrency:
  max_runs: 1
  scope: "{{ trigger.scopeId }}"
  on_conflict: queue
jobs:
  - id: review
    type: execution
    tier: heavy
    inputs:
      agent_profile: ceo-agent
    output_contract:
      required: [decision, rationale]
    steps:
      - id: decide
        type: agent
        prompt: |
          Evaluate readiness and recommend the next orchestration step.
          Persist final output via set_job_output.
```

## Workflow With switch/default + for_each + mapping
```yaml
workflow_id: yaml_features_demo
name: YAML Features Demo
trigger:
  type: manual
jobs:
  - id: choose_event
    type: emit_event
    tier: light
    inputs:
      event_name: DefaultEvent
      payload:
        decision_state:
          source: "{{ trigger.decision }}"
          mapping:
            accept: approved
            reject: rejected
          default: pending
    switch:
      - case: "{{ trigger.use_alternate }}"
        inputs:
          event_name: AlternateEvent
    default:
      inputs:
        event_name: DefaultEvent

  - id: emit_batch
    type: emit_event
    tier: light
    depends_on: [choose_event]
    for_each: "{{ trigger.items }}"
    continue_on_error: true
    inputs:
      event_name: "{{ item.event_name }}"
      payload:
        index: "{{ item_index }}"
        ticket: "{{ item.ticket_id }}"
```

## Invalid Pattern Example
```yaml
workflow_id: broken_flow
name: Broken
trigger:
  type: manual
jobs:
  - id: a
    type: execution
    tier: heavy
    depends_on: [missing_job]
    steps: []
```

Why invalid:
- depends_on references a non-existent job.
- steps array is empty for an execution job.
