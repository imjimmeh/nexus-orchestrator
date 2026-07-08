import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { GitCommitPathsService } from './git-commit-paths.service';
import type { CommitPathsResult } from './git-commit-paths.service.types';
import {
  listRepoFiles,
  readRepoFile,
  writeRepoFile,
  deleteRepoFile,
} from './git-file.ops';
import { GitRepositoryMetadataService } from './git-repository-metadata.service';

type CommitPathsBody = {
  repoPath?: string;
  paths?: string[];
  message?: string;
  push?: boolean;
};

@Controller('git')
export class GitController {
  constructor(
    private readonly gitCommitPaths: GitCommitPathsService,
    private readonly gitRepositoryMetadata: GitRepositoryMetadataService,
  ) {}

  @Post('commit-paths')
  async commitPaths(@Body() body: CommitPathsBody): Promise<CommitPathsResult> {
    const repoPath = body.repoPath?.trim();
    if (!repoPath) {
      return {
        committed: false,
        status: 'clean',
        changed_files: [],
        commit_sha: null,
      };
    }
    if (!Array.isArray(body.paths) || body.paths.length === 0) {
      return {
        committed: false,
        status: 'clean',
        changed_files: [],
        commit_sha: null,
      };
    }
    const message = body.message?.trim();
    if (!message) {
      return {
        committed: false,
        status: 'clean',
        changed_files: [],
        commit_sha: null,
      };
    }
    return this.gitCommitPaths.commitPaths({
      repoPath,
      paths: body.paths,
      message,
      push: body.push,
    });
  }

  @Post('files/list')
  async listFiles(
    @Body() body: { repoPath?: string; directory?: string; pattern?: string },
  ) {
    const repoPath = body.repoPath?.trim();
    const directory = body.directory?.trim();
    if (!repoPath || !directory) return { files: [] };
    return listRepoFiles(repoPath, directory, body.pattern ?? undefined);
  }

  @Post('branches/list')
  async listBranches(@Body() body: { repoPath?: string }) {
    const repoPath = body.repoPath?.trim();
    if (!repoPath) return { branches: [] };
    const branches = await this.gitRepositoryMetadata.listBranches(repoPath);
    return { branches };
  }

  @Post('tracked-files/list')
  async listTrackedFiles(@Body() body: { repoPath?: string }) {
    const repoPath = body.repoPath?.trim();
    if (!repoPath) return { files: [] };
    const files = await this.gitRepositoryMetadata.listTrackedFiles(repoPath);
    return { files };
  }

  @Post('files/show')
  async showFile(
    @Body() body: { repoPath?: string; filePath?: string; ref?: string },
  ) {
    const repoPath = body.repoPath?.trim();
    const filePath = body.filePath?.trim();
    if (!repoPath || !filePath) {
      throw new BadRequestException('repoPath and filePath required');
    }
    const ref = body.ref?.trim() || undefined;
    return this.gitRepositoryMetadata.readFileAtRef({
      repoPath,
      filePath,
      ref,
    });
  }

  @Post('files/read')
  async readFile(@Body() body: { repoPath?: string; filePath?: string }) {
    const repoPath = body.repoPath?.trim();
    const filePath = body.filePath?.trim();
    if (!repoPath || !filePath) {
      throw new BadRequestException('repoPath and filePath required');
    }
    try {
      const content = await readRepoFile(repoPath, filePath);
      return { content };
    } catch (err) {
      throw new BadRequestException(
        `Cannot read file: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  @Post('files/write')
  async writeFile(
    @Body()
    body: {
      repoPath?: string;
      filePath?: string;
      content?: string;
      message?: string;
      push?: boolean;
    },
  ): Promise<CommitPathsResult> {
    const repoPath = body.repoPath?.trim();
    const filePath = body.filePath?.trim();
    const content = body.content;
    const message = body.message?.trim();

    if (
      !repoPath ||
      !filePath ||
      content === undefined ||
      content === null ||
      !message
    ) {
      return {
        committed: false,
        status: 'clean',
        changed_files: [],
        commit_sha: null,
      };
    }

    await writeRepoFile(repoPath, filePath, content);
    return this.gitCommitPaths.commitPaths({
      repoPath,
      paths: [filePath],
      message,
      push: body.push,
    });
  }

  @Post('files/delete')
  async deleteFile(
    @Body()
    body: {
      repoPath?: string;
      filePath?: string;
      message?: string;
      push?: boolean;
    },
  ): Promise<CommitPathsResult> {
    const repoPath = body.repoPath?.trim();
    const filePath = body.filePath?.trim();
    const message = body.message?.trim();

    if (!repoPath || !filePath || !message) {
      return {
        committed: false,
        status: 'clean',
        changed_files: [],
        commit_sha: null,
      };
    }

    await deleteRepoFile(repoPath, filePath);
    return this.gitCommitPaths.commitPaths({
      repoPath,
      paths: [filePath],
      message,
      push: body.push,
    });
  }
}
