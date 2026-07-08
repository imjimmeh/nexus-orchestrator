type SettingType = "boolean" | "number" | "string_array" | "json";

type KnownSettingConfig = {
  label: string;
  description: string;
  type: SettingType;
  group: string;
  min?: number;
  max?: number;
};

export const KNOWN_SETTINGS: Record<string, KnownSettingConfig> = {
  question_idle_stop_seconds: {
    label: "Question Idle Stop Seconds",
    description:
      "Seconds to wait before dehydrating a container waiting for user input.",
    type: "number",
    group: "containers",
    min: 0,
    max: 7200,
  },
  question_idle_remove_seconds: {
    label: "Question Idle Remove Seconds",
    description:
      "Seconds to wait before removing a stopped container waiting for user input.",
    type: "number",
    group: "containers",
    min: 0,
    max: 86400,
  },
  scheduled_jobs_enabled: {
    label: "Enable Scheduled Jobs",
    description: "Enable scheduled jobs automation queue processing.",
    type: "boolean",
    group: "scheduling",
  },
  scheduled_jobs_poll_interval_seconds: {
    label: "Scheduled Jobs Poll Interval (seconds)",
    description:
      "Polling cadence in seconds for discovering due scheduled jobs.",
    type: "number",
    group: "scheduling",
    min: 5,
    max: 300,
  },
  scheduled_jobs_poll_batch_size: {
    label: "Scheduled Jobs Batch Size",
    description: "Maximum due scheduled jobs evaluated per polling tick.",
    type: "number",
    group: "scheduling",
    min: 1,
    max: 200,
  },
  workflow_host_mount_catalog: {
    label: "Host Mount Catalog",
    description:
      "Alias-indexed host mount catalog. Each alias defines api_root, default_mode, writable_allowed, and approval_required_on_rw.",
    type: "json",
    group: "host-mounts",
  },
  workflow_host_mount_rw_approval_required: {
    label: "Require RW Mount Approval",
    description:
      "Require explicit operator approval for read-write host mounts.",
    type: "boolean",
    group: "host-mounts",
  },
  max_concurrent_subagents_per_workflow: {
    label: "Max Concurrent Subagents per Workflow",
    description: "Controls parallelism within a single workflow run.",
    type: "number",
    group: "concurrency",
    min: 1,
    max: 16,
  },
  agent_mesh_scheduler_max_concurrency: {
    label: "Mesh Max Concurrency",
    description:
      "Maximum concurrently running mesh delegation contracts per parent container.",
    type: "number",
    group: "concurrency",
    min: 1,
    max: 32,
  },
  agent_mesh_scheduler_max_queue_depth: {
    label: "Mesh Max Queue Depth",
    description:
      "Maximum queued mesh delegation contracts per parent container.",
    type: "number",
    group: "concurrency",
    min: 1,
    max: 200,
  },
  agent_mesh_privileged_tools: {
    label: "Privileged Tools",
    description:
      "Tool list requiring explicit delegation contract approval before execution in mesh mode.",
    type: "string_array",
    group: "mesh",
  },
  agent_mesh_max_token_budget: {
    label: "Mesh Max Token Budget",
    description: "Upper bound for delegation contract token budget.",
    type: "number",
    group: "mesh",
    min: 1,
  },
  agent_mesh_max_time_budget_ms: {
    label: "Mesh Max Time Budget (ms)",
    description:
      "Upper bound for delegation contract time budget in milliseconds.",
    type: "number",
    group: "mesh",
    min: 1,
  },
  agent_war_room_required_signoff_roles: {
    label: "Required Signoff Roles",
    description:
      "Ordered role list required for consensus signoff in war-room sessions.",
    type: "string_array",
    group: "war-room",
  },
  agent_war_room_deadlock_signoff_threshold: {
    label: "Deadlock Signoff Threshold",
    description:
      "Minimum submitted required-role signoffs before conflicting state is treated as deadlock.",
    type: "number",
    group: "war-room",
    min: 1,
    max: 20,
  },
  agent_war_room_auto_ceo_tie_break: {
    label: "Auto CEO Tie-Break",
    description:
      "Automatically apply CEO tie-break on deadlocked war-room sessions.",
    type: "boolean",
    group: "war-room",
  },
  agent_war_room_max_message_chars: {
    label: "Max Message Characters",
    description:
      "Maximum allowed message length for war-room discussion messages.",
    type: "number",
    group: "war-room",
    min: 100,
    max: 50000,
  },
  workflow_auto_retry_enabled: {
    label: "Enable Auto Retry",
    description:
      "Enable automatic workflow job retries after terminal job failure.",
    type: "boolean",
    group: "auto-retry",
  },
  workflow_auto_retry_max_attempts: {
    label: "Max Retry Attempts",
    description:
      "Maximum auto-retry attempts after a job fails all queue attempts.",
    type: "number",
    group: "auto-retry",
    min: 1,
    max: 10,
  },
  workflow_auto_retry_initial_delay_ms: {
    label: "Initial Retry Delay (ms)",
    description:
      "Initial delay in milliseconds before the first automatic retry.",
    type: "number",
    group: "auto-retry",
    min: 1000,
  },
  workflow_auto_retry_max_delay_ms: {
    label: "Max Retry Delay (ms)",
    description:
      "Maximum delay in milliseconds applied to exponential retry backoff.",
    type: "number",
    group: "auto-retry",
    min: 1000,
  },
  workflow_auto_retry_backoff_multiplier: {
    label: "Backoff Multiplier",
    description:
      "Exponential multiplier between automatic workflow retry attempts.",
    type: "number",
    group: "auto-retry",
    min: 1,
    max: 10,
  },
  workflow_auto_retry_jitter_ratio: {
    label: "Jitter Ratio",
    description:
      "Random jitter ratio applied to automatic workflow retry backoff delay.",
    type: "number",
    group: "auto-retry",
    min: 0,
    max: 1,
  },
  workflow_stage_skill_policy: {
    label: "Stage Skill Policy",
    description:
      "Lifecycle stage-to-skill policy map keyed by stage and agent profile for runtime skill selection.",
    type: "json",
    group: "skill-policy",
  },
  retrospective_enabled: {
    label: "Enable Retrospective Analyst",
    description:
      "Master kill-switch for the EPIC-212 Phase-2 retrospective analyst loop. When false (default) terminal runs are not enqueued and no LLM retrospective mining runs — only the deterministic Phase-0/1 learning loop stays active. Set to true to enable the full analyst-driven mining, routing, and governance pipeline.",
    type: "boolean",
    group: "learning",
  },
  workflow_postmortem_writeback_enabled: {
    label: "Enable Postmortem Writeback",
    description:
      "When true (default), workflow failure postmortems are written to the learning candidate queue. Disable to stop the high-volume direct-write path that contributes noise to the learning pipeline.",
    type: "boolean",
    group: "learning",
  },
  orchestration_cycle_candidate_enabled: {
    label: "Enable Orchestration-Cycle Learning Candidates",
    description:
      "When false (default), templated 'completed an orchestration cycle' learning candidates are dropped at ingestion — they are low-signal and generated at high volume. Enable only if you want these retained for analysis.",
    type: "boolean",
    group: "learning",
  },
  chat_session_learning_flush_enabled: {
    label: "Enable Chat Session Learning Flush",
    description:
      "When true, completing or failing a chat session will trigger a background LLM review sweep to extract learning candidates.",
    type: "boolean",
    group: "learning",
  },
};

export const SETTING_GROUPS = [
  { value: "concurrency", label: "Concurrency" },
  { value: "containers", label: "Containers" },
  { value: "scheduling", label: "Scheduled Jobs" },
  { value: "host-mounts", label: "Host Mounts" },
  { value: "mesh", label: "Agent Mesh" },
  { value: "war-room", label: "War Room" },
  { value: "auto-retry", label: "Auto Retry" },
  { value: "skill-policy", label: "Skill Policy" },
  { value: "learning", label: "Learning & Memory" },
];
