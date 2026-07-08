import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { z } from 'zod';

const createArtifactInputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  force: z.boolean().optional().default(false),
});

type CreateArtifactInput = z.infer<typeof createArtifactInputSchema>;

@Injectable()
export class CreateArtifactTool implements IInternalToolHandler<CreateArtifactInput> {
  getName(): string {
    return 'create_artifact';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['ingestion', 'write'],
      description:
        'Create a file artifact in the project repository or worktree.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/internal-tools/execute',
        bodyMapping: { path: 'path', content: 'content', force: 'force' },
      },
      inputSchema: createArtifactInputSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: CreateArtifactInput,
  ): Promise<Record<string, unknown>> {
    if (params.path.includes('..')) {
      throw new Error('Invalid path: directory traversal is not allowed');
    }

    if (!params.force) {
      const exists = await fs
        .stat(params.path)
        .then(() => true)
        .catch((e: unknown) => {
          const err = e as NodeJS.ErrnoException;
          if (err.code !== 'ENOENT') throw e;
          return false;
        });
      if (exists) {
        throw new Error(
          `File already exists at ${params.path}. Use force: true to overwrite.`,
        );
      }
    }

    const dir = path.dirname(params.path);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(params.path, params.content, 'utf8');

    return {
      path: params.path,
      created: true,
      size_bytes: Buffer.byteLength(params.content, 'utf8'),
    };
  }
}
