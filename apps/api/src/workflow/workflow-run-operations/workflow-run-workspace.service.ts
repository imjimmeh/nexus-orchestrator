import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asRecord, getScopeId } from '@nexus/core';
import { GitWorktreeService } from '../../common/git/git-worktree.service';
import { resolveTriggerContext } from '../../shared/agent-scope.utils';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

export type { WorkspaceTreeNode } from './workflow-run-workspace.service.types';
import type { WorkspaceTreeNode } from './workflow-run-workspace.service.types';
import { WORKFLOW_PERSISTENCE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowPersistenceService } from '../kernel/interfaces/workflow-kernel.ports';

@Injectable()
export class WorkflowRunWorkspaceService {
  constructor(
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    private readonly gitWorktreeService: GitWorktreeService,
  ) {}

  async getFileTree(workflowRunId: string): Promise<WorkspaceTreeNode[]> {
    const workspacePath = await this.resolveWorkspacePathOrNull(workflowRunId);
    if (!workspacePath) {
      return [];
    }

    return this.readTree(workspacePath, '');
  }

  async getDiff(workflowRunId: string): Promise<string> {
    const workspacePath = await this.resolveWorkspacePathOrNull(workflowRunId);
    if (!workspacePath) {
      return '';
    }

    try {
      const { stdout } = await execFileAsync('git', [
        '-C',
        workspacePath,
        'diff',
        '--no-color',
      ]);
      return stdout || '';
    } catch {
      return '';
    }
  }

  private async resolveWorkspacePathOrNull(
    workflowRunId: string,
  ): Promise<string | null> {
    try {
      return await this.resolveWorkspacePath(workflowRunId);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }

      const message = error.message;
      if (message.includes('Workflow run') && message.includes('not found')) {
        throw error;
      }

      return null;
    }
  }

  private async resolveWorkspacePath(workflowRunId: string): Promise<string> {
    const run = await this.workflowPersistence.getWorkflowRun(workflowRunId);
    const stepId =
      typeof run.current_step_id === 'string' && run.current_step_id.trim()
        ? run.current_step_id
        : null;

    if (stepId) {
      const exportWorkspacePath = this.getExportWorkspacePath(
        workflowRunId,
        stepId,
      );
      if (await this.pathExists(exportWorkspacePath)) {
        return exportWorkspacePath;
      }
    }

    const worktreePath = await this.resolveWorktreePathFromRunState(
      run.state_variables,
    );
    if (worktreePath) {
      return worktreePath;
    }

    if (!stepId) {
      throw new NotFoundException(
        `Workflow run ${workflowRunId} has no active step workspace`,
      );
    }

    throw new NotFoundException(
      `Workspace not found for workflow run ${workflowRunId}`,
    );
  }

  private getExportWorkspacePath(
    workflowRunId: string,
    stepId: string,
  ): string {
    const workspaceBasePath =
      process.env.NEXUS_WORKSPACE_EXPORT_PATH ||
      process.env.NEXUS_WORKSPACE_BASE_PATH ||
      path.join(os.tmpdir(), 'nexus-workspaces');

    return path.join(workspaceBasePath, `${workflowRunId}-${stepId}`);
  }

  private async pathExists(candidatePath: string): Promise<boolean> {
    try {
      await fs.access(candidatePath);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveWorktreePathFromRunState(
    stateVariables: unknown,
  ): Promise<string | null> {
    const trigger = asRecord(asRecord(stateVariables).trigger);
    const context = resolveTriggerContext(trigger);
    const scopeId = getScopeId(context) ?? undefined;
    const contextId = context.contextId ?? undefined;
    if (!scopeId || !contextId) {
      return null;
    }

    try {
      const worktreePath =
        await this.gitWorktreeService.getExistingWorktreePath(
          scopeId,
          contextId,
        );

      return worktreePath || null;
    } catch {
      return null;
    }
  }

  async getFileContent(
    workflowRunId: string,
    filePath: string,
  ): Promise<string> {
    const workspacePath = await this.resolveWorkspacePath(workflowRunId);
    const resolved = path.resolve(workspacePath, filePath);

    if (
      !resolved.startsWith(workspacePath + path.sep) &&
      resolved !== workspacePath
    ) {
      throw new NotFoundException('File path is outside the workspace');
    }

    try {
      return await fs.readFile(resolved, 'utf-8');
    } catch {
      throw new NotFoundException(`File not found in workspace: ${filePath}`);
    }
  }

  private async readTree(
    rootPath: string,
    relativePath: string,
  ): Promise<WorkspaceTreeNode[]> {
    const currentPath = relativePath
      ? path.join(rootPath, relativePath)
      : rootPath;

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const sorted = entries.toSorted((a, b) => a.name.localeCompare(b.name));

    const nodes: WorkspaceTreeNode[] = [];

    for (const entry of sorted) {
      if (entry.name === '.git') {
        continue;
      }

      const childRelativePath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;

      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: childRelativePath,
          type: 'directory',
          children: await this.readTree(rootPath, childRelativePath),
        });
        continue;
      }

      nodes.push({
        name: entry.name,
        path: childRelativePath,
        type: 'file',
      });
    }

    return nodes;
  }
}
