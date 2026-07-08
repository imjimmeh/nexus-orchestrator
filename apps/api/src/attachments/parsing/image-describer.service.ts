import { Injectable, Optional } from '@nestjs/common';
import type { VisionClient, DescribedImage } from './vision.types';

const DEFAULT_PROMPT =
  'Analyze this image. Describe all visible elements, text content, UI components, and user flows.';

@Injectable()
export class ImageDescriberService {
  constructor(@Optional() private readonly visionClient: VisionClient | null) {}

  async describe(
    filename: string,
    buffer: Buffer,
    mimeType: string,
    prompt = DEFAULT_PROMPT,
  ): Promise<DescribedImage> {
    if (!this.visionClient) {
      return {
        available: false,
        markdown: `# ${filename}\n\n_No vision model configured; image not analyzed._`,
      };
    }

    const analysis = await this.visionClient.analyzeBase64Image({
      base64: buffer.toString('base64'),
      mimeType,
      prompt,
    });

    const markdown = [
      `# ${filename}`,
      ``,
      `## Description`,
      analysis.description,
      ``,
      `## Text content`,
      analysis.text_content,
      ``,
      `## UI components`,
      analysis.ui_components.map((c) => `- ${c}`).join('\n'),
    ].join('\n');

    return { available: true, markdown, analysis };
  }
}
