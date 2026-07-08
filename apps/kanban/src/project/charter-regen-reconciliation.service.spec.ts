import { describe, expect, it, vi } from "vitest";
import { CharterRegenReconciliationService } from "./charter-regen-reconciliation.service";
import type { ProjectService } from "./project.service";
import type { CharterRegenEnqueuer } from "./charter-regen.enqueuer";

describe("CharterRegenReconciliationService", () => {
  it("enqueues regen for every project that has a base path", async () => {
    const projects = {
      list: vi.fn().mockResolvedValue([
        { id: "p1", basePath: "/clone/p1" },
        { id: "p2", basePath: null },
        { id: "p3", basePath: "/clone/p3" },
      ]),
    } as unknown as ProjectService;
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const enqueuer = { enqueue } as unknown as CharterRegenEnqueuer;

    const service = new CharterRegenReconciliationService(projects, enqueuer);
    const count = await service.reconcileAll();

    expect(count).toBe(2);
    expect(enqueue).toHaveBeenCalledWith("p1");
    expect(enqueue).toHaveBeenCalledWith("p3");
    expect(enqueue).not.toHaveBeenCalledWith("p2");
  });

  it("continues past a project that fails to enqueue", async () => {
    const projects = {
      list: vi.fn().mockResolvedValue([
        { id: "p1", basePath: "/clone/p1" },
        { id: "p2", basePath: "/clone/p2" },
      ]),
    } as unknown as ProjectService;
    const enqueue = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const enqueuer = { enqueue } as unknown as CharterRegenEnqueuer;

    const service = new CharterRegenReconciliationService(projects, enqueuer);
    const count = await service.reconcileAll();

    expect(count).toBe(1);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });
});
