import { Injectable } from '@nestjs/common';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  ListPathBody,
  UpdateOrchestrationStateBody,
  YieldSessionBody,
} from './workflow-runtime-tools.controller.types';

type SessionSnapshot = {
  scope_id: string;
  workflow_run_id?: string;
  state: Record<string, unknown>;
  yielded?: {
    active_playbook?: string;
    status: YieldSessionBody['status'];
    summary: string;
    recommended_next_playbook?: string;
    notes?: string;
    yielded_at: string;
  };
};

@Injectable()
export class WorkflowRuntimeOrchestrationSessionService {
  private readonly sessions = new Map<string, SessionSnapshot>();

  yieldSession(body: YieldSessionBody): Record<string, unknown> {
    const session = this.getOrCreateSession(body.scope_id);
    session.workflow_run_id = body.workflow_run_id;
    session.yielded = {
      active_playbook: body.active_playbook,
      status: body.status,
      summary: body.summary,
      recommended_next_playbook: body.recommended_next_playbook,
      notes: body.notes,
      yielded_at: new Date().toISOString(),
    };

    return {
      ok: true,
      scope_id: body.scope_id,
      workflow_run_id: body.workflow_run_id,
      status: body.status,
    };
  }

  async listPath(body: ListPathBody): Promise<Record<string, unknown>> {
    const relativePath = body.relative_path?.trim() || '.';
    const basePath = path.resolve(process.cwd());
    const resolvedPath = path.resolve(basePath, relativePath);
    const entries = await readdir(resolvedPath, { withFileTypes: true });

    return {
      ok: true,
      scope_id: body.scope_id,
      relative_path: relativePath,
      entries: entries
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  updateOrchestrationState(
    body: UpdateOrchestrationStateBody,
  ): Record<string, unknown> {
    const session = this.getOrCreateSession(body.scope_id);
    session.state = {
      ...session.state,
      ...body.patch,
    };

    return {
      ok: true,
      scope_id: body.scope_id,
      state: session.state,
    };
  }

  private getOrCreateSession(scopeId: string): SessionSnapshot {
    const existing = this.sessions.get(scopeId);
    if (existing) {
      return existing;
    }

    const created: SessionSnapshot = {
      scope_id: scopeId,
      state: {},
    };
    this.sessions.set(scopeId, created);
    return created;
  }
}
