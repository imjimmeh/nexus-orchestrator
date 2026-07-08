import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemSettingsController } from './system-settings.controller';
import type { SystemSettingsService } from './system-settings.service';
import type { SystemSetting } from '../system/database/entities/system-setting.entity';
import type { UpdateSystemSettingDto } from './dto/update-system-setting.dto';
import type { Request } from 'express';

describe('SystemSettingsController', () => {
  let controller: SystemSettingsController;

  const getAllMock = vi.fn();
  const setAndEmitMock = vi.fn();

  const service = {
    getAll: getAllMock,
    setAndEmit: setAndEmitMock,
  } as unknown as SystemSettingsService;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new SystemSettingsController(service);
  });

  describe('findAll', () => {
    it('returns all settings wrapped in success envelope', async () => {
      const settings = [
        { key: 'a', value: 1 },
        { key: 'b', value: 'hello' },
      ] as SystemSetting[];
      getAllMock.mockResolvedValue(settings);

      const result = await controller.findAll();

      expect(result).toEqual({ success: true, data: settings });
      expect(getAllMock).toHaveBeenCalledOnce();
    });
  });

  describe('upsert', () => {
    it('creates or updates a setting and returns it', async () => {
      const setting = {
        key: 'question_idle_stop_seconds',
        value: 600,
        description: 'Updated',
        updatedAt: new Date(),
      } as SystemSetting;
      setAndEmitMock.mockResolvedValue(setting);

      const dto: UpdateSystemSettingDto = {
        value: 600,
        description: 'Updated',
      };

      const result = await controller.upsert(
        'question_idle_stop_seconds',
        dto,
        { user: { id: 'admin-user' } } as unknown as Request,
      );

      expect(result).toEqual({ success: true, data: setting });
      expect(setAndEmitMock).toHaveBeenCalledWith(
        'question_idle_stop_seconds',
        600,
        'Updated',
        'admin-user',
      );
    });

    it('passes undefined description when not provided', async () => {
      setAndEmitMock.mockResolvedValue({});

      const dto: UpdateSystemSettingDto = { value: 42 };

      await controller.upsert('some_key', dto, {} as Request);

      expect(setAndEmitMock).toHaveBeenCalledWith(
        'some_key',
        42,
        undefined,
        undefined,
      );
    });
  });
});
