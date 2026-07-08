import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanSettingRepository } from "../database/repositories/kanban-setting.repository";
import { KANBAN_SETTING_DEFAULTS } from "./kanban-settings.constants";
import { KanbanSettingsService } from "./kanban-settings.service";

const now = new Date("2026-05-30T00:00:00.000Z");

type SettingRow = {
  key: string;
  value: unknown;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

describe("KanbanSettingsService", () => {
  const rows = new Map<string, SettingRow>();

  let service: KanbanSettingsService;

  beforeEach(() => {
    rows.clear();
    const repository = {
      findAll: vi.fn(() =>
        Promise.resolve(
          [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)),
        ),
      ),
      findByKey: vi.fn((key: string) => Promise.resolve(rows.get(key) ?? null)),
      upsert: vi.fn(
        (key: string, value: unknown, description?: string | null) => {
          const existing = rows.get(key);
          const row = {
            key,
            value,
            description:
              description === undefined
                ? (existing?.description ?? null)
                : description,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          rows.set(key, row);
          return Promise.resolve(row);
        },
      ),
    } as unknown as KanbanSettingRepository;

    service = new KanbanSettingsService(repository);
  });

  it("seeds all Kanban setting defaults", async () => {
    await service.seedDefaults();

    expect(rows.size).toBe(Object.keys(KANBAN_SETTING_DEFAULTS).length);
    expect(rows.get("work_item_dispatch_max_active_per_project")).toMatchObject(
      {
        value:
          KANBAN_SETTING_DEFAULTS.work_item_dispatch_max_active_per_project
            .value,
      },
    );
  });

  it("normalizes numeric settings through configured bounds", async () => {
    await service.set("work_item_dispatch_max_active_per_project", "999");

    await expect(
      service.getNumber("work_item_dispatch_max_active_per_project"),
    ).resolves.toBe(50);
  });

  it("rejects unknown setting keys", async () => {
    await expect(
      service.set("core_system_setting", true),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
