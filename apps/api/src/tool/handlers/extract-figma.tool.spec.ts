import { describe, it, expect, vi } from 'vitest';
import { ExtractFigmaTool } from './extract-figma.tool';
import type { SecretManagerService } from '../../security/secret-manager.service';

const mockSecretStore = {
  getSecret: vi.fn(),
} as unknown as SecretManagerService;

describe('ExtractFigmaTool', () => {
  it('exposes the extract_figma tool name', () => {
    expect(new ExtractFigmaTool(mockSecretStore).getName()).toBe(
      'extract_figma',
    );
  });

  it('fetches file structure from Figma API', async () => {
    (mockSecretStore.getSecret as ReturnType<typeof vi.fn>).mockResolvedValue(
      'fake-figma-token',
    );
    const tool = new ExtractFigmaTool(mockSecretStore);

    vi.spyOn(tool as any, 'callFigmaApi').mockResolvedValue({
      name: 'My Design File',
      document: {
        children: [
          {
            id: '1',
            name: 'Page 1',
            type: 'CANVAS',
            children: [
              { id: '2', name: 'Login Frame', type: 'FRAME', children: [] },
            ],
          },
        ],
      },
      styles: {},
    });

    const result = await tool.execute(
      { workflowRunId: 'run-1', jobId: 'job-1' },
      { figma_url: 'https://www.figma.com/file/abc123/My-Design-File' },
    );

    expect(result).toMatchObject({
      file_name: 'My Design File',
      pages: expect.any(Array),
      components: expect.any(Array),
      text_content: expect.any(String),
      styles: expect.any(Object),
    });
  });

  it('extracts file key from Figma URL', () => {
    const tool = new ExtractFigmaTool(mockSecretStore);
    const key = (tool as any).extractFileKey(
      'https://www.figma.com/file/abc123XYZ/My-Design',
    );
    expect(key).toBe('abc123XYZ');
  });

  it('throws on an invalid (non-Figma) URL', () => {
    const tool = new ExtractFigmaTool(mockSecretStore);
    expect(() =>
      (tool as any).extractFileKey('https://not-figma.com/abc'),
    ).toThrow();
  });
});
