import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const seedRoot = resolve(__dirname, "../../../../seed/workflows");

function readSeed(relativePath: string): string {
  return readFileSync(join(seedRoot, relativePath), "utf8");
}

interface WorkflowOutputContract {
  required?: string[];
  forbidden?: Array<{ description?: string; condition?: string }>;
}

interface WorkflowToolPolicyRule {
  effect?: string;
  tool?: string;
}

interface WorkflowToolPolicy {
  default?: string;
  rules?: WorkflowToolPolicyRule[];
}

interface WorkflowPermissions {
  allow_tools?: string[];
  deny_tools?: string[];
  tool_policy?: WorkflowToolPolicy;
}

interface WorkflowJob {
  id?: string;
  output_contract?: WorkflowOutputContract;
}

interface Workflow {
  permissions?: WorkflowPermissions;
  jobs?: WorkflowJob[];
}

function loadWorkflow(): Workflow {
  const raw = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
  return yaml.load(raw) as Workflow;
}

function loadWorkflowOutputContract(): WorkflowOutputContract | undefined {
  // The dispatch job carries the primary output contract with the decision
  // and forbidden fields. The strategize job only requires groomed_board_summary.
  const jobs = loadWorkflow().jobs ?? [];
  const dispatchJob = jobs.find((j) => j.id === "dispatch");
  return dispatchJob?.output_contract;
}

// Flatten `permissions.tool_policy.rules[].tool` (effect: allow) into a
// sorted, unique list of tool names. The CEO workflow uses the explicit
// `default: deny` + `rules` policy format (instead of the legacy
// `permissions.allow_tools` array), so the loader must walk the rules to
// recover the effective allow list.
function loadWorkflowAllowTools(): readonly string[] {
  const permissions = loadWorkflow().permissions;
  const rules = permissions?.tool_policy?.rules;
  if (!Array.isArray(rules)) {
    return [];
  }
  const toolNames = new Set<string>();
  for (const rule of rules) {
    if (!rule || typeof rule !== "object") continue;
    if (rule.effect !== "allow") continue;
    if (typeof rule.tool === "string" && rule.tool.trim().length > 0) {
      toolNames.add(rule.tool.trim());
    }
  }
  return Array.from(toolNames).sort();
}

describe("project orchestration cycle CEO seed contract", () => {
  it("does not grant direct work-item creation to the CEO cycle", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    expect(workflow).not.toContain("kanban.work_item_create");
  });

  it("uses projected delegation tools instead of static agent-invoke jobs", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    expect(workflow).toContain("delegate_goal_backlog_planning");
    expect(workflow).toContain("delegate_imported_repo_discovery");
    expect(workflow).not.toContain("invoke_agent_workflow");
    // Note: invoke_workflow IS used for deterministic gate jobs (EPIC-208 Phase 2).
    // The prohibition is on the old invoke_agent_workflow pattern, not invoke_workflow.
  });

  it("does not wire charter refinement into the strategize cycle", () => {
    // Product decision: charter refinement is no longer part of the
    // orchestration cycle. The standalone project_charter_ceo workflow
    // (incl. its manual refine mode) remains, but the cycle must neither
    // allow the delegation tool nor instruct the CEO to use it.
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    const strategize = readSeed(
      "prompts/project-orchestration-cycle-ceo/strategize.md",
    );
    expect(workflow).not.toContain("delegate_charter_refinement");
    expect(strategize).not.toContain("delegate_charter_refinement");
    expect(strategize).not.toContain("CHARTER_DRIFT_MERGE_THRESHOLD");
  });

  it("has explicit max_step_loops for multi-delegation iteration", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    expect(workflow).toContain("max_step_loops: 10");
  });

  it("uses projected delegation pattern in prompt", () => {
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/dispatch.md",
    );
    expect(prompt).toContain("Projected Delegation Cycle");
    expect(prompt).toContain("delegate_goal_backlog_planning");
    expect(prompt).toContain("delegate_imported_repo_discovery");
    expect(prompt).toContain("Check results");
    expect(prompt).toContain("Iterate or act");
    expect(prompt).not.toContain("invoke_agent_workflow");
    expect(prompt).not.toContain("set_job_output");
    expect(prompt).not.toContain("kanban.work_item_create");
  });

  it("has output_contract with required decision and Kanban linkage fields", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    // Post-WI-2026-007: the CEO cycle must also surface a Kanban linkage
    // field (`linked_run_id`) so dispatch claims can be backed by an
    // execution linkage. The `decision` field remains required; the
    // `linked_run_id` field is the contractually required linkage.
    expect(workflow).toContain("required: [decision, linked_run_id]");
    expect(workflow).not.toContain("delegated_workflow_id");
  });

  it("output_contract.required includes the decision field", () => {
    const outputContract = loadWorkflowOutputContract();
    expect(outputContract).toBeDefined();
    expect(outputContract?.required).toBeDefined();
    expect(outputContract?.required).toContain("decision");
  });

  it("output_contract.forbidden defines the bare-repeat mandate violation", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    const outputContract = loadWorkflowOutputContract();

    expect(outputContract?.forbidden).toBeDefined();
    expect(outputContract?.forbidden?.length ?? 0).toBeGreaterThan(0);

    const bareRepeatEntry = outputContract?.forbidden?.find(
      (entry) =>
        entry.description?.toLowerCase().includes("bare repeat") === true ||
        entry.condition?.includes("decision == 'repeat'") === true,
    );
    expect(bareRepeatEntry).toBeDefined();
    expect(bareRepeatEntry?.condition).toContain("todo_count == 0");
    expect(bareRepeatEntry?.condition).toContain("backlog_count > 0");

    // The raw YAML must surface the forbidden block so downstream
    // validators (e.g. job output contract enforcement) can find it.
    expect(workflow).toContain("forbidden:");
    expect(workflow).toContain("decision == 'repeat'");
    expect(workflow).toContain("blockedItems == null");
  });

  it("output_contract forbids repeat-without-blockedItems explicitly", () => {
    const outputContract = loadWorkflowOutputContract();
    const conditions = (outputContract?.forbidden ?? [])
      .map((entry) => entry.condition ?? "")
      .join("\n");

    expect(conditions).toMatch(/repeat/i);
    expect(conditions).toMatch(/todo_count\s*==\s*0/);
    expect(conditions).toMatch(/backlog_count\s*>\s*0/);
  });

  it("tool allowlist includes the backlog-to-todo promotion tool", () => {
    const allowTools = loadWorkflowAllowTools();
    // `kanban.work_item_transition_status` is the only tool that can
    // promote a backlog item into the todo column, so the CEO cycle
    // MUST have it in its allowlist to satisfy the zero-todo
    // promotion mandate.
    expect(allowTools).toContain("kanban.work_item_transition_status");
  });

  it("tool allowlist includes the execution-config patch tool", () => {
    const allowTools = loadWorkflowAllowTools();
    // Outcome (b) of the mandate ("patch") requires patching the
    // execution config of a candidate before promotion.
    expect(allowTools).toContain("kanban.work_item_patch_execution_config");
  });

  it("tool allowlist includes the work-item generation delegation", () => {
    const allowTools = loadWorkflowAllowTools();
    // Outcome (c) of the mandate ("create") requires a projected
    // delegation that creates a new work item and promotes it.
    expect(allowTools).toContain("delegate_work_item_generation");
  });

  it("exposes both lifecycle transitions and direct dispatch in the CEO cycle (post-WI-2026-007)", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/dispatch.md",
    );

    // Post-WI-2026-007 AC-1: the CEO cycle's tool policy must grant
    // `kanban.dispatch_selected_work_items` so the CEO can truthfully
    // claim dispatch with a populated Kanban linkage field
    // (`linked_run_id` / `current_execution_id`). The CEO also retains
    // the lifecycle transition tool for promoting safe backlog items
    // and starting coherent todo work.
    const allowTools = loadWorkflowAllowTools();
    expect(allowTools).toContain("kanban.work_item_transition_status");
    expect(allowTools).toContain("kanban.dispatch_selected_work_items");
    // The raw YAML must surface the dispatch tool entry so reviewers
    // can find the allow rule in source.
    expect(workflow).toContain("kanban.dispatch_selected_work_items");

    // Prompt still uses lifecycle transitions to start in-progress work
    // and the WIP-cap guard. The dispatch tool is invoked from the
    // allow list directly, not referenced by name in the prompt.
    expect(prompt).toContain("Lifecycle Start Rules");
    expect(prompt).toContain("kanban.work_item_transition_status");
    expect(prompt).toContain('status: "in-progress"');
    expect(prompt).toContain("project_wip_limit_reached");
    expect(prompt).toContain("do not try additional todo starts");
    expect(prompt).toContain("authoritative WIP-cap check");
  });

  it("does not expose direct workflow or job-output tools in the CEO cycle contract", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/dispatch.md",
    );

    expect(workflow).not.toContain("invoke_agent_workflow");
    expect(prompt).not.toContain("invoke_agent_workflow");
    expect(prompt).not.toContain("set_job_output");
  });

  it("requires composite decision completion before step completion", () => {
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/dispatch.md",
    );
    expect(prompt).toContain("kanban.complete_orchestration_cycle_decision");
    expect(prompt).toContain('next_action: "call_step_complete"');
    expect(prompt).toContain("Do not try to write job output yourself");
  });

  it("passes the project scope id into the CEO prompt and forbids project alias guesses", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/strategize.md",
    );

    expect(workflow).toContain('project_id: "{{ trigger.scopeId }}"');
    expect(prompt).toContain("Project ID: `{{ inputs.project_id }}`");
    expect(prompt).toContain("Never guess project aliases");
    expect(prompt).toContain("default/main/workspace/kanban-domain");
  });

  it("can restart stale work-item lifecycle automation from the CEO cycle", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/dispatch.md",
    );

    expect(workflow).toContain("kanban.work_item_restart_execution");
    expect(prompt).toContain("kanban.work_item_restart_execution");
    expect(prompt).toContain("ready-to-merge");
    expect(prompt).toContain("linkedRunId is empty");
    expect(prompt).toContain("currentExecutionId is empty");
  });

  it("must lifecycle-start dispatchable todo work whenever a free slot exists", () => {
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/dispatch.md",
    );

    expect(prompt).toContain("Dispatchable Todo Start Rules");
    expect(prompt).toContain("dispatchableTodoCount > 0");
    // Fix A: the hard lifecycle-start mandate keys off available capacity, not
    // "no run is active". A free slot must be filled even while other runs are
    // in flight — the engine must never hold a capacity slot in reserve.
    expect(prompt).toContain("strategic.dispatch.capacity.availableSlots > 0");
    expect(prompt).toContain("even when other runs are already active");
    expect(prompt).toContain("authoritative WIP-cap check");
    expect(prompt).toContain("MUST NOT be held in reserve");
    expect(prompt).toContain("call `kanban.work_item_transition_status`");
    expect(prompt).toContain('status: "in-progress"');
    expect(prompt).toContain(
      "A bare `repeat` decision is forbidden when a free capacity slot and dispatchable todo work both exist",
    );
  });

  it("aligns CEO todo starts with the authoritative WIP-cap tool rejection", () => {
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/dispatch.md",
    );

    expect(prompt).toContain("kanban.work_item_transition_status");
    expect(prompt).toContain("authoritative WIP-cap check");
    expect(prompt).toContain("project_wip_limit_reached");
    expect(prompt).toContain("trust the tool rejection");
    expect(prompt).toContain("rather than re-evaluating capacity yourself");
    expect(prompt).toContain("stop attempting starts");
    expect(prompt).toContain("do not try additional todo starts");
    expect(prompt).toContain("checking the tool outcome after each attempt");
    expect(prompt).not.toMatch(/try the next item/i);
    expect(prompt).not.toMatch(/try another todo start/i);
    expect(prompt).not.toMatch(
      /project_wip_limit_reached[\s\S]{0,240}(retry|try the next|try another)/i,
    );
  });

  it("promotes safe backlog deterministically when zero-todo (engine job)", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    expect(workflow).toContain("id: promote_safe_backlog");
    expect(workflow).toContain("tool_name: kanban.work_item_transition_status");
    expect(workflow).toContain("groomed_board_summary.todo_count");
    expect(workflow).toContain("for_each:");
  });

  it("dispatch still backstops bare repeat via output_contract.forbidden", () => {
    const outputContract = loadWorkflowOutputContract();
    const bareRepeat = outputContract?.forbidden?.find((e) =>
      e.condition?.includes("decision == 'repeat'"),
    );
    expect(bareRepeat?.condition).toContain("todo_count == 0");
    expect(bareRepeat?.condition).toContain("backlog_count > 0");
  });

  it("strategize prompt surfaces dispatch capacity and forbids inferring it from linkedRunCount", () => {
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/strategize.md",
    );
    // Fix B: the strategize step must read the authoritative capacity object so
    // it cannot mistake a single active run for an exhausted board (the root of
    // the "keep one slot in reserve" misread).
    expect(prompt).toContain("strategic.dispatch.capacity");
    expect(prompt).toContain("availableSlots");
    expect(prompt).toContain("maxActive");
    expect(prompt).toMatch(
      /never infer[^.]*capacity[^.]*linkedRunCount|never[^.]*linkedRunCount[^.]*capacity/i,
    );
    // And it must not direct dispatch to hold a free slot in reserve.
    expect(prompt).toContain(
      "must not direct the dispatch step to hold a free",
    );
  });

  it("dispatch prompt references engine-assisted promotion and the capacity signal", () => {
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/dispatch.md",
    );
    expect(prompt).toContain("engine has already promoted");
    expect(prompt).toContain("strategic.dispatch.capacity.availableSlots");
  });

  it("mandate prohibits bare repeat with no mutation when backlog exists", () => {
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/dispatch.md",
    );
    expect(prompt).toContain("A bare `repeat` decision with no board mutation");
    expect(prompt).toContain("NOT permitted when unblocked backlog exists");
  });

  it("mandate includes the blockedItems array format for structured no-action", () => {
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/dispatch.md",
    );
    expect(prompt).toContain("blockedItems");
    expect(prompt).toMatch(/\{workItemId,\s*blockedReason\}/);
    expect(prompt).toContain("decision: repeat");
  });
});

describe("EPIC-208 Phase 3: two-phase strategize/dispatch", () => {
  interface CeoJob {
    id?: string;
    prompt_file?: string;
    depends_on?: string[];
    steps?: Array<{ id?: string; prompt_file?: string }>;
  }

  function loadJobs(): CeoJob[] {
    const raw = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    const wf = yaml.load(raw) as { jobs?: CeoJob[] };
    return wf.jobs ?? [];
  }

  it("has load_state as the first job, strategize after the gates, and dispatch last", () => {
    // EPIC-208 Phase 2: four deterministic gate jobs precede strategize.
    // load_state is now the first job; strategize follows ideation_gate;
    // dispatch remains the final job.
    const jobs = loadJobs();
    const ids = jobs.map((j) => j.id);
    expect(ids[0]).toBe("load_state");
    const strategizeIdx = ids.indexOf("strategize");
    const dispatchIdx = ids.indexOf("dispatch");
    expect(strategizeIdx).toBeGreaterThan(0);
    expect(dispatchIdx).toBeGreaterThan(strategizeIdx);
  });

  it("strategize job has the strategize prompt file", () => {
    const jobs = loadJobs();
    const strategize = jobs.find((j) => j.id === "strategize");
    const step = strategize?.steps?.[0];
    expect(step?.prompt_file).toBe(
      "prompts/project-orchestration-cycle-ceo/strategize.md",
    );
  });

  it("dispatch job has the dispatch prompt file and depends on promote_safe_backlog", () => {
    // Phase 5: dispatch now depends on promote_safe_backlog (which itself
    // depends_on strategize), so the zero-todo promotion job runs between
    // the two agent steps.
    const jobs = loadJobs();
    const dispatch = jobs.find((j) => j.id === "dispatch");
    const step = dispatch?.steps?.[0];
    expect(step?.prompt_file).toBe(
      "prompts/project-orchestration-cycle-ceo/dispatch.md",
    );
    expect(dispatch?.depends_on).toContain("promote_safe_backlog");
  });

  it("grants the strategic-intent and job-output tools to the cycle", () => {
    const allowTools = loadWorkflowAllowTools();
    expect(allowTools).toContain("kanban.record_strategic_intent");
    expect(allowTools).toContain("set_job_output");
  });
});

describe("EPIC-208 Phase 3: strategize prompt content", () => {
  const prompt = () =>
    readSeed("prompts/project-orchestration-cycle-ceo/strategize.md");

  it("loads staleness, charter, initiatives, prior intent and timeline", () => {
    const p = prompt();
    expect(p).toContain("kanban.project_state");
    expect(p).toContain("strategic.staleness");
    expect(p).toContain("strategic.latestStrategicIntent");
    expect(p).toContain("strategic.initiatives");
    expect(p).toContain("docs/project-context/CHARTER.md");
    expect(p).toContain("query_memory");
    expect(p).toContain("kanban.orchestration_timeline");
  });

  it("performs light grooming and records strategic intent", () => {
    const p = prompt();
    expect(p).toMatch(/re-?prioritise|reprioritize|defer|split|link/i);
    expect(p).toContain("kanban.record_strategic_intent");
  });

  it("hands a groomed board summary to dispatch via set_job_output", () => {
    const p = prompt();
    expect(p).toContain("set_job_output");
    expect(p).toContain("groomed_board_summary");
    expect(p).toContain("dispatch");
  });

  it("strategize prompt defers gate evaluation to the engine and allows override", () => {
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/strategize.md",
    );
    expect(prompt).toContain("already evaluated by the engine");
    expect(prompt).toContain("Judgement-based override");
    // The threshold arithmetic instructions are gone from the prompt (now in YAML conditions).
    expect(prompt).not.toContain("REDISCOVERY_MERGE_THRESHOLD = 10");
    expect(prompt).not.toContain(
      "mergesSinceDiscovery >= REDISCOVERY_MERGE_THRESHOLD",
    );
  });
});

describe("EPIC-208 Phase 3: dispatch prompt preserves tactical mandates", () => {
  const prompt = () =>
    readSeed("prompts/project-orchestration-cycle-ceo/dispatch.md");

  it("reads the groomed board summary handed from strategize", () => {
    expect(prompt()).toContain("groomed_board_summary");
  });

  it("preserves the lifecycle-start and zero-todo mandates", () => {
    const p = prompt();
    expect(p).toContain("Lifecycle Start Rules");
    expect(p).toContain("kanban.work_item_transition_status");
    expect(p).toContain('status: "in-progress"');
    expect(p).toContain("Dispatchable Todo Start Rules");
    expect(p).toContain("kanban.complete_orchestration_cycle_decision");
    expect(p).toContain('next_action: "call_step_complete"');
  });

  it("removes the old cycle.md and decide.md prompts", () => {
    const dir = join(seedRoot, "prompts/project-orchestration-cycle-ceo");
    expect(existsSync(join(dir, "cycle.md"))).toBe(false);
    expect(existsSync(join(dir, "decide.md"))).toBe(false);
  });
});

describe("EPIC-208 Phase 3: CEO agent profile", () => {
  it("CEO agent profile grants the strategic-intent tool", () => {
    const raw = readFileSync(
      resolve(__dirname, "../../../../seed/agents/ceo-agent/agent.json"),
      "utf8",
    );
    const profile = JSON.parse(raw) as {
      tool_policy?: { rules?: Array<{ effect?: string; tool?: string }> };
    };
    const granted = (profile.tool_policy?.rules ?? [])
      .filter((r) => r.effect === "allow")
      .map((r) => r.tool);
    expect(granted).toContain("kanban.record_strategic_intent");
  });
});

describe("project-spec-revision-ceo war-room subagent tool contract", () => {
  // All war-room tools (post_war_room_message, submit_war_room_signoff,
  // get_war_room_state, step_complete) are api_callback capabilities that
  // never materialise for subagents. Reviewer subagents must use only
  // SDK-native tools and return findings as text; the parent orchestrator
  // step posts them to the war room on the reviewers' behalf.
  it("only grants SDK-native tools to spawned subagents in the war-room-revision-align prompt", () => {
    const prompt = readSeed(
      "prompts/project-spec-revision-ceo/war-room-revision-align.md",
    );
    const toolListPattern = /tools:\s*\[([^\]]*)\]/g;
    const toolLists = [...prompt.matchAll(toolListPattern)].map((match) =>
      match[1]
        .split(",")
        .map((tool) => tool.trim().replaceAll(/["']/g, ""))
        .filter((tool) => tool.length > 0),
    );

    const SDK_NATIVE = new Set([
      "bash",
      "edit",
      "find",
      "grep",
      "ls",
      "read",
      "write",
    ]);

    expect(toolLists.length).toBeGreaterThan(0);
    for (const tools of toolLists) {
      for (const tool of tools) {
        expect(
          SDK_NATIVE.has(tool),
          `subagent spawn template lists non-SDK-native tool '${tool}', which never materialises for a subagent`,
        ).toBe(true);
      }
    }
  });
});

describe("EPIC-208 deterministic gates", () => {
  it("loads project_state via a deterministic mcp_tool_call job", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    expect(workflow).toContain("id: load_state");
    expect(workflow).toContain("type: mcp_tool_call");
    expect(workflow).toContain("tool_name: kanban.project_state");
  });

  it("fires the three specialist passes as condition-gated invoke_workflow jobs", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    expect(workflow).toContain("id: rediscovery_gate");
    expect(workflow).toContain(
      "workflow_id: project_codebase_deep_investigation",
    );
    expect(workflow).toContain(
      "(gte jobs.load_state.output.result.strategic.staleness.mergesSinceDiscovery vars.gates.rediscovery_merge_threshold)",
    );
    expect(workflow).toContain("id: roadmap_planning_gate");
    expect(workflow).toContain("workflow_id: project_roadmap_planning");
    expect(workflow).toContain(
      "(eq jobs.load_state.output.result.strategic.staleness.activeNowInitiativeCount 0)",
    );
    expect(workflow).toContain("id: ideation_gate");
    expect(workflow).toContain("workflow_id: project_goal_backlog_planning");
    expect(workflow).toContain(
      "(lte jobs.load_state.output.result.strategic.staleness.starvationForecastCycles vars.gates.ideation_starvation_cycles)",
    );
  });

  it("runs strategize after the gates", () => {
    const workflow = readSeed("project-orchestration-cycle-ceo.workflow.yaml");
    expect(workflow).toContain("depends_on: [ideation_gate]");
  });
});
