import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { z } from 'zod';
import { ImageDescriberService } from '../../attachments/parsing/image-describer.service';
import type { VisionAnalysis } from '../../attachments/parsing/vision.types';

const SUPPORTED_FORMATS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

const analyzeImageInputSchema = z.object({
  image_path: z.string().min(1),
  prompt: z
    .string()
    .optional()
    .default(
      'Analyze this UI image. Describe all visible elements, text content, UI components, and user flows.',
    ),
});

type AnalyzeImageInput = z.infer<typeof analyzeImageInputSchema>;

@Injectable()
export class AnalyzeImageTool implements IInternalToolHandler<AnalyzeImageInput> {
  constructor(private readonly imageDescriber: ImageDescriberService) {}

  getName(): string {
    return 'analyze_image';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['ingestion', 'vision'],
      description:
        'Analyze UI images, mockups, and screenshots using a vision model.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/internal-tools/execute',
        bodyMapping: { image_path: 'image_path', prompt: 'prompt' },
      },
      inputSchema: analyzeImageInputSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: AnalyzeImageInput,
  ): Promise<Record<string, unknown>> {
    const resolvedPath = path.resolve(params.image_path);
    const workDir = process.cwd();
    const WORKSPACE_MOUNT = '/workspace';
    if (
      !resolvedPath.startsWith(workDir + path.sep) &&
      resolvedPath !== workDir &&
      !resolvedPath.startsWith(WORKSPACE_MOUNT + path.sep) &&
      resolvedPath !== WORKSPACE_MOUNT
    ) {
      throw new Error(
        'Invalid path: access outside the working directory is not allowed',
      );
    }

    const ext = path.extname(params.image_path).toLowerCase();
    if (!SUPPORTED_FORMATS.includes(ext)) {
      throw new Error(
        `Unsupported image format: ${ext}. Supported: ${SUPPORTED_FORMATS.join(', ')}`,
      );
    }

    try {
      const imageBuffer = await this.readImageFile(resolvedPath);
      const mimeType =
        ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.webp'
              ? 'image/webp'
              : 'image/png';

      const filename = path.basename(params.image_path);
      const described = await this.imageDescriber.describe(
        filename,
        imageBuffer,
        mimeType,
        params.prompt,
      );

      if (!described.available) {
        return {
          error:
            'No vision model client configured. Ensure a vision-capable model is set up.',
          markdown: described.markdown,
        };
      }

      return { ...(described.analysis as VisionAnalysis) };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to analyze image';
      return { error: message };
    }
  }

  private async readImageFile(imagePath: string): Promise<Buffer> {
    return fs.readFile(imagePath);
  }
}
