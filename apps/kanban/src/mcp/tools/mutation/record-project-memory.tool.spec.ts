import { describe, expect, it, vi } from "vitest";
import { RecordProjectMemoryTool } from "./record-project-memory.tool";

describe("kanban.record_project_memory", () => {
  const ctx = {} as never;
  it("has the kanban-prefixed name", () => {
    const tool = new RecordProjectMemoryTool({
      createProjectMemory: vi.fn(),
    } as never);
    expect(tool.getName()).toBe("kanban.record_project_memory");
  });

  it("delegates to createProjectMemory with onboarding_chat source and echoes category", async () => {
    const createProjectMemory = vi.fn().mockResolvedValue({ id: "seg-1" });
    const tool = new RecordProjectMemoryTool({ createProjectMemory } as never);
    const result = await tool.execute(ctx, {
      scope_id: "proj-1",
      category: "requirement",
      content: "must support SSO",
      confidence: 0.8,
    });
    expect(createProjectMemory).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        category: "requirement",
        content: "must support SSO",
        source: "onboarding_chat",
        confidence: 0.8,
      }),
    );
    expect(result).toEqual({ id: "seg-1", category: "requirement" });
  });
});
