import { describe, it, expect, vi } from 'vitest';
import { ModelsController } from './models.controller';

describe('ModelsController', () => {
  const mockAdminService = {
    listModelsPaginated: vi.fn(),
    listModelPresets: vi.fn(),
    getModel: vi.fn(),
    createModel: vi.fn(),
    updateModel: vi.fn(),
    deleteModel: vi.fn(),
  };

  const controller = new ModelsController(mockAdminService as any);

  describe('listModels', () => {
    it('delegates to admin service', async () => {
      mockAdminService.listModelsPaginated.mockResolvedValue({
        items: [],
        total: 0,
      });

      const result = await controller.listModels({ page: 1, limit: 10 });
      expect(result).toEqual({ items: [], total: 0 });
      expect(mockAdminService.listModelsPaginated).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
      });
    });
  });

  describe('listPresets', () => {
    it('delegates to admin service and returns presets list', async () => {
      const mockPresets = {
        success: true,
        data: [
          { id: 'claude-3-opus', name: 'Claude 3 Opus', provider: 'anthropic' },
        ],
      };
      mockAdminService.listModelPresets.mockResolvedValue(mockPresets);

      const result = await controller.listPresets();
      expect(result).toEqual(mockPresets);
      expect(mockAdminService.listModelPresets).toHaveBeenCalled();
    });
  });

  describe('getModel', () => {
    it('delegates to admin service', async () => {
      mockAdminService.getModel.mockResolvedValue({ id: '1', name: 'GPT-4' });

      const result = await controller.getModel('1');
      expect(result).toEqual({
        success: true,
        data: { id: '1', name: 'GPT-4' },
      });
      expect(mockAdminService.getModel).toHaveBeenCalledWith('1');
    });
  });

  describe('createModel', () => {
    it('delegates to admin service', async () => {
      mockAdminService.createModel.mockResolvedValue({ id: '1', name: 'New' });

      const result = await controller.createModel({ name: 'New' });
      expect(result).toEqual({
        success: true,
        data: { id: '1', name: 'New' },
      });
      expect(mockAdminService.createModel).toHaveBeenCalledWith({
        name: 'New',
      });
    });
  });

  describe('updateModel', () => {
    it('delegates to admin service', async () => {
      mockAdminService.updateModel.mockResolvedValue({
        id: '1',
        name: 'Updated',
      });

      const result = await controller.updateModel('1', { name: 'Updated' });
      expect(result).toEqual({
        success: true,
        data: { id: '1', name: 'Updated' },
      });
      expect(mockAdminService.updateModel).toHaveBeenCalledWith('1', {
        name: 'Updated',
      });
    });
  });

  describe('deleteModel', () => {
    it('delegates to admin service', async () => {
      mockAdminService.deleteModel.mockResolvedValue(undefined);

      await controller.deleteModel('1');
      expect(mockAdminService.deleteModel).toHaveBeenCalledWith('1');
    });
  });
});
