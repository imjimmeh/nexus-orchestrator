import * as path from 'path';
import { describe, it, expect, vi } from 'vitest';
import { AnalyzeImageTool } from './analyze-image.tool';
import { ImageDescriberService } from '../../attachments/parsing/image-describer.service';

const mockVisionClient = {
  analyzeBase64Image: vi.fn(),
};

describe('AnalyzeImageTool', () => {
  it('exposes the analyze_image tool name', () => {
    const describer = new ImageDescriberService(mockVisionClient);
    expect(new AnalyzeImageTool(describer).getName()).toBe('analyze_image');
  });

  it('returns structured analysis from vision model', async () => {
    mockVisionClient.analyzeBase64Image.mockResolvedValue({
      description: 'A login form with email and password fields',
      elements_detected: ['input', 'button', 'form'],
      text_content: 'Email, Password, Sign In',
      ui_components: ['TextInput', 'PasswordInput', 'Button'],
    });

    const describer = new ImageDescriberService(mockVisionClient);
    const tool = new AnalyzeImageTool(describer);
    vi.spyOn(tool as any, 'readImageFile').mockResolvedValue(
      Buffer.from('fake-image'),
    );

    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      { image_path: path.join(process.cwd(), 'mockups', 'login.png') },
    );

    expect(result).toMatchObject({
      description: expect.any(String),
      elements_detected: expect.any(Array),
      text_content: expect.any(String),
      ui_components: expect.any(Array),
    });
  });

  it('rejects path traversal in image_path', async () => {
    const describer = new ImageDescriberService(mockVisionClient);
    const tool = new AnalyzeImageTool(describer);
    await expect(
      tool.execute(
        { workflowRunId: 'run-1', jobId: 'job-1' },
        {
          image_path: '../../../etc/shadow.png',
        },
      ),
    ).rejects.toThrow('Invalid path');
  });

  it('falls back gracefully when no vision client is available', async () => {
    const describer = new ImageDescriberService(null);
    const tool = new AnalyzeImageTool(describer);
    vi.spyOn(tool as any, 'readImageFile').mockResolvedValue(
      Buffer.from('fake-image'),
    );
    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      { image_path: path.join(process.cwd(), 'mockups', 'login.png') },
    );
    expect(result.error).toContain('vision');
  });
});
