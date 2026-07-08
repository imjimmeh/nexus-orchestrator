import { Injectable } from '@nestjs/common';
import * as path from 'path';
import type { ParsedDocument } from './document-parser.service.types';

export type { ParsedDocument } from './document-parser.service.types';

const MAX_CONTENT_BYTES = 100_000;

@Injectable()
export class DocumentParserService {
  async parse(filename: string, buffer: Buffer): Promise<ParsedDocument> {
    const ext = path.extname(filename).toLowerCase();
    let raw: string;

    if (ext === '.pdf') {
      raw = await this.readPdf(buffer);
    } else if (ext === '.docx') {
      raw = await this.readDocx(buffer);
    } else {
      raw = buffer.toString('utf-8');
    }

    const rawBytes = Buffer.from(raw, 'utf-8');
    const truncated = rawBytes.length > MAX_CONTENT_BYTES;
    const content = truncated
      ? rawBytes.subarray(0, MAX_CONTENT_BYTES).toString('utf-8')
      : raw;
    const word_count = content.trim() ? content.trim().split(/\s+/).length : 0;

    return { filename, content, word_count, truncated };
  }

  private async readPdf(buffer: Buffer): Promise<string> {
    const pdfParseModule = await import('pdf-parse');
    const pdfParseFn =
      (pdfParseModule as { default?: unknown }).default ?? pdfParseModule;
    if (typeof pdfParseFn !== 'function') {
      throw new Error(
        'Failed to load pdf-parse: module did not export a function',
      );
    }
    const data = await (
      pdfParseFn as (buf: Buffer) => Promise<{ text: string }>
    )(buffer);
    return data.text;
  }

  private async readDocx(buffer: Buffer): Promise<string> {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
}
