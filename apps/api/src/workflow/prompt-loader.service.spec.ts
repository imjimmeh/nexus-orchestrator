import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PromptLoaderService } from './prompt-loader.service';
import { IWorkflowDefinition } from '@nexus/core';

describe('PromptLoaderService', () => {
  let tempRoot: string;
  let service: PromptLoaderService;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-loader-'));
    process.env.NEXUS_WORKFLOWS_SEED_PATH = tempRoot;
    process.env.EXTERNAL_PROMPTS_ENABLED = 'true';
    delete process.env.NODE_ENV;
    service = new PromptLoaderService();
  });

  afterEach(() => {
    delete process.env.NEXUS_WORKFLOWS_SEED_PATH;
    delete process.env.EXTERNAL_PROMPTS_ENABLED;
    delete process.env.NODE_ENV;
    delete process.env.NEXUS_PROMPT_LOAD_RETRY_ATTEMPTS;
    delete process.env.NEXUS_PROMPT_LOAD_RETRY_BASE_DELAY_MS;

    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('loads prompt content from prompt_file', () => {
    const promptPath = path.join(tempRoot, 'prompts', 'wf', 'implement.md');
    fs.mkdirSync(path.dirname(promptPath), { recursive: true });
    fs.writeFileSync(promptPath, 'External prompt', 'utf8');

    const def: IWorkflowDefinition = {
      workflow_id: 'wf',
      name: 'Workflow',
      jobs: [
        {
          id: 'implement',
          type: 'execution',
          tier: 'heavy',
          steps: [
            {
              id: 'main',
              type: 'agent',
              prompt_file: 'prompts/wf/implement.md',
            },
          ],
        },
      ],
    };

    const resolved = service.resolveWorkflowPrompts(def);
    const prompt = resolved.jobs?.[0]?.steps?.[0]?.prompt;

    expect(prompt).toBe('External prompt');
  });

  it('falls back to inline prompt when prompt_file is missing', () => {
    const def: IWorkflowDefinition = {
      workflow_id: 'wf',
      name: 'Workflow',
      jobs: [
        {
          id: 'implement',
          type: 'execution',
          tier: 'heavy',
          steps: [
            {
              id: 'main',
              type: 'agent',
              prompt: 'Inline prompt',
              prompt_file: 'prompts/wf/missing.md',
            },
          ],
        },
      ],
    };

    const resolved = service.resolveWorkflowPrompts(def);
    expect(resolved.jobs?.[0]?.steps?.[0]?.prompt).toBe('Inline prompt');
  });

  it('throws when prompt_file is missing and no inline fallback exists', () => {
    const def: IWorkflowDefinition = {
      workflow_id: 'wf',
      name: 'Workflow',
      jobs: [
        {
          id: 'implement',
          type: 'execution',
          tier: 'heavy',
          steps: [
            {
              id: 'main',
              type: 'agent',
              prompt_file: 'prompts/wf/missing.md',
            },
          ],
        },
      ],
    };

    expect(() => service.resolveWorkflowPrompts(def)).toThrow(
      "Prompt file 'prompts/wf/missing.md' could not be loaded",
    );
  });

  it('rejects prompt_file traversal paths', () => {
    const def: IWorkflowDefinition = {
      workflow_id: 'wf',
      name: 'Workflow',
      jobs: [
        {
          id: 'implement',
          type: 'execution',
          tier: 'heavy',
          steps: [
            {
              id: 'main',
              type: 'agent',
              prompt_file: '../secrets.md',
            },
          ],
        },
      ],
    };

    expect(() => service.resolveWorkflowPrompts(def)).toThrow(
      'prompt_file cannot traverse outside workflow seed root',
    );
  });

  it('retries prompt resolution and succeeds when file appears later', async () => {
    process.env.NEXUS_PROMPT_LOAD_RETRY_ATTEMPTS = '3';
    process.env.NEXUS_PROMPT_LOAD_RETRY_BASE_DELAY_MS = '1';

    const promptPath = path.join(tempRoot, 'prompts', 'wf', 'delayed.md');
    const def: IWorkflowDefinition = {
      workflow_id: 'wf',
      name: 'Workflow',
      jobs: [
        {
          id: 'implement',
          type: 'execution',
          tier: 'heavy',
          steps: [
            {
              id: 'main',
              type: 'agent',
              prompt_file: 'prompts/wf/delayed.md',
            },
          ],
        },
      ],
    };

    setTimeout(() => {
      fs.mkdirSync(path.dirname(promptPath), { recursive: true });
      fs.writeFileSync(promptPath, 'Delayed prompt', 'utf8');
    }, 2);

    const resolved = await service.resolveWorkflowPromptsWithRetry(def);
    expect(resolved.jobs?.[0]?.steps?.[0]?.prompt).toBe('Delayed prompt');
  });

  it('throws after exhausting prompt resolution retries', async () => {
    process.env.NEXUS_PROMPT_LOAD_RETRY_ATTEMPTS = '2';
    process.env.NEXUS_PROMPT_LOAD_RETRY_BASE_DELAY_MS = '1';

    const def: IWorkflowDefinition = {
      workflow_id: 'wf',
      name: 'Workflow',
      jobs: [
        {
          id: 'implement',
          type: 'execution',
          tier: 'heavy',
          steps: [
            {
              id: 'main',
              type: 'agent',
              prompt_file: 'prompts/wf/missing.md',
            },
          ],
        },
      ],
    };

    await expect(service.resolveWorkflowPromptsWithRetry(def)).rejects.toThrow(
      "Prompt file 'prompts/wf/missing.md' could not be loaded",
    );
  });
});
