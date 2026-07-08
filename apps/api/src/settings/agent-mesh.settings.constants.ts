/**
 * `SYSTEM_SETTING_DEFAULTS` fragment for the agent-mesh knobs
 * (work item 52666e94-e403-4d00-97ab-95a3cc8af256, milestone 3).
 *
 * String-literal keys are used here so the fragment can be imported by
 * `system-settings.defaults.ts` without dragging in the agent-mesh
 * scheduler / subagent code path. The scheduler re-reads the budget
 * and concurrency knobs on every delegation contract dispatch so
 * operator changes take effect on the next contract without
 * restarting the API.
 *
 * Extracted out of `system-settings.defaults.ts` so that file stays
 * under the project's `max-lines` lint cap while the operator-tunable
 * knob surface continues to grow across milestones. The spread keeps
 * the seeded defaults byte-identical to the pre-refactor registry.
 */
export const AGENT_MESH_SYSTEM_SETTING_DEFAULTS: Record<
  string,
  { value: unknown; description: string }
> = {
  max_concurrent_subagents_per_workflow: {
    value: 3,
    description:
      'Maximum number of concurrent subagents allowed per workflow run (default: 3)',
  },
  agent_mesh_scheduler_max_concurrency: {
    value: 3,
    description:
      'Maximum number of concurrently running mesh delegation contracts per parent container',
  },
  agent_mesh_scheduler_max_queue_depth: {
    value: 50,
    description:
      'Maximum number of queued mesh delegation contracts allowed per parent container',
  },
  agent_mesh_privileged_tools: {
    value: [
      'bash',
      'write',
      'publish_tool_candidate',
      'upsert_tool',
      'invoke_agent_workflow',
      'complete_orchestration',
      'create_agent_profile',
    ],
    description:
      'Tool list requiring explicit delegation contract approval before execution in mesh mode',
  },
  agent_mesh_max_token_budget: {
    value: 200000,
    description:
      'Upper bound for delegation contract token budget enforced by governance policy checks',
  },
  agent_mesh_max_time_budget_ms: {
    value: 3600000,
    description:
      'Upper bound for delegation contract time budget in milliseconds enforced by governance policy checks',
  },
};
