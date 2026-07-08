import { describe, expect, it, vi } from 'vitest';
import type Docker from 'dockerode';
import { collectContainerDiagnostics } from './subagent-container-diagnostics.helpers';

describe('subagent-container-diagnostics.helpers', () => {
  describe('collectContainerDiagnostics', () => {
    it('returns null when there is no child container id', async () => {
      const docker = {
        getContainer: vi.fn(),
      } as unknown as Pick<Docker, 'getContainer'>;

      expect(await collectContainerDiagnostics(docker, null)).toBeNull();
      expect(docker.getContainer).not.toHaveBeenCalled();
    });

    it('captures the sanitized log tail for a live container', async () => {
      const logs = vi.fn().mockResolvedValue(Buffer.from('runner boot failed'));
      const docker = {
        getContainer: vi.fn(() => ({ logs })),
      } as unknown as Pick<Docker, 'getContainer'>;

      const diagnostics = await collectContainerDiagnostics(docker, 'child-1');

      expect(diagnostics).toEqual({
        child_container_id: 'child-1',
        logs_tail: 'runner boot failed',
      });
    });

    it('records a failed-to-collect note when the container is gone (never throws)', async () => {
      const logs = vi.fn().mockRejectedValue(new Error('no such container'));
      const docker = {
        getContainer: vi.fn(() => ({ logs })),
      } as unknown as Pick<Docker, 'getContainer'>;

      const diagnostics = await collectContainerDiagnostics(docker, 'gone-1');

      expect(diagnostics).toEqual({
        child_container_id: 'gone-1',
        logs_tail: 'Failed to collect logs: no such container',
      });
    });
  });
});
