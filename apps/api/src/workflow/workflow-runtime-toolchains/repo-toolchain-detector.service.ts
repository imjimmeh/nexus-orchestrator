import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolchainSpec } from '@nexus/core';
import {
  DETECTED_FILENAMES,
  detectToolchainsFromFiles,
} from './repo-toolchain-detector';

/**
 * IO wrapper around the pure {@link detectToolchainsFromFiles} detector: reads
 * each well-known toolchain manifest from the workspace checkout (missing
 * file -> `null`) and hands the resulting map to the pure detection logic.
 */
@Injectable()
export class RepoToolchainDetectorService {
  async detect(workspacePath: string): Promise<ToolchainSpec[]> {
    const files: Record<string, string | null> = {};
    await Promise.all(
      DETECTED_FILENAMES.map(async (name) => {
        try {
          files[name] = await readFile(join(workspacePath, name), 'utf8');
        } catch {
          files[name] = null;
        }
      }),
    );
    return detectToolchainsFromFiles(files);
  }
}
