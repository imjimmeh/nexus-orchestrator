import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type {
  BrowserAutomationActionType,
  IBrowserAutomationAttemptTrace,
  IBrowserSelectorTrace,
} from '@nexus/core';
import { WebAutomationFailureArtifact } from './database/entities/web-automation-failure-artifact.entity';
import { WebAutomationFailureArtifactRepository } from './database/repositories/web-automation-failure-artifact.repository';
import type {
  BrowserAutomationExecutionInputs,
  BrowserAutomationPage,
  BrowserAutomationSession,
} from './web-automation.types';

interface CaptureFailureArtifactParams {
  workflowRunId: string;
  stepId: string;
  action: BrowserAutomationActionType;
  inputs: BrowserAutomationExecutionInputs;
  selectorTrace?: IBrowserSelectorTrace;
  attempts: IBrowserAutomationAttemptTrace[];
  errorMessage: string;
  startedAtMs: number;
  session?: BrowserAutomationSession;
}

interface CapturedPageEvidence {
  domSnapshot: string | null;
  domSnapshotHash: string | null;
  screenshotBase64: string | null;
}

@Injectable()
export class WebAutomationFailureArtifactService {
  private readonly logger = new Logger(
    WebAutomationFailureArtifactService.name,
  );

  constructor(
    private readonly repository: WebAutomationFailureArtifactRepository,
  ) {}

  async captureFailureArtifact(
    params: CaptureFailureArtifactParams,
  ): Promise<WebAutomationFailureArtifact> {
    const capturedEvidence = await this.capturePageEvidence(
      params.session?.page,
    );

    const artifact = await this.repository.create({
      workflow_run_id: params.workflowRunId,
      step_id: params.stepId,
      action_name: params.action,
      action_payload: params.inputs,
      selector_trace: params.selectorTrace ?? null,
      attempts: params.attempts,
      attempt_count: params.attempts.length,
      duration_ms: Math.max(Date.now() - params.startedAtMs, 0),
      error_message: params.errorMessage,
      dom_snapshot_hash: capturedEvidence.domSnapshotHash,
      dom_snapshot: capturedEvidence.domSnapshot,
      screenshot_base64: capturedEvidence.screenshotBase64,
    });

    this.logger.warn(
      `Captured web automation failure artifact ${artifact.id} for run ${params.workflowRunId} step ${params.stepId}`,
    );

    return artifact;
  }

  private async capturePageEvidence(
    page: BrowserAutomationPage | undefined,
  ): Promise<CapturedPageEvidence> {
    if (!page) {
      return {
        domSnapshot: null,
        domSnapshotHash: null,
        screenshotBase64: null,
      };
    }

    const domSnapshot = await this.captureDomSnapshot(page);
    const screenshotBase64 = await this.captureScreenshot(page);

    return {
      domSnapshot,
      domSnapshotHash: domSnapshot
        ? createHash('sha256').update(domSnapshot).digest('hex')
        : null,
      screenshotBase64,
    };
  }

  private async captureDomSnapshot(
    page: BrowserAutomationPage,
  ): Promise<string | null> {
    try {
      return await page.content();
    } catch (error) {
      this.logger.warn(
        `Failed to capture page DOM snapshot: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async captureScreenshot(
    page: BrowserAutomationPage,
  ): Promise<string | null> {
    try {
      const pngBytes = await page.screenshot({
        fullPage: true,
        type: 'png',
      });

      return pngBytes.toString('base64');
    } catch (error) {
      this.logger.warn(
        `Failed to capture page screenshot: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
