import { BadRequestException, Injectable, OnModuleInit } from "@nestjs/common";
import type { KanbanSetting, KanbanSettingKey } from "@nexus/kanban-contracts";
import { KanbanSettingRepository } from "../database/repositories/kanban-setting.repository";
import {
  KANBAN_SETTING_DEFAULTS,
  isKanbanSettingKey,
} from "./kanban-settings.constants";

@Injectable()
export class KanbanSettingsService implements OnModuleInit {
  constructor(private readonly repository: KanbanSettingRepository) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaults();
  }

  async getAll(): Promise<KanbanSetting[]> {
    return (await this.repository.findAll()).map((setting) =>
      this.toContract(setting),
    );
  }

  async get<T>(key: KanbanSettingKey, fallback?: T): Promise<T> {
    const setting = await this.repository.findByKey(key);
    const value =
      setting?.value ?? fallback ?? KANBAN_SETTING_DEFAULTS[key].value;
    return value as T;
  }

  async getNumber(key: KanbanSettingKey): Promise<number> {
    const definition = KANBAN_SETTING_DEFAULTS[key];
    return this.normalizeNumber(
      await this.get<unknown>(key),
      Number(definition.value),
      {
        min: definition.min,
        max: definition.max,
        integer: true,
      },
    );
  }

  async getBoolean(key: KanbanSettingKey): Promise<boolean> {
    const definition = KANBAN_SETTING_DEFAULTS[key];
    return this.normalizeBoolean(
      await this.get<unknown>(key),
      Boolean(definition.value),
    );
  }

  async set(
    key: string,
    value: unknown,
    description?: string | null,
  ): Promise<KanbanSetting> {
    const settingKey = this.requireKnownKey(key);
    const saved = await this.repository.upsert(settingKey, value, description);
    return this.toContract(saved);
  }

  async seedDefaults(): Promise<void> {
    for (const [key, definition] of Object.entries(KANBAN_SETTING_DEFAULTS)) {
      const existing = await this.repository.findByKey(key);
      if (!existing) {
        await this.repository.upsert(
          key,
          definition.value,
          definition.description,
        );
      }
    }
  }

  private requireKnownKey(key: string): KanbanSettingKey {
    if (!isKanbanSettingKey(key)) {
      throw new BadRequestException(`Unknown Kanban setting: ${key}`);
    }
    return key;
  }

  private toContract(setting: {
    key: string;
    value: unknown;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): KanbanSetting {
    return {
      key: this.requireKnownKey(setting.key),
      value: setting.value,
      description: setting.description,
      createdAt: setting.createdAt.toISOString(),
      updatedAt: setting.updatedAt.toISOString(),
    };
  }

  private normalizeBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      if (value === "true" || value === "1") return true;
      if (value === "false" || value === "0") return false;
    }
    return fallback;
  }

  private normalizeNumber(
    value: unknown,
    fallback: number,
    bounds: { min?: number; max?: number; integer?: boolean },
  ): number {
    let parsed = Number.NaN;
    if (typeof value === "number") parsed = value;
    if (typeof value === "string") parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;

    let normalized = bounds.integer ? Math.trunc(parsed) : parsed;
    if (bounds.min !== undefined) normalized = Math.max(bounds.min, normalized);
    if (bounds.max !== undefined) normalized = Math.min(bounds.max, normalized);
    return normalized;
  }
}
