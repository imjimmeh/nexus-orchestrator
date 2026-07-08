import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { KanbanSettingsController } from "./kanban-settings.controller";
import type { KanbanSettingsService } from "./kanban-settings.service";

const setting = {
  key: "work_item_dispatch_max_active_per_project" as const,
  value: 3,
  description: "Maximum active work items",
  createdAt: "2026-05-30T00:00:00.000Z",
  updatedAt: "2026-05-30T00:00:00.000Z",
};

describe("KanbanSettingsController", () => {
  it("lists Kanban settings with the standard envelope", async () => {
    const service = {
      getAll: vi.fn(() => Promise.resolve([setting])),
    } as unknown as KanbanSettingsService;
    const controller = new KanbanSettingsController(service);

    await expect(controller.list()).resolves.toEqual({
      success: true,
      data: [setting],
    });
  });

  it("updates a Kanban setting after validating body shape", async () => {
    const setMock = vi.fn(() => Promise.resolve({ ...setting, value: 1 }));
    const service = {
      set: setMock,
    } as unknown as KanbanSettingsService;
    const controller = new KanbanSettingsController(service);

    await expect(
      controller.update("work_item_dispatch_max_active_per_project", {
        value: 1,
      }),
    ).resolves.toEqual({ success: true, data: { ...setting, value: 1 } });
    expect(setMock).toHaveBeenCalledWith(
      "work_item_dispatch_max_active_per_project",
      1,
      undefined,
    );
  });

  it("rejects invalid update bodies", async () => {
    const service = {} as KanbanSettingsService;
    const controller = new KanbanSettingsController(service);

    await expect(
      controller.update("work_item_dispatch_max_active_per_project", null),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.update("work_item_dispatch_max_active_per_project", {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
