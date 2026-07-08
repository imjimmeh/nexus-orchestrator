import { Injectable } from '@nestjs/common';
import type { BrowserAutomationActionType } from '@nexus/core';
import { WebAutomationActionExecutorService } from '../../web-automation/web-automation-action-executor.service';
import { WebAutomationArtifactQueryService } from '../../web-automation/web-automation-artifact-query.service';
import { WebAutomationSessionStoreService } from '../../web-automation/web-automation-session-store.service';
import { WorkflowRuntimeCapabilityExecutorService } from './workflow-runtime-capability-executor.service';
import type { RuntimeContextInput } from './workflow-runtime-capability-lifecycle.types';
import {
  buildBrowserActionInputs,
  DEFAULT_ARTIFACT_LIMIT,
  MAX_ARTIFACT_LIMIT,
  requireNonEmptyString,
  resolveDomainPolicyViolation,
  resolveSessionId,
  toBoundedInteger,
  toOptionalString,
} from './workflow-runtime-browser-actions.helpers';
import type { BrowserRuntimeActionInput } from './workflow-runtime-browser-actions.types';
import {
  parseAgentExecutionContext,
  resolveWorkflowRunId,
} from './workflow-runtime-tools.context';
import { WorkflowEventLogService } from '../workflow-event-log.service';

type BrowserRuntimeActionParams = RuntimeContextInput &
  BrowserRuntimeActionInput;

interface BrowserRuntimeArtifactListParams extends RuntimeContextInput {
  limit?: number;
  offset?: number;
}

interface BrowserRuntimeArtifactGetParams extends RuntimeContextInput {
  artifact_id: string;
}

@Injectable()
export class WorkflowRuntimeBrowserActionsService {
  constructor(
    private readonly capabilityExecutor: WorkflowRuntimeCapabilityExecutorService,
    private readonly webAutomationExecutor: WebAutomationActionExecutorService,
    private readonly sessionStore: WebAutomationSessionStoreService,
    private readonly artifactQuery: WebAutomationArtifactQueryService,
    private readonly workflowEventLog: WorkflowEventLogService,
  ) {}

  async openPage(
    params: BrowserRuntimeActionParams,
  ): Promise<Record<string, unknown>> {
    return this.executeBrowserAction({
      capabilityName: 'browser_open_page',
      action: 'open_page',
      params,
    });
  }

  async navigate(
    params: BrowserRuntimeActionParams,
  ): Promise<Record<string, unknown>> {
    return this.executeBrowserAction({
      capabilityName: 'browser_navigate',
      action: 'navigate',
      params,
    });
  }

  async click(
    params: BrowserRuntimeActionParams,
  ): Promise<Record<string, unknown>> {
    return this.executeBrowserAction({
      capabilityName: 'browser_click',
      action: 'click',
      params,
    });
  }

  async type(
    params: BrowserRuntimeActionParams,
  ): Promise<Record<string, unknown>> {
    return this.executeBrowserAction({
      capabilityName: 'browser_type',
      action: 'type',
      params,
    });
  }

  async waitFor(
    params: BrowserRuntimeActionParams,
  ): Promise<Record<string, unknown>> {
    return this.executeBrowserAction({
      capabilityName: 'browser_wait_for',
      action: 'wait_for',
      params,
    });
  }

  async readPage(
    params: BrowserRuntimeActionParams,
  ): Promise<Record<string, unknown>> {
    return this.executeBrowserAction({
      capabilityName: 'browser_read_page',
      action: 'read_page',
      params,
    });
  }

  async screenshot(
    params: BrowserRuntimeActionParams,
  ): Promise<Record<string, unknown>> {
    return this.executeBrowserAction({
      capabilityName: 'browser_screenshot',
      action: 'screenshot',
      params,
    });
  }

  async closePage(
    params: RuntimeContextInput & { session_id?: string },
  ): Promise<Record<string, unknown>> {
    const workflowRunId = this.requireWorkflowRunId(params);
    const jobId = this.resolveJobId(params);
    const sessionId = resolveSessionId(params.session_id);

    return this.capabilityExecutor.execute({
      capabilityName: 'browser_close_page',
      context: {
        workflow_run_id: workflowRunId,
        job_id: jobId,
        user: params.user,
      },
      payload: {
        session_id: sessionId,
      },
      execute: async () => {
        const closed: boolean = await this.sessionStore.closeSession(
          workflowRunId,
          sessionId,
        );

        const result = closed
          ? {
              ok: true,
              action: 'close_page',
              session_id: sessionId,
              closed: true,
            }
          : {
              ok: false,
              action: 'close_page',
              session_id: sessionId,
              closed: false,
              error: `Browser session '${sessionId}' was not found`,
            };

        await this.workflowEventLog.appendBestEffort({
          workflowRunId,
          jobId: jobId ?? undefined,
          eventType: closed
            ? 'runtime.browser_session.closed'
            : 'runtime.browser_session.close_failed',
          payload: {
            session_id: sessionId,
          },
        });

        return result;
      },
    });
  }

  async listFailureArtifacts(
    params: BrowserRuntimeArtifactListParams,
  ): Promise<Record<string, unknown>> {
    const workflowRunId = this.requireWorkflowRunId(params);
    const jobId = this.resolveJobId(params);
    const limit = toBoundedInteger(params.limit, DEFAULT_ARTIFACT_LIMIT, {
      min: 1,
      max: MAX_ARTIFACT_LIMIT,
    });
    const offset = toBoundedInteger(params.offset, 0, {
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });

    return this.capabilityExecutor.execute({
      capabilityName: 'browser_list_failure_artifacts',
      context: {
        workflow_run_id: workflowRunId,
        job_id: jobId,
        user: params.user,
      },
      payload: {
        limit,
        offset,
      },
      execute: async () => {
        const artifacts = await this.artifactQuery.listRunArtifacts(
          workflowRunId,
          limit,
          offset,
        );

        await this.workflowEventLog.appendBestEffort({
          workflowRunId,
          jobId: jobId ?? undefined,
          eventType: 'runtime.browser_artifacts.listed',
          payload: {
            count: artifacts.data.length,
            total: artifacts.total,
            limit,
            offset,
          },
        });

        return {
          workflow_run_id: workflowRunId,
          limit,
          offset,
          count: artifacts.data.length,
          total: artifacts.total,
          artifacts: artifacts.data,
        };
      },
    });
  }

  async getFailureArtifact(
    params: BrowserRuntimeArtifactGetParams,
  ): Promise<Record<string, unknown>> {
    const workflowRunId = this.requireWorkflowRunId(params);
    const jobId = this.resolveJobId(params);
    const artifactId = requireNonEmptyString(params.artifact_id, 'artifact_id');

    return this.capabilityExecutor.execute({
      capabilityName: 'browser_get_failure_artifact',
      context: {
        workflow_run_id: workflowRunId,
        job_id: jobId,
        user: params.user,
      },
      payload: {
        artifact_id: artifactId,
      },
      execute: async () => {
        const artifact = await this.artifactQuery.getRunArtifact(
          workflowRunId,
          artifactId,
        );

        await this.workflowEventLog.appendBestEffort({
          workflowRunId,
          jobId: jobId ?? undefined,
          eventType: 'runtime.browser_artifact.read',
          payload: {
            artifact_id: artifactId,
          },
        });

        return {
          workflow_run_id: workflowRunId,
          artifact,
        };
      },
    });
  }

  private async executeBrowserAction(params: {
    capabilityName: string;
    action: BrowserAutomationActionType;
    params: BrowserRuntimeActionParams;
  }): Promise<Record<string, unknown>> {
    const workflowRunId = this.requireWorkflowRunId(params.params);
    const jobId = this.resolveJobId(params.params);
    const sessionId = resolveSessionId(params.params.session_id);
    const actionInputs = buildBrowserActionInputs(
      params.action,
      sessionId,
      params.params,
    );

    const domainViolation = resolveDomainPolicyViolation({
      action: params.action,
      rawUrl: actionInputs.url,
      allowedDomainsEnv: process.env.BROWSER_RUNTIME_ALLOWED_DOMAINS,
      deniedDomainsEnv: process.env.BROWSER_RUNTIME_DENIED_DOMAINS,
    });

    return this.capabilityExecutor.execute({
      capabilityName: params.capabilityName,
      context: {
        workflow_run_id: workflowRunId,
        job_id: jobId,
        user: params.params.user,
      },
      payload: {
        action: params.action,
        session_id: sessionId,
      },
      execute: async () => {
        if (domainViolation) {
          const blocked = {
            ok: false,
            action: params.action,
            session_id: sessionId,
            error: domainViolation,
            attempts: [],
          };

          await this.appendBrowserActionEvent({
            workflowRunId,
            jobId,
            capabilityName: params.capabilityName,
            action: params.action,
            sessionId,
            result: blocked,
          });

          return blocked;
        }

        const result = await this.webAutomationExecutor.execute({
          workflowRunId,
          stepId: this.resolveStepId(params.action, jobId),
          inputs: actionInputs,
        });

        await this.appendBrowserActionEvent({
          workflowRunId,
          jobId,
          capabilityName: params.capabilityName,
          action: params.action,
          sessionId,
          result,
        });

        return result;
      },
    });
  }

  private async appendBrowserActionEvent(params: {
    workflowRunId: string;
    jobId: string | undefined;
    capabilityName: string;
    action: BrowserAutomationActionType;
    sessionId: string;
    result: {
      ok: boolean;
      failure_artifact_id?: string;
      attempts?: Array<unknown>;
      current_url?: string;
    };
  }): Promise<void> {
    await this.workflowEventLog.appendBestEffort({
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      eventType: params.result.ok
        ? 'runtime.browser_action.succeeded'
        : 'runtime.browser_action.failed',
      payload: {
        capability_name: params.capabilityName,
        action: params.action,
        session_id: params.sessionId,
        current_url: params.result.current_url ?? null,
        attempt_count: Array.isArray(params.result.attempts)
          ? params.result.attempts.length
          : 0,
        failure_artifact_id: params.result.failure_artifact_id ?? null,
      },
    });
  }

  private resolveStepId(
    action: BrowserAutomationActionType,
    jobId: string | undefined,
  ): string {
    if (jobId) {
      return `${jobId}.runtime.${action}`;
    }

    return `runtime.browser.${action}`;
  }

  private requireWorkflowRunId(params: RuntimeContextInput): string {
    return resolveWorkflowRunId({
      workflowRunId: params.workflow_run_id,
      user: params.user,
    });
  }

  private resolveJobId(params: RuntimeContextInput): string | undefined {
    const explicit = toOptionalString(params.job_id);
    if (explicit) {
      return explicit;
    }

    return parseAgentExecutionContext(params.user?.userId)?.jobId;
  }
}
