# Project Spec Revision War Room Alignment

This is a real revision-alignment war room, not an audit log. Do not close until product/architecture reviewers have posted findings or an explicit failure has been recorded.

## Context

- Scope ID: {{trigger.scopeId}}
- Orchestration ID: {{trigger.orchestrationId}}
- Revision Feedback: {{trigger.feedback}}
- Revision Decision: {{jobs.revise_specs.output.decision}}
- Investigation Artifact Paths: {{trigger.investigationArtifactPaths}}
- Investigation Summary Path: {{trigger.investigationSummaryPath}}
- Commit SHA: {{trigger.investigationCommitSha}}

## Repository Context

Read the following project-context documents before proceeding:

- docs/project-context/ARCHITECTURE.md
- docs/project-context/CAPABILITY_MAP.md
- docs/project-context/CODEBASE_HEALTH.md
- docs/project-context/probe-results/\*.md (when present)

## Protocol

Execute the following in order:

1. Call open_war_room with workflow/project context and a concise initial message.
   - `context_id` must be a valid UUID. Use `{{trigger.scopeId}}` when it is a UUID; otherwise generate a UUID-form identifier and include the project key in title/metadata, not in `context_id`.
   - `session_id`, when supplied, must be a valid UUID.
   - Allowed participant roles: `architect`, `pm`, `dev`, `qa`, `moderator`.
   - Do not use `product-manager` as a war-room role; use `pm` instead.

2. Call update_war_room_blackboard with the revision feedback, revision decision, investigation artifact paths, and architect/product questions.

3. Call spawn_subagent_async with the following arguments:
   - agent_profile: architect-agent
   - tools: ["read", "ls"]
   - task_prompt: Read the repository context documents (docs/project-context/ARCHITECTURE.md, docs/project-context/CAPABILITY_MAP.md, docs/project-context/CODEBASE_HEALTH.md, docs/project-context/probe-results/\*.md if present). Review the revision feedback and investigation artifact paths provided in the war-room context. Return your architecture findings as your final message. Include: key architectural concerns or risks, alignment with ARCHITECTURE.md patterns, and a signoff recommendation (approved|approved_with_conditions|blocked). Do not call step_complete — your final message is your output.

4. Call spawn_subagent_async with the following arguments:
   - agent_profile: product-manager
   - tools: ["read", "ls"]
   - task_prompt: Read the repository context documents (docs/project-context/ARCHITECTURE.md, docs/project-context/CAPABILITY_MAP.md, docs/project-context/CODEBASE_HEALTH.md, docs/project-context/probe-results/\*.md if present). Review the revision feedback and investigation artifact paths provided in the war-room context. Return your product findings as your final message. Include: product alignment concerns, scope clarity, user impact assessment, and a signoff recommendation (approved|approved_with_conditions|blocked). Do not call step_complete — your final message is your output.

5. Call wait_for_subagents to await both reviewers.

5a. After wait_for_subagents completes, post each reviewer's findings to the war room on their behalf using the text from results[execution_id].latest_response in the wait result: - Call post_war_room_message with the architect-agent findings - Call post_war_room_message with the product-manager findings

6. If wait_for_subagents times out, call check_subagent_status for each execution_id and determine which reviewers have completed.

7. Call get_war_room_state to retrieve the current session state.

8. Call update_war_room_blackboard with resolutions, concerns, and any unresolved blockers.

9. Call set_job_output with:
   - war_room_summary: concise summary of the alignment outcome
   - concerns: array of concerns raised by reviewers
   - signoffs: array of signoffs received
   - unresolved_blockers: array of unresolved blockers (empty if all resolved)

10. Close the war room with explicit resolution:
    - If unresolved_blockers is empty: call close_war_room with resolution_type: consensus and a resolution note summarizing reviewer agreement.
    - If unresolved_blockers is not empty or reviewer failures occurred: call close_war_room with resolution_type: deadlock or resolution_type: manual and a concrete unresolved-risk note listing each blocker; do not claim specs are ready in war_room_summary.

11. Call step_complete with the war-room session id, blocker count, and close resolution.

## Signoff Semantics

- Reviewer subagents submit their own signoff.
- Reviewer subagents must omit `agent_profile` unless setting it to their authenticated profile.
- The CEO agent must not submit signoff as `architect-agent`, `pm`, `moderator`, or `orchestrator`.
- If reviewer spawn or wait fails, record `unresolved_blockers` and close with `resolution_type: deadlock` or `manual`, not `consensus`.

## Explicit Prohibitions

- Do not use invite_war_room_participant as a substitute for reviewer execution. Reviewers must be spawned and run as subagents.
- Do not close the war room without reviewer findings or an explicit failure recording.
