import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { z } from 'zod';
import { DocumentParserService } from '../../attachments/parsing/document-parser.service';

const readDocumentInputSchema = z.object({
  file_path: z.string().min(1),
});

type ReadDocumentInput = z.infer<typeof readDocumentInputSchema>;

@Injectable()
export class ReadDocumentTool implements IInternalToolHandler<ReadDocumentInput> {
  constructor(private readonly documentParser: DocumentParserService) {}

  getName(): string {
    return 'read_document';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'ingestion', 'document'],
      description:
        'Parse PDF, DOCX, TXT, MD, CSV files and return their text content.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/internal-tools/execute',
        bodyMapping: { file_path: 'file_path' },
      },
      inputSchema: readDocumentInputSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: ReadDocumentInput,
  ): Promise<Record<string, unknown>> {
    const filePath = params.file_path;
    const resolvedPath = path.resolve(filePath);
    const workDir = process.cwd();
    const WORKSPACE_MOUNT = '/workspace';
    const isUnderWorkDir =
      resolvedPath.startsWith(workDir + path.sep) || resolvedPath === workDir;
    const isUnderWorkspaceMount =
      resolvedPath.startsWith(WORKSPACE_MOUNT + path.sep) ||
      resolvedPath === WORKSPACE_MOUNT;
    if (!isUnderWorkDir && !isUnderWorkspaceMount) {
      throw new Error(
        'Invalid path: access outside the working directory is not allowed',
      );
    }

    const ext = path.extname(filePath).toLowerCase();
    const filename = path.basename(filePath);
    let buffer: Buffer;

    if (ext === '.pdf' || ext === '.docx') {
      buffer = await fs.readFile(filePath);
    } else {
      const rawContent = await this.readTextFile(filePath);
      buffer = Buffer.from(rawContent, 'utf-8');
    }

    const parsed = await this.documentParser.parse(filename, buffer);
    return {
      filename: parsed.filename,
      content: parsed.content,
      word_count: parsed.word_count,
      truncated: parsed.truncated,
    };
  }

  private async readTextFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf8');
  }
}
