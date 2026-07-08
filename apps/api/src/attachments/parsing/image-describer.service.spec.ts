import { describe, expect, it, vi } from 'vitest';
import { ImageDescriberService } from './image-describer.service';

describe('ImageDescriberService', () => {
  it('returns a skipped markdown note when no vision client is available', async () => {
    const service = new ImageDescriberService(null);
    const result = await service.describe(
      'a.png',
      Buffer.from('x'),
      'image/png',
    );
    expect(result.markdown).toContain('vision');
    expect(result.available).toBe(false);
  });

  it('uses the vision client when present', async () => {
    const vision = {
      analyzeBase64Image: vi.fn().mockResolvedValue({
        description: 'A login form',
        elements_detected: ['button'],
        text_content: 'Sign in',
        ui_components: ['form'],
      }),
    };
    const service = new ImageDescriberService(vision);
    const result = await service.describe(
      'a.png',
      Buffer.from('x'),
      'image/png',
    );
    expect(vision.analyzeBase64Image).toHaveBeenCalled();
    expect(result.markdown).toContain('A login form');
    expect(result.available).toBe(true);
  });
});
