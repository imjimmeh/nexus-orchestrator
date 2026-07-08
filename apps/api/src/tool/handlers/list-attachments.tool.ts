import { Injectable } from '@nestjs/common';
import {
  attachmentOwnerTypeSchema,
  type IInternalToolHandler,
  type InternalToolExecutionContext,
  type RuntimeCapabilityDefinition,
} from '@nexus/core';
import { z } from 'zod';
import { AttachmentsService } from '../../attachments/attachments.service';

const listAttachmentsInputSchema = z.object({
  owner_type: attachmentOwnerTypeSchema,
  owner_id: z.string().min(1),
});

type ListAttachmentsInput = z.infer<typeof listAttachmentsInputSchema>;

@Injectable()
export class ListAttachmentsTool implements IInternalToolHandler<ListAttachmentsInput> {
  constructor(private readonly attachments: AttachmentsService) {}

  getName(): string {
    return 'list_attachments';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'ingestion', 'attachment'],
      description:
        'List all attachments linked to a given owner (e.g. a chat message or project).',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/internal-tools/execute',
        bodyMapping: { owner_type: 'owner_type', owner_id: 'owner_id' },
      },
      inputSchema: listAttachmentsInputSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: ListAttachmentsInput,
  ): Promise<Record<string, unknown>> {
    const found = await this.attachments.listForOwner(
      params.owner_type,
      params.owner_id,
    );
    return {
      attachments: found.map((a) => ({
        id: a.id,
        filename: a.filename,
        mime_type: a.mime_type,
        parse_status: a.parse_status,
      })),
    };
  }
}
