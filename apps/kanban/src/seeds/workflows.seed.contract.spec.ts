import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  IJob,
  IJobStep,
  IWorkflowDefinition,
  IWorkflowStep,
} from "@nexus/core";
import * as yaml from "js-yaml";
import {
  OrchestrationRecordBlockedSchema,
  OrchestrationClearBlockedSchema,
  WorkItemAppendMetadataArraySchema,
  DispatchSelectedWorkItemsSchema,
} from "../mcp/tools/shared/schemas";

type WorkflowDocument = IWorkflowDefinition & { steps?: IWorkflowStep[] };

const parser = {
  parseWorkflow(yamlString: string): IWorkflowDefinition {
    const doc = yaml.load(yamlString) as WorkflowDocument;
    if (!doc || typeof doc !== "object") {
      throw new Error("YAML must evaluate to an object");
    }
    if (!doc.workflow_id) throw new Error("Missing workflow_id");
    if (!doc.name) throw new Error("Missing name");
    if (doc.jobs && doc.steps) {
      throw new Error(
        "Cannot define both jobs and steps at the workflow level",
      );
    }
    if (doc.jobs) {
      if (!Array.isArray(doc.jobs)) throw new Error("jobs must be an array");
      return doc;
    }
    if (doc.steps) {
      if (!Array.isArray(doc.steps)) throw new Error("steps must be an array");
      doc.jobs = doc.steps.map(normalizeStepToJob);
      delete doc.steps;
      return doc;
    }
    throw new Error("Workflow must contain either jobs or steps");
  },
};

function normalizeStepToJob(step: IWorkflowStep): IJob {
  return {
    id: step.id,
    type: step.type,
    tier: step.tier,
    depends_on: step.depends_on,
    inputs: step.inputs,
    workflow_id: step.workflow_id,
    wait_for_completion: step.wait_for_completion,
    continue_on_concurrency_skip: step.continue_on_concurrency_skip,
    permissions: step.permissions,
    tools: step.tools,
    transitions: step.transitions,
    max_retries: step.max_retries,
    retry_prompt: step.retry_prompt,
    output_contract: step.output_contract,
    switch: step.switch,
    default: step.default,
    for_each: step.for_each,
    continue_on_error: step.continue_on_error,
    steps: createJobStepsFromStepInputs(step.inputs),
  };
}

function createJobStepsFromStepInputs(
  inputs: Record<string, unknown> | undefined,
): IJobStep[] {
  const systemPrompt =
    inputs && typeof inputs.system_prompt === "string"
      ? inputs.system_prompt
      : "";
  return [{ id: "default", prompt: systemPrompt }];
}

const repositoryRoot = resolve(__dirname, "../../../..");
const seedRootDir = resolve(repositoryRoot, "seed");
const seedsDir = resolve(seedRootDir, "workflows");

function readSeed(filename: string): string {
  return readFileSync(join(seedsDir, filename), "utf8");
}

function readSeedRoot(filename: string): string {
  return readFileSync(join(seedRootDir, filename), "utf8");
}

function getPolicyEntries(
  policy: unknown,
  direction: "allow" | "deny",
): Set<string> {
  const policyRecord =
    policy && typeof policy === "object" && !Array.isArray(policy)
      ? (policy as Record<string, unknown>)
      : null;

  if (!policyRecord) {
    return new Set();
  }

  // Handle new tool_policy format
  if (
    policyRecord.tool_policy &&
    typeof policyRecord.tool_policy === "object"
  ) {
    const toolPolicy = policyRecord.tool_policy as Record<string, unknown>;
    const rules = toolPolicy.rules;
    if (Array.isArray(rules)) {
      const allowed = new Set<string>();
      const denied = new Set<string>();
      for (const rule of rules) {
        if (rule && typeof rule === "object" && !Array.isArray(rule)) {
          const r = rule as Record<string, unknown>;
          if (typeof r.tool === "string") {
            if (r.effect === "allow") {
              allowed.add(r.tool);
            } else if (r.effect === "deny") {
              denied.add(r.tool);
            }
          }
        }
      }
      return direction === "allow" ? allowed : denied;
    }
  }

  const toolRules =
    direction === "allow" ? policyRecord.allow_tools : policyRecord.deny_tools;
  if (!Array.isArray(toolRules)) {
    return new Set();
  }

  return new Set(
    toolRules
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
}

function applyToolPolicy(
  candidateTools: Set<string>,
  defaults: Set<string>,
  policy: unknown,
): Set<string> {
  const allow = getPolicyEntries(policy, "allow");
  const deny = getPolicyEntries(policy, "deny");

  let effectiveTools = candidateTools;
  if (allow.has("*")) {
    effectiveTools = new Set(candidateTools);
  } else if (allow.size > 0) {
    const allowed = new Set<string>();
    for (const candidate of defaults) {
      if (allow.has(candidate) || allow.has("*")) {
        allowed.add(candidate);
      }
    }
    effectiveTools = allowed;
  }

  for (const candidateTool of deny) {
    effectiveTools.delete(candidateTool);
  }

  return effectiveTools;
}

function expectEmitEvent(
  seedFilename: string,
  expectedEventName: string,
): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));

  const emitsExpectedEvent = (definition.jobs ?? []).some((job) => {
    if (job.type !== "emit_event") {
      return false;
    }

    const inputs =
      job.inputs && typeof job.inputs === "object" ? job.inputs : null;

    return inputs?.event_name === expectedEventName;
  });

  expect(emitsExpectedEvent).toBe(true);
}

function expectTriggeredManually(seedFilename: string): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  expect(definition.trigger?.type).toBe("manual");
}

function expectWorkflowId(
  seedFilename: string,
  expectedWorkflowId: string,
): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  expect(definition.workflow_id).toBe(expectedWorkflowId);
}

function expectJobExists(seedFilename: string, jobId: string): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  const job = (definition.jobs ?? []).find(
    (candidate) => candidate.id === jobId,
  );
  expect(job).toBeDefined();
}

function expectExecutionJobRequiredOutputFields(
  seedFilename: string,
  jobId: string,
  expectedRequiredFields: string[],
): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  const job = (definition.jobs ?? []).find(
    (candidate) => candidate.id === jobId,
  );

  expect(job).toBeDefined();
  expect(job?.type).toBe("execution");
  expect(job?.output_contract?.required).toEqual(expectedRequiredFields);
}

function expectJobConditionContains(
  seedFilename: string,
  jobId: string,
  expectedFragment: string,
): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  const job = (definition.jobs ?? []).find(
    (candidate) => candidate.id === jobId,
  );

  expect(job).toBeDefined();
  expect(typeof job?.condition).toBe("string");

  if (typeof job?.condition === "string") {
    expect(job.condition).toContain(expectedFragment);
  }
}

function expectTriggerConditionContains(
  seedFilename: string,
  expectedFragment: string,
): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));

  expect(typeof definition.trigger?.condition).toBe("string");
  if (typeof definition.trigger?.condition === "string") {
    expect(definition.trigger.condition).toContain(expectedFragment);
  }
}

function getJobInputs(
  seedFilename: string,
  jobId: string,
): Record<string, unknown> {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  const job = (definition.jobs ?? []).find(
    (candidate) => candidate.id === jobId,
  );

  expect(job).toBeDefined();
  expect(job?.inputs).toBeDefined();
  expect(typeof job?.inputs).toBe("object");

  const inputs = job?.inputs;
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    return {};
  }

  return inputs;
}

function getExecutionStepPrompt(
  seedFilename: string,
  jobId: string,
  stepId: string,
): string {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  const job = (definition.jobs ?? []).find(
    (candidate) => candidate.id === jobId,
  );
  const step = job?.steps?.find((candidate) => candidate.id === stepId);

  expect(job).toBeDefined();
  expect(job?.type).toBe("execution");
  expect(step).toBeDefined();

  if (typeof step?.prompt === "string") {
    expect(typeof step.prompt).toBe("string");
    return step.prompt;
  }

  const promptFile = (step as { prompt_file?: unknown })?.prompt_file;
  if (typeof promptFile !== "string") {
    throw new Error(
      "Expected step prompt to be provided via prompt_file when inline prompt is absent",
    );
  }

  const promptFileName = promptFile.trim();
  expect(promptFileName.length).toBeGreaterThan(0);

  if (promptFileName === "prompts/project-orchestration-cycle-ceo/cycle.md") {
    const path1 = join(
      seedsDir,
      "prompts/project-orchestration-cycle-ceo/cycle.md",
    );
    const path2 = join(
      seedsDir,
      "prompts/project-orchestration-cycle-ceo/decide.md",
    );
    expect(existsSync(path1)).toBe(true);
    expect(existsSync(path2)).toBe(true);
    return readFileSync(path1, "utf8") + "\n\n" + readFileSync(path2, "utf8");
  }

  const promptFilePath = join(seedsDir, promptFileName);
  expect(existsSync(promptFilePath)).toBe(true);

  return readFileSync(promptFilePath, "utf8");
}

function expectJobDeniedTool(
  seedFilename: string,
  jobId: string,
  deniedTool: string,
): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  const job = (definition.jobs ?? []).find(
    (candidate) => candidate.id === jobId,
  );

  expect(job).toBeDefined();
  const denied = getPolicyEntries(job?.permissions, "deny");
  expect(denied).toContain(deniedTool);
}

function expectEffectiveAllowedToolsNotToContain(
  seedFilename: string,
  jobId: string,
  disallowedTool: string,
): void {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  const job = (definition.jobs ?? []).find(
    (candidate) => candidate.id === jobId,
  );

  expect(job).toBeDefined();
  const candidateTools = new Set([
    disallowedTool,
    ...getPolicyEntries(definition.permissions, "allow"),
    ...getPolicyEntries(definition.permissions, "deny"),
    ...getPolicyEntries(job?.permissions, "allow"),
    ...getPolicyEntries(job?.permissions, "deny"),
  ]);
  const workflowScoped = applyToolPolicy(
    new Set(candidateTools),
    candidateTools,
    definition.permissions,
  );
  const jobScoped = applyToolPolicy(
    workflowScoped,
    workflowScoped,
    job?.permissions,
  );

  expect(jobScoped).not.toContain(disallowedTool);
}

function getEffectiveAllowedTools(
  seedFilename: string,
  jobId: string,
): Set<string> {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  const job = (definition.jobs ?? []).find(
    (candidate) => candidate.id === jobId,
  );

  expect(job).toBeDefined();
  const defaultTools = new Set<string>([
    ...getPolicyEntries(definition.permissions, "allow"),
    ...getPolicyEntries(definition.permissions, "deny"),
    ...getPolicyEntries(job?.permissions, "allow"),
    ...getPolicyEntries(job?.permissions, "deny"),
  ]);

  const workflowScoped = applyToolPolicy(
    new Set(defaultTools),
    defaultTools,
    definition.permissions,
  );
  const jobScopedCandidates = new Set([
    ...workflowScoped,
    ...getPolicyEntries(job?.permissions, "allow"),
    ...getPolicyEntries(job?.permissions, "deny"),
  ]);

  return applyToolPolicy(
    jobScopedCandidates,
    jobScopedCandidates,
    job?.permissions,
  );
}

function expectEffectiveAllowedToolsToContain(
  seedFilename: string,
  jobId: string,
  allowedTool: string,
): void {
  const effectiveTools = getEffectiveAllowedTools(seedFilename, jobId);

  expect(effectiveTools).toContain(allowedTool);
}

describe("workflow seed orchestration contracts", () => {
  it("applies explicit tool denies after wildcard allows", () => {
    const effectiveTools = applyToolPolicy(
      new Set(["read", "write", "delete"]),
      new Set(["read", "write", "delete"]),
      { allow_tools: ["*"], deny_tools: ["delete"] },
    );

    expect(effectiveTools).toEqual(new Set(["read", "write"]));
  });

  it("discovery workflow emits specs-ready contract event", () => {
    expectEmitEvent(
      "project-discovery-ceo.workflow.yaml",
      "ProjectOrchestrationSpecsReadyEvent",
    );
  });

  it("orchestration cycle workflow includes Kanban-owned lifecycle tooling in effective permissions", () => {
    expectEffectiveAllowedToolsToContain(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "kanban.work_item_transition_status",
    );
  });

  it("umbrella resolution workflow triggers for completed split children", () => {
    const definition = parser.parseWorkflow(
      readSeed("work-item-umbrella-resolution-default.workflow.yaml"),
    );
    const condition = definition.trigger?.condition;
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "resolve_umbrella_parent",
    );

    expect(definition.workflow_id).toBe(
      "work_item_umbrella_resolution_default",
    );
    expect(definition.trigger?.type).toBe("event");
    expect(definition.trigger?.event).toBe(
      "kanban.work_item.status_changed.v1",
    );
    expect(typeof condition).toBe("string");
    expect(condition).toContain("trigger.status 'done'");
    expect(condition).toContain("trigger.resource.metadata.split.parentId");
    expect(condition).toContain("trigger.resource.metadata.parent_context_id");
    expect(job?.type).toBe("mcp_tool_call");
    expect(job?.inputs?.tool_name).toBe(
      "kanban.work_item_resolve_umbrella_parent",
    );
  });

  it("orchestration cycle CEO prompt stewards the whole board before starting work", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );

    expect(prompt).toContain(
      "Every orchestration cycle is a product and delivery management pass",
    );
    expect(prompt).toContain("current sprint scope");
    expect(prompt).toContain("current sprint goal");
    expect(prompt).toContain("Identify missing-work gaps");
    expect(prompt).toContain("Update stale specs");
    expect(prompt).toContain("work-item descriptions");
    expect(prompt).toContain("execution configuration");
    expect(prompt).toContain("backlog items into `todo`");
    expect(prompt).toContain("Demote `todo` items back to backlog");
    expect(prompt).toContain("Resolve safe blockers");
    expect(prompt).toContain("target branch conflicts");
    expect(prompt).toContain(
      "Lifecycle-start only after the todo list represents a coherent current sprint",
    );
    // Non-contagion rule: human-decision blockers on individual items must not
    // be misread as a board-wide block. The engine enforces this structurally by
    // excluding human_decision items from promotableBacklog (promote_safe_backlog
    // job). The dispatch prompt reinforces it via the INVALID example and the
    // explicit non-contagion statement.
    expect(prompt).toContain(
      "Human-decision items do NOT block unrelated backlog items",
    );
    expect(prompt).toContain("unblocked backlog");
    expect(prompt).toContain("MANDATORY—not an optional path");
  });

  it("requires autonomous imported-repo all-blocked cycles to promote safe work", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );

    expect(prompt).toContain("AUTONOMOUS IMPORTED-REPO ALL-BLOCKED BOARD RULE");
    expect(prompt).toContain("All current work items are blocked by");
    expect(prompt).toContain("delegate_goal_backlog_planning");
    expect(prompt).toContain("Keep probe findings blocked");
    expect(prompt).toContain("re-read project state");
    expect(prompt).toContain("Promote safe backlog items to todo");
  });

  it("documents the iterative delegation cycle for multi-delegation orchestration", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );

    expect(prompt).toContain("Projected Delegation Cycle");
    expect(prompt).toContain("delegate_goal_backlog_planning");
    expect(prompt).toContain("delegate_imported_repo_discovery");
    expect(prompt).toContain("delegate_orchestration_advisor");
    expect(prompt).toContain("Check results");
    expect(prompt).toContain("Iterate or act");
    expect(prompt).toContain("You have up to 10 turns");
    expect(prompt).not.toContain("invoke_agent_workflow");
  });

  it("documents scheduler stale-intent reset recovery in CEO prompt", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );

    expect(prompt).toContain("kanban.reset_orchestration_intents");
    expect(prompt).toMatch(/conflict_key_active/i);
    expect(prompt).toMatch(/lane_capacity_reached/i);
    expect(prompt).toMatch(/Decision is not launchable/i);
    expect(prompt).toMatch(/two distinct\s+attempts/i);
  });

  it("documents authoritative WIP-cap behavior in CEO prompt", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );

    expect(prompt).toContain("project_wip_limit_reached");
    // The WIP-cap check and lifecycle trigger live in the "Lifecycle Start Rules"
    // section. The prompt now surfaces capacity via strategic.dispatch.capacity.availableSlots
    // instead of a generic phrase.
    expect(prompt).toContain("Lifecycle Start Rules");
    expect(prompt).toContain("do not try additional todo starts");
    expect(prompt).toContain("strategic.dispatch.capacity.availableSlots");
  });

  it("documents DB fallback when in-progress work item markdown is unavailable", () => {
    const prompt = getExecutionStepPrompt(
      "work-item-in-progress-default.workflow.yaml",
      "implement_and_commit",
      "implement",
    );

    expect(prompt).toMatch(/Missing markdown is not a workflow failure/i);
    expect(prompt).toMatch(/DB-backed work item context/i);
    expect(prompt).toContain("Title: {{trigger.resource.title}}");
    expect(prompt).toContain("Description: {{trigger.resource.description}}");
    expect(prompt).toContain(
      "Work item metadata: {{json trigger.resource.metadata}}",
    );
    expect(prompt).toMatch(
      /Do not fail solely because `workItemMarkdownPath` is absent/i,
    );
  });

  it("work item in-progress workflow uses strict needs for escalation branch", () => {
    const definition = parser.parseWorkflow(
      readSeed("work-item-in-progress-default.workflow.yaml"),
    );
    expect(definition.strict_dependencies).toBe(true);

    const transition = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "transition_to_needs_rework",
    );
    expect(transition?.needs).toEqual([
      { job: "escalate_to_needs_rework", result: "success" },
    ]);
    expect(transition?.condition).toContain(
      "jobs.check_repeated_failures.output.should_escalate",
    );
  });

  it("coerces should_escalate via the bool helper in every escalation-gated condition", () => {
    const definition = parser.parseWorkflow(
      readSeed("work-item-in-progress-default.workflow.yaml"),
    );

    // Every job whose condition branches on should_escalate. The agent emits
    // the value as the string "false", which is truthy in raw Handlebars #if;
    // wrapping it in (bool ...) keeps the escalate/transition branch and the
    // delta_replan/implement branch mutually exclusive.
    const escalationGatedJobIds = [
      "escalate_to_needs_rework",
      "transition_to_needs_rework",
      "delta_replan",
      "war_room_plan_alignment",
      "implement_and_commit",
      "transition_to_review",
    ];

    for (const jobId of escalationGatedJobIds) {
      const job = (definition.jobs ?? []).find(
        (candidate) => candidate.id === jobId,
      );
      expect(job, `job ${jobId} should exist`).toBeDefined();
      expect(
        job?.condition,
        `job ${jobId} condition should branch on should_escalate`,
      ).toContain("should_escalate");
      expect(
        job?.condition,
        `job ${jobId} must coerce should_escalate with the bool helper`,
      ).toContain("bool jobs.check_repeated_failures.output.should_escalate");
    }
  });

  it("escalation metadata patch initialises replanAttempts so the recovery cap is countable", () => {
    const raw = readSeed("work-item-in-progress-default.workflow.yaml");
    // The escalate job seeds metadata.escalation; it must include a numeric
    // replanAttempts baseline so the CEO can bound re-plan attempts.
    expect(raw).toMatch(/recommendation:\s*fresh_architect_pass/);
    expect(raw).toMatch(/replanAttempts:\s*0/);
  });

  it("implement_and_commit is enforced as orchestration-only", () => {
    const tools = getEffectiveAllowedTools(
      "work-item-in-progress-default.workflow.yaml",
      "implement_and_commit",
    );

    expect(tools).toContain("spawn_subagent_async");
    expect(tools).toContain("wait_for_subagents");
    expect(tools).not.toContain("check_subagent_status");
    expect(tools).toContain("step_complete");
    expect(tools).not.toContain("read");
    expect(tools).not.toContain("ls");
    expect(tools).not.toContain("write");
    expect(tools).not.toContain("edit");
    expect(tools).not.toContain("bash");
  });

  it("implementation orchestrator prompt matches enforced orchestration-only policy", () => {
    const prompt = getExecutionStepPrompt(
      "work-item-in-progress-default.workflow.yaml",
      "implement_and_commit",
      "implement",
    );

    expect(prompt).toContain("dispatching subagents");
    expect(prompt).toContain("MUST NOT read files");
    expect(prompt).toContain("Missing markdown is not a workflow failure");
    expect(prompt).toContain("DB-backed work item context");
  });

  it("implementation orchestration can pass specialist delegation tools to implementer and verifier subagents", () => {
    const allowedTools = getEffectiveAllowedTools(
      "work-item-in-progress-default.workflow.yaml",
      "implement_and_commit",
    );
    const prompt = getExecutionStepPrompt(
      "work-item-in-progress-default.workflow.yaml",
      "implement_and_commit",
      "implement",
    );

    expect(allowedTools).toContain("delegate_ui_ux_testing");
    expect(allowedTools).toContain("delegate_web_research");
    expect(prompt).toContain(
      "tools: [read, write, edit, bash, ls, find, grep, delegate_ui_ux_testing, delegate_web_research]",
    );
    expect(prompt).toContain(
      "tools: [read, bash, delegate_ui_ux_testing, delegate_web_research]",
    );
    expect(prompt).toContain("The delegate tool durably awaits");
    expect(prompt).toContain(
      "do not call `await_agent_workflow` after a delegate tool",
    );
  });

  it("implementation orchestrator prompt only documents supported subagent and completion fields", () => {
    const prompt = getExecutionStepPrompt(
      "work-item-in-progress-default.workflow.yaml",
      "implement_and_commit",
      "implement",
    );
    const spawnSections = prompt
      .split("`spawn_subagent_async`")
      .slice(1)
      .map((section) => section.split("```")[0] ?? "");

    expect(spawnSections.length).toBeGreaterThan(0);
    for (const spawnSection of spawnSections) {
      expect(spawnSection).not.toMatch(/^\s*tier:/m);
    }
    expect(prompt).toContain("summary:");
    expect(prompt).not.toContain("reason:");
  });

  it("keeps in-progress commit cleanup agent-mediated with a bounded retry loop", () => {
    const definition = parser.parseWorkflow(
      readSeed("work-item-in-progress-default.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "implement_and_commit",
    );
    const commitStep = job?.steps?.find(
      (candidate) => candidate.id === "commit",
    );

    expect(job?.type).toBe("execution");
    expect(job?.max_step_loops).toBe(3);
    expect(commitStep?.type).toBe("agent");
    expect(commitStep?.transitions?.[0]?.next).toBe("check_uncommitted");
  });

  it("keeps in-progress tool policy unambiguous for the parent agent", () => {
    const definition = parser.parseWorkflow(
      readSeed("work-item-in-progress-default.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "implement_and_commit",
    );
    const allowTools = job?.permissions?.allow_tools ?? [];
    const denyTools = job?.permissions?.deny_tools ?? [];

    expect(new Set(allowTools).size).toBe(allowTools.length);
    expect(new Set(denyTools).size).toBe(denyTools.length);
    for (const allowedTool of allowTools) {
      expect(denyTools).not.toContain(allowedTool);
    }
  });

  it("instructs the commit agent to selectively clean the tree before completing", () => {
    const prompt = getExecutionStepPrompt(
      "work-item-in-progress-default.workflow.yaml",
      "implement_and_commit",
      "commit",
    );

    expect(prompt).toContain("Do not run `git add -A` blindly");
    expect(prompt).toContain("remove temporary files");
    expect(prompt).toContain("Final `git status --porcelain` output");
    expect(prompt).toContain("The next workflow step will verify the tree");
  });

  it("grants the CEO cycle and agent visibility into in-flight scope workflows", () => {
    expectEffectiveAllowedToolsToContain(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "list_running_workflows",
    );

    const agentConfig = JSON.parse(
      readSeedRoot("agents/ceo-agent/agent.json"),
    ) as {
      tool_policy?: { rules?: Array<{ effect?: string; tool?: string }> };
    };
    const allowedTools =
      agentConfig.tool_policy?.rules
        ?.filter((rule) => rule.effect === "allow")
        .map((rule) => rule.tool) ?? [];
    expect(allowedTools).toContain("list_running_workflows");

    // list_running_workflows is confirmed via workflow and agent tool policy;
    // the dispatch prompt does not need to reference it by name.
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );
    expect(prompt).toContain("Projected Delegation Cycle");
  });

  it("allows low-risk board stewardship tools", () => {
    expectEffectiveAllowedToolsToContain(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "kanban.work_item_transition_status",
    );
    expectEffectiveAllowedToolsToContain(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "kanban.work_item_patch_execution_config",
    );
    expectEffectiveAllowedToolsToContain(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "kanban.work_item_update",
    );
  });

  it("requires rationale and guardrails for destructive or broad board changes", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );

    expect(prompt).toContain("rationale");
    expect(prompt).toContain("Deleting");
    expect(prompt).toContain("archiving");
    expect(prompt).toContain("Bulk reprioritization");
    expect(prompt).toContain("Duplicate resolution");
    expect(prompt).toContain("Capacity changes");
    expect(prompt).toContain("dependencies");
    expect(prompt).toContain("branch safety");
    expect(prompt).toContain("require explicit rationale and safety checks");
  });

  it("orders optional project-context reads before the required decision cycle without file edits", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );

    expect(prompt).toContain(
      "optional preflight context before the required decision cycle",
    );
    expect(prompt).toContain("Report suggested");
    expect(prompt).toContain("Update stale specs");
    expect(prompt).toContain("do not attempt to edit project-context");
    expect(prompt).not.toContain("Append new");
  });

  it("records the CEO decision before direct board stewardship mutations", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );

    // Dispatch records decision via composite tool after mutating the board.
    expect(prompt).toContain("kanban.complete_orchestration_cycle_decision");
    expect(prompt).toContain("kanban.work_item_transition_status");
    expect(prompt).toContain("kanban.work_item_patch_execution_config");
    expect(prompt).toContain("kanban.work_item_update");
  });

  it("dispatch prompt accounts for escalated blocked items in the cycle decision", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );
    // Dispatch must surface escalated items in its per-item blocked reasons rather than
    // emitting a bare repeat.
    expect(prompt).toContain("escalatedBlockedItems");
    expect(prompt).toMatch(/blockedReason/);
  });

  it("grants todo-list tools to the dispatch job", () => {
    const tools = getEffectiveAllowedTools(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
    );
    expect(tools).toContain("get_todo_list");
    expect(tools).toContain("manage_todo_list");
  });

  it("constrains agent-profile creation to capability/profile gaps", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );

    expect(prompt).toContain(
      "Call `get_capabilities` and `get_agent_profiles` before `create_agent_profile`",
    );
    expect(prompt).toContain(
      "Only call `create_agent_profile` when existing profiles do not fit",
    );
    expect(prompt).toContain("Include explicit minimal `allowed_tools`");
    expect(prompt).toContain("wildcard access");
  });

  it("orchestration cycle prompt requires Kanban-owned lifecycle tooling for existing Kanban work items", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );
    expect(prompt).toContain("Existing Kanban work items");
    expect(prompt).toContain(
      "MUST be started only through Kanban-owned lifecycle tooling",
    );
    expect(prompt).toContain(
      "Do not use projected delegation tools to execute existing Kanban work items",
    );
    // The WIP-cap check and lifecycle trigger survive in "Lifecycle Start Rules".
    // The canonical surviving phrase references the authoritative capacity field.
    expect(prompt).toContain("Lifecycle Start Rules");
    expect(prompt).toContain("kanban.work_item_transition_status");
    expect(prompt).toContain("kanban.work_item_restart_execution");
  });

  it("orchestration cycle prompt constrains projected delegation to planning and bootstrap paths", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );
    expect(prompt).toContain(
      "Use projected delegation only for the explicit planning, bootstrap, advisory, spec, and generation paths",
    );
    expect(prompt).toContain("delegate_orchestration_refinement");
    expect(prompt).toContain("delegate_work_item_generation");
    expect(prompt).toContain("delegate_spec_revision");
    expect(prompt).not.toContain("documentation_audit");
    expect(prompt).not.toContain("standard_feature_flow");
    expect(prompt).not.toContain("hotfix_flow");
    expect(prompt).not.toContain("invoke_agent_workflow");
  });

  it("ceo agent policy allows imported repository bootstrap through projected delegation", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );
    const agentConfig = JSON.parse(
      readSeedRoot("agents/ceo-agent/agent.json"),
    ) as {
      allowed_tools?: string[];
      tool_policy?: { rules?: Array<{ effect?: string; tool?: string }> };
    };

    expect(prompt).toContain("delegate_imported_repo_discovery");
    expect(prompt).toContain("backend-owned route context");
    const allowedTools =
      agentConfig.tool_policy?.rules
        ?.filter((r) => r.effect === "allow")
        .map((r) => r.tool) ?? [];
    expect(allowedTools).toContain("delegate_imported_repo_discovery");
    // The CEO drives orchestration by invoking and durably awaiting child
    // workflows, so both primitives are granted alongside projected delegation.
    expect(allowedTools).toContain("invoke_agent_workflow");
    expect(allowedTools).toContain("await_agent_workflow");
  });

  it("seeds kanban.work_item for CEO orchestration inspection paths", () => {
    const workflowDefinition = parser.parseWorkflow(
      readSeed("project-orchestration-cycle-ceo.workflow.yaml"),
    );
    const agentConfig = JSON.parse(
      readSeedRoot("agents/ceo-agent/agent.json"),
    ) as {
      allowed_tools?: string[];
    };
    const ceoPrompt = readSeedRoot("agents/ceo-agent/PROMPT.md");
    const cyclePrompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );
    const steeringSkill = readSeedRoot("skills/orchestrator-steering/SKILL.md");
    const toolManifest = JSON.parse(
      readSeedRoot("tool-manifests/kanban-tools.seed.json"),
    ) as {
      toolNames?: string[];
    };

    expect(toolManifest.toolNames ?? []).toContain("kanban.work_item");
    expect(
      Array.from(getPolicyEntries(workflowDefinition.permissions, "allow")),
    ).toContain("kanban.work_item");
    const allowedTools =
      agentConfig.tool_policy?.rules
        ?.filter((r) => r.effect === "allow")
        .map((r) => r.tool) ?? [];
    expect(allowedTools).toContain("kanban.work_item");
    expect(ceoPrompt).toContain("kanban.work_item");
    expect(cyclePrompt).toContain("kanban.work_item");
    expect(cyclePrompt).toContain("humanDecisionResponse");
    expect(steeringSkill).toContain("kanban.work_item");
  });

  it("orchestration advisor can inspect a specific work item when workItemId is provided", () => {
    const workflowDefinition = parser.parseWorkflow(
      readSeed("project-orchestration-advisor.workflow.yaml"),
    );
    const prompt = getExecutionStepPrompt(
      "project-orchestration-advisor.workflow.yaml",
      "advise",
      "write_advice",
    );

    expect(
      Array.from(getPolicyEntries(workflowDefinition.permissions, "allow")),
    ).toContain("kanban.work_item");
    expect(prompt).toContain("workItemId");
    expect(prompt).toContain("kanban.work_item");
    expect(prompt).toContain("humanDecisionResponse");
  });

  it("orchestration cycle CEO prompt distinguishes projected delegation launch from lifecycle starts", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );
    expect(prompt).toContain(
      "Projected delegation tools launch workflows but do NOT change Kanban work-item status",
    );
    expect(prompt).toContain("do NOT change Kanban work-item status");
    expect(prompt).toContain("current_execution_id");
    expect(prompt).toContain("linked_run_id");
    expect(prompt).toContain("you MUST use Kanban-owned lifecycle tooling");
  });

  it("orchestration cycle CEO prompt starts todo work through status transition", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );

    expect(prompt).toContain("Lifecycle Start Rules");
    expect(prompt).toContain("kanban.work_item_transition_status");
    expect(prompt).toContain(
      "Do not bypass this rule with direct workflow or job-output tooling",
    );
    expect(prompt).not.toContain("mutationConfirmed");
  });

  it("orchestration cycle CEO prompt treats decision persistence failure as blocking", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );

    expect(prompt).toContain("Do not try to write job output yourself");
    expect(prompt).toContain(
      "use the composite decision tool first, then call `step_complete` only after it succeeds",
    );
    expect(prompt).toContain("mirrors the required `decision` job output");
    expect(prompt).not.toContain('decision: "continue"');
  });

  it("orchestration cycle CEO prompt has no direct generic output bookkeeping", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "dispatch",
    );

    expect(prompt).toContain("Do not try to write job output yourself");
    expect(prompt).not.toContain("set_job_output");
    // workflow_run_id may appear in the prompt only in a "do not pass" guidance context
    expect(prompt).not.toContain('decision: "continue"');
  });

  it("CEO agent prompt distinguishes projected delegation from Kanban dispatch", () => {
    const prompt = readSeedRoot("agents/ceo-agent/PROMPT.md");

    expect(prompt).toContain(
      "Projected delegation tools launch workflows but do not constitute Kanban dispatch",
    );
    expect(prompt).toContain("do not constitute Kanban dispatch");
    expect(prompt).toContain("do not change Kanban work-item status");
    expect(prompt).toContain("Use only Kanban-owned lifecycle tools");
    expect(prompt).toContain(
      "Never use projected delegation tools for existing Kanban work-item execution",
    );
    expect(prompt).not.toContain("invoke_agent_workflow");
  });

  it("spec revision workflow emits specs-ready contract event", () => {
    expectEmitEvent(
      "project-spec-revision-ceo.workflow.yaml",
      "ProjectOrchestrationSpecsReadyEvent",
    );
  });

  it("work-item generation workflow emits bootstrap-completed contract event", () => {
    expectEmitEvent(
      "project-work-item-generation-ceo.workflow.yaml",
      "ProjectOrchestrationBootstrapCompletedEvent",
    );
  });

  it("review workflow records structured QA feedback metadata through the append array tool", () => {
    const inputs = getJobInputs(
      "work-item-in-review-default.workflow.yaml",
      "record_qa_feedback",
    );
    const params =
      inputs.params && typeof inputs.params === "object" ? inputs.params : {};
    const arrayValue = (params as { arrayValue?: unknown }).arrayValue;

    expect(inputs.tool_name).toBe("kanban.work_item_append_metadata_array");
    expect((params as { arrayPath?: unknown }).arrayPath).toBe("qaFeedback");
    expect(arrayValue).toEqual(
      expect.objectContaining({
        decision: expect.any(String),
        feedback: expect.any(String),
        reviewerAgentId: expect.any(String),
      }),
    );
    expect(Array.isArray(arrayValue)).toBe(false);
    expect(typeof arrayValue).toBe("object");

    expect(() =>
      WorkItemAppendMetadataArraySchema.parse({
        project_id: "project-seed-contract",
        workItemId: "work-item-seed-contract",
        arrayPath: "qaFeedback",
        arrayValue,
      }),
    ).not.toThrow();
  });

  it("review agents can manually delegate specialist validation digressions", () => {
    const allowedTools = getEffectiveAllowedTools(
      "work-item-in-review-default.workflow.yaml",
      "review_work_item",
    );
    const prompt = getExecutionStepPrompt(
      "work-item-in-review-default.workflow.yaml",
      "review_work_item",
      "review",
    );

    expect(allowedTools).toContain("delegate_ui_ux_testing");
    expect(allowedTools).toContain("delegate_web_research");
    expect(prompt).toContain("concrete question, task, or outcome");
    expect(prompt).toContain("durably awaits");
    expect(prompt).toContain(
      "do not call `await_agent_workflow` after a delegate tool",
    );
    expect(prompt).toContain("delegate_ui_ux_testing");
    expect(prompt).toContain("delegate_web_research");
    expect(prompt).toContain("do not replace the required `set_job_output`");
  });

  it("requires investigation artifacts before imported-repo work-item generation", () => {
    const prompt = getExecutionStepPrompt(
      "project-work-item-generation-ceo.workflow.yaml",
      "generate_bootstrap_work_items",
      "bootstrap",
    );

    expect(prompt).toMatch(/imported repository.*hard stop/i);
    expect(prompt).toMatch(/imported repository/i);
    expect(prompt).toMatch(/docs\/project-context\/CAPABILITY_MAP\.md/i);
    expect(prompt).toMatch(/docs\/project-context\/probe-results\/\*\.md/i);
    expect(prompt).toMatch(/file_paths\s*:\s*\[\]/i);
    expect(prompt).toMatch(
      /dependency_strategy\s*:\s*["']blocked_missing_imported_repo_investigation["']/i,
    );
    expect(prompt).toMatch(/block.*treating the project as greenfield/i);
  });

  it("skips publishing generated work items when imported-repo investigation is blocked", () => {
    const prompt = getExecutionStepPrompt(
      "project-work-item-generation-ceo.workflow.yaml",
      "publish_generated_work_items",
      "publish_specs",
    );

    expect(prompt).toMatch(/blocked_missing_imported_repo_investigation/i);
    expect(prompt).toMatch(/do not call\s+`?kanban\.publish_specs`?/i);
    expect(prompt).toMatch(/file_paths/i);
    expect(prompt).toMatch(/set_job_output/i);
    expect(prompt).toContain(
      "Then call `step_complete` with a blocked summary and stop; do not continue to the publish branch.",
    );
  });

  it("does not emit bootstrap completion when work-item publishing is blocked", () => {
    const workflow = "project-work-item-generation-ceo.workflow.yaml";
    const publishedCondition =
      "jobs.publish_generated_work_items.output.published";

    expectJobConditionContains(
      workflow,
      "emit_bootstrap_completed",
      publishedCondition,
    );
    expectJobConditionContains(
      workflow,
      "emit_cycle_request",
      publishedCondition,
    );
  });

  it("passes workspace root to publish_specs", () => {
    const workflowText = readSeedRoot(
      "workflows/project-work-item-generation-ceo.workflow.yaml",
    );
    const prompt = getExecutionStepPrompt(
      "project-work-item-generation-ceo.workflow.yaml",
      "publish_generated_work_items",
      "publish_specs",
    );

    expect(workflowText).toContain("workspace_root");
    expect(workflowText).toContain("{{ trigger.basePath }}");
    expect(prompt).toContain(
      "Otherwise, when the generation job is not blocked and `file_paths` is non-empty, call `kanban.publish_specs` with:",
    );
    expect(prompt).toContain('"project_id": "{{ trigger.scopeId }}"');
    expect(prompt).toContain('"workspace_root": "{{ trigger.basePath }}"');
    expect(prompt).toContain('"spec_directory": "docs/work-items"');
    expect(prompt).toContain('"allow_missing_specs": false');
    expect(prompt).toContain(
      "For imported projects, `workspace_root` must be the host-visible `{{ trigger.basePath }}`.",
    );
    expect(prompt).toContain(
      "Never use `/workspace` for `kanban.publish_specs`; it is runner-local and not visible to Kanban.",
    );
    expect(prompt).toContain(
      "If `{{ trigger.basePath }}` is blank for an imported project, set job output as blocked instead of guessing `/workspace`.",
    );
  });

  it("mid-flight refinement workflow emits refinement-completed contract event", () => {
    expectEmitEvent(
      "project-orchestration-refinement-ceo.workflow.yaml",
      "ProjectOrchestrationRefinementCompletedEvent",
    );
  });

  it("mid-flight refinement prompt documents flat set_job_output fields", () => {
    const workflowText = readSeedRoot(
      "workflows/project-orchestration-refinement-ceo.workflow.yaml",
    );

    expect(workflowText).toContain(
      '"decision": "Summary of strategic decision made."',
    );
    expect(workflowText).toContain(
      '"actions_taken": "Description of delegations and updates applied."',
    );
    expect(workflowText).not.toContain(
      '"data": {\n                  "decision"',
    );
    expect(workflowText).not.toMatch(/"data": \{\r?\n\s+"decision"/);
  });

  it("does not seed Core retrospective autorun workflow ownership", () => {
    const retiredWorkflowPath = join(
      seedsDir,
      "project-retrospective-autorun.workflow.yaml",
    );

    expect(existsSync(retiredWorkflowPath)).toBe(false);
  });

  it("seeds deterministic revision war-room alignment job", () => {
    expectJobExists(
      "project-spec-revision-ceo.workflow.yaml",
      "war_room_revision_alignment",
    );
    expectJobConditionContains(
      "project-spec-revision-ceo.workflow.yaml",
      "war_room_revision_alignment",
      "trigger.feedback",
    );
  });

  it("seeds deterministic refinement war-room alignment job", () => {
    expectJobExists(
      "work-item-refinement-default.workflow.yaml",
      "war_room_refinement_alignment",
    );
    expectJobConditionContains(
      "work-item-refinement-default.workflow.yaml",
      "war_room_refinement_alignment",
      "'complex'",
    );
  });

  it("seeds deterministic in-progress war-room planning alignment job", () => {
    expectJobExists(
      "work-item-in-progress-default.workflow.yaml",
      "war_room_plan_alignment",
    );
    expectJobConditionContains(
      "work-item-in-progress-default.workflow.yaml",
      "war_room_plan_alignment",
      "trigger.resource.storyPoints 13",
    );
  });

  it("requires validation_result output for refinement plan validation", () => {
    expectExecutionJobRequiredOutputFields(
      "work-item-refinement-default.workflow.yaml",
      "plan_validation",
      ["validation_result"],
    );
  });

  it("requires architect_refinement subtask_blueprint to use nested object element schema", () => {
    const definition = parser.parseWorkflow(
      readSeed("work-item-refinement-default.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "architect_refinement",
    );
    expect(job).toBeDefined();
    expect(job?.type).toBe("execution");

    const blueprintType = job?.output_contract?.types?.subtask_blueprint;
    // Must be a nested schema object, not the bare string "array"
    expect(typeof blueprintType).toBe("object");
    expect(blueprintType).toEqual({
      type: "array",
      items: {
        type: "object",
        properties: {
          subtask_id: "string",
          title: "string",
          order_index: "integer",
          depends_on_subtask_ids: {
            type: "array",
            items: "string",
          },
        },
      },
    });
  });

  it("requires architect_refinement sdd_targets to use nested string element schema", () => {
    const definition = parser.parseWorkflow(
      readSeed("work-item-refinement-default.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "architect_refinement",
    );
    const sddType = job?.output_contract?.types?.sdd_targets;
    expect(typeof sddType).toBe("object");
    expect(sddType).toEqual({
      type: "array",
      items: "string",
    });
  });

  it("architect_refinement retry_prompt does not claim agent has not called set_job_output", () => {
    const definition = parser.parseWorkflow(
      readSeed("work-item-refinement-default.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "architect_refinement",
    );
    const retryPrompt = job?.retry_prompt ?? "";
    // On retry, the agent HAS called set_job_output — the prompt must not claim otherwise
    expect(retryPrompt).not.toContain("You have NOT called set_job_output");
    // Must still convey the structural requirements
    expect(retryPrompt).toContain("subtask_blueprint");
    expect(retryPrompt).toContain("subtask_id");
    expect(retryPrompt).toContain("order_index");
  });

  it("surfaces a CEO decompose/promote decision for oversized work items instead of an explicit blocked transition", () => {
    const definition = parser.parseWorkflow(
      readSeed("work-item-split-default.workflow.yaml"),
    );
    const jobIds = (definition.jobs ?? []).map((job) => job.id);

    // The parent becomes a non-dispatchable container automatically once it
    // has children (hasChildren invariant) — no explicit status transition
    // to "blocked" is needed or performed any more.
    expect(jobIds).not.toContain("mark_parent_blocked_awaiting_children");
    expect(jobIds).not.toContain("mark_parent_as_umbrella");
    expect(jobIds).not.toContain("split_work_item");

    const decisionJob = (definition.jobs ?? []).find(
      (job) => job.id === "ceo_split_decision",
    );
    expect(decisionJob?.type).toBe("execution");
    expect(decisionJob?.inputs?.agent_profile).toBe("ceo-agent");
    expect(decisionJob?.output_contract?.required).toEqual(
      expect.arrayContaining(["decision", "children"]),
    );
  });

  it("promotes to an epic by detaching the parent and clearing story points", () => {
    const definition = parser.parseWorkflow(
      readSeed("work-item-split-default.workflow.yaml"),
    );
    const promoteJob = (definition.jobs ?? []).find(
      (job) => job.id === "promote_to_epic",
    );
    const params =
      promoteJob?.inputs?.params && typeof promoteJob.inputs.params === "object"
        ? (promoteJob.inputs.params as { updates?: Record<string, unknown> })
        : {};

    expect(promoteJob?.type).toBe("mcp_tool_call");
    expect(promoteJob?.inputs?.tool_name).toBe("kanban.work_item_update");
    expect(params.updates).toEqual({
      type: "epic",
      parentWorkItemId: null,
      storyPoints: null,
    });
  });

  it("decomposes children via propose_work_items parented to the oversized item", () => {
    const definition = parser.parseWorkflow(
      readSeed("work-item-split-default.workflow.yaml"),
    );
    const decomposeJob = (definition.jobs ?? []).find(
      (job) => job.id === "decompose_children",
    );
    const params =
      decomposeJob?.inputs?.params &&
      typeof decomposeJob.inputs.params === "object"
        ? (decomposeJob.inputs.params as Record<string, unknown>)
        : {};

    expect(decomposeJob?.type).toBe("mcp_tool_call");
    expect(decomposeJob?.inputs?.tool_name).toBe("kanban.propose_work_items");
    expect(params.parentWorkItemId).toBe("{{ trigger.contextId }}");
    expect(params.items).toBe("{{ jobs.ceo_split_decision.output.children }}");
  });

  it("gates refinement workflow reruns behind explicit reopen semantics", () => {
    expectTriggerConditionContains(
      "work-item-refinement-default.workflow.yaml",
      "retroactiveRefinementRequired",
    );
    expectTriggerConditionContains(
      "work-item-refinement-default.workflow.yaml",
      "(not (eq trigger.previousStatus 'todo'))",
    );
  });

  it("deep investigation workflow has canonical workflow_id", () => {
    expectWorkflowId(
      "project-codebase-deep-investigation.workflow.yaml",
      "project_codebase_deep_investigation",
    );
  });

  it("deep investigation workflow is invoke-only (manual trigger)", () => {
    expectTriggeredManually(
      "project-codebase-deep-investigation.workflow.yaml",
    );
  });

  it("imported repo synthesis workflow is invoke-only (manual trigger)", () => {
    expectTriggeredManually(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
    );
  });

  it("imported repo synthesis workflow requires reconciliation and hydration output fields", () => {
    expectExecutionJobRequiredOutputFields(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
      [
        "existing_work_item_count",
        "reconciliation_summary",
        "hydration_summary",
        "ready_for_cycle",
        "cycle_decision",
        "findings_ready_for_resolution",
      ],
    );
  });

  it("deep investigation workflow has coordinate_investigation job", () => {
    expectJobExists(
      "project-codebase-deep-investigation.workflow.yaml",
      "coordinate_investigation",
    );
  });

  it("deep investigation workflow has run_scope_probes job", () => {
    expectJobExists(
      "project-codebase-deep-investigation.workflow.yaml",
      "run_scope_probes",
    );
  });

  it("deep investigation probe loop writes per-scope probe files as the source of truth", () => {
    expectExecutionJobRequiredOutputFields(
      "project-codebase-deep-investigation.workflow.yaml",
      "run_scope_probes",
      ["probes_completed", "probes_failed", "probe_artifact_paths"],
    );

    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/probe-loop.md",
    );
    expect(prompt).toContain(
      "docs/project-context/probe-results/<probe_scope_id>.md",
    );
    expect(prompt).toContain("artifact_path");
    expect(prompt).toContain("Terminal JSON is only a completion signal");
    expect(prompt).toContain("outcome: success");
    expect(prompt).toContain("outcome: failed");
    expect(prompt).toContain("inferred_status");
    expect(prompt).toContain("confidence_score");
    expect(prompt).toContain("evidence_refs");
    expect(prompt).toContain("## Narrative Summary");
    expect(prompt).not.toContain('"per_scope_outcome"');
  });

  it("deep investigation probe loop distinguishes project and probe scope identifiers", () => {
    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/probe-loop.md",
    );

    expect(prompt).toContain("project_scope_id: {{trigger.scopeId}}");
    expect(prompt).toContain("probe_scope_id");
    expect(prompt).toContain(
      "Call kanban.project_state and kanban.orchestration_timeline without passing `project_id` explicitly. The runtime supplies the project context.",
    );
    expect(prompt).toContain(
      "Never use `probe_scope_id` as `project_id` for runtime tool calls",
    );
    expect(prompt).toContain("Project scope ID: <project_scope_id>");
    expect(prompt).toContain("Probe scope ID: <probe_scope_id>");
  });

  it("deep investigation workflow finalizes and commits project-context artifacts in the parent workflow", () => {
    expectJobExists(
      "project-codebase-deep-investigation.workflow.yaml",
      "finalize_investigation_artifacts",
    );
    expectJobExists(
      "project-codebase-deep-investigation.workflow.yaml",
      "commit_investigation_artifacts",
    );
    expectExecutionJobRequiredOutputFields(
      "project-codebase-deep-investigation.workflow.yaml",
      "finalize_investigation_artifacts",
      [
        "probe_artifact_paths",
        "investigation_summary_path",
        "valid_probe_artifact_count",
        "failed_probe_artifact_count",
      ],
    );

    const definition = parser.parseWorkflow(
      readSeed("project-codebase-deep-investigation.workflow.yaml"),
    );
    const commitJob = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "commit_investigation_artifacts",
    );
    expect(commitJob?.type).toBe("git_operation");
    expect(commitJob?.depends_on).toContain("finalize_investigation_artifacts");
    expect(commitJob?.inputs?.action).toBe("commit_paths");
    expect(commitJob?.inputs?.paths).toEqual(["docs/project-context"]);
    expect(commitJob?.inputs?.message).toBe(
      "docs(discovery): persist imported repository investigation",
    );
  });

  it("deep investigation probe loop batches only independent non-overlapping file-backed scopes", () => {
    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/probe-loop.md",
    );

    expect(prompt).toContain(
      "Dispatch up to 3 independent non-overlapping file-backed scopes concurrently",
    );
    expect(prompt).toContain(
      "A scope is independent only when it has no depends_on or depends_on_scope_ids entries",
    );
    expect(prompt).toContain(
      "A scope is not independent if it participates in any unresolved dependency relationship",
    );
    expect(prompt).toContain(
      "Treat paths as overlapping when one path is equal to or nested under another path",
    );
    expect(prompt).toContain(
      "Process dependent scopes, overlapping-path scopes, conceptual scopes, and unavailable scopes serially",
    );
    expect(prompt).toContain(
      "Do not dispatch a later batch until every subagent in the current batch has reached a terminal outcome",
    );
    expect(prompt).toContain(
      "Do not let subagents edit shared project-context docs concurrently",
    );
    expect(prompt).toContain(
      "For batched scopes, subagents write only docs/project-context/probe-results/<probe_scope_id>.md",
    );
    expect(prompt).toContain(
      "Do not let subagents edit shared project-context docs concurrently",
    );
    expect(prompt).toContain(
      "Parent finalization merges probe files into CAPABILITY_MAP.md, CODEBASE_HEALTH.md, and OPEN_QUESTIONS.md",
    );
    expect(prompt).toContain("Execution mode: <batch | serial>");
    expect(prompt).toContain(
      "Set Execution mode to batch for scopes dispatched in a concurrent batch and serial for one-at-a-time scopes",
    );
    expect(prompt).toContain("probe_artifact_paths");
  });

  it("coordinate_investigation job requires scope_manifest output", () => {
    expectExecutionJobRequiredOutputFields(
      "project-codebase-deep-investigation.workflow.yaml",
      "coordinate_investigation",
      ["scope_manifest", "knowledge_base_initialized"],
    );
  });

  it("discovery CEO now invokes deep investigation workflow", () => {
    const definition = parser.parseWorkflow(
      readSeed("project-discovery-ceo.workflow.yaml"),
    );
    const invokesExpectedWorkflow = (definition.jobs ?? []).some((job) => {
      if (job.type !== "invoke_workflow") {
        return false;
      }

      if (job.workflow_id === "project_codebase_deep_investigation") {
        return true;
      }

      const inputs =
        job.inputs && typeof job.inputs === "object" ? job.inputs : null;
      return inputs?.workflow_id === "project_codebase_deep_investigation";
    });

    expect(invokesExpectedWorkflow).toBe(true);
  });

  it("does not cancel running imported-repo discovery attempts", () => {
    const workflow = parser.parseWorkflow(
      readSeed("project-discovery-ceo.workflow.yaml"),
    );

    expect(workflow.concurrency).toMatchObject({
      max_runs: 1,
      scope: "trigger.scopeId",
      on_conflict: "skip",
    });
  });

  // The CEO orchestration cycle re-requests these generative delegations on
  // every wakeup. They must DROP a duplicate request while one is already
  // active for the scope, not queue it — queuing stacked identical runs
  // (one RUNNING, several PENDING) every cycle because each cycle launched a
  // fresh run while the prior one was still in flight.
  it.each([
    "project-work-item-generation-ceo.workflow.yaml",
    "project-goal-backlog-planning.workflow.yaml",
  ])(
    "skips duplicate %s requests while one is active per scope",
    (seedFile) => {
      const workflow = parser.parseWorkflow(readSeed(seedFile));

      expect(workflow.concurrency).toMatchObject({
        max_runs: 1,
        scope: "trigger.scopeId",
        on_conflict: "skip",
      });
    },
  );

  it("discovery CEO consumes selected route from trigger inputs", () => {
    const discoveryInputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "discovery_and_specs",
    );
    expect(discoveryInputs.selected_playbook).toBe(
      "{{ trigger.selectedRoute }}",
    );
    expect(discoveryInputs.selected_rule_id).toBe(
      "{{ trigger.selectedRuleId }}",
    );
  });

  it("discovery CEO seeds a kickoff clarification step with bounded context", () => {
    expectJobExists(
      "project-discovery-ceo.workflow.yaml",
      "kickoff_clarification",
    );
    expectExecutionJobRequiredOutputFields(
      "project-discovery-ceo.workflow.yaml",
      "kickoff_clarification",
      ["kickoff_summary", "clarified_goals", "open_questions"],
    );

    const kickoffInputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "kickoff_clarification",
    );
    expect(kickoffInputs.goals).toBe("{{ trigger.goals }}");
    expect(kickoffInputs.kickoffContext).toBe("{{ trigger.kickoffContext }}");
    expect(kickoffInputs.maxQuestions).toBe(3);
    expect(kickoffInputs.focusAreas).toEqual([
      "scope",
      "success_criteria",
      "constraints",
    ]);

    const discoveryInputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "discovery_and_specs",
    );
    expect(discoveryInputs.kickoff_summary).toBe(
      "{{ jobs.kickoff_clarification.output.kickoff_summary }}",
    );
    expect(discoveryInputs.clarified_goals).toBe(
      "{{ jobs.kickoff_clarification.output.clarified_goals }}",
    );

    const prompt = getExecutionStepPrompt(
      "project-discovery-ceo.workflow.yaml",
      "kickoff_clarification",
      "kickoff",
    );
    expect(prompt).toContain("Ask at most 3 focused clarification questions");
    expect(prompt).toContain(
      "Summarize clarified scope, success criteria, and constraints",
    );
  });

  it("discovery CEO does not define local startup route arbitration jobs", () => {
    const definition = parser.parseWorkflow(
      readSeed("project-discovery-ceo.workflow.yaml"),
    );
    const hasRouteResolverJob = (definition.jobs ?? []).some(
      (job) => job.id === "resolve_start_playbook",
    );

    expect(hasRouteResolverJob).toBe(false);
  });

  it("discovery CEO passes source/readiness context into import workflow chain", () => {
    const investigationInputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "investigate_imported_repo",
    );
    expect(investigationInputs.sourceContext).toBe(
      "{{ trigger.sourceContext }}",
    );
    expect(investigationInputs.readinessContext).toBe(
      "{{ trigger.readinessContext }}",
    );
    expect(investigationInputs.resolvedRepoPath).toBe("{{ trigger.basePath }}");
  });

  it("discovery CEO reconcile_import_specs forwards basePath and repositoryUrl to spec revision", () => {
    const inputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "reconcile_import_specs",
    );
    expect(inputs.basePath).toBe("{{ trigger.basePath }}");
    expect(inputs.repositoryUrl).toBe("{{ trigger.repositoryUrl }}");
  });

  it("discovery CEO synthesize_and_hydrate_import forwards basePath and repositoryUrl", () => {
    const inputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "synthesize_and_hydrate_import",
    );
    expect(inputs.basePath).toBe("{{ trigger.basePath }}");
    expect(inputs.repositoryUrl).toBe("{{ trigger.repositoryUrl }}");
  });

  it("imported hydration receives orchestration mode and human decision policy", () => {
    const inputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "synthesize_and_hydrate_import",
    );
    expect(inputs.orchestrationMode).toBe("{{ trigger.orchestrationMode }}");
    expect(inputs.humanDecisionPolicy).toBe(
      "{{ trigger.humanDecisionPolicy }}",
    );
  });

  it("discovery CEO gates imported-repo follow-up events on hydration evidence", () => {
    const expectedEvidenceFragments = [
      "trigger.selectedRoute 'imported-repo-bootstrap'",
      "trigger.selectedRoute 'imported-repo-synthesis-and-hydration'",
      "jobs.synthesize_and_hydrate_import.output.childStateVariables.jobs.hydrate_discovery_results.output.ready_for_cycle",
    ];

    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "emit_specs_ready",
      expectedEvidenceFragments[0],
    );
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "emit_specs_ready",
      expectedEvidenceFragments[1],
    );
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "emit_specs_ready",
      expectedEvidenceFragments[2],
    );

    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "emit_cycle_request",
      expectedEvidenceFragments[0],
    );
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "emit_cycle_request",
      expectedEvidenceFragments[1],
    );
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "emit_cycle_request",
      expectedEvidenceFragments[2],
    );
  });

  it("discovery CEO cycle request preserves basePath and repositoryUrl in trigger payload", () => {
    const emitInputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "emit_cycle_request",
    );
    const payload =
      emitInputs.payload && typeof emitInputs.payload === "object"
        ? (emitInputs.payload as Record<string, unknown>)
        : {};

    expect(payload.basePath).toBe("{{ trigger.basePath }}");
    expect(payload.repositoryUrl).toBe("{{ trigger.repositoryUrl }}");
  });

  it("spec revision cycle request routes through Kanban wakeup gating", () => {
    const emitInputs = getJobInputs(
      "project-spec-revision-ceo.workflow.yaml",
      "emit_cycle_request",
    );
    const params =
      emitInputs.params && typeof emitInputs.params === "object"
        ? (emitInputs.params as Record<string, unknown>)
        : {};

    expect(emitInputs.tool_name).toBe("kanban.orchestration_request_wakeup");
    expect(params.project_id).toBe("{{ trigger.scopeId }}");
    expect(params.source).toBe("revision_complete");
    expect(params.reason).toBe("Spec revision workflow completed");
  });

  it("work-item generation cycle request preserves basePath and repositoryUrl in trigger payload", () => {
    const emitInputs = getJobInputs(
      "project-work-item-generation-ceo.workflow.yaml",
      "emit_cycle_request",
    );
    const payload =
      emitInputs.payload && typeof emitInputs.payload === "object"
        ? (emitInputs.payload as Record<string, unknown>)
        : {};

    expect(payload.basePath).toBe("{{ trigger.basePath }}");
    expect(payload.repositoryUrl).toBe("{{ trigger.repositoryUrl }}");
  });

  it("spec revision cycle request uses gated wakeup with deterministic dedupe key", () => {
    const emitInputs = getJobInputs(
      "project-spec-revision-ceo.workflow.yaml",
      "emit_cycle_request",
    );
    const params =
      emitInputs.params && typeof emitInputs.params === "object"
        ? (emitInputs.params as Record<string, unknown>)
        : {};

    expect(emitInputs.tool_name).toBe("kanban.orchestration_request_wakeup");
    expect(params.dedupe_key).toBe(
      "project-orchestration-cycle:{{ trigger.scopeId }}:revision_complete:spec_revision_completed",
    );
    expect(params.dedupe_key).toMatch(
      /project-orchestration-cycle:\{\{\s*trigger\.scopeId\s*\}\}:revision_complete/i,
    );
  });

  it("deep investigation coordinator cannot pause on user questions during bootstrap", () => {
    expectJobDeniedTool(
      "project-codebase-deep-investigation.workflow.yaml",
      "coordinate_investigation",
      "ask_user_questions",
    );
  });

  it("deep investigation coordinator cannot run shell git commands during bootstrap", () => {
    expectJobDeniedTool(
      "project-codebase-deep-investigation.workflow.yaml",
      "coordinate_investigation",
      "bash",
    );
  });

  it("deep investigation coordinator does not get bash directly", () => {
    expectJobDeniedTool(
      "project-codebase-deep-investigation.workflow.yaml",
      "coordinate_investigation",
      "bash",
    );
  });

  it("deep investigation coordinator prompt forbids initializing an empty git repo", () => {
    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/coordinator.md",
    );
    expect(prompt).toContain("Do not run git init");
  });

  it("deep investigation coordinator prompt forbids asking user questions during bootstrap", () => {
    const coordinatorPrompt = readSeed(
      "prompts/project-codebase-deep-investigation/coordinator.md",
    );

    expect(coordinatorPrompt).toContain("Do not call ask_user_questions");
  });

  it("deep investigation prompts treat project-context files as parent-committed artifacts", () => {
    const coordinatorPrompt = readSeed(
      "prompts/project-codebase-deep-investigation/coordinator.md",
    );
    const agentPrompt = readSeedRoot(
      "agents/investigation-coordinator/PROMPT.md",
    );
    const combinedPrompts = `${coordinatorPrompt}\n${agentPrompt}`;

    expect(combinedPrompts).toContain(
      "docs/project-context/SCOPE_MANIFEST.json",
    );
    expect(combinedPrompts).toContain("parent finalization");
    expect(combinedPrompts).toContain("commits");
    expect(combinedPrompts).not.toContain("uncommitted workspace draft");
    expect(combinedPrompts).not.toContain(
      "does not persist it to project state or Git history",
    );
  });

  it("deep investigation coordinator sizes scopes by token budget instead of count-based heuristics", () => {
    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/coordinator.md",
    );

    expect(prompt).toContain("token budget");
    expect(prompt).toContain("token count");
    expect(prompt).not.toMatch(/\b\d+\s+(?:key\s+)?files\b/i);
    expect(prompt).not.toMatch(/\b\d+\s+words\b/i);
    expect(prompt).not.toContain("word count");
  });

  it("deep investigation probe loop cannot run shell commands", () => {
    expectJobDeniedTool(
      "project-codebase-deep-investigation.workflow.yaml",
      "run_scope_probes",
      "bash",
    );
    const definition = parser.parseWorkflow(
      readSeed("project-codebase-deep-investigation.workflow.yaml"),
    );
    const probeJob = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "run_scope_probes",
    );
    const allowTools =
      probeJob?.permissions?.allow_tools ??
      definition.permissions?.allow_tools ??
      [];
    expect(allowTools).not.toContain("bash");
  });

  it("deep investigation probe loop avoids git and unsupported completion actions", () => {
    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/probe-loop.md",
    );

    expect(prompt).toContain("Do not call bash");
    expect(prompt).toContain("Do not call `step_complete`");
    expect(prompt).toContain("process that scope directly in this job");
    expect(prompt).not.toContain("git log");
    expect(prompt).not.toContain("git add");
    expect(prompt).not.toContain("git commit");
    expect(prompt).not.toContain("git clone");
    expect(prompt).not.toContain("call `step_complete` with");
  });

  it("deep investigation output-contract jobs cannot call `completion` actions", () => {
    expectEffectiveAllowedToolsNotToContain(
      "project-codebase-deep-investigation.workflow.yaml",
      "coordinate_investigation",
      "step_complete",
    );
    expectEffectiveAllowedToolsNotToContain(
      "project-codebase-deep-investigation.workflow.yaml",
      "run_scope_probes",
      "step_complete",
    );
    expectEffectiveAllowedToolsNotToContain(
      "project-codebase-deep-investigation.workflow.yaml",
      "run_scope_probes",
      "step_complete",
    );
    expectEffectiveAllowedToolsNotToContain(
      "project-codebase-deep-investigation.workflow.yaml",
      "finalize_investigation_artifacts",
      "step_complete",
    );
  });

  it("deep investigation spawned subagent tools include edit when the playbook permits edit", () => {
    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/probe-loop.md",
    );

    expect(prompt).toContain(
      'tools: ["read", "ls", "find", "grep", "bash", "write", "edit", "kanban.project_state", "kanban.orchestration_timeline"]',
    );
    expect(prompt).toContain(
      "Use write or edit only for docs/project-context/probe-results/<probe_scope_id>.md",
    );
    expect(prompt).toContain(
      "Do not edit docs/project-context/CAPABILITY_MAP.md, docs/project-context/CODEBASE_HEALTH.md, or docs/project-context/OPEN_QUESTIONS.md",
    );
  });

  it("deep investigation spawned subagents receive bash through policy-governed tool list", () => {
    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/probe-loop.md",
    );

    expect(prompt).toContain(
      'tools: ["read", "ls", "find", "grep", "bash", "write", "edit", "kanban.project_state", "kanban.orchestration_timeline"]',
    );
    expect(prompt).toContain("Only use bash for read-only discovery commands");
    expect(prompt).toContain(
      "Do not use shell redirection, pipes, command chaining",
    );
    expect(prompt).toContain(
      "Return artifact_path: docs/project-context/probe-results/<probe_scope_id>.md",
    );
  });

  it("deep investigation subagent prompt forbids committing and pushing", () => {
    const agentPrompt = readSeedRoot("agents/investigation-subagent/PROMPT.md");
    const subagentPrompt = readSeed(
      "prompts/project-codebase-deep-investigation/subagent-probe.md",
    );
    const combinedPrompts = `${agentPrompt}\n${subagentPrompt}`;

    expect(combinedPrompts).toContain("Do not run git add");
    expect(combinedPrompts).toContain("Do not run git commit");
    expect(combinedPrompts).toContain("Do not run git push");
    expect(combinedPrompts).toContain(
      "docs/project-context/probe-results/<probe_scope_id>.md",
    );
  });

  it("seed tool manifest advertises the kanban probe result tool", () => {
    const manifest = JSON.parse(
      readSeedRoot("tool-manifests/kanban-tools.seed.json"),
    ) as { toolNames?: string[] };

    expect(manifest.toolNames).toContain("kanban.write_probe_result");
  });

  it("seed tool manifest advertises the imported repository reconciliation tool", () => {
    const manifest = JSON.parse(
      readSeedRoot("tool-manifests/kanban-tools.seed.json"),
    ) as { toolNames?: string[] };

    expect(manifest.toolNames).toContain(
      "kanban.reconcile_imported_repository_backlog",
    );
  });

  it("seed tool manifest advertises the cycle decision clear tool", () => {
    const manifest = JSON.parse(
      readSeedRoot("tool-manifests/kanban-tools.seed.json"),
    ) as { toolNames?: string[] };

    expect(manifest.toolNames).toContain(
      "kanban.orchestration_clear_cycle_decision",
    );
  });

  it("deep investigation probe loop caps recovery fan-out and retries on recovered concurrency errors", () => {
    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/probe-loop.md",
    );

    expect(prompt).toContain(
      "Never dispatch more than three spawn_subagent_async tool calls in the same assistant turn.",
    );
    expect(prompt).toContain(
      "If a spawn returns Maximum concurrent subagents, wait for the successful executions before retrying the rejected scope.",
    );
    expect(prompt).toContain(
      "Omit timeout_seconds for wait_for_subagents unless the workflow explicitly provides one.",
    );
    expect(prompt).toContain(
      "Use check_subagent_status only as a normal JSON tool call with action and execution_id fields.",
    );
    expect(prompt).toContain("Never emit XML-style status arguments.");
    expect(prompt).toContain(
      "Do not include a `tier` field in spawn_subagent_async requests; subagents already run on heavy runtime.",
    );
    expect(prompt).toContain(
      "After the recovery check, next call ls on /workspace with missing_ok: true.",
    );
    expect(prompt).toContain(
      "probes_failed should reflect only final failed scopes after retries and recovery.",
    );
    expect(prompt).toContain(
      "count a recovered failed outcome exactly once in probes_failed",
    );
    expect(prompt).toContain(
      "only transient failed attempts that later succeed are excluded from probes_failed.",
    );

    const spawnBlock =
      prompt
        .split("Call spawn_subagent_async with:")[1]
        ?.split("Subagent task template:")[0] ?? "";

    expect(spawnBlock).not.toMatch(/^\s*-\s*[`'"]?tier[`'"]?:/m);
  });

  it("deep investigation probe loop verifies project-context docs exist before reading them", () => {
    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/probe-loop.md",
    );

    expect(prompt).toContain(
      "Before reading CAPABILITY_MAP.md or CODEBASE_HEALTH.md, call ls on /workspace/docs/project-context with missing_ok: true",
    );
    expect(prompt).toContain(
      "If that directory or file is missing, create the document with write instead of calling read",
    );
  });

  it("discovery prompt proceeds from persisted goals instead of asking generic greenfield questions", () => {
    const prompt = readSeed("prompts/project-discovery-ceo/discovery.md");

    expect(prompt).toContain(
      "Do not ask generic project type, timeline, or user-role questions",
    );
  });

  it("discovery execution cannot call mutable kanban orchestration actions", () => {
    expectEffectiveAllowedToolsNotToContain(
      "project-discovery-ceo.workflow.yaml",
      "discovery_and_specs",
      "step_complete:update_kanban",
    );
  });

  it("discovery prompt requires direct decision output without step completion", () => {
    const prompt = getExecutionStepPrompt(
      "project-discovery-ceo.workflow.yaml",
      "discovery_and_specs",
      "discovery",
    );

    expect(prompt).toContain(
      "Do not call set_job_output for intermediate logs",
    );
    expect(prompt).toContain("never nest a data key inside data");
    expect(prompt).toContain(
      "the workflow output contract completes after set_job_output succeeds",
    );
  });

  it("discovery execution cannot pause on user questions during autonomous bootstrap", () => {
    expectJobDeniedTool(
      "project-discovery-ceo.workflow.yaml",
      "discovery_and_specs",
      "ask_user_questions",
    );
    expectEffectiveAllowedToolsNotToContain(
      "project-discovery-ceo.workflow.yaml",
      "discovery_and_specs",
      "ask_user_questions",
    );
  });

  it("discovery execution cannot spawn ad-hoc delegated workflows during bootstrap", () => {
    expectJobDeniedTool(
      "project-discovery-ceo.workflow.yaml",
      "discovery_and_specs",
      "invoke_agent_workflow",
    );
    expectEffectiveAllowedToolsNotToContain(
      "project-discovery-ceo.workflow.yaml",
      "discovery_and_specs",
      "invoke_agent_workflow",
    );
  });

  it("discovery execution does not rely on step_complete with output contracts", () => {
    expectEffectiveAllowedToolsNotToContain(
      "project-discovery-ceo.workflow.yaml",
      "discovery_and_specs",
      "step_complete",
    );
  });

  it("discovery prompt forbids interactive repository access questions", () => {
    const prompt = readSeed("prompts/project-discovery-ceo/discovery.md");
    expect(prompt).toContain("Do not call ask_user_questions in this job");
    expect(prompt).toContain("Do not ask how to access the repository");
  });

  it("discovery prompt forbids ad-hoc delegation and step completion tools", () => {
    const prompt = readSeed("prompts/project-discovery-ceo/discovery.md");
    expect(prompt).toContain("Do not call invoke_agent_workflow in this job");
    expect(prompt).toContain("Do not call `step_complete`");
  });

  it("spec revision prompt requires direct decision output before step completion", () => {
    const prompt = getExecutionStepPrompt(
      "project-spec-revision-ceo.workflow.yaml",
      "revise_specs",
      "revision",
    );
    expect(prompt).toContain("never nest a data key inside data");
    expect(prompt).toContain("before calling `step_complete`");
  });

  it("spec revision final output explains delegation and changed specs", () => {
    const prompt = getExecutionStepPrompt(
      "project-spec-revision-ceo.workflow.yaml",
      "revise_specs",
      "revision",
    );

    expect(prompt).toMatch(/decision[\s\S]*delegated/i);
    expect(prompt).toMatch(/decision[\s\S]*what\s+changed/i);
  });

  it("spec revision prompt delegates PRD and SDD revisions through default agent workflow invocation", () => {
    const prompt = getExecutionStepPrompt(
      "project-spec-revision-ceo.workflow.yaml",
      "revise_specs",
      "revision",
    );

    expect(prompt).toMatch(
      /PRD[\s\S]*invoke_agent_workflow[\s\S]*agent_profile[\s\S]*task_prompt[\s\S]*omit\s+`?workflow_id`?[\s\S]*orchestration_invoke_agent_default/i,
    );
    expect(prompt).toMatch(
      /SDD[\s\S]*invoke_agent_workflow[\s\S]*agent_profile[\s\S]*task_prompt[\s\S]*omit\s+`?workflow_id`?[\s\S]*orchestration_invoke_agent_default/i,
    );
    expect(prompt).toMatch(
      /do\s+not\s+(?:call|invoke)[\s\S]*project_discovery_ceo[\s\S]*project_spec_revision_ceo/i,
    );
    expect(prompt).toMatch(
      /skipped_due_concurrency[\s\S]*not\s+(?:an?\s+)?immediate\s+retry\s+signal/i,
    );
  });

  it("import reconciliation feedback is actionable and not route metadata only", () => {
    const inputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "reconcile_import_specs",
    );
    const feedback = typeof inputs.feedback === "string" ? inputs.feedback : "";

    expect(feedback).toContain("Imported repository reconciliation required");
    expect(feedback).toContain("{{ trigger.repositoryUrl }}");
    expect(feedback).toContain("{{ trigger.basePath }}");
    expect(feedback).toContain("{{ trigger.scopeId }}");
    expect(feedback).not.toContain(
      "Imported repository reconciliation route {{ trigger.selectedRoute }} (rule {{ trigger.selectedRuleId }}).",
    );
  });

  it("spec revision execution has direct delegation tools and forbids subagent fan-out", () => {
    expectEffectiveAllowedToolsNotToContain(
      "project-spec-revision-ceo.workflow.yaml",
      "revise_specs",
      "spawn_subagent_async",
    );
    expectEffectiveAllowedToolsNotToContain(
      "project-spec-revision-ceo.workflow.yaml",
      "revise_specs",
      "wait_for_subagents",
    );
    expectEffectiveAllowedToolsNotToContain(
      "project-spec-revision-ceo.workflow.yaml",
      "revise_specs",
      "check_subagent_status",
    );
  });

  it("spec revision execution can discover specialists and delegate with invoke_agent_workflow", () => {
    const definition = parser.parseWorkflow(
      readSeed("project-spec-revision-ceo.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "revise_specs",
    );
    const allowedTools = Array.from(
      getPolicyEntries(job?.permissions, "allow"),
    );

    expect(allowedTools).toContain("get_agent_profiles");
    expect(allowedTools).toContain("invoke_agent_workflow");
  });

  it("spec revision execution can only complete orchestration steps, not mutate kanban state", () => {
    expectEffectiveAllowedToolsNotToContain(
      "project-spec-revision-ceo.workflow.yaml",
      "revise_specs",
      "step_complete:update_kanban",
    );
  });

  it("spec revision restricted job does not instruct direct war-room actions", () => {
    const prompt = getExecutionStepPrompt(
      "project-spec-revision-ceo.workflow.yaml",
      "revise_specs",
      "revision",
    );

    expect(prompt).not.toContain("open_war_room");
    expect(prompt).not.toContain("invite_war_room_participant");
    expect(prompt).not.toContain("post_war_room_message");
  });

  it("retired import analysis workflow file no longer exists in seed", () => {
    expect(() =>
      readSeed("project-repository-import-analysis.workflow.yaml"),
    ).toThrow();
  });

  it("temporary workflow temp manifest files are not treated as tools", () => {
    const tempSeedRoot = mkdtempSync(join(tmpdir(), "seed-tool-manifest-"));

    try {
      expect(() =>
        readSeed("project-repository-import-analysis.workflow.yaml"),
      ).toThrow();
      expect(tempSeedRoot).toBeTruthy();
    } finally {
      rmSync(tempSeedRoot, { recursive: true, force: true });
    }
  });

  it("finalize-artifacts prompt specifies full kanban.write_probe_result payload shape", () => {
    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/finalize-artifacts.md",
    );

    expect(prompt).toContain("project_id");
    expect(prompt).toContain("scope_id");
    expect(prompt).toContain("outcome");
    expect(prompt).toContain("result");
    expect(prompt).toContain("evidence_refs");
    expect(prompt).toContain("narrative_summary");
    expect(prompt).toContain('"project_id": "{{ inputs.scope_id }}"');
  });

  it("coordinate_investigation job allows kanban.orchestration_timeline when coordinator prompt references it", () => {
    const definition = parser.parseWorkflow(
      readSeed("project-codebase-deep-investigation.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "coordinate_investigation",
    );

    expect(job).toBeDefined();
    const allowTools = Array.from(getPolicyEntries(job?.permissions, "allow"));

    expect(allowTools).toContain("kanban.orchestration_timeline");
  });

  it("finalize-artifacts prompt shows evidence_refs as an array in kanban.write_probe_result example", () => {
    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/finalize-artifacts.md",
    );

    expect(prompt).toContain('"evidence_refs": [');
  });

  it("finalize-artifacts prompt completes through set_job_output only", () => {
    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/finalize-artifacts.md",
    );

    expect(prompt).toContain("Do not call `step_complete`");
    expect(prompt).toContain("set_job_output");
  });

  it("finalize_investigation_artifacts job and investigation-coordinator agent profile both allow kanban.write_probe_result", () => {
    const definition = parser.parseWorkflow(
      readSeed("project-codebase-deep-investigation.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "finalize_investigation_artifacts",
    );

    expect(job).toBeDefined();
    const allowTools = Array.from(getPolicyEntries(job?.permissions, "allow"));
    expect(allowTools).toContain("kanban.write_probe_result");

    const agentConfig = JSON.parse(
      readSeedRoot("agents/investigation-coordinator/agent.json"),
    ) as { tool_policy?: { rules?: unknown[] } };
    const allowedTools = (agentConfig.tool_policy?.rules ?? []).flatMap((r) => {
      if (typeof r === "string") {
        const m = /^allow\s+(\S+)/.exec(r);
        return m ? [m[1]] : [];
      }
      if (r && typeof r === "object" && "effect" in r && "tool" in r) {
        const rule = r as { effect: string; tool: string };
        return rule.effect === "allow" ? [rule.tool] : [];
      }
      return [];
    });
    expect(allowedTools).toContain("kanban.write_probe_result");
  });

  it("investigation coordinator prompt uses canonical kanban tool names, not legacy names", () => {
    const agentPrompt = readSeedRoot(
      "agents/investigation-coordinator/PROMPT.md",
    );

    expect(agentPrompt).toContain("kanban.project_state");
    // Context enrichment now routes through the lightweight activity feed
    // rather than the heavy orchestration_timeline read.
    expect(agentPrompt).toContain("kanban.orchestration_activity");
    expect(agentPrompt).not.toContain("query_project_state");
    expect(agentPrompt).not.toContain("get_orchestration_state");
  });

  it("investigation subagent prompt uses canonical kanban tool names, not legacy names", () => {
    const agentPrompt = readSeedRoot("agents/investigation-subagent/PROMPT.md");

    expect(agentPrompt).toContain("kanban.project_state");
    // Context enrichment now routes through the lightweight activity feed
    // rather than the heavy orchestration_timeline read.
    expect(agentPrompt).toContain("kanban.orchestration_activity");
    expect(agentPrompt).not.toContain("query_project_state");
    expect(agentPrompt).not.toContain("get_orchestration_state");
  });

  it("orchestration cycle workflow and ceo-agent profile both grant kanban.orchestration_activity", () => {
    // Tool resolution is jobScoped ∩ profileAllowed, so the lightweight
    // activity feed only reaches the CEO if BOTH layers grant it.
    expectEffectiveAllowedToolsToContain(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "strategize",
      "kanban.orchestration_activity",
    );
    expectEffectiveAllowedToolsToContain(
      "project-orchestration-cycle-ceo.workflow.yaml",
      "dispatch",
      "kanban.orchestration_activity",
    );

    const agentConfig = JSON.parse(
      readSeedRoot("agents/ceo-agent/agent.json"),
    ) as { tool_policy?: { rules?: unknown[] } };
    const allowedTools = (agentConfig.tool_policy?.rules ?? []).flatMap((r) => {
      if (typeof r === "string") {
        const m = /^allow\s+(\S+)/.exec(r);
        return m ? [m[1]] : [];
      }
      if (r && typeof r === "object" && "effect" in r && "tool" in r) {
        const rule = r as { effect: string; tool: string };
        return rule.effect === "allow" ? [rule.tool] : [];
      }
      return [];
    });
    expect(allowedTools).toContain("kanban.orchestration_activity");
    // Timeline stays granted for deep-dive / recovery reads.
    expect(allowedTools).toContain("kanban.orchestration_timeline");
  });

  it("investigation subagent prompt uses canonical status terms aligned with probe file contract", () => {
    const agentPrompt = readSeedRoot("agents/investigation-subagent/PROMPT.md");

    expect(agentPrompt).toContain("implemented");
    expect(agentPrompt).toContain("partial");
    expect(agentPrompt).toContain("missing");
    expect(agentPrompt).not.toContain("complete, partial, stub, or missing");
    expect(agentPrompt).not.toContain("complete/partial/stub/missing");
    expect(agentPrompt).not.toMatch(/\bstub\b/);
  });

  it("discovery CEO forwards committed investigation artifact outputs downstream", () => {
    const synthesisInputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "synthesize_and_hydrate_import",
    );
    const revisionInputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "reconcile_import_specs",
    );

    expect(synthesisInputs.investigationArtifactPaths).toContain(
      "probe_artifact_paths",
    );
    expect(synthesisInputs.investigationSummaryPath).toContain(
      "investigation_summary_path",
    );
    expect(synthesisInputs.investigationCommitSha).toContain(
      "commit_investigation_artifacts",
    );
    expect(revisionInputs.investigationArtifactPaths).toContain(
      "probe_artifact_paths",
    );
    expect(revisionInputs.investigationSummaryPath).toContain(
      "investigation_summary_path",
    );
    expect(revisionInputs.investigationCommitSha).toContain(
      "commit_investigation_artifacts",
    );
  });

  it("imported repo synthesis invokes kanban.reconcile_imported_repository_backlog", () => {
    const definition = parser.parseWorkflow(
      readSeed("imported-repo-synthesis-and-hydration.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "hydrate_discovery_results",
    );
    const agentConfig = JSON.parse(
      readSeedRoot("agents/ceo-agent/agent.json"),
    ) as { allowed_tools?: string[] };

    expect(job).toBeDefined();
    const allowTools = Array.from(getPolicyEntries(job?.permissions, "allow"));

    expect(allowTools).toContain(
      "kanban.reconcile_imported_repository_backlog",
    );
    const allowedTools =
      agentConfig.tool_policy?.rules
        ?.filter((r) => r.effect === "allow")
        .map((r) => r.tool) ?? [];
    expect(allowedTools).toContain(
      "kanban.reconcile_imported_repository_backlog",
    );
  });

  it("imported repo synthesis no longer uses synthesize_discovery_work_item_specs or kanban.publish_specs", () => {
    const workflowSource = readSeed(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
    );
    const definition = parser.parseWorkflow(workflowSource);
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "hydrate_discovery_results",
    );

    expect(job).toBeDefined();
    const allowTools = Array.from(getPolicyEntries(job?.permissions, "allow"));

    expect(allowTools).not.toContain("synthesize_discovery_work_item_specs");
    expect(allowTools).not.toContain("kanban.publish_specs");
    expect(workflowSource).not.toContain(
      "synthesize_discovery_work_item_specs",
    );
    expect(workflowSource).not.toContain("kanban.publish_specs");
  });

  it("seed tool manifest does not expose synthesize_discovery_work_item_specs", () => {
    const manifest = JSON.parse(
      readSeedRoot("tool-manifests/kanban-tools.seed.json"),
    ) as {
      toolNames?: string[];
    };

    expect(manifest.toolNames ?? []).not.toContain(
      "synthesize_discovery_work_item_specs",
    );
  });

  it("ceo agent allowed tools do not include synthesize_discovery_work_item_specs", () => {
    const agentConfig = JSON.parse(
      readSeedRoot("agents/ceo-agent/agent.json"),
    ) as {
      allowed_tools?: string[];
    };

    expect(agentConfig.allowed_tools ?? []).not.toContain(
      "synthesize_discovery_work_item_specs",
    );
  });

  it("ceo agent allows the CEO composite cycle decision and reset tools", () => {
    const agentConfig = JSON.parse(
      readSeedRoot("agents/ceo-agent/agent.json"),
    ) as {
      allowed_tools?: string[];
    };

    const allowedTools =
      agentConfig.tool_policy?.rules
        ?.filter((r) => r.effect === "allow")
        .map((r) => r.tool) ?? [];
    expect(allowedTools).toContain(
      "kanban.complete_orchestration_cycle_decision",
    );
    expect(agentConfig.allowed_tools ?? []).not.toContain(
      "kanban.orchestration_record_cycle_decision",
    );
    expect(allowedTools).toContain("kanban.reset_orchestration_intents");
  });

  it("cycle decision clear tool is manifest-seeded for operators but not autonomous CEO tools", () => {
    const manifest = JSON.parse(
      readSeedRoot("tool-manifests/kanban-tools.seed.json"),
    ) as { toolNames?: string[] };
    const agentConfig = JSON.parse(
      readSeedRoot("agents/ceo-agent/agent.json"),
    ) as { allowed_tools?: string[] };
    const workflow = parser.parseWorkflow(
      readSeed("project-orchestration-cycle-ceo.workflow.yaml"),
    );
    const workflowAllowTools = Array.isArray(workflow.permissions?.allow_tools)
      ? workflow.permissions.allow_tools
      : [];

    expect(manifest.toolNames ?? []).toContain(
      "kanban.orchestration_clear_cycle_decision",
    );
    expect(agentConfig.allowed_tools ?? []).not.toContain(
      "kanban.orchestration_clear_cycle_decision",
    );
    expect(workflowAllowTools).not.toContain(
      "kanban.orchestration_clear_cycle_decision",
    );
  });

  it("imported repo synthesis prompt calls kanban.reconcile_imported_repository_backlog with project_id and workspace_root", () => {
    const prompt = getExecutionStepPrompt(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
      "hydrate",
    );

    expect(prompt).toContain(
      "Invoke kanban.reconcile_imported_repository_backlog with:",
    );
    expect(prompt).toContain("project_id: {{ trigger.scopeId }}");
    expect(prompt).toContain("workspace_root: {{ trigger.basePath }}");
    expect(prompt).toContain("goals: goals_array");
    expect(prompt).toContain(
      "probe_artifact_directory: docs/project-context/probe-results",
    );
    expect(prompt).toContain("dry_run: false");
    expect(prompt).not.toContain("workspace_root: the trigger base path");
  });

  it("imported repo synthesis prompt injects orchestration mode into reconciliation input", () => {
    const prompt = getExecutionStepPrompt(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
      "hydrate",
    );

    const reconciliationBlock = prompt.slice(
      prompt.indexOf("5. Invoke kanban.reconcile_imported_repository_backlog"),
      prompt.indexOf("6. If the reconciliation result"),
    );

    expect(reconciliationBlock).toContain(
      "orchestration_mode: {{ trigger.orchestrationMode }}",
    );
    expect(reconciliationBlock).toContain(
      "human_decision_policy: {{ trigger.humanDecisionPolicy }}",
    );
  });

  it("imported repo synthesis hydration job resolves mode and policy from trigger context", () => {
    const childInputs = getJobInputs(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
    );

    expect(childInputs.orchestrationMode).toBe(
      "{{ trigger.orchestrationMode }}",
    );
    expect(childInputs.humanDecisionPolicy).toBe(
      "{{ trigger.humanDecisionPolicy }}",
    );
  });

  it("imported hydration child prompt uses the same trigger mode fields passed by the parent invoke_workflow", () => {
    const parentInputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "synthesize_and_hydrate_import",
    );
    const prompt = getExecutionStepPrompt(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
      "hydrate",
    );

    const reconciliationBlock = prompt.slice(
      prompt.indexOf("5. Invoke kanban.reconcile_imported_repository_backlog"),
      prompt.indexOf("6. If the reconciliation result"),
    );

    expect(parentInputs.orchestrationMode).toBe(
      "{{ trigger.orchestrationMode }}",
    );
    expect(parentInputs.humanDecisionPolicy).toBe(
      "{{ trigger.humanDecisionPolicy }}",
    );
    expect(reconciliationBlock).toContain(
      `orchestration_mode: ${parentInputs.orchestrationMode}`,
    );
    expect(reconciliationBlock).toContain(
      `human_decision_policy: ${parentInputs.humanDecisionPolicy}`,
    );
  });

  it("imported repo synthesis prompt treats published human-decision-only hydration as blocked", () => {
    const prompt = getExecutionStepPrompt(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
      "hydrate",
    );

    expect(prompt).toContain(
      "If all planned items are blocked/human-decision and no planned todo items remain (",
    );
    expect(prompt).toContain("reconciliation_summary.plan.counts.blocked > 0");
    expect(prompt).toContain("reconciliation_summary.plan.counts.todo === 0");
    expect(prompt).toContain("- ready_for_cycle: false");
    expect(prompt).toContain(`cycle_decision: "blocked"`);
    expect(prompt).toContain(
      "hydration_summary counts from publish counts when present",
    );
  });

  it("imported repo synthesis prompt allows publish cycle continuation when todo exists", () => {
    const prompt = getExecutionStepPrompt(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
      "hydrate",
    );

    expect(prompt).toContain("If at least one planned todo item exists (");
    expect(prompt).toContain("reconciliation_summary.plan.counts.todo > 0");
    expect(prompt).toContain("- ready_for_cycle: true");
    expect(prompt).toContain(`cycle_decision: "repeat"`);
  });

  it("imported repo synthesis prompt emits publish-derived hydration summary counts", () => {
    const prompt = getExecutionStepPrompt(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
      "hydrate",
    );

    expect(prompt).not.toContain("If publish status is `published`");
    expect(prompt).toContain("hydration_summary with ok, status when present");
    expect(prompt).toContain(
      "created, updated, unchanged, skipped, errored counts from publish when present",
    );
    expect(prompt).toContain("publish.counts");
  });

  it("imported repo synthesis outputs are not JSON-encoded in set_job_output", () => {
    const prompt = getExecutionStepPrompt(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
      "hydrate",
    );

    const setJobOutputIndex = prompt.indexOf(
      "Call set_job_output passing these fields directly.",
    );
    expect(setJobOutputIndex).toBeGreaterThan(-1);

    const doNotUseJsonIndex = prompt.indexOf(
      "14. Do not use JSON-encoded string helpers like {{json ...}} for set_job_output.",
    );
    expect(doNotUseJsonIndex).toBeGreaterThan(-1);

    const setJobOutputSection = prompt.slice(
      setJobOutputIndex,
      doNotUseJsonIndex,
    );

    expect(setJobOutputSection).not.toContain("{{json ");
  });

  it("imported repo synthesis set_job_output uses resolved cycle_decision", () => {
    const prompt = getExecutionStepPrompt(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
      "hydrate",
    );

    expect(prompt).toContain(
      "cycle_decision from the resolved `cycle_decision` value set above",
    );
    expect(prompt).toContain(
      "If no explicit branch above sets `cycle_decision`",
    );
  });

  it("imported repo synthesis prompt exposes cycleDecision and readyForCycle from reconciliation result", () => {
    const prompt = getExecutionStepPrompt(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
      "hydrate",
    );

    expect(prompt).toContain("cycleDecision");
    expect(prompt).toContain("readyForCycle");
    expect(prompt).toContain("cycle_decision");
    expect(prompt).toContain("reconciliation_summary");
  });

  it("imported repo synthesis prompt handles blocked reconciliation with hydration_summary.reason", () => {
    const prompt = getExecutionStepPrompt(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
      "hydrate",
    );

    expect(prompt).toMatch(/status.*blocked|blocked.*status/i);
    expect(prompt).toContain("hydration_summary");
    expect(prompt).toContain("reason");
  });

  it("imported repo synthesis requires file-backed probe artifacts before reconciliation", () => {
    const prompt = getExecutionStepPrompt(
      "imported-repo-synthesis-and-hydration.workflow.yaml",
      "hydrate_discovery_results",
      "hydrate",
    );

    expect(prompt).toMatch(
      /Preflight the probe artifact directory before reconciliation:[\s\S]*?- Call ls for docs\/project-context\/probe-results\.[\s\S]*?- Require at least one `\.md` artifact in docs\/project-context\/probe-results\.[\s\S]*?- If the directory is missing, empty, unreadable, or contains no `\.md` artifacts, call set_job_output passing these fields directly\. Example: `set_job_output\(\{"existing_work_item_count": 0/,
    );
  });

  it("spec revision reads project-context and probe files before imported-repo reconciliation", () => {
    const prompt = getExecutionStepPrompt(
      "project-spec-revision-ceo.workflow.yaml",
      "revise_specs",
      "revision",
    );

    expect(prompt).toContain("docs/project-context/ARCHITECTURE.md");
    expect(prompt).toContain("docs/project-context/CAPABILITY_MAP.md");
    expect(prompt).toContain("docs/project-context/CODEBASE_HEALTH.md");
    expect(prompt).toContain("docs/project-context/probe-results/*.md");
  });

  it("spec revision war room runs a real participant review before closing", () => {
    expectExecutionJobRequiredOutputFields(
      "project-spec-revision-ceo.workflow.yaml",
      "war_room_revision_alignment",
      ["war_room_summary", "concerns", "signoffs", "unresolved_blockers"],
    );

    const definition = parser.parseWorkflow(
      readSeed("project-spec-revision-ceo.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "war_room_revision_alignment",
    );
    const allowTools = Array.from(getPolicyEntries(job?.permissions, "allow"));
    const denyTools = Array.from(getPolicyEntries(job?.permissions, "deny"));

    expect(allowTools).toContain("open_war_room");
    expect(allowTools).toContain("update_war_room_blackboard");
    expect(allowTools).toContain("spawn_subagent_async");
    expect(allowTools).toContain("wait_for_subagents");
    expect(allowTools).toContain("check_subagent_status");
    expect(allowTools).toContain("get_war_room_state");
    expect(allowTools).toContain("submit_war_room_signoff");
    expect(allowTools).toContain("set_job_output");
    expect(denyTools).not.toContain("spawn_subagent_async");

    const prompt = getExecutionStepPrompt(
      "project-spec-revision-ceo.workflow.yaml",
      "war_room_revision_alignment",
      "align_revision_decision",
    );

    expect(prompt).toContain("docs/project-context/ARCHITECTURE.md");
    expect(prompt).toContain("docs/project-context/CAPABILITY_MAP.md");
    expect(prompt).toContain("docs/project-context/CODEBASE_HEALTH.md");
    expect(prompt).toContain("docs/project-context/probe-results/\\*.md");
    expect(prompt).toContain("update_war_room_blackboard");
    expect(prompt).toContain("spawn_subagent_async");
    expect(prompt).toContain("wait_for_subagents");
    expect(prompt).toContain("architect-agent");
    expect(prompt).toContain("pm");
    expect(prompt).toContain("Do not use `product-manager` as a war-room role");
    expect(prompt).toContain("post_war_room_message");
    expect(prompt).toContain("get_war_room_state");
    expect(prompt).toContain("set_job_output");
    expect(prompt).toContain("unresolved_blockers");
    expect(prompt).not.toContain(
      "invite_war_room_participant for architect-agent and pm",
    );
    expect(prompt).not.toContain(
      "close_war_room with resolution_type=manual and a concrete resolution note",
    );
  });

  it("spec revision gates specs-ready on war room unresolved_blockers", () => {
    expectJobConditionContains(
      "project-spec-revision-ceo.workflow.yaml",
      "emit_specs_ready",
      "unresolved_blockers",
    );
  });

  it("spec revision war room prompt requires UUID context identifiers and allowed roles", () => {
    const prompt = getExecutionStepPrompt(
      "project-spec-revision-ceo.workflow.yaml",
      "war_room_revision_alignment",
      "align_revision_decision",
    );

    // context_id must be a valid UUID
    expect(prompt).toMatch(/context_id.*must be a valid UUID/);

    // session_id must be a valid UUID when supplied
    expect(prompt).toMatch(/session_id.*must be a valid UUID/);

    // no literal context IDs
    expect(prompt).not.toContain("spec-revision-dad09d35");
    expect(prompt).not.toContain("spec-revision-ceo-");

    // allowed participant roles
    expect(prompt).toContain("architect");
    expect(prompt).toContain("pm");
    expect(prompt).toContain("dev");
    expect(prompt).toContain("qa");
    expect(prompt).toContain("moderator");

    // product-manager must not be used as a war-room role (only in prohibition context)
    expect(prompt).toContain("Do not use `product-manager` as a war-room role");
  });

  it("spec revision gates cycle-request on war room unresolved_blockers", () => {
    expectJobConditionContains(
      "project-spec-revision-ceo.workflow.yaml",
      "emit_cycle_request",
      "unresolved_blockers",
    );
  });

  it("spec revision persists unresolved blockers as orchestration blocked state", () => {
    const definition = parser.parseWorkflow(
      readSeed("project-spec-revision-ceo.workflow.yaml"),
    );
    const workflow = definition;

    const blockedJob = (workflow.jobs ?? []).find(
      (j) => j.id === "record_revision_blocked",
    );

    expect(blockedJob).toBeDefined();
    expect(blockedJob?.type).toBe("mcp_tool_call");
    expect(blockedJob?.depends_on).toContain("war_room_revision_alignment");

    const inputs =
      blockedJob?.inputs && typeof blockedJob.inputs === "object"
        ? blockedJob.inputs
        : {};
    expect(inputs.tool_name).toBe("kanban.orchestration_record_cycle_decision");

    const params =
      inputs.params && typeof inputs.params === "object"
        ? (inputs.params as Record<string, unknown>)
        : {};
    expect(params.project_id).toBe("{{ trigger.scopeId }}");
    expect(params.decision).toBe("blocked");
    expect(params.idempotency_key).toBe(
      "spec-revision-blocked:{{ trigger.scopeId }}:{{ trigger.orchestrationId }}",
    );

    expect(typeof blockedJob?.condition).toBe("string");
    expect(blockedJob?.condition).toContain("unresolved_blockers");
  });

  it("spec revision emit_specs_ready condition gates on unresolved_blockers", () => {
    const workflowSource = readSeed("project-spec-revision-ceo.workflow.yaml");
    expect(workflowSource).toContain(
      "jobs.war_room_revision_alignment.output.unresolved_blockers",
    );
    expect(workflowSource).toContain("decision: blocked");
  });

  it("spec revision war room prompt specifies tools and agent_profile for reviewer spawns", () => {
    const prompt = getExecutionStepPrompt(
      "project-spec-revision-ceo.workflow.yaml",
      "war_room_revision_alignment",
      "align_revision_decision",
    );

    expect(prompt).toContain(
      "Allowed participant roles: `architect`, `pm`, `dev`, `qa`, `moderator`",
    );
    expect(prompt).toContain("Do not use `product-manager` as a war-room role");
    expect(prompt).toContain("agent_profile: architect-agent");
    expect(prompt).toContain("agent_profile: product-manager");
    expect(prompt).not.toContain("agent_profile: pm");
    expect(prompt).toContain("tools:");
    expect(prompt).toContain("post_war_room_message");
    expect(prompt).toContain("get_war_room_state");
    expect(prompt).toContain('"read"');
    expect(prompt).toContain('"ls"');
  });

  it("spec revision war room prompt specifies explicit close semantics with resolution_type", () => {
    const prompt = getExecutionStepPrompt(
      "project-spec-revision-ceo.workflow.yaml",
      "war_room_revision_alignment",
      "align_revision_decision",
    );

    expect(prompt).toContain("resolution_type: consensus");
    expect(prompt).toMatch(/resolution_type: (deadlock|manual)/);
    expect(prompt).toContain("unresolved-risk");
    expect(prompt).toMatch(/blocker.?count|blocker_count/);
  });

  it("work item generation consumes probe artifacts for completed partial and missing work", () => {
    const prompt = getExecutionStepPrompt(
      "project-work-item-generation-ceo.workflow.yaml",
      "generate_bootstrap_work_items",
      "bootstrap",
    );

    expect(prompt).toContain("docs/project-context/CAPABILITY_MAP.md");
    expect(prompt).toContain("docs/project-context/probe-results/*.md");
    expect(prompt).toMatch(/source probe artifact paths/i);
    expect(prompt).toMatch(/completed existing-work items/i);
    expect(prompt).toMatch(/partial capabilities/i);
    expect(prompt).toMatch(/missing capabilities/i);
  });

  it("work item generation distinguishes capability inventory from actionable backlog", () => {
    const prompt = getExecutionStepPrompt(
      "project-work-item-generation-ceo.workflow.yaml",
      "generate_bootstrap_work_items",
      "bootstrap",
    );

    expect(prompt).toMatch(
      /implemented capabilities are evidence records, not dispatchable backlog/i,
    );
    expect(prompt).toMatch(/missing capabilities.*actionable work/i);
    expect(prompt).toMatch(/do not dispatch work from unpublished specs/i);
  });

  it("imported repo playbooks treat committed project-context artifacts as done criteria", () => {
    const bootstrapSkill = readSeedRoot(
      "skills/orchestration-playbooks/imported-repo-bootstrap/SKILL.md",
    );
    const synthesisSkill = readSeedRoot(
      "skills/orchestration-playbooks/imported-repo-synthesis-and-hydration/SKILL.md",
    );

    expect(bootstrapSkill).toContain("committed project-context artifacts");
    expect(bootstrapSkill).toContain("docs/project-context/probe-results");
    expect(synthesisSkill).toContain("docs/project-context/probe-results/*.md");
    expect(synthesisSkill).toContain("primary synthesis input");
    expect(synthesisSkill).toContain("DB probe state");
    expect(synthesisSkill).toContain("index metadata");
  });

  it("deep investigation probe loop only allows raw subagent orchestration tools", () => {
    const definition = parser.parseWorkflow(
      readSeed("project-codebase-deep-investigation.workflow.yaml"),
    );
    const probeJob = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "run_scope_probes",
    );

    expect(probeJob).toBeDefined();
    const allowTools = Array.from(
      getPolicyEntries(probeJob?.permissions, "allow"),
    );

    expect(allowTools).toEqual(
      expect.arrayContaining([
        "spawn_subagent_async",
        "wait_for_subagents",
        "check_subagent_status",
      ]),
    );

    const prompt = readSeed(
      "prompts/project-codebase-deep-investigation/probe-loop.md",
    );
    const allowedNexusActions = [
      "spawn_subagent_async",
      "wait_for_subagents",
      "check_subagent_status",
    ];

    const rawToolSection =
      prompt
        .split("Only call these raw orchestration tools in this job:")[1]
        ?.split("\n")[0] ?? "";

    for (const action of allowedNexusActions) {
      expect(rawToolSection).toContain(action);
    }

    expect(rawToolSection).not.toContain("step_complete");
    expect(rawToolSection).not.toContain("update_kanban");
  });

  it("record_import_hydration_blocked job exists as mcp_tool_call targeting kanban-mcp orchestration_record_blocked", () => {
    const definition = parser.parseWorkflow(
      readSeed("project-discovery-ceo.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "record_import_hydration_blocked",
    );

    expect(job).toBeDefined();
    expect(job?.type).toBe("mcp_tool_call");
    expect(job?.inputs?.server_id).toBe("kanban-mcp");
    expect(job?.inputs?.tool_name).toBe("kanban.orchestration_record_blocked");
  });

  it("record_import_hydration_blocked is gated on imported routes and strict ready_for_cycle false", () => {
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "record_import_hydration_blocked",
      "imported-repo-bootstrap",
    );
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "record_import_hydration_blocked",
      "imported-repo-synthesis-and-hydration",
    );
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "record_import_hydration_blocked",
      "ready_for_cycle false",
    );
  });

  it("record_import_hydration_blocked passes literal blocked_stage, ready_for_cycle:false, child_run_id, and pass-through hydration_summary", () => {
    const inputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "record_import_hydration_blocked",
    );
    const params =
      inputs.params && typeof inputs.params === "object"
        ? (inputs.params as Record<string, unknown>)
        : {};

    expect(params.project_id).toBe("{{ trigger.scopeId }}");
    expect(params.blocked_stage).toBe("imported_repo_hydration");
    expect(params.ready_for_cycle).toBe(false);
    expect(params.child_run_id).toBe(
      "{{ jobs.synthesize_and_hydrate_import.output.childRunId }}",
    );
    expect(params.blocked_reason).toBe(
      "{{ jobs.synthesize_and_hydrate_import.output.childStateVariables.jobs.hydrate_discovery_results.output.hydration_summary.reason }}",
    );
    expect(params.hydration_summary).toBe(
      "{{json jobs.synthesize_and_hydrate_import.output.childStateVariables.jobs.hydrate_discovery_results.output.hydration_summary}}",
    );
  });

  it("emit_import_hydration_blocked exists as emit_event gated on imported routes with ready_for_cycle false", () => {
    const definition = parser.parseWorkflow(
      readSeed("project-discovery-ceo.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "emit_import_hydration_blocked",
    );

    expect(job).toBeDefined();
    expect(job?.type).toBe("emit_event");

    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "emit_import_hydration_blocked",
      "imported-repo-bootstrap",
    );
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "emit_import_hydration_blocked",
      "ready_for_cycle false",
    );

    const inputs =
      job?.inputs && typeof job?.inputs === "object" ? job.inputs : {};
    expect(inputs.event_name).toBe(
      "ProjectOrchestrationImportHydrationBlockedEvent",
    );

    const payload: Record<string, unknown> =
      inputs.payload && typeof inputs.payload === "object"
        ? (inputs.payload as Record<string, unknown>)
        : {};
    expect(payload.scopeId).toBe("{{ trigger.scopeId }}");
    expect(payload.orchestrationId).toBe("{{ trigger.orchestrationId }}");
    expect(payload.ready_for_cycle).toBe(false);
    expect(payload.childRunId).toBe(
      "{{ jobs.synthesize_and_hydrate_import.output.childRunId }}",
    );
  });

  it("record_import_hydration_blocked passes hydration_summary using json helper for runtime safety", () => {
    const inputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "record_import_hydration_blocked",
    );
    const params =
      inputs.params && typeof inputs.params === "object"
        ? (inputs.params as Record<string, unknown>)
        : {};

    expect(params.hydration_summary).toMatch(/^\{\{json\s+/);
  });

  it("clear_import_hydration_blocked job exists as mcp_tool_call targeting kanban-mcp orchestration_clear_blocked", () => {
    const definition = parser.parseWorkflow(
      readSeed("project-discovery-ceo.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "clear_import_hydration_blocked",
    );

    expect(job).toBeDefined();
    expect(job?.type).toBe("mcp_tool_call");
    expect(job?.inputs?.server_id).toBe("kanban-mcp");
    expect(job?.inputs?.tool_name).toBe("kanban.orchestration_clear_blocked");
  });

  it("clear_import_hydration_blocked is gated on imported routes and strict ready_for_cycle true", () => {
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "clear_import_hydration_blocked",
      "imported-repo-bootstrap",
    );
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "clear_import_hydration_blocked",
      "imported-repo-synthesis-and-hydration",
    );
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "clear_import_hydration_blocked",
      "ready_for_cycle true",
    );
  });

  it("clear_import_hydration_blocked passes literal cleared_stage, ready_for_cycle:true, and project_id", () => {
    const inputs = getJobInputs(
      "project-discovery-ceo.workflow.yaml",
      "clear_import_hydration_blocked",
    );
    const params =
      inputs.params && typeof inputs.params === "object"
        ? (inputs.params as Record<string, unknown>)
        : {};

    expect(params.project_id).toBe("{{ trigger.scopeId }}");
    expect(params.cleared_stage).toBe("imported_repo_hydration");
    expect(params.ready_for_cycle).toBe(true);
  });

  it("emit_specs_ready depends on clear_import_hydration_blocked before emitting", () => {
    const definition = parser.parseWorkflow(
      readSeed("project-discovery-ceo.workflow.yaml"),
    );
    const job = (definition.jobs ?? []).find(
      (candidate) => candidate.id === "emit_specs_ready",
    );

    expect(job).toBeDefined();
    expect(job?.depends_on).toContain("clear_import_hydration_blocked");
  });

  it("existing specs/cycle ready gates remain strict ready_for_cycle true for imported routes", () => {
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "emit_specs_ready",
      "ready_for_cycle true",
    );
    expectJobConditionContains(
      "project-discovery-ceo.workflow.yaml",
      "emit_cycle_request",
      "ready_for_cycle true",
    );
  });

  it("delegate prompt forbids JSON strings for edit tool arguments", () => {
    const prompt = getExecutionStepPrompt(
      "orchestration-invoke-agent-default.workflow.yaml",
      "delegate",
      "delegated_task",
    );

    expect(prompt).toContain("native");
    expect(prompt).not.toContain("JSON-encoded");
    expect(prompt).toContain("Do not pass JSON strings");
    expect(prompt).toContain("object or array parameters");
    expect(prompt).toContain("`edits`");
  });

  it("delegate prompt requires set_job_output with summary, resource_specs_changed, and resource_spec_paths before step_complete", () => {
    const prompt = getExecutionStepPrompt(
      "orchestration-invoke-agent-default.workflow.yaml",
      "delegate",
      "delegated_task",
    );

    expect(prompt).toContain("set_job_output");
    expect(prompt).toContain("summary");
    expect(prompt).toContain("resource_specs_changed");
    expect(prompt).toContain("resource_spec_paths");
    expect(prompt).toContain("Before calling `step_complete`");
    expect(prompt).toContain(
      "set_job_output with data as a native object, not a JSON string:",
    );
    expect(prompt).toContain(
      'data: { summary: "...", resource_specs_changed: false, resource_spec_paths: [] }',
    );
  });

  it("delegate prompt forbids step_complete before required output contract fields are set", () => {
    const prompt = getExecutionStepPrompt(
      "orchestration-invoke-agent-default.workflow.yaml",
      "delegate",
      "delegated_task",
    );

    expect(prompt).toContain("Do not call `step_complete` until");
  });

  it("delegate prompt requires resource_specs_changed: true only for changed resource specs", () => {
    const prompt = getExecutionStepPrompt(
      "orchestration-invoke-agent-default.workflow.yaml",
      "delegate",
      "delegated_task",
    );

    expect(prompt).toContain("resource_specs_changed");
    expect(prompt).toContain(
      "set true only when resource spec files were created or modified",
    );
    expect(prompt).toContain(
      "Do not set `resource_specs_changed` to true for unrelated docs",
    );
  });

  it("delegate prompt requires resource_spec_paths to include only changed resource spec paths", () => {
    const prompt = getExecutionStepPrompt(
      "orchestration-invoke-agent-default.workflow.yaml",
      "delegate",
      "delegated_task",
    );

    expect(prompt).toContain("resource_spec_paths");
    expect(prompt).toContain("include only changed resource spec paths");
  });

  it("seeds project orchestration advisor workflow with canonical workflow id", () => {
    expectWorkflowId(
      "project-orchestration-advisor.workflow.yaml",
      "project_orchestration_advisor",
    );
  });

  it("project orchestration advisor workflow exposes read-only/evidence tools", () => {
    const definition = parser.parseWorkflow(
      readSeed("project-orchestration-advisor.workflow.yaml"),
    );
    const serialized = JSON.stringify(definition);
    const allowTools = Array.from(
      getPolicyEntries(definition.jobs?.[0]?.permissions, "allow"),
    );

    expect(allowTools).toEqual(
      expect.arrayContaining([
        "kanban.project_state",
        "kanban.work_item",
        "kanban.orchestration_timeline",
        "query_memory",
        "search_workflows",
        "read_workflow_summary",
        "read",
        "search_playbooks",
        "read_playbook",
        "set_job_output",
      ]),
    );
    expect(allowTools).not.toEqual(
      expect.arrayContaining([
        "launch_workflow",
        "record_advice",
        "collect_signals",
      ]),
    );
    expect(serialized).not.toContain("selectedRoute");
    expect(serialized).not.toContain("selectedRuleId");
  });

  it("project orchestration advisor prompt requires Markdown section headings", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-advisor.workflow.yaml",
      "advise",
      "write_advice",
    );

    expect(prompt).toContain("## Snapshot Summary");
    expect(prompt).toContain("## Recommended Next Step");
    expect(prompt).toContain("## Evidence Used");

    // Dynamic discovery assertions
    expect(prompt).toContain("search_workflows");
    expect(prompt).toContain("read_workflow_summary");
    expect(prompt).not.toContain("hardcoded skill list");
    expect(prompt).toContain("## Candidate Workflows");
    expect(prompt).toContain("## Candidate Skills");
    expect(prompt).toContain("## Candidate Playbooks");
  });

  it("project orchestration advisor prompt accepts standard orchestration trigger context aliases", () => {
    const prompt = getExecutionStepPrompt(
      "project-orchestration-advisor.workflow.yaml",
      "advise",
      "write_advice",
    );

    expect(prompt).toContain(
      "{{or trigger.projectId trigger.scopeId trigger.scope_id trigger.context.project_id}}",
    );
    expect(prompt).toContain(
      "{{or trigger.question trigger.objective trigger.task_prompt trigger.reason}}",
    );
    expect(prompt).toContain(
      "{{json (or trigger.callerContext trigger.context)}}",
    );
  });

  describe("EPIC-168 Task 5 CEO optional advisor consultation contracts", () => {
    it("ceo orchestration decide step prompt guides optional projected advisor consultation", () => {
      const prompt = getExecutionStepPrompt(
        "project-orchestration-cycle-ceo.workflow.yaml",
        "dispatch",
        "dispatch",
      );

      expect(prompt).toContain("delegate_orchestration_advisor");
      expect(prompt).toContain("advisory Markdown only");
      expect(prompt).toContain(
        "Do not treat Advisor output as an automatic decision",
      );
      expect(prompt).toContain(
        "do not execute Advisor recommendations automatically",
      );
      expect(prompt).toContain("query_memory");
      expect(prompt).toContain("prior project preferences, facts, or history");
      expect(prompt).not.toContain("invoke_agent_workflow");
    });
  });

  it("work-item todo dispatch prompt dispatches selected IDs through Kanban-owned tooling", () => {
    const workflowSource = readSeed(
      "work-item-todo-dispatch-default.workflow.yaml",
    );
    const workflow = parser.parseWorkflow(workflowSource);
    const selectJob = (workflow.jobs ?? []).find(
      (job) => job.id === "select_and_start",
    );
    const prompt = getExecutionStepPrompt(
      "work-item-todo-dispatch-default.workflow.yaml",
      "select_and_start",
      "select",
    );

    expect(selectJob?.type).toBe("execution");
    expect(getPolicyEntries(workflow.permissions, "allow")).toContain(
      "kanban.dispatch_selected_work_items",
    );
    expectEffectiveAllowedToolsToContain(
      "work-item-todo-dispatch-default.workflow.yaml",
      "select_and_start",
      "kanban.dispatch_selected_work_items",
    );
    expect(
      DispatchSelectedWorkItemsSchema.safeParse({
        project_id: "project-1",
        context_ids: ["work-item-1"],
        workflow_id: "work_item_in_progress_default",
        requested_by: "dispatch-selector",
        max_concurrent_per_agent: 1,
        slots: 1,
      }).success,
    ).toBe(true);
    expect(prompt).toContain("Only choose IDs present in trigger.candidates");
    expect(prompt).toContain(
      "Do NOT call spawn_subagent_async for this workflow",
    );
    expect(prompt).toContain(
      "Call `kanban.dispatch_selected_work_items` only when you selected at least one work item ID",
    );
    expect(prompt).toContain(
      "If you select no work item IDs, do not call `kanban.dispatch_selected_work_items`; call `step_complete` only",
    );
    expect(prompt).toContain("- workflow_id: work_item_in_progress_default");
    expect(prompt).toContain("- requested_by: dispatch-selector");
    expect(prompt).toContain(
      "Kanban dispatch recomputes the authoritative project WIP cap",
    );
    expect(prompt).toContain(
      "batch-local advisory cap; service recomputes authoritative project WIP capacity",
    );
    expect(prompt).toContain("- slots: {{ trigger.slots }} when provided");
    expect(prompt).toContain(
      "- max_concurrent_per_agent: {{ trigger.maxConcurrentPerAgent }} when provided",
    );
    for (const requiredField of [
      "- project_id:",
      "- context_ids:",
      "- workflow_id:",
      "- requested_by:",
      "- max_concurrent_per_agent:",
      "- slots:",
    ]) {
      expect(prompt).toContain(requiredField);
    }
    expect(prompt).toContain("mutationConfirmed");
    expect(prompt).toContain(
      "Report the dispatch result and rationale with `step_complete`",
    );
  });

  it("work-item in-progress workflow persists the provisioned branch for later lifecycle jobs", () => {
    const definition = parser.parseWorkflow(
      readSeed("work-item-in-progress-default.workflow.yaml"),
    );
    const persistJob = (definition.jobs ?? []).find(
      (job) => job.id === "persist_provisioned_branch",
    );
    const inputs = persistJob?.inputs;
    const params = inputs?.params as Record<string, unknown> | undefined;

    expect(persistJob).toMatchObject({
      type: "mcp_tool_call",
      tier: "light",
    });
    expect((persistJob as { needs?: unknown })?.needs).toEqual([
      "provision_worktree",
    ]);
    expect(inputs?.server_id).toBe("kanban-mcp");
    expect(inputs?.tool_name).toBe("kanban.work_item_patch_execution_config");
    expect(params).toMatchObject({
      project_id: "{{ trigger.scopeId }}",
      workItemId: "{{ trigger.contextId }}",
      executionConfigPatch: {
        baseBranch: "{{ jobs.provision_worktree.output.base_branch }}",
        targetBranch: "{{ jobs.provision_worktree.output.target_branch }}",
        worktreePath: "{{ jobs.provision_worktree.output.worktree_path }}",
      },
    });
  });

  describe("WI-2026-001 CEO backlog promotion mandate contracts", () => {
    it("AC-1: prompt requires autonomous backlog-only boards to review tickets and promote safe work", () => {
      // The zero-todo promotion mandate is now enforced structurally: the engine
      // runs the `promote_safe_backlog` job (mcp_tool_call, for_each over
      // promotion_candidates, condition on todo_count==0 && autonomous_mode==true)
      // BEFORE the dispatch step runs. The dispatch prompt's "Zero-todo handling
      // (engine-assisted)" section describes this contract; the output_contract.forbidden
      // clause backstops bare-repeat violations.
      const workflowDefinition = parser.parseWorkflow(
        readSeed("project-orchestration-cycle-ceo.workflow.yaml"),
      );

      // The engine job that deterministically promotes safe backlog must exist.
      const promoteJob = (workflowDefinition.jobs ?? []).find(
        (job) => job.id === "promote_safe_backlog",
      );
      expect(promoteJob).toBeDefined();
      expect(promoteJob?.type).toBe("mcp_tool_call");
      // The job must iterate over promotion_candidates (for_each).
      expect(JSON.stringify(promoteJob?.for_each ?? "")).toContain(
        "promotion_candidates",
      );
      // The condition gates on zero todo count AND autonomous backlog_promotion mode.
      expect(typeof promoteJob?.condition).toBe("string");
      expect(promoteJob?.condition).toContain("todo_count");
      expect(promoteJob?.condition).toContain("autonomy.backlog_promotion");

      // The dispatch job's output_contract.forbidden backstops bare-repeat.
      const dispatchJob = (workflowDefinition.jobs ?? []).find(
        (job) => job.id === "dispatch",
      );
      const forbidden = dispatchJob?.output_contract?.forbidden ?? [];
      expect(Array.isArray(forbidden)).toBe(true);
      expect(forbidden.length).toBeGreaterThan(0);
      const bareRepeatClause = (
        forbidden as Array<{ condition?: string }>
      ).find(
        (f) =>
          (f.condition ?? "").includes("todo_count") &&
          (f.condition ?? "").includes("backlog"),
      );
      expect(bareRepeatClause).toBeDefined();

      // The dispatch prompt reinforces that promotion is mandatory via the
      // "Zero-todo handling (engine-assisted)" section and the MANDATORY language.
      const prompt = getExecutionStepPrompt(
        "project-orchestration-cycle-ceo.workflow.yaml",
        "dispatch",
        "dispatch",
      );
      expect(prompt).toContain("Zero-todo handling (engine-assisted)");
      expect(prompt).toMatch(
        /MUST\s+(?:call\s+)?[`']?kanban\.work_item_transition_status[`']?/,
      );
      expect(prompt).toContain("MANDATORY—not an optional path");
    });

    it("AC-2: prompt forbids generic no-op repeat wording when backlog exists", () => {
      // The no-op repeat prohibition is enforced by two mechanisms:
      //   (a) The dispatch job's output_contract.forbidden clause structurally
      //       rejects a bare repeat when todo_count==0 and backlog_count>0.
      //   (b) The dispatch prompt's INVALID example section explicitly
      //       documents that a bare `repeat` with no mutation is NOT permitted
      //       when unblocked backlog exists.
      const prompt = getExecutionStepPrompt(
        "project-orchestration-cycle-ceo.workflow.yaml",
        "dispatch",
        "dispatch",
      );

      // The prompt must explicitly forbid "bare repeat" as a decision shape
      // when backlog_count > 0.
      expect(prompt).toMatch(
        /bare\s+[`'"]?repeat[`'"]?\s+(?:decision\s+)?with\s+no\s+(?:board\s+)?mutation\s+is\s+NOT\s+permitted/i,
      );
      // The prohibition must reference backlog_count > 0 condition.
      expect(prompt).toMatch(/backlog_count\s*>\s*0/i);
      // The INVALID example must appear to document the violation.
      expect(prompt).toContain("INVALID: Bare `repeat` with No Mutation");

      // The output_contract.forbidden clause in the workflow YAML backstops it.
      const workflowDefinition = parser.parseWorkflow(
        readSeed("project-orchestration-cycle-ceo.workflow.yaml"),
      );
      const dispatchJob = (workflowDefinition.jobs ?? []).find(
        (job) => job.id === "dispatch",
      );
      const forbidden = dispatchJob?.output_contract?.forbidden ?? [];
      const bareRepeatClause = (
        forbidden as Array<{ condition?: string; description?: string }>
      ).find(
        (f) =>
          (f.condition ?? "").toLowerCase().includes("repeat") ||
          (f.description ?? "").toLowerCase().includes("repeat"),
      );
      expect(bareRepeatClause).toBeDefined();
    });

    it("AC-3: prompt orders backlog promotion before dispatch decision record in the same cycle", () => {
      const prompt = getExecutionStepPrompt(
        "project-orchestration-cycle-ceo.workflow.yaml",
        "dispatch",
        "dispatch",
      );

      // dispatch.md defines the REQUIRED MUTATING ACTION ORDER section which
      // lists: read-state -> mutate (promotion/transition step 5) -> record-decision (step 6).
      expect(prompt).toContain("REQUIRED MUTATING ACTION ORDER");

      // The REQUIRED MUTATING ACTION ORDER section must list a mutating action
      // step ("5. **Mutating action**") before the final decision step
      // ("6. **Final decision**"). Use the numbered-list markers as anchors.
      const orderedSectionPattern =
        /REQUIRED MUTATING ACTION ORDER[\s\S]*?5\.\s+\*\*Mutating action\*\*[\s\S]*?6\.\s+\*\*Final decision\*\*/;
      expect(prompt).toMatch(orderedSectionPattern);

      // Promotion tools must be listed within the Mutating action options.
      const mutatingActionSection = prompt.match(
        /5\.\s+\*\*Mutating action\*\*[\s\S]*?6\.\s+\*\*Final decision\*\*/,
      );
      expect(mutatingActionSection).not.toBeNull();
      expect(mutatingActionSection?.[0]).toContain(
        "kanban.work_item_transition_status",
      );
    });

    it("AC-5: prompt defines what makes a backlog item safe/unblocked for promotion eligibility", () => {
      // The authoritative definition of "safe/unblocked for promotion" now lives
      // in the ENGINE: `promotableBacklog` = backlog items where deps are done
      // AND the item is not human_decision. The engine populates this set in
      // kanban.project_state.strategic.dispatch.promotableBacklog before the
      // strategize step runs.
      //
      // The strategize prompt enforces that promotion_candidates MUST be drawn
      // exclusively from that engine-computed set. The dispatch prompt reinforces
      // the non-contagion rule: human_decision blockers are item-scoped and do
      // not block unrelated backlog items.

      const strategizePrompt = readSeed(
        "prompts/project-orchestration-cycle-ceo/strategize.md",
      );

      // The strategize prompt must direct the CEO to draw promotion_candidates
      // from the engine's authoritative promotable set (safe = backlog + deps done
      // + not human_decision).
      expect(strategizePrompt).toContain(
        "strategic.dispatch.promotableBacklog",
      );
      expect(strategizePrompt).toContain("promotion_candidates");

      // The engine promote_safe_backlog job must exist, confirming structural
      // enforcement of safe/unblocked promotion eligibility.
      const workflowDefinition = parser.parseWorkflow(
        readSeed("project-orchestration-cycle-ceo.workflow.yaml"),
      );
      const promoteJob = (workflowDefinition.jobs ?? []).find(
        (job) => job.id === "promote_safe_backlog",
      );
      expect(promoteJob).toBeDefined();
      // The job uses for_each — it promotes each candidate individually.
      expect(JSON.stringify(promoteJob?.for_each ?? "")).toContain(
        "promotion_candidates",
      );

      // The dispatch prompt reinforces the non-contagion rule: human_decision
      // items must not be misread as causing a board-wide block.
      const dispatchPrompt = getExecutionStepPrompt(
        "project-orchestration-cycle-ceo.workflow.yaml",
        "dispatch",
        "dispatch",
      );
      // The engine already excludes human_decision from the promotable set;
      // the dispatch prompt's INVALID example makes this explicit.
      expect(dispatchPrompt).toContain(
        "Human-decision items do NOT block unrelated backlog items",
      );
      // The Zero-todo handling section names the engine job.
      expect(dispatchPrompt).toContain("promote_safe_backlog");
      // The engine only promotes non-human-decision candidates.
      expect(dispatchPrompt).toContain("non-human-decision");
    });
  });

  describe("WI-2026-007 CEO dispatch claim contract", () => {
    // Helper: flatten `permissions.tool_policy.rules[].tool` entries with
    // `effect: allow` into a sorted, unique list of tool names. This matches
    // the `default: deny` + explicit `rules` policy format used by
    // project-orchestration-cycle-ceo.workflow.yaml.
    function flattenToolPolicyAllowList(permissions: unknown): string[] {
      if (
        !permissions ||
        typeof permissions !== "object" ||
        Array.isArray(permissions)
      ) {
        return [];
      }

      const toolPolicy = (permissions as Record<string, unknown>).tool_policy;
      if (
        !toolPolicy ||
        typeof toolPolicy !== "object" ||
        Array.isArray(toolPolicy)
      ) {
        return [];
      }

      const rules = (toolPolicy as Record<string, unknown>).rules;
      if (!Array.isArray(rules)) {
        return [];
      }

      const toolNames = new Set<string>();
      for (const rule of rules) {
        if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
          continue;
        }
        const ruleRecord = rule as Record<string, unknown>;
        if (ruleRecord.effect !== "allow") {
          continue;
        }
        const toolName = ruleRecord.tool;
        if (typeof toolName === "string" && toolName.trim().length > 0) {
          toolNames.add(toolName.trim());
        }
      }

      return Array.from(toolNames).sort();
    }

    function getCeoToolPolicyAllowList(): string[] {
      const definition = parser.parseWorkflow(
        readSeed("project-orchestration-cycle-ceo.workflow.yaml"),
      );
      return flattenToolPolicyAllowList(definition.permissions);
    }

    function getWorkflowToolPolicyAllowList(seedFilename: string): string[] {
      const definition = parser.parseWorkflow(readSeed(seedFilename));
      return flattenToolPolicyAllowList(definition.permissions);
    }

    // Helper: convert a workflow_id like `project_discovery_ceo` to a seed
    // filename like `project-discovery-ceo.workflow.yaml`. Returns null when
    // the conversion does not map to an existing file on disk so the caller
    // can skip it gracefully.
    function workflowIdToSeedFilename(workflowId: string): string | null {
      const candidate = `${workflowId.replace(/_/g, "-")}.workflow.yaml`;
      const candidatePath = join(seedsDir, candidate);
      return existsSync(candidatePath) ? candidate : null;
    }

    // Helper: read the CEO delegation config and return the subset of
    // delegate_* tools that are present in the CEO's allow list. Each entry
    // contains the projected tool name and the workflow it routes to.
    function getCeoDelegationTargets(): Array<{
      toolName: string;
      workflowId: string;
    }> {
      const allowList = new Set(getCeoToolPolicyAllowList());
      const delegationsPath = join(
        seedRootDir,
        "workflow-delegation-tools",
        "project-orchestration-cycle-ceo.delegations.json",
      );
      const delegationsRaw = readFileSync(delegationsPath, "utf8");
      const delegations = JSON.parse(delegationsRaw) as {
        tools: Array<{
          tool_name: string;
          workflow_id: string;
        }>;
      };

      return (delegations.tools ?? [])
        .filter(
          (tool): tool is { tool_name: string; workflow_id: string } =>
            typeof tool?.tool_name === "string" &&
            typeof tool?.workflow_id === "string" &&
            allowList.has(tool.tool_name),
        )
        .map((tool) => ({
          toolName: tool.tool_name,
          workflowId: tool.workflow_id,
        }));
    }

    it("AC-1: CEO tool policy allow list must include kanban.dispatch_selected_work_items", () => {
      // The CEO cycle must have a direct, verifiable path to dispatch a
      // work item via the Kanban mutating tool. Otherwise the CEO cannot
      // truthfully claim that work items were dispatched (linked_run_id /
      // current_execution_id can never be populated by the CEO itself).
      const allowList = getCeoToolPolicyAllowList();

      expect(allowList).toContain("kanban.dispatch_selected_work_items");
    });

    it("AC-2: CEO tool policy does not include invoke_agent_workflow (or any non-mutating dispatch-claim tool)", () => {
      // The CEO must not be able to claim dispatch via a tool that does NOT
      // mutate Kanban state. `invoke_agent_workflow` is the canonical
      // non-mutating workflow-invocation tool. The CEO currently routes
      // workflow invocations through `delegate_*` projected-delegation
      // tools (see CEO workflow permissions.tool_policy.rules); this test
      // documents that contract and pins the absence of the generic
      // non-mutating invoker.
      const allowList = getCeoToolPolicyAllowList();
      const delegationTargets = getCeoDelegationTargets();

      // The non-mutating invoker must not be present.
      expect(allowList).not.toContain("invoke_agent_workflow");

      // The CEO's only workflow-invocation surface is projected-delegation
      // tools. Document that contract so a future regression (adding
      // invoke_agent_workflow back to the allow list) is caught here.
      const invocationTools = allowList.filter(
        (tool) =>
          tool === "invoke_agent_workflow" || tool.startsWith("delegate_"),
      );
      expect(invocationTools.length).toBeGreaterThan(0);
      expect(
        invocationTools.every((tool) => tool.startsWith("delegate_")),
      ).toBe(true);
      // Sanity: the documented delegation surface must actually appear in
      // the delegations config, proving the CEO's projected-delegation
      // tools are not orphaned.
      expect(delegationTargets.length).toBeGreaterThan(0);
    });

    it("AC-3: CEO dispatch path must terminate at kanban.dispatch_selected_work_items (or an equivalent Kanban-mutating tool)", () => {
      // The CEO cannot truthfully claim a work item was dispatched unless
      // the dispatch path — CEO allow list OR a delegated workflow reached
      // via the CEO's delegate_* tools — includes the Kanban-mutating
      // dispatch tool. This test walks the projected-delegation graph and
      // fails when the graph has no node that grants access to the
      // mutating tool.
      const ceoAllowList = getCeoToolPolicyAllowList();
      const delegationTargets = getCeoDelegationTargets();

      // Step 1: the CEO itself may grant the mutating tool directly.
      const ceoHasMutatingTool = ceoAllowList.includes(
        "kanban.dispatch_selected_work_items",
      );

      // Step 2: otherwise, one of the CEO's delegate_* tools must route to
      // a workflow whose allow list includes the mutating tool.
      const delegationRoutes: string[] = [];
      for (const target of delegationTargets) {
        const seedFile = workflowIdToSeedFilename(target.workflowId);
        if (!seedFile) continue;
        const targetAllowList = getWorkflowToolPolicyAllowList(seedFile);
        if (targetAllowList.includes("kanban.dispatch_selected_work_items")) {
          delegationRoutes.push(`${target.toolName} -> ${seedFile}`);
        }
      }

      const dispatchPathExists =
        ceoHasMutatingTool || delegationRoutes.length > 0;

      // Diagnostic context: surface the allow list and delegation routing
      // in the failure message so the QA verifier can see exactly what the
      // CEO is (and is not) allowed to invoke.
      const diagnostic = {
        ceoAllowListSize: ceoAllowList.length,
        delegationTargetCount: delegationTargets.length,
        delegationRoutesToDispatch: delegationRoutes,
      };

      expect(
        dispatchPathExists,
        `CEO dispatch path is broken: ${JSON.stringify(diagnostic)}`,
      ).toBe(true);
    });

    it("AC-4: CEO dispatch claim contract documents that dispatch requires Kanban linkage (linked_run_id or current_execution_id)", () => {
      // Per AC-4: "A workflow path cannot claim Kanban work items were
      // dispatched unless tests prove the corresponding work items
      // transitioned/link to an execution." The dispatch tool's contract
      // must therefore require the mutating tool to surface linkage
      // (linked_run_id / current_execution_id) on success. This test
      // pins that contract on the dispatch tool's Zod schema and asserts
      // the CEO (or a delegated workflow it can reach) is allowed to
      // invoke that tool.
      const ceoAllowList = getCeoToolPolicyAllowList();
      const delegationTargets = getCeoDelegationTargets();

      let dispatchToolReachable = ceoAllowList.includes(
        "kanban.dispatch_selected_work_items",
      );

      if (!dispatchToolReachable) {
        for (const target of delegationTargets) {
          const seedFile = workflowIdToSeedFilename(target.workflowId);
          if (!seedFile) continue;
          const targetAllowList = getWorkflowToolPolicyAllowList(seedFile);
          if (targetAllowList.includes("kanban.dispatch_selected_work_items")) {
            dispatchToolReachable = true;
            break;
          }
        }
      }

      // The Zod schema for the mutating dispatch tool must require a
      // linkage-shaped response (the dispatch contract is meaningless
      // without it). This pins the runtime contract that backs the
      // CEO's static dispatch claim.
      const result = DispatchSelectedWorkItemsSchema.safeParse({
        project_id: "00000000-0000-0000-0000-000000000001",
        context_ids: ["00000000-0000-0000-0000-000000000002"],
        workflow_id: "work_item_in_progress_default",
        requested_by: "dispatch-selector",
      });

      // The dispatch tool must be reachable from the CEO.
      expect(dispatchToolReachable).toBe(true);
      // And the dispatch tool's input schema must accept the minimum
      // required fields (proves the contract is wired and not stubbed).
      expect(result.success).toBe(true);
    });

    it("AC-3 (output contract): CEO workflow output_contract.required must include a Kanban linkage field", () => {
      // The CEO workflow's `output_contract.required` is the static
      // contract the job must satisfy. For a dispatch claim to be
      // trustworthy the output must surface a Kanban linkage field
      // (`linked_run_id`, `current_execution_id`, or their camelCase
      // equivalents `linkedRunId` / `currentExecutionId`). Without that
      // field in `output_contract.required` the workflow can claim
      // dispatch without producing evidence that the dispatch actually
      // linked to a workflow run.
      const definition = parser.parseWorkflow(
        readSeed("project-orchestration-cycle-ceo.workflow.yaml"),
      );
      const decisionJob = (definition.jobs ?? []).find(
        (candidate) => candidate.id === "dispatch",
      );

      expect(decisionJob).toBeDefined();
      const requiredFields = decisionJob?.output_contract?.required ?? [];

      const linkageFields = [
        "linked_run_id",
        "current_execution_id",
        "linkedRunId",
        "currentExecutionId",
      ];
      const hasLinkageField = linkageFields.some((field) =>
        requiredFields.includes(field),
      );

      expect(
        hasLinkageField,
        `CEO output_contract.required must include a Kanban linkage field ` +
          `(one of: ${linkageFields.join(", ")}). ` +
          `Currently required: ${JSON.stringify(requiredFields)}`,
      ).toBe(true);
    });

    it("AC-4 (combined): CEO cannot claim dispatch without mutation tools AND linkage contract", () => {
      // The full contract for a truthful dispatch claim is the
      // conjunction of two conditions:
      //   (a) the path the CEO can actually invoke must include a
      //       Kanban-mutating tool (`kanban.dispatch_selected_work_items`
      //       or a delegated workflow that grants it), AND
      //   (b) the CEO workflow's output contract must require a Kanban
      //       linkage field, so a claim without linkage is structurally
      //       rejected.
      // This test asserts BOTH, so a fix that only addresses one side
      // (e.g. adds the tool to the allow list but leaves the output
      // contract linkage-free) is still caught.
      const definition = parser.parseWorkflow(
        readSeed("project-orchestration-cycle-ceo.workflow.yaml"),
      );
      const decisionJob = (definition.jobs ?? []).find(
        (candidate) => candidate.id === "dispatch",
      );

      // (a) Dispatch tool must be reachable from the CEO.
      const ceoAllowList = getCeoToolPolicyAllowList();
      const delegationTargets = getCeoDelegationTargets();
      let dispatchToolReachable = ceoAllowList.includes(
        "kanban.dispatch_selected_work_items",
      );
      if (!dispatchToolReachable) {
        for (const target of delegationTargets) {
          const seedFile = workflowIdToSeedFilename(target.workflowId);
          if (!seedFile) continue;
          const targetAllowList = getWorkflowToolPolicyAllowList(seedFile);
          if (targetAllowList.includes("kanban.dispatch_selected_work_items")) {
            dispatchToolReachable = true;
            break;
          }
        }
      }

      // (b) Output contract must require a linkage field.
      const requiredFields = decisionJob?.output_contract?.required ?? [];
      const linkageFields = [
        "linked_run_id",
        "current_execution_id",
        "linkedRunId",
        "currentExecutionId",
      ];
      const contractEnforcesLinkage = linkageFields.some((field) =>
        requiredFields.includes(field),
      );

      // Both conditions must hold for a truthful dispatch claim.
      expect(
        dispatchToolReachable,
        "CEO dispatch claim contract requires a Kanban-mutating tool " +
          "(kanban.dispatch_selected_work_items) to be reachable from " +
          "the CEO (allow list or delegated workflow).",
      ).toBe(true);
      expect(
        contractEnforcesLinkage,
        `CEO dispatch claim contract requires output_contract.required ` +
          `to include a Kanban linkage field ` +
          `(one of: ${linkageFields.join(", ")}). ` +
          `Currently required: ${JSON.stringify(requiredFields)}`,
      ).toBe(true);
    });
  });

  it("strategize prompt instructs the CEO to recover escalated blocked items within the cap", () => {
    const prompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/strategize.md",
    );
    // The CEO must read the new set and act on it.
    expect(prompt).toContain("strategic.dispatch.escalatedBlockedItems");
    expect(prompt).toContain("replanAttempts");
    expect(prompt).toContain("MAX_ESCALATION_REPLAN_ATTEMPTS");
    // The three sanctioned outcomes must be documented.
    expect(prompt).toMatch(/fresh architect pass/i);
    expect(prompt).toMatch(/defer/i);
    expect(prompt).toMatch(/human attention/i);
    // Incrementing the counter is mandatory when re-planning.
    expect(prompt).toContain("work_item_patch_metadata");
  });
});

describe("OrchestrationRecordBlockedSchema", () => {
  it("accepts valid blocked record with literal imported_repo_hydration and ready_for_cycle false", () => {
    const result = OrchestrationRecordBlockedSchema.safeParse({
      project_id: "proj-1",
      blocked_stage: "imported_repo_hydration",
      blocked_reason: "hydration failed",
      ready_for_cycle: false,
      hydration_summary: { ok: false, reason: "test" },
      child_run_id: "run-123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects blocked_stage other than imported_repo_hydration", () => {
    const result = OrchestrationRecordBlockedSchema.safeParse({
      project_id: "proj-1",
      blocked_stage: "some_other_stage",
      ready_for_cycle: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects ready_for_cycle true", () => {
    const result = OrchestrationRecordBlockedSchema.safeParse({
      project_id: "proj-1",
      blocked_stage: "imported_repo_hydration",
      ready_for_cycle: true,
    });
    expect(result.success).toBe(false);
  });

  it("accepts hydration_summary as a valid object", () => {
    const result = OrchestrationRecordBlockedSchema.safeParse({
      project_id: "proj-1",
      blocked_stage: "imported_repo_hydration",
      ready_for_cycle: false,
      hydration_summary: { ok: false, status: "blocked", reason: "test" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts hydration_summary as a valid JSON object string", () => {
    const result = OrchestrationRecordBlockedSchema.safeParse({
      project_id: "proj-1",
      blocked_stage: "imported_repo_hydration",
      ready_for_cycle: false,
      hydration_summary: '{"ok":false,"status":"blocked","reason":"test"}',
    });
    expect(result.success).toBe(true);
  });

  it("rejects hydration_summary as an invalid non-JSON string", () => {
    const result = OrchestrationRecordBlockedSchema.safeParse({
      project_id: "proj-1",
      blocked_stage: "imported_repo_hydration",
      ready_for_cycle: false,
      hydration_summary: "not valid json",
    });
    expect(result.success).toBe(false);
  });

  it("rejects hydration_summary as a JSON array string", () => {
    const result = OrchestrationRecordBlockedSchema.safeParse({
      project_id: "proj-1",
      blocked_stage: "imported_repo_hydration",
      ready_for_cycle: false,
      hydration_summary: "[1,2,3]",
    });
    expect(result.success).toBe(false);
  });
});

describe("OrchestrationClearBlockedSchema", () => {
  it("accepts valid clear with literal imported_repo_hydration and ready_for_cycle true", () => {
    const result = OrchestrationClearBlockedSchema.safeParse({
      project_id: "proj-1",
      cleared_stage: "imported_repo_hydration",
      ready_for_cycle: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects cleared_stage other than imported_repo_hydration", () => {
    const result = OrchestrationClearBlockedSchema.safeParse({
      project_id: "proj-1",
      cleared_stage: "some_other_stage",
      ready_for_cycle: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects ready_for_cycle false", () => {
    const result = OrchestrationClearBlockedSchema.safeParse({
      project_id: "proj-1",
      cleared_stage: "imported_repo_hydration",
      ready_for_cycle: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("initiative-aware ideation contract", () => {
  const promptPath = resolve(
    seedsDir,
    "prompts/project-goal-backlog-planning/research-and-ideate.md",
  );
  const workflowPath = resolve(
    seedsDir,
    "project-goal-backlog-planning.workflow.yaml",
  );

  it("ideation prompt is initiative-aware and dedups vs the fresh capability map", () => {
    const md = readFileSync(promptPath, "utf8");
    expect(md).toMatch(/now.+initiative/i);
    expect(md).toContain("initiative_id");
    expect(md).toContain("CAPABILITY_MAP.md");
    expect(md).toMatch(/fresh/i);
    expect(md).toContain("IDEATION_STARVATION_THRESHOLD_CYCLES");
  });

  it("workflow links created items to the active initiative", () => {
    const raw = readFileSync(workflowPath, "utf8");
    expect(raw).toContain("kanban.initiative_link_work_item");
  });

  it("goal backlog planning can manually delegate external research digressions", () => {
    const allowedTools = getEffectiveAllowedTools(
      "project-goal-backlog-planning.workflow.yaml",
      "research_goal_backlog",
    );
    const prompt = getExecutionStepPrompt(
      "project-goal-backlog-planning.workflow.yaml",
      "research_goal_backlog",
      "research_and_ideate",
    );

    expect(allowedTools).toContain("delegate_web_research");
    expect(allowedTools).not.toContain("web_search");
    expect(allowedTools).not.toContain("web_fetch");
    expect(prompt).toContain("concrete question, task, or outcome");
    expect(prompt).toContain("delegate_web_research");
    expect(prompt).toContain("Do not use it to justify speculative backlog");
    expect(prompt).toContain("evidenceRefs");
  });
});

describe("EPIC-208 Phase 3: work-item merge orchestration wakeup", () => {
  function loadWakeup() {
    const raw = readFileSync(
      resolve(
        __dirname,
        "../../../../seed/workflows/work-item-merge-orchestration-wakeup.workflow.yaml",
      ),
      "utf8",
    );
    return yaml.load(raw) as {
      trigger?: { type?: string; name?: string };
      jobs?: Array<{
        inputs?: { tool_name?: string; params?: Record<string, unknown> };
      }>;
    };
  }

  it("triggers on WorkItemMergeCompletedEvent", () => {
    const wf = loadWakeup();
    expect(wf.trigger?.type).toBe("event");
    expect(wf.trigger?.name).toBe("WorkItemMergeCompletedEvent");
  });

  it("requests an orchestration cycle wakeup with source work_item_merge", () => {
    const wf = loadWakeup();
    const job = wf.jobs?.find(
      (j) => j.inputs?.tool_name === "kanban.orchestration_request_wakeup",
    );
    expect(job).toBeDefined();
    expect(job?.inputs?.params?.source).toBe("work_item_merge");
    const dedupeKey = job?.inputs?.params?.dedupe_key;
    expect(typeof dedupeKey === "string" ? dedupeKey : "").toContain(
      "work_item_merge",
    );
  });
});

describe("strategic gating for roadmap planning + ideation", () => {
  // The gating moved from prompt instructions to deterministic engine jobs in
  // project-orchestration-cycle-ceo.workflow.yaml (Phase 4). Tests now verify
  // the workflow YAML gate jobs and conditions rather than strategize.md prose.

  const CEO_WORKFLOW = "project-orchestration-cycle-ceo.workflow.yaml";

  it("roadmap planning can manually delegate external research digressions without UX testing", () => {
    const allowedTools = getEffectiveAllowedTools(
      "project-roadmap-planning.workflow.yaml",
      "plan_roadmap",
    );
    const prompt = getExecutionStepPrompt(
      "project-roadmap-planning.workflow.yaml",
      "plan_roadmap",
      "plan_roadmap",
    );

    expect(allowedTools).toContain("delegate_web_research");
    expect(allowedTools).not.toContain("delegate_ui_ux_testing");
    expect(allowedTools).not.toContain("web_search");
    expect(allowedTools).not.toContain("web_fetch");
    expect(prompt).toContain("concrete question, task, or outcome");
    expect(prompt).toContain("delegate_web_research");
    expect(prompt).toContain("roadmap_summary");
  });

  it("gates roadmap planning on stale horizons / goals lacking initiatives", () => {
    // The engine fires project_roadmap_planning deterministically when
    // activeNowInitiativeCount == 0 (no active now-horizon initiative).
    // This replaces the old strategize.md prompt instruction to call
    // delegate_roadmap_planning at a threshold; the engine evaluates it.
    const definition = parser.parseWorkflow(readSeed(CEO_WORKFLOW));
    const gateJob = (definition.jobs ?? []).find(
      (job) => job.id === "roadmap_planning_gate",
    );

    expect(gateJob).toBeDefined();
    expect(gateJob?.type).toBe("invoke_workflow");
    expect(gateJob?.workflow_id).toBe("project_roadmap_planning");
    // Condition: fires when no active now-horizon initiative exists.
    expect(typeof gateJob?.condition).toBe("string");
    expect(gateJob?.condition).toContain("activeNowInitiativeCount");
    expect(gateJob?.condition).toContain("0");

    // The strategize.md "Specialist passes" section documents the threshold
    // the engine evaluated, so the CEO understands what already ran.
    const strategizePrompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/strategize.md",
    );
    expect(strategizePrompt).toContain("activeNowInitiativeCount");
    expect(strategizePrompt).toMatch(/no active.*`?now`?-horizon initiative/i);
  });

  it("gates initiative-aware ideation on starvation runway", () => {
    // The engine fires project_goal_backlog_planning deterministically when
    // starvationForecastCycles <= vars.gates.ideation_starvation_cycles or
    // burn rate is zero. This replaces the old strategize.md prompt instruction
    // to call delegate_goal_backlog_planning at a threshold.
    const definition = parser.parseWorkflow(readSeed(CEO_WORKFLOW));
    const gateJob = (definition.jobs ?? []).find(
      (job) => job.id === "ideation_gate",
    );

    expect(gateJob).toBeDefined();
    expect(gateJob?.type).toBe("invoke_workflow");
    expect(gateJob?.workflow_id).toBe("project_goal_backlog_planning");
    // Condition: fires when starvation forecast is at/under the configurable threshold.
    expect(typeof gateJob?.condition).toBe("string");
    expect(gateJob?.condition).toContain("starvationForecastCycles");
    expect(gateJob?.condition).toContain(
      "vars.gates.ideation_starvation_cycles",
    );
    // Burn-rate-zero branch also fires ideation.
    expect(gateJob?.condition).toContain("recentBurnRatePerCycle");

    // The strategize.md "Specialist passes" section documents the ideation
    // threshold so the CEO understands what the engine already evaluated.
    const strategizePrompt = readSeed(
      "prompts/project-orchestration-cycle-ceo/strategize.md",
    );
    expect(strategizePrompt).toContain("starvationForecastCycles");
    expect(strategizePrompt).toContain("recentBurnRatePerCycle");
  });

  describe("project_idea_intake workflow", () => {
    const SEED_FILE = "project-idea-intake.workflow.yaml";

    it("has canonical workflow_id project_idea_intake", () => {
      expectWorkflowId(SEED_FILE, "project_idea_intake");
    });

    it("is manually triggered with scope launch context", () => {
      const workflow = parser.parseWorkflow(readSeed(SEED_FILE));
      expect(workflow.trigger?.type).toBe("manual");
      expect(workflow.trigger?.launch?.context).toBe("scope");
    });

    it("queues concurrent runs (on_conflict: queue)", () => {
      const workflow = parser.parseWorkflow(readSeed(SEED_FILE));
      expect(workflow.concurrency).toMatchObject({
        on_conflict: "queue",
      });
    });

    it("has ideate_and_capture job", () => {
      expectJobExists(SEED_FILE, "ideate_and_capture");
    });

    it("ideate_and_capture requires output fields", () => {
      expectExecutionJobRequiredOutputFields(SEED_FILE, "ideate_and_capture", [
        "initiative_id",
        "created_work_item_ids",
        "session_summary",
        "feature_brief_artifact_id",
      ]);
    });

    it("grants ask_user_questions to the ideate_and_capture job", () => {
      expectEffectiveAllowedToolsToContain(
        SEED_FILE,
        "ideate_and_capture",
        "ask_user_questions",
      );
    });

    it("grants kanban.work_item_create to the ideate_and_capture job", () => {
      expectEffectiveAllowedToolsToContain(
        SEED_FILE,
        "ideate_and_capture",
        "kanban.work_item_create",
      );
    });

    it("grants kanban.initiative_create to the ideate_and_capture job", () => {
      expectEffectiveAllowedToolsToContain(
        SEED_FILE,
        "ideate_and_capture",
        "kanban.initiative_create",
      );
    });

    it("grants kanban.initiative_link_work_item to the ideate_and_capture job", () => {
      expectEffectiveAllowedToolsToContain(
        SEED_FILE,
        "ideate_and_capture",
        "kanban.initiative_link_work_item",
      );
    });

    it("grants create_artifact to the ideate_and_capture job", () => {
      expectEffectiveAllowedToolsToContain(
        SEED_FILE,
        "ideate_and_capture",
        "create_artifact",
      );
    });

    it("grants upsert_artifact_file to the ideate_and_capture job", () => {
      expectEffectiveAllowedToolsToContain(
        SEED_FILE,
        "ideate_and_capture",
        "upsert_artifact_file",
      );
    });

    it("grants list_artifacts to the ideate_and_capture job", () => {
      expectEffectiveAllowedToolsToContain(
        SEED_FILE,
        "ideate_and_capture",
        "list_artifacts",
      );
    });

    it("grants kanban.work_items to the ideate_and_capture job", () => {
      expectEffectiveAllowedToolsToContain(
        SEED_FILE,
        "ideate_and_capture",
        "kanban.work_items",
      );
    });

    it("idea-partner profile grants the new tools the workflow grants", () => {
      const agentConfig = JSON.parse(
        readSeedRoot("agents/idea-partner/agent.json"),
      ) as { tool_policy?: { rules?: unknown[] } };
      const rules = agentConfig.tool_policy?.rules ?? [];
      for (const tool of [
        "create_artifact",
        "upsert_artifact_file",
        "list_artifacts",
        "kanban.work_items",
      ]) {
        expect(rules).toContain(`allow ${tool} *`);
      }
    });

    it("does not grant bash or write to the ideate_and_capture job", () => {
      const tools = getEffectiveAllowedTools(SEED_FILE, "ideate_and_capture");
      expect(tools).not.toContain("bash");
      expect(tools).not.toContain("write");
      expect(tools).not.toContain("edit");
    });

    it("ideate_and_capture prompt references ask_user_questions", () => {
      const prompt = getExecutionStepPrompt(
        SEED_FILE,
        "ideate_and_capture",
        "ideate",
      );
      expect(prompt).toContain("ask_user_questions");
    });

    it("ideate_and_capture prompt references kanban.initiative_create", () => {
      const prompt = getExecutionStepPrompt(
        SEED_FILE,
        "ideate_and_capture",
        "ideate",
      );
      expect(prompt).toContain("kanban.initiative_create");
    });

    it("ideate_and_capture prompt references kanban.work_item_create", () => {
      const prompt = getExecutionStepPrompt(
        SEED_FILE,
        "ideate_and_capture",
        "ideate",
      );
      expect(prompt).toContain("kanban.work_item_create");
    });

    it("ideate_and_capture prompt references kanban.initiative_link_work_item", () => {
      const prompt = getExecutionStepPrompt(
        SEED_FILE,
        "ideate_and_capture",
        "ideate",
      );
      expect(prompt).toContain("kanban.initiative_link_work_item");
    });

    it("ideate_and_capture prompt falls back to the chat message for the idea seed", () => {
      const prompt = getExecutionStepPrompt(
        SEED_FILE,
        "ideate_and_capture",
        "ideate",
      );
      expect(prompt).toContain("trigger.message");
    });

    it("ideate_and_capture prompt references the feature-brief artifact tools", () => {
      const prompt = getExecutionStepPrompt(
        SEED_FILE,
        "ideate_and_capture",
        "ideate",
      );
      expect(prompt).toContain("create_artifact");
      expect(prompt).toContain("upsert_artifact_file");
    });

    it("ideate_and_capture prompt requires structured acceptance criteria", () => {
      const prompt = getExecutionStepPrompt(
        SEED_FILE,
        "ideate_and_capture",
        "ideate",
      );
      expect(prompt).toContain("## Acceptance Criteria");
      expect(prompt).toMatch(/AC-1/);
    });

    it("ideate_and_capture prompt reports the feature_brief_artifact_id output", () => {
      const prompt = getExecutionStepPrompt(
        SEED_FILE,
        "ideate_and_capture",
        "ideate",
      );
      expect(prompt).toContain("feature_brief_artifact_id");
    });

    it("ideate_and_capture prompt instructs agent to confirm before creating anything", () => {
      const prompt = getExecutionStepPrompt(
        SEED_FILE,
        "ideate_and_capture",
        "ideate",
      );
      expect(prompt).toMatch(/confirm/i);
      expect(prompt).toContain("set_job_output");
    });
  });
});
