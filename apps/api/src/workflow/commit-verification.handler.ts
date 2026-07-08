import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { CommitVerificationResult } from './commit-verification.handler.types';

export type { CommitVerificationResult } from './commit-verification.handler.types';

@Injectable()
export class CommitVerificationHandler {
  private execAsync = promisify(exec);

  async verify(worktreePath: string): Promise<CommitVerificationResult> {
    const { stdout } = await this.execAsync('git status --short', {
      cwd: worktreePath,
    });
    const lines = stdout.split('\n').filter((line) => line.length > 0);

    if (lines.length === 0) {
      return { status: 'verified', uncommittedFiles: [] };
    }

    // git status --short format: XY filename (2 status chars + 1 space prefix)
    const uncommittedFiles = lines.map((line) => line.slice(3).trim());
    return { status: 'needs_commit', uncommittedFiles };
  }
}
