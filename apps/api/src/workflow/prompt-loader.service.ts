import { Injectable, Logger } from '@nestjs/common';
import { IWorkflowDefinition, IJob, IJobStep } from '@nexus/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sleep } from '../common/utils/async.utils';

interface PromptResolutionContext {
  workflowId: string;
  jobId: string;
  step: IJobStep;
}

@Injectable()
export class PromptLoaderService {
  private readonly logger = new Logger(PromptLoaderService.name);
  private readonly promptCache = new Map<string, string>();

  async resolveWorkflowPromptsWithRetry(
    definition: IWorkflowDefinition,
  ): Promise<IWorkflowDefinition> {
    const maxAttempts = this.resolvePromptLoadRetryAttempts();
    const baseDelayMs = this.resolvePromptLoadRetryBaseDelayMs();

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return this.resolveWorkflowPrompts(definition);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        const isRetryable = this.isRetryablePromptLoadError(err);
        const hasAttemptsRemaining = attempt < maxAttempts;

        if (!isRetryable || !hasAttemptsRemaining) {
          throw err;
        }

        const delayMs = baseDelayMs * 2 ** (attempt - 1);
        this.logger.warn(
          `Prompt resolution failed for workflow ${definition.workflow_id} on attempt ${attempt}/${maxAttempts}. Retrying in ${delayMs}ms. Error: ${err.message}`,
        );
        await sleep(delayMs);
      }
    }

    return definition;
  }

  resolveWorkflowPrompts(definition: IWorkflowDefinition): IWorkflowDefinition {
    if (!this.isExternalPromptsEnabled()) {
      return definition;
    }

    const jobs = Array.isArray(definition.jobs) ? definition.jobs : [];
    let hasChanges = false;

    const resolvedJobs: IJob[] = jobs.map((job) => {
      if (!Array.isArray(job.steps) || job.steps.length === 0) {
        return job;
      }

      let stepChanged = false;
      const resolvedSteps = job.steps.map((step) => {
        const resolvedStep = this.resolveStepPrompt({
          workflowId: definition.workflow_id,
          jobId: job.id,
          step,
        });

        if (resolvedStep !== step) {
          stepChanged = true;
        }

        return resolvedStep;
      });

      if (!stepChanged) {
        return job;
      }

      hasChanges = true;
      return {
        ...job,
        steps: resolvedSteps,
      };
    });

    if (!hasChanges) {
      return definition;
    }

    return {
      ...definition,
      jobs: resolvedJobs,
    };
  }

  private resolveStepPrompt(context: PromptResolutionContext): IJobStep {
    const promptFile = this.readOptionalString(context.step.prompt_file);
    if (!promptFile) {
      return context.step;
    }

    const promptFilePath = this.resolvePromptFilePath(promptFile);
    const promptContent = promptFilePath
      ? this.readPromptFile(promptFilePath)
      : null;

    if (!promptContent) {
      const fallbackPrompt = this.readOptionalString(context.step.prompt);
      if (fallbackPrompt) {
        this.logger.warn(
          `Falling back to inline prompt for workflow ${context.workflowId}, job ${context.jobId}, step ${context.step.id}. Missing prompt_file: ${promptFile}`,
        );
        const stepWithoutPromptFile = this.withoutPromptFile(context.step);
        return {
          ...stepWithoutPromptFile,
          prompt: fallbackPrompt,
        };
      }

      throw new Error(
        `Prompt file '${promptFile}' could not be loaded for workflow '${context.workflowId}', job '${context.jobId}', step '${context.step.id}'`,
      );
    }

    const stepWithoutPromptFile = this.withoutPromptFile(context.step);
    return {
      ...stepWithoutPromptFile,
      prompt: promptContent,
    };
  }

  private withoutPromptFile(step: IJobStep): Omit<IJobStep, 'prompt_file'> {
    const stepRecord = {
      ...(step as unknown as Record<string, unknown>),
    };
    delete stepRecord.prompt_file;
    return stepRecord as Omit<IJobStep, 'prompt_file'>;
  }

  private resolvePromptFilePath(promptFile: string): string | null {
    if (path.isAbsolute(promptFile)) {
      throw new Error(`prompt_file must be relative, received '${promptFile}'`);
    }

    const normalizedPromptFile = promptFile.replaceAll('\\', '/').trim();
    if (!normalizedPromptFile) {
      throw new Error('prompt_file must be a non-empty relative path');
    }

    if (
      normalizedPromptFile.startsWith('../') ||
      normalizedPromptFile.includes('/../')
    ) {
      throw new Error(
        `prompt_file cannot traverse outside workflow seed root: '${promptFile}'`,
      );
    }

    const workflowSeedRoot = this.resolveWorkflowSeedRoot();
    if (!workflowSeedRoot) {
      return null;
    }

    return path.join(workflowSeedRoot, normalizedPromptFile);
  }

  private readPromptFile(filePath: string): string | null {
    if (this.shouldCachePrompts()) {
      const cached = this.promptCache.get(filePath);
      if (cached !== undefined) {
        return cached;
      }
    }

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const rawContent = fs.readFileSync(filePath, 'utf8');
      const content = rawContent.trim();
      if (!content) {
        return null;
      }

      if (this.shouldCachePrompts()) {
        this.promptCache.set(filePath, content);
      }

      return content;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `Failed to read prompt file '${filePath}': ${err.message}`,
      );
      return null;
    }
  }

  private resolveWorkflowSeedRoot(): string | undefined {
    const configuredRoot =
      process.env.NEXUS_WORKFLOWS_SEED_PATH?.trim() || null;
    const candidatePaths = [
      configuredRoot,
      path.join(process.cwd(), 'seed', 'workflows'),
      path.join(process.cwd(), '..', 'seed', 'workflows'),
      path.join(process.cwd(), '..', '..', 'seed', 'workflows'),
      path.resolve(__dirname, '../../../../seed/workflows'),
    ].filter((candidate): candidate is string => Boolean(candidate));

    return candidatePaths.find((candidate) => fs.existsSync(candidate));
  }

  private shouldCachePrompts(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private isExternalPromptsEnabled(): boolean {
    const value = process.env.EXTERNAL_PROMPTS_ENABLED?.trim().toLowerCase();
    if (!value) {
      return true;
    }

    return value !== 'false';
  }

  private readOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private resolvePromptLoadRetryAttempts(): number {
    const rawValue = process.env.NEXUS_PROMPT_LOAD_RETRY_ATTEMPTS;
    const parsedValue = Number.parseInt(rawValue ?? '', 10);
    if (!Number.isFinite(parsedValue) || parsedValue < 1) {
      return 4;
    }

    return Math.min(parsedValue, 10);
  }

  private resolvePromptLoadRetryBaseDelayMs(): number {
    const rawValue = process.env.NEXUS_PROMPT_LOAD_RETRY_BASE_DELAY_MS;
    const parsedValue = Number.parseInt(rawValue ?? '', 10);
    if (!Number.isFinite(parsedValue) || parsedValue < 1) {
      return 100;
    }

    return Math.min(parsedValue, 5000);
  }

  private isRetryablePromptLoadError(error: Error): boolean {
    return (
      error.message.includes('Prompt file') ||
      error.message.includes('ENOENT') ||
      error.message.includes('EACCES') ||
      error.message.includes('EBUSY')
    );
  }
}
