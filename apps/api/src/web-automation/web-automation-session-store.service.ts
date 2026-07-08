import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { BrowserAutomationSession } from './web-automation.types';
import { WebAutomationPlaywrightDriverService } from './web-automation-playwright-driver.service';

@Injectable()
export class WebAutomationSessionStoreService implements OnModuleDestroy {
  private readonly logger = new Logger(WebAutomationSessionStoreService.name);

  private readonly sessionsByRun = new Map<
    string,
    Map<string, BrowserAutomationSession>
  >();

  constructor(private readonly driver: WebAutomationPlaywrightDriverService) {}

  async openSession(
    workflowRunId: string,
    sessionId: string,
  ): Promise<BrowserAutomationSession> {
    const runSessions = this.getOrCreateRunSessions(workflowRunId);

    const existingSession = runSessions.get(sessionId);
    if (existingSession) {
      await existingSession.close();
      runSessions.delete(sessionId);
    }

    const session = await this.driver.createSession(sessionId);
    runSessions.set(sessionId, session);

    this.logger.debug(
      `Opened browser session '${sessionId}' for workflow run ${workflowRunId}`,
    );

    return session;
  }

  getSession(
    workflowRunId: string,
    sessionId: string,
  ): BrowserAutomationSession | null {
    return this.sessionsByRun.get(workflowRunId)?.get(sessionId) ?? null;
  }

  async closeSession(
    workflowRunId: string,
    sessionId: string,
  ): Promise<boolean> {
    const runSessions = this.sessionsByRun.get(workflowRunId);
    if (!runSessions) {
      return false;
    }

    const session = runSessions.get(sessionId);
    if (!session) {
      return false;
    }

    try {
      await session.close();
    } catch (error) {
      this.logger.warn(
        `Failed to close browser session ${session.id}: ${(error as Error).message}`,
      );
    }

    runSessions.delete(sessionId);
    if (runSessions.size === 0) {
      this.sessionsByRun.delete(workflowRunId);
    }

    this.logger.debug(
      `Closed browser session '${sessionId}' for workflow run ${workflowRunId}`,
    );

    return true;
  }

  async closeRunSessions(workflowRunId: string): Promise<void> {
    const runSessions = this.sessionsByRun.get(workflowRunId);
    if (!runSessions) {
      return;
    }

    await this.closeSessionMap(runSessions);
    this.sessionsByRun.delete(workflowRunId);
  }

  async onModuleDestroy(): Promise<void> {
    for (const runSessions of this.sessionsByRun.values()) {
      await this.closeSessionMap(runSessions);
    }

    this.sessionsByRun.clear();
  }

  private getOrCreateRunSessions(
    workflowRunId: string,
  ): Map<string, BrowserAutomationSession> {
    let runSessions = this.sessionsByRun.get(workflowRunId);
    if (!runSessions) {
      runSessions = new Map<string, BrowserAutomationSession>();
      this.sessionsByRun.set(workflowRunId, runSessions);
    }

    return runSessions;
  }

  private async closeSessionMap(
    sessions: Map<string, BrowserAutomationSession>,
  ): Promise<void> {
    for (const session of sessions.values()) {
      try {
        await session.close();
      } catch (error) {
        this.logger.warn(
          `Failed to close browser session ${session.id}: ${(error as Error).message}`,
        );
      }
    }
  }
}
