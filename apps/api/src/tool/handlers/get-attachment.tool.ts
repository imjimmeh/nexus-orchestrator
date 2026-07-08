import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { z } from 'zod';
import { AttachmentsService } from '../../attachments/attachments.service';

const ATTACHMENTS_DIR = '.attachments';

const getAttachmentInputSchema = z.object({
  attachment_id: z.string().uuid(),
});

type GetAttachmentInput = z.infer<typeof getAttachmentInputSchema>;

@Injectable()
export class GetAttachmentTool implements IInternalToolHandler<GetAttachmentInput> {
  constructor(private readonly attachments: AttachmentsService) {}

  getName(): string {
    return 'get_attachment';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'ingestion', 'attachment'],
      description:
        'Materialize an attachment into the worktree by UUID and return its local path and parsed content.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/internal-tools/execute',
        bodyMapping: { attachment_id: 'attachment_id' },
      },
      inputSchema: getAttachmentInputSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: GetAttachmentInput,
  ): Promise<Record<string, unknown>> {
    getAttachmentInputSchema.parse(params);
    const meta = await this.attachments.getMetadata(params.attachment_id);
    const { body } = await this.attachments.getContent(params.attachment_id);
    const parsed = await this.attachments.getParsed(params.attachment_id);

    const dir = path.join(process.cwd(), ATTACHMENTS_DIR, meta.id);
    const safeName = path.basename(meta.filename);
    const filePath = path.join(dir, safeName);

    const allowedRoot = path.join(process.cwd(), ATTACHMENTS_DIR);
    if (
      !filePath.startsWith(allowedRoot + path.sep) &&
      filePath !== allowedRoot
    ) {
      throw new Error(
        'Invalid path: access outside the attachments directory is not allowed',
      );
    }

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, body);

    return {
      path: filePath,
      parsed_content: parsed.content ?? null,
      parse_status: parsed.status,
      mime_type: meta.mime_type,
    };
  }
}
