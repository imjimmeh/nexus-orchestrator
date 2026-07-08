import { Injectable, Logger } from '@nestjs/common';
import type {
  ISystemPromptContributor,
  PromptAssemblyContext,
  PromptContributionBlock,
  SkippedContributor,
  SystemPromptAssemblyResult,
} from './system-prompt-contributor.types';
import {
  DEFAULT_CONTRIBUTOR_PRIORITY,
  DEFAULT_CONTRIBUTOR_TIMEOUT_MS,
} from './system-prompt-contributor.types';

/**
 * Owns the system-prompt contributor registry and the assembly pipeline.
 * Consumed by the workflow agent-run path and by chat sessions.
 */
@Injectable()
export class SystemPromptAssemblyService {
  private readonly logger = new Logger(SystemPromptAssemblyService.name);
  private readonly contributors = new Map<string, ISystemPromptContributor>();

  register(contributor: ISystemPromptContributor): void {
    if (this.contributors.has(contributor.name)) {
      this.logger.warn(
        `Contributor "${contributor.name}" already registered, overwriting`,
      );
    }
    this.contributors.set(contributor.name, contributor);
  }

  getRegisteredNames(): string[] {
    return Array.from(this.contributors.keys());
  }

  getRegisteredCount(): number {
    return this.contributors.size;
  }

  isRegistryEmpty(): boolean {
    return this.contributors.size === 0;
  }

  /** Test-only: empty the registry. */
  clearForTesting(): void {
    this.contributors.clear();
  }

  async gatherBlocks(ctx: PromptAssemblyContext): Promise<{
    blocks: PromptContributionBlock[];
    applied: string[];
    skipped: SkippedContributor[];
  }> {
    const ordered = Array.from(this.contributors.values());
    const skipped: SkippedContributor[] = [];

    const results = await Promise.all(
      ordered.map(async (contributor, index) => {
        try {
          const block = await this.withTimeout(
            contributor.contribute(ctx),
            contributor.timeoutMs ?? DEFAULT_CONTRIBUTOR_TIMEOUT_MS,
          );
          if (block === null) {
            return null;
          }
          return { contributor, index, block };
        } catch (error) {
          skipped.push({
            name: contributor.name,
            stage: 'contribute',
            reason: (error as Error).message,
          });
          return null;
        }
      }),
    );

    const surviving = results.filter(
      (
        r,
      ): r is {
        contributor: ISystemPromptContributor;
        index: number;
        block: PromptContributionBlock;
      } => r !== null,
    );

    surviving.sort((a, b) => {
      const pa = a.block.priority ?? DEFAULT_CONTRIBUTOR_PRIORITY;
      const pb = b.block.priority ?? DEFAULT_CONTRIBUTOR_PRIORITY;
      if (pb !== pa) {
        return pb - pa;
      }
      return a.index - b.index;
    });

    return {
      blocks: surviving.map((s) => s.block),
      applied: surviving.map((s) => s.contributor.name),
      skipped,
    };
  }

  async applyTransforms(
    assembled: string,
    ctx: PromptAssemblyContext,
  ): Promise<{ prompt: string; skipped: SkippedContributor[] }> {
    const transformers = Array.from(this.contributors.values())
      .map((contributor, index) => ({ contributor, index }))
      .filter(
        (
          entry,
        ): entry is {
          contributor: ISystemPromptContributor & {
            transform: (
              s: string,
              ctx: PromptAssemblyContext,
            ) => Promise<string | null>;
          };
          index: number;
        } => typeof entry.contributor.transform === 'function',
      )
      .sort((a, b) => {
        const pa = a.contributor.priority ?? DEFAULT_CONTRIBUTOR_PRIORITY;
        const pb = b.contributor.priority ?? DEFAULT_CONTRIBUTOR_PRIORITY;
        if (pb !== pa) {
          return pb - pa;
        }
        return a.index - b.index;
      });

    const skipped: SkippedContributor[] = [];
    let prompt = assembled;

    for (const { contributor } of transformers) {
      try {
        const next = await this.withTimeout(
          contributor.transform(prompt, ctx),
          contributor.timeoutMs ?? DEFAULT_CONTRIBUTOR_TIMEOUT_MS,
        );
        if (typeof next === 'string') {
          prompt = next;
        }
      } catch (error) {
        skipped.push({
          name: contributor.name,
          stage: 'transform',
          reason: (error as Error).message,
        });
      }
    }

    return { prompt, skipped };
  }

  async assemble(
    ctx: PromptAssemblyContext,
  ): Promise<SystemPromptAssemblyResult> {
    const {
      blocks,
      applied,
      skipped: gatherSkipped,
    } = await this.gatherBlocks(ctx);

    const baseSection = ctx.baseLayers
      .map((layer) => layer.content)
      .filter((content) => content && content.trim().length > 0)
      .join('\n\n');

    const blockSections = blocks.map(
      (block) => `## ${block.title}\n\n${block.content}`,
    );

    const merged = [baseSection, ...blockSections]
      .filter((section) => section && section.trim().length > 0)
      .join('\n\n');

    const { prompt, skipped: transformSkipped } = await this.applyTransforms(
      merged,
      ctx,
    );

    return {
      prompt,
      blocks,
      applied,
      skipped: [...gatherSkipped, ...transformSkipped],
    };
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`contributor timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => {
      clearTimeout(timer);
    });
  }
}
