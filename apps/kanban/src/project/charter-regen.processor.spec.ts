import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { CharterRegenProcessor } from "./charter-regen.processor";
import type { CharterDocRenderService } from "./charter-doc-render.service";
import type { ProjectService } from "./project.service";
import type { CoreWorkflowClientService } from "../core/core-workflow-client.service";

function makeJob(projectId: string): Job {
  return { data: { projectId } } as unknown as Job;
}

describe("CharterRegenProcessor", () => {
  it("renders and writes the charter to the project base path", async () => {
    const render = {
      render: vi.fn().mockResolvedValue("# Project Charter\n"),
    } as unknown as CharterDocRenderService;
    const projects = {
      get: vi.fn().mockResolvedValue({ id: "p1", basePath: "/clone/p1" }),
    } as unknown as ProjectService;
    const writeRepoFile = vi.fn().mockResolvedValue({ committed: true });
    const core = { writeRepoFile } as unknown as CoreWorkflowClientService;

    const processor = new CharterRegenProcessor(render, projects, core);
    await processor.process(makeJob("p1"));

    expect(writeRepoFile).toHaveBeenCalledWith({
      repoPath: "/clone/p1",
      filePath: "docs/project-context/CHARTER.md",
      content: "# Project Charter\n",
      message: "docs(charter): regenerate from project intent",
      push: true,
    });
  });

  it("re-throws so BullMQ retries when the git write fails", async () => {
    const render = {
      render: vi.fn().mockResolvedValue("# Project Charter\n"),
    } as unknown as CharterDocRenderService;
    const projects = {
      get: vi.fn().mockResolvedValue({ id: "p1", basePath: "/clone/p1" }),
    } as unknown as ProjectService;
    const core = {
      writeRepoFile: vi.fn().mockRejectedValue(new Error("push rejected")),
    } as unknown as CoreWorkflowClientService;

    const processor = new CharterRegenProcessor(render, projects, core);

    await expect(() => processor.process(makeJob("p1"))).rejects.toThrow(
      "push rejected",
    );
  });

  it("skips (no throw) when the project has no base path", async () => {
    const render = { render: vi.fn() } as unknown as CharterDocRenderService;
    const projects = {
      get: vi.fn().mockResolvedValue({ id: "p1", basePath: null }),
    } as unknown as ProjectService;
    const writeRepoFile = vi.fn();
    const core = { writeRepoFile } as unknown as CoreWorkflowClientService;

    const processor = new CharterRegenProcessor(render, projects, core);
    await processor.process(makeJob("p1"));
    expect(writeRepoFile).not.toHaveBeenCalled();
  });
});
