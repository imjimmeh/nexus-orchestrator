import { describe, expect, it, vi } from 'vitest';
import { DocumentParserService } from './document-parser.service';

vi.mock('pdf-parse', () => ({
  default: vi.fn().mockResolvedValue({ text: 'parsed pdf content' }),
}));

vi.mock('mammoth', () => ({
  extractRawText: vi.fn().mockResolvedValue({ value: 'parsed docx content' }),
}));

describe('DocumentParserService', () => {
  it('returns plain text for txt/md content under the cap', async () => {
    const service = new DocumentParserService();
    const result = await service.parse(
      'notes.md',
      Buffer.from('# Title\nbody'),
    );
    expect(result.content).toContain('# Title');
    expect(result.truncated).toBe(false);
    expect(result.word_count).toBeGreaterThan(0);
  });

  it('truncates content beyond the byte cap', async () => {
    const service = new DocumentParserService();
    const big = 'a '.repeat(80_000);
    const result = await service.parse('big.txt', Buffer.from(big));
    expect(result.truncated).toBe(true);
  });

  it('parses PDF files using pdf-parse', async () => {
    const service = new DocumentParserService();
    const result = await service.parse('doc.pdf', Buffer.from('%PDF'));
    expect(result.content).toBe('parsed pdf content');
    expect(result.filename).toBe('doc.pdf');
  });

  it('parses DOCX files using mammoth', async () => {
    const service = new DocumentParserService();
    const result = await service.parse('doc.docx', Buffer.from('docx-bytes'));
    expect(result.content).toBe('parsed docx content');
  });
});
