import { Injectable, Logger } from '@nestjs/common';
import { mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as os from 'node:os';

const execFileAsync = promisify(execFile);

@Injectable()
export class GitInitService {
  private readonly logger = new Logger(GitInitService.name);

  async initRepository(repoPath: string): Promise<string> {
    await mkdir(repoPath, { recursive: true });
    await execFileAsync('git', ['init', repoPath]);
    await execFileAsync('git', [
      '-C',
      repoPath,
      'config',
      'user.name',
      'Nexus Orchestrator',
    ]);
    await execFileAsync('git', [
      '-C',
      repoPath,
      'config',
      'user.email',
      'nexus@localhost',
    ]);
    await execFileAsync('git', [
      '-C',
      repoPath,
      'commit',
      '--allow-empty',
      '-m',
      'Initial commit',
    ]);
    this.logger.log(`Initialized git repository at ${repoPath}`);
    return repoPath;
  }

  getDefaultRepoPath(scopeId: string): string {
    const basePath =
      process.env.NEXUS_WORKSPACE_BASE_PATH ||
      path.join(os.tmpdir(), 'nexus-workspaces');
    return path.resolve(basePath, 'repos', scopeId);
  }
}
