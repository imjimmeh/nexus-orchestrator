import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyGithubSignature } from './webhook-signature.util';

const secret = 'shhh';
const body = Buffer.from(JSON.stringify({ action: 'closed' }), 'utf-8');

function sign(buf: Buffer, key: string): string {
  return `sha256=${createHmac('sha256', key).update(buf).digest('hex')}`;
}

describe('verifyGithubSignature', () => {
  it('accepts a valid sha256 signature over the raw body', () => {
    expect(verifyGithubSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const tampered = Buffer.from(JSON.stringify({ action: 'opened' }), 'utf-8');
    expect(verifyGithubSignature(tampered, sign(body, secret), secret)).toBe(
      false,
    );
  });

  it('rejects an absent signature header', () => {
    expect(verifyGithubSignature(body, undefined, secret)).toBe(false);
  });

  it('rejects a signature signed with a different secret', () => {
    expect(verifyGithubSignature(body, sign(body, 'other'), secret)).toBe(
      false,
    );
  });
});
