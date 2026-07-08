import { Injectable } from '@nestjs/common';
import axios from 'axios';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { z } from 'zod';
import { SecretManagerService } from '../../security/secret-manager.service';

const FIGMA_BASE_URL = 'https://api.figma.com/v1';
const FIGMA_FILE_URL_PATTERN = /figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/;

const extractFigmaInputSchema = z.object({
  figma_url: z.string().min(1),
});

type ExtractFigmaInput = z.infer<typeof extractFigmaInputSchema>;

@Injectable()
export class ExtractFigmaTool implements IInternalToolHandler<ExtractFigmaInput> {
  constructor(private readonly secretStore: SecretManagerService) {}

  getName(): string {
    return 'extract_figma';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['ingestion', 'figma'],
      description:
        'Fetch Figma file structure, pages, components, and text via the Figma API.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/internal-tools/execute',
        bodyMapping: { figma_url: 'figma_url' },
      },
      inputSchema: extractFigmaInputSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: ExtractFigmaInput,
  ): Promise<Record<string, unknown>> {
    const fileKey = this.extractFileKey(params.figma_url);
    const token = await this.secretStore.getSecret('FIGMA_API_TOKEN');
    const data = await this.callFigmaApi(fileKey, token);

    const pages = (data.document?.children ?? []).map((page: FigmaNode) => ({
      id: page.id,
      name: page.name,
      frames: (page.children ?? [])
        .filter((n: FigmaNode) => n.type === 'FRAME')
        .map((f: FigmaNode) => ({ id: f.id, name: f.name })),
    }));

    const textContent = this.extractAllText(data.document);
    const components = Object.values(data.components ?? {}).map(
      (c: FigmaComponent) => ({
        id: c.id,
        name: c.name,
        description: c.description,
      }),
    );

    return {
      file_name: data.name,
      pages,
      components,
      text_content: textContent,
      styles: data.styles ?? {},
    };
  }

  private extractFileKey(url: string): string {
    const match = url.match(FIGMA_FILE_URL_PATTERN);
    if (!match)
      throw new Error(`Cannot extract Figma file key from URL: ${url}`);
    return match[1];
  }

  private async callFigmaApi(
    fileKey: string,
    token: string,
  ): Promise<FigmaFileResponse> {
    const response = await axios.get<FigmaFileResponse>(
      `${FIGMA_BASE_URL}/files/${fileKey}`,
      {
        headers: { 'X-Figma-Token': token },
      },
    );
    return response.data;
  }

  private extractAllText(node: FigmaNode | undefined): string {
    if (!node) return '';
    if (node.type === 'TEXT') return node.characters ?? '';
    if (!node.children) return '';
    return node.children
      .map((child) => this.extractAllText(child))
      .filter(Boolean)
      .join(' ');
  }
}

interface FigmaNode {
  id: string;
  name: string;
  type: string;
  characters?: string;
  children?: FigmaNode[];
}

interface FigmaComponent {
  id: string;
  name: string;
  description?: string;
}

interface FigmaFileResponse {
  name: string;
  document?: FigmaNode;
  components?: Record<string, FigmaComponent>;
  styles?: Record<string, unknown>;
}
