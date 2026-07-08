import { describe, it, expect, vi, afterEach } from 'vitest';
import * as path from 'node:path';
import { CONTAINER_AGENT_DIR } from '@nexus/core';
import type { SkillLibraryRecord } from '../ai-config/services/agent-skill-library.service.types';
import { CONTAINER_SKILLS_ROOT } from './skill-mounting.constants';

const {
  mkdirSyncMock,
  readdirSyncMock,
  rmSyncMock,
  cpSyncMock,
  existsSyncMock,
  writeFileSyncMock,
} = vi.hoisted(() => ({
  mkdirSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
  rmSyncMock: vi.fn(),
  cpSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  mkdirSync: mkdirSyncMock,
  readdirSync: readdirSyncMock,
  rmSync: rmSyncMock,
  cpSync: cpSyncMock,
  existsSync: existsSyncMock,
  writeFileSync: writeFileSyncMock,
}));

vi.mock('node:os', () => ({
  tmpdir: vi.fn().mockReturnValue('/tmp'),
}));

import { SkillMountingService } from './skill-mounting.service';

function skill(name: string): SkillLibraryRecord {
  return {
    id: `${name}-id`,
    name,
    description: `${name} description`,
    skillMarkdown: `# ${name}`,
    rootPath: `/lib/skills/${name}`,
  } as never;
}

describe('SkillMountingService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('mounts skills at the directory the pi harness natively scans', () => {
    // The mount/catalog root MUST equal `${agentDir}/skills` so pi's
    // DefaultResourceLoader enumerates the bundle and the runtime diagnostics
    // resolve the mount.
    expect(CONTAINER_SKILLS_ROOT).toBe(`${CONTAINER_AGENT_DIR}/skills`);
  });

  describe('prepareSkillMount', () => {
    it('returns null when there are no skills to mount', () => {
      existsSyncMock.mockReturnValue(true);

      const service = new SkillMountingService();
      expect(service.prepareSkillMount('key0', [])).toBeNull();
    });

    it('embeds catalog skill paths under the harness skills root', () => {
      // existsSync false → write SKILL.md; readdirSync [] → no extra resources.
      existsSyncMock.mockReturnValue(false);
      readdirSyncMock.mockReturnValue([]);

      const service = new SkillMountingService();
      const mountPath = service.prepareSkillMount('key1', [
        skill('test-driven-development'),
      ]);

      expect(mountPath).toBe(
        path.join('/tmp', 'nexus-tools', 'skills', 'key1'),
      );

      const catalogCall = writeFileSyncMock.mock.calls.find((call) =>
        String(call[0]).endsWith('skill-catalog.json'),
      );
      expect(catalogCall).toBeDefined();
      const catalog = JSON.parse(catalogCall![1] as string) as Array<{
        name: string;
        path: string;
        root: string;
      }>;
      expect(catalog[0].path).toBe(
        `${CONTAINER_SKILLS_ROOT}/test-driven-development/SKILL.md`,
      );
      expect(catalog[0].root).toBe(
        `${CONTAINER_SKILLS_ROOT}/test-driven-development`,
      );
    });
  });
});
