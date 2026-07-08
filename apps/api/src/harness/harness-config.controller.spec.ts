import { describe, it, expect, vi } from 'vitest';
import { HarnessConfigController } from './harness-config.controller';
import type { HarnessValidateResult } from './harness-validate.types.js';

describe('HarnessConfigController', () => {
  it('lists definitions', async () => {
    const svc = { list: vi.fn(async () => [{ harnessId: 'pi' }]) } as never;
    const ctrl = new HarnessConfigController(svc);
    expect(await ctrl.list()).toEqual([{ harnessId: 'pi' }]);
  });

  describe('POST :harnessId/validate', () => {
    it('calls svc.validate with harnessId and optional scopeNodeId', async () => {
      const expected: HarnessValidateResult = {
        harnessId: 'custom:ext',
        reachable: true,
        credentialStatus: [],
      };
      const mockService = { validate: vi.fn(async () => expected) } as never;
      const ctrl = new HarnessConfigController(mockService);

      const result = await ctrl.validate('custom:ext', 'scope-1');

      expect(
        (mockService as { validate: ReturnType<typeof vi.fn> }).validate,
      ).toHaveBeenCalledWith('custom:ext', 'scope-1');
      expect(result).toEqual(expected);
    });

    it('forwards undefined scopeNodeId when not provided', async () => {
      const expected: HarnessValidateResult = {
        harnessId: 'custom:ext',
        reachable: false,
        credentialStatus: [],
      };
      const mockService = { validate: vi.fn(async () => expected) } as never;
      const ctrl = new HarnessConfigController(mockService);

      const result = await ctrl.validate('custom:ext', undefined);

      expect(
        (mockService as { validate: ReturnType<typeof vi.fn> }).validate,
      ).toHaveBeenCalledWith('custom:ext', undefined);
      expect(result).toEqual(expected);
    });
  });
});
