import { describe, expect, it } from "vitest";
import { toJSONSchema } from "zod";
import {
  createAgentProfileSchema,
  createScheduleSchema,
  webFetchInputSchema,
  invokeAgentWorkflowSchema,
  manageTodoListBodySchema,
  playbookIdentitySchema,
  queryMemoryBodySchema,
  readPlaybookSchema,
  readSkillManifestSchema,
  readWorkflowSummarySchema,
  recordLearningBodySchema,
  rememberBodySchema,
  searchPlaybooksSchema,
  searchSkillsSchema,
  searchWorkflowsSchema,
  skillManifestIdentitySchema,
  strategicIntentBodySchema,
  webSearchInputSchema,
} from "./workflow-runtime-inputs.schemas";
import {
  runtimeQueryMemoryBodySchema,
  runtimeRecordLearningBodySchema,
  runtimeRememberBodySchema,
} from "./workflow-runtime-lifecycle.schema";
import type { RuntimeRecordLearningBody } from "./workflow-runtime-inputs.types";
import { ScheduledJobScope } from "../../interfaces";

const validRecordLearningInput = {
  scope_type: "workflow_run",
  scope_id: "run-1",
  lesson: "Prefer narrow schema changes for governed runtime tools.",
  evidence: [
    {
      kind: "test",
      id: "workflow-runtime-inputs.schemas.spec.ts",
      summary: "Schema coverage describes the governed input contract.",
    },
  ],
  confidence: 0.82,
  tags: ["runtime", "learning"],
};

const validRuntimeRecordLearningInput: RuntimeRecordLearningBody = {
  ...validRecordLearningInput,
  workflow_run_id: "run-1",
  job_id: "job-1",
};

// EPIC-208 (Milestone 1) — canonical strategic-intent payload reused by the
// strategicIntentBodySchema and runtime strategic intent describe blocks.
const validStrategicIntent = {
  horizon: "Q1-2026",
  priority_themes: ["autonomous development", "agent self-improvement"],
  focus_areas: ["memory schema coverage"],
  constraints: ["no silent lint regressions"],
  rationale: "Lean into memory schema coverage this cycle.",
  updated_at: "2026-06-19T12:00:00.000Z",
  updated_by: "ceo",
};

describe("invokeAgentWorkflowSchema", () => {
  it("accepts the documented generic payload", () => {
    const parsed = invokeAgentWorkflowSchema.parse({
      agent_profile: "product-manager",
      task_prompt: "Draft PRD",
      context: { type: "external_domain", id: "ctx-1" },
      trigger_data: { scope_id: "scope-1" },
      reasoning: "kick off PRD authoring",
    });

    expect(parsed.agent_profile).toBe("product-manager");
    expect(parsed.task_prompt).toBe("Draft PRD");
    expect(parsed.context).toEqual({ type: "external_domain", id: "ctx-1" });
    expect(parsed.trigger_data).toEqual({ scope_id: "scope-1" });
    expect(parsed.reasoning).toBe("kick off PRD authoring");
  });

  it("accepts `reason` as an alias for `reasoning`", () => {
    const parsed = invokeAgentWorkflowSchema.parse({
      agent_profile: "product-manager",
      reason: "kick off PRD authoring",
    });

    expect(parsed.reason).toBe("kick off PRD authoring");
  });

  it("does not reject unknown extra keys", () => {
    expect(() =>
      invokeAgentWorkflowSchema.parse({
        agent_profile: "product-manager",
        extra_hint: "ignore me",
        nested: { foo: "bar" },
      }),
    ).not.toThrow();
  });

  it("does not require domain-specific identifiers", () => {
    expect(() =>
      invokeAgentWorkflowSchema.parse({
        agent_profile: "product-manager",
      }),
    ).not.toThrow();
  });
});

describe("createScheduleSchema", () => {
  it("requires scope_id when schedule_scope is scope", () => {
    const validData = {
      scope_id: "scope-1",
      schedule_scope: ScheduledJobScope.SCOPE,
      name: "test-schedule",
      schedule_type: "cron",
      schedule_expression: "0 * * * *",
      workflow_id: "wf-1",
    };

    expect(() => createScheduleSchema.parse(validData)).not.toThrow();

    const invalidData = {
      ...validData,
      scope_id: undefined,
    };

    const result = createScheduleSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("scope_id");
      expect(result.error.issues[0].message).toContain("scope_id is required");
    }
  });

  it("does not require scope_id when schedule_scope is global", () => {
    const validData = {
      schedule_scope: ScheduledJobScope.GLOBAL,
      name: "global-schedule",
      schedule_type: "cron",
      schedule_expression: "0 * * * *",
      workflow_id: "wf-1",
    };

    expect(() => createScheduleSchema.parse(validData)).not.toThrow();
  });
});

describe("recordLearningBodySchema", () => {
  it("accepts neutral learning candidates and strips unknown keys", () => {
    const parsed = recordLearningBodySchema.parse({
      ...validRecordLearningInput,
      extra_scope: "scope-1",
      extra: "ignored",
    });

    expect(parsed).toEqual(validRecordLearningInput);
  });

  it("accepts omitted and null scope_id only for global scope", () => {
    expect(
      recordLearningBodySchema.parse({
        ...validRecordLearningInput,
        scope_type: "global",
        scope_id: undefined,
      }),
    ).toMatchObject({ scope_type: "global" });

    expect(
      recordLearningBodySchema.parse({
        ...validRecordLearningInput,
        scope_type: "global",
        scope_id: null,
      }),
    ).toMatchObject({ scope_type: "global", scope_id: null });
  });

  it("requires confidence to be between zero and one", () => {
    expect(
      recordLearningBodySchema.safeParse({
        ...validRecordLearningInput,
        confidence: -0.01,
      }).success,
    ).toBe(false);
    expect(
      recordLearningBodySchema.safeParse({
        ...validRecordLearningInput,
        confidence: 1.01,
      }).success,
    ).toBe(false);
  });

  it("requires evidence kind, id, and summary", () => {
    const result = recordLearningBodySchema.safeParse({
      ...validRecordLearningInput,
      evidence: [{ kind: "test", id: "case-1" }],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an empty evidence array", () => {
    const result = recordLearningBodySchema.safeParse({
      ...validRecordLearningInput,
      evidence: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects evidence entries missing kind", () => {
    const result = recordLearningBodySchema.safeParse({
      ...validRecordLearningInput,
      evidence: [
        {
          id: "case-1",
          summary: "Evidence cannot omit its source kind.",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects evidence entries missing id", () => {
    const result = recordLearningBodySchema.safeParse({
      ...validRecordLearningInput,
      evidence: [
        {
          kind: "test",
          summary: "Evidence cannot omit its source id.",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("defaults omitted tags to an empty array", () => {
    const parsed = recordLearningBodySchema.parse({
      ...validRecordLearningInput,
      tags: undefined,
    });

    expect(parsed.tags).toEqual([]);
  });

  it("rejects workflow_run scope without scope_id", () => {
    const result = recordLearningBodySchema.safeParse({
      ...validRecordLearningInput,
      scope_id: undefined,
    });

    expect(result.success).toBe(false);
  });
});

describe("runtimeRecordLearningBodySchema", () => {
  it("accepts runtime identifiers with the record learning body shape", () => {
    const parsed = runtimeRecordLearningBodySchema.parse(
      validRuntimeRecordLearningInput,
    );

    expect(parsed).toEqual(validRuntimeRecordLearningInput);
  });
});

describe("queryMemoryBodySchema", () => {
  it("accepts neutral learning scopes used by promoted runtime learning", () => {
    expect(
      queryMemoryBodySchema.parse({
        entity_type: "workflow_run",
        entity_id: "run-1",
        query: "deterministic repair tests",
        memory_type: "fact",
      }),
    ).toEqual({
      entity_type: "workflow_run",
      entity_id: "run-1",
      query: "deterministic repair tests",
      memory_type: "fact",
      include_provenance: true,
    });
  });

  it("accepts include_learning when explicitly true", () => {
    expect(
      queryMemoryBodySchema.safeParse({
        entity_type: "User",
        entity_id: "u1",
        include_learning: true,
      }).success,
    ).toBe(true);
  });

  it("accepts omitted include_learning (default behaviour unchanged)", () => {
    expect(
      queryMemoryBodySchema.safeParse({
        entity_type: "User",
        entity_id: "u1",
      }).success,
    ).toBe(true);
  });

  it("rejects non-boolean include_learning", () => {
    const result = queryMemoryBodySchema.safeParse({
      entity_type: "User",
      entity_id: "u1",
      include_learning: "yes",
    });
    expect(result.success).toBe(false);
  });

  it("serializes to an object-rooted JSON schema so strict providers accept the tool", () => {
    const jsonSchema = toJSONSchema(queryMemoryBodySchema, {
      unrepresentable: "any",
    }) as Record<string, unknown>;

    expect(jsonSchema.type).toBe("object");
  });

  it("defaults include_provenance to true when omitted", () => {
    const parsed = queryMemoryBodySchema.parse({
      entity_type: "User",
      entity_id: "u1",
    });
    expect(parsed.include_provenance).toBe(true);
  });

  it("accepts include_provenance when explicitly true", () => {
    const parsed = queryMemoryBodySchema.parse({
      entity_type: "User",
      entity_id: "u1",
      include_provenance: true,
    });
    expect(parsed.include_provenance).toBe(true);
  });

  it("accepts include_provenance when explicitly false", () => {
    const parsed = queryMemoryBodySchema.parse({
      entity_type: "User",
      entity_id: "u1",
      include_provenance: false,
    });
    expect(parsed.include_provenance).toBe(false);
  });

  it("rejects non-boolean include_provenance", () => {
    const result = queryMemoryBodySchema.safeParse({
      entity_type: "User",
      entity_id: "u1",
      include_provenance: "yes",
    });
    expect(result.success).toBe(false);
  });
});

describe("manageTodoListBodySchema", () => {
  it("serializes to an object-rooted JSON schema so strict providers accept the tool", () => {
    const jsonSchema = toJSONSchema(manageTodoListBodySchema, {
      unrepresentable: "any",
    }) as Record<string, unknown>;

    expect(jsonSchema.type).toBe("object");
  });

  it("accepts the camelCase todoList shape", () => {
    const parsed = manageTodoListBodySchema.parse({
      workflow_run_id: "run-1",
      todoList: [
        {
          id: "todo-1",
          title: "Implement runtime context projection",
          status: "in-progress",
        },
      ],
    });

    expect(parsed.todoList).toHaveLength(1);
  });

  it("rejects a payload that omits both list shapes", () => {
    const result = manageTodoListBodySchema.safeParse({
      workflow_run_id: "run-1",
    });

    expect(result.success).toBe(false);
  });

  it("preserves canonical source context identifiers", () => {
    const parsed = manageTodoListBodySchema.parse({
      workflow_run_id: "run-1",
      todo_list: [
        {
          id: "todo-1",
          title: "Implement runtime context projection",
          status: "in-progress",
          source_context_item_id: "ctx-3",
        },
      ],
    });

    expect(parsed).toEqual({
      workflow_run_id: "run-1",
      todo_list: [
        {
          id: "todo-1",
          title: "Implement runtime context projection",
          status: "in-progress",
          source_context_item_id: "ctx-3",
        },
      ],
    });
  });

  it("strips non-canonical context aliases", () => {
    const parsed = manageTodoListBodySchema.parse({
      workflow_run_id: "run-1",
      todo_list: [
        {
          id: "todo-1",
          title: "Implement runtime context projection",
          status: "in-progress",
          context_item_id: "ctx-1",
          contextItemId: "ctx-2",
        },
      ],
    });

    expect(parsed).toEqual({
      workflow_run_id: "run-1",
      todo_list: [
        {
          id: "todo-1",
          title: "Implement runtime context projection",
          status: "in-progress",
        },
      ],
    });
  });

  it("normalises underscore_case status values from AI models to their hyphenated canonical form", () => {
    const parsed = manageTodoListBodySchema.parse({
      workflow_run_id: "run-1",
      todo_list: [
        { id: "1", title: "Task A", status: "in_progress" },
        { id: "2", title: "Task B", status: "not_started" },
        { id: "3", title: "Task C", status: "completed" },
      ],
    });

    const statuses = parsed.todo_list!.map((t) => t.status);
    expect(statuses).toEqual(["in-progress", "not-started", "completed"]);
  });
});

describe("runtimeQueryMemoryBodySchema", () => {
  it("accepts neutral learning scopes through the runtime endpoint contract", () => {
    expect(
      runtimeQueryMemoryBodySchema.parse({
        workflow_run_id: "run-ctx",
        job_id: "job-ctx",
        entity_type: "workflow_run",
        entity_id: "run-1",
        query: "deterministic repair tests",
        memory_type: "fact",
      }),
    ).toEqual({
      workflow_run_id: "run-ctx",
      job_id: "job-ctx",
      entity_type: "workflow_run",
      entity_id: "run-1",
      query: "deterministic repair tests",
      memory_type: "fact",
      include_provenance: true,
    });
  });
});

describe("rememberBodySchema scope values (Epic C)", () => {
  const base = {
    content: "The dev DB only accepts the nexus_dev role on port 5433.",
  };

  it.each(["project", "global", "agent", "workflow"] as const)(
    "accepts scope '%s'",
    (scope) => {
      const parsed = rememberBodySchema.parse({ ...base, scope });
      expect(parsed.scope).toBe(scope);
    },
  );

  it("rejects an unknown scope", () => {
    expect(() =>
      rememberBodySchema.parse({ ...base, scope: "team" }),
    ).toThrow();
  });
});

describe("runtimeRememberBodySchema", () => {
  it("accepts the agent remember payload plus optional run/job context", () => {
    expect(
      runtimeRememberBodySchema.parse({
        workflow_run_id: "run-ctx",
        job_id: "job-ctx",
        content: "Place git diff formatting options before positional refs.",
        memory_type: "fact",
        scope: "project",
        tags: ["git"],
        origin: "discovery",
      }),
    ).toEqual({
      workflow_run_id: "run-ctx",
      job_id: "job-ctx",
      content: "Place git diff formatting options before positional refs.",
      memory_type: "fact",
      scope: "project",
      tags: ["git"],
      origin: "discovery",
    });
  });

  it("applies remember defaults and works without run/job context", () => {
    expect(
      runtimeRememberBodySchema.parse({
        content: "Place git diff formatting options before positional refs.",
      }),
    ).toEqual({
      content: "Place git diff formatting options before positional refs.",
      memory_type: "fact",
      scope: "project",
      tags: [],
      origin: "discovery",
    });
  });
});

describe("workflow runtime discovery schemas", () => {
  it("accepts workflow search filters and rejects empty workflow summary ids", () => {
    expect(
      searchWorkflowsSchema.parse({
        query: "review",
        include_inactive: true,
        limit: 10,
        offset: 0,
      }),
    ).toEqual({
      query: "review",
      include_inactive: true,
      limit: 10,
      offset: 0,
    });

    expect(
      readWorkflowSummarySchema.safeParse({ workflow_id: "" }).success,
    ).toBe(false);
  });

  it("accepts both database-backed and seed discovery skill inputs", () => {
    expect(
      searchSkillsSchema.parse({
        query: "code",
        category: "debugging",
        tags: ["review"],
        limit: 20,
        offset: 0,
      }),
    ).toEqual({
      query: "code",
      category: "debugging",
      tags: ["review"],
      limit: 20,
      offset: 0,
    });

    expect(skillManifestIdentitySchema.parse({ skill_id: "skill-1" })).toEqual({
      skill_id: "skill-1",
    });
    expect(skillManifestIdentitySchema.parse({ skill_dir: "skill-1" })).toEqual(
      {
        skill_dir: "skill-1",
      },
    );
    expect(readSkillManifestSchema.parse({ name: "legacy-skill" })).toEqual({
      name: "legacy-skill",
    });
  });

  it("accepts both database-backed and seed discovery playbook inputs", () => {
    expect(
      searchPlaybooksSchema.parse({
        query: "release",
        category: "testing",
        tags: ["planning"],
        limit: 20,
        offset: 0,
      }),
    ).toEqual({
      query: "release",
      category: "testing",
      tags: ["planning"],
      limit: 20,
      offset: 0,
    });

    expect(playbookIdentitySchema.parse({ playbook_id: "playbook-1" })).toEqual(
      {
        playbook_id: "playbook-1",
      },
    );
    expect(readPlaybookSchema.parse({ name: "legacy-playbook" })).toEqual({
      name: "legacy-playbook",
    });
  });
});

describe("createAgentProfileSchema", () => {
  it("accepts separated provider references for agent profile creation", () => {
    const parsed = createAgentProfileSchema.parse({
      scope_id: "scope-1",
      profile_name: "builder",
      allowed_tools: [],
      provider_source: "user",
      provider_name: "openai",
      model_name: "gpt-5.5",
    });

    expect(parsed.provider_source).toBe("user");
  });
});

describe("strategicIntentBodySchema", () => {
  it("accepts a complete strategic intent payload", () => {
    const parsed = strategicIntentBodySchema.parse(validStrategicIntent);

    expect(parsed).toEqual(validStrategicIntent);
  });

  it("defaults updated_by to 'ceo' and keeps omitted arrays as empty", () => {
    const parsed = strategicIntentBodySchema.parse({
      horizon: "30-day",
    });

    expect(parsed).toEqual({
      horizon: "30-day",
      priority_themes: [],
      focus_areas: [],
      constraints: [],
      updated_by: "ceo",
    });
  });

  it("trims whitespace and strips unknown keys", () => {
    const parsed = strategicIntentBodySchema.parse({
      ...validStrategicIntent,
      horizon: "  Q1-2026  ",
      priority_themes: ["  autonomous development  "],
      focus_areas: ["  memory schema coverage  "],
      extra_field: "ignored",
    });

    expect(parsed.horizon).toBe("Q1-2026");
    expect(parsed.priority_themes).toEqual(["autonomous development"]);
    expect(parsed.focus_areas).toEqual(["memory schema coverage"]);
    expect(parsed).not.toHaveProperty("extra_field");
  });

  it("rejects an empty horizon", () => {
    expect(
      strategicIntentBodySchema.safeParse({
        ...validStrategicIntent,
        horizon: "   ",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-ISO updated_at", () => {
    expect(
      strategicIntentBodySchema.safeParse({
        ...validStrategicIntent,
        updated_at: "yesterday",
      }).success,
    ).toBe(false);
  });

  it("rejects an empty updated_by when explicitly provided", () => {
    expect(
      strategicIntentBodySchema.safeParse({
        ...validStrategicIntent,
        updated_by: "",
      }).success,
    ).toBe(false);
  });

  it("rejects oversized array entries and array counts", () => {
    expect(
      strategicIntentBodySchema.safeParse({
        ...validStrategicIntent,
        priority_themes: ["x".repeat(201)],
      }).success,
    ).toBe(false);

    const tooManyThemes = Array.from(
      { length: 33 },
      (_, index) => `theme-${index}`,
    );
    expect(
      strategicIntentBodySchema.safeParse({
        ...validStrategicIntent,
        priority_themes: tooManyThemes,
      }).success,
    ).toBe(false);
  });

  it("serializes to an object-rooted JSON schema so strict providers accept the tool", () => {
    const jsonSchema = toJSONSchema(strategicIntentBodySchema, {
      unrepresentable: "any",
    }) as Record<string, unknown>;

    expect(jsonSchema.type).toBe("object");
    expect(jsonSchema.properties).toMatchObject({
      horizon: expect.objectContaining({ type: "string" }),
      updated_by: expect.objectContaining({ type: "string" }),
    });
  });
});

describe("webSearchInputSchema", () => {
  it("serializes to an object-rooted JSON schema", () => {
    const jsonSchema = toJSONSchema(webSearchInputSchema, {
      unrepresentable: "any",
    }) as Record<string, unknown>;

    expect(jsonSchema.type).toBe("object");
  });

  it("defaults search controls and bounds max_results", () => {
    const parsed = webSearchInputSchema.parse({ query: "nexus docs" });

    expect(parsed).toEqual({
      query: "nexus docs",
      max_results: 5,
      safe_search: "moderate",
      freshness: "any",
    });
    expect(
      webSearchInputSchema.safeParse({ query: "x", max_results: 11 }).success,
    ).toBe(false);
  });
});

describe("webFetchInputSchema", () => {
  it("serializes to an object-rooted JSON schema", () => {
    const jsonSchema = toJSONSchema(webFetchInputSchema, {
      unrepresentable: "any",
    }) as Record<string, unknown>;

    expect(jsonSchema.type).toBe("object");
  });

  it("defaults fetch controls and bounds timeout and size", () => {
    const parsed = webFetchInputSchema.parse({ url: "https://example.com" });

    expect(parsed).toEqual({
      url: "https://example.com",
      format: "text",
      max_bytes: 100000,
      timeout_ms: 10000,
    });
    expect(
      webFetchInputSchema.safeParse({
        url: "https://example.com",
        max_bytes: 1000001,
      }).success,
    ).toBe(false);
    expect(
      webFetchInputSchema.safeParse({
        url: "https://example.com",
        timeout_ms: 60001,
      }).success,
    ).toBe(false);
  });
});
