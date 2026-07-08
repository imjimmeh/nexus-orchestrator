import { describe, it, expect, vi } from "vitest";
import { CharterDocRenderService } from "./charter-doc-render.service";

const goals = { listGoals: vi.fn() };
const memories = { getCharterMemories: vi.fn() };
const svc = new CharterDocRenderService(goals as never, memories as never);

describe("CharterDocRenderService", () => {
  it("renders Goals from board goals and sections from memories in canonical order", async () => {
    goals.listGoals.mockResolvedValue([
      {
        title: "Ship MVP",
        status: "in_progress",
        moscow: "must",
        priority: "p0",
        description: "launch",
      },
    ]);
    memories.getCharterMemories.mockResolvedValue([
      {
        id: "1",
        content: "Be the best",
        memory_type: "fact",
        metadata: { category: "vision" },
        created_at: "",
        updated_at: "",
      },
      {
        id: "2",
        content: "Support SSO",
        memory_type: "fact",
        metadata: { category: "requirement" },
        created_at: "",
        updated_at: "",
      },
    ]);
    const md = await svc.render("proj-1");
    expect(md).toContain("# Project Charter");
    expect(md.indexOf("## Vision")).toBeLessThan(md.indexOf("## Goals"));
    expect(md.indexOf("## Goals")).toBeLessThan(md.indexOf("## Requirements"));
    expect(md).toContain("Be the best");
    expect(md).toContain("Ship MVP");
    expect(md).toContain("Support SSO");
  });
});
