import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IJob, IJobStep } from '@nexus/core';
import type { PromptContractMentions } from './seed-data-validation.contract-compiler.types';
import { extractPromptContractMentions } from './seed-data-validation.prompt-contract.helpers';
import type { ParsedWorkflowSeed } from './seed-data-validation.types';

export function collectWorkflowPromptContractMentions(params: {
  parsedWorkflows: ParsedWorkflowSeed[];
  workflowsRoot: string;
}): Map<string, Map<string, PromptContractMentions>> {
  const mentionsByWorkflow = new Map<
    string,
    Map<string, PromptContractMentions>
  >();

  for (const workflow of params.parsedWorkflows) {
    const mentionsByJob = collectWorkflowMentions({
      workflow,
      workflowsRoot: params.workflowsRoot,
    });
    mentionsByWorkflow.set(workflow.workflowId, mentionsByJob);
  }

  return mentionsByWorkflow;
}

function collectWorkflowMentions(params: {
  workflow: ParsedWorkflowSeed;
  workflowsRoot: string;
}): Map<string, PromptContractMentions> {
  const mentionsByJob = new Map<string, PromptContractMentions>();

  for (const promptSource of collectWorkflowPromptSources({
    parsed: params.workflow.parsed,
    filePath: params.workflow.filePath,
    workflowsRoot: params.workflowsRoot,
  })) {
    const existing = mentionsByJob.get(promptSource.jobId) ?? emptyMentions();
    const next = extractPromptContractMentions(promptSource.content);
    mentionsByJob.set(promptSource.jobId, mergePromptMentions(existing, next));
  }

  return mentionsByJob;
}

function collectWorkflowPromptSources(params: {
  parsed: ParsedWorkflowSeed['parsed'];
  filePath: string;
  workflowsRoot: string;
}): Array<{ content: string; jobId: string }> {
  const promptSources: Array<{ content: string; jobId: string }> = [];

  for (const job of params.parsed.jobs ?? []) {
    for (const step of collectWorkflowJobSteps(job)) {
      const inlinePrompt = readInlinePrompt(step);
      if (inlinePrompt) {
        promptSources.push({ content: inlinePrompt, jobId: job.id });
      }

      const promptFilePath = resolvePromptFilePath(step, params.workflowsRoot);
      if (promptFilePath) {
        promptSources.push({
          content: fs.readFileSync(promptFilePath, 'utf8'),
          jobId: job.id,
        });
      }
    }
  }

  return promptSources;
}

function collectWorkflowJobSteps(job: IJob): IJobStep[] {
  if (!Array.isArray(job.steps)) {
    return [];
  }

  return job.steps;
}

function readInlinePrompt(step: IJobStep): string | null {
  const prompt = (step as { prompt?: unknown }).prompt;
  if (typeof prompt !== 'string') {
    return null;
  }

  const trimmed = prompt.trim();
  return trimmed.length > 0 ? prompt : null;
}

function resolvePromptFilePath(
  step: IJobStep,
  workflowsRoot: string,
): string | null {
  const promptFile = (step as { prompt_file?: unknown }).prompt_file;
  if (typeof promptFile !== 'string') {
    return null;
  }

  const trimmed = promptFile.trim();
  if (!trimmed) {
    return null;
  }

  const promptPath = path.join(workflowsRoot, trimmed);
  return fs.existsSync(promptPath) ? promptPath : null;
}

function emptyMentions(): PromptContractMentions {
  return { toolNames: [], setJobOutputKeys: [], eventNames: [] };
}

function mergePromptMentions(
  left: PromptContractMentions,
  right: PromptContractMentions,
): PromptContractMentions {
  return {
    toolNames: mergeUnique(left.toolNames, right.toolNames),
    setJobOutputKeys: mergeUnique(
      left.setJobOutputKeys,
      right.setJobOutputKeys,
    ),
    eventNames: mergeUnique(left.eventNames, right.eventNames),
  };
}

function mergeUnique(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b));
}
