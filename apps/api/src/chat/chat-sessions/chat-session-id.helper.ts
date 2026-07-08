import { createHash } from 'node:crypto';

export function buildDeterministicSessionId(seed: string): string {
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 32);

  const timeLow = hash.slice(0, 8);
  const timeMid = hash.slice(8, 12);
  const timeHigh = `4${hash.slice(13, 16)}`;
  const variantNibble = ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  const clockSeq = `${variantNibble}${hash.slice(17, 20)}`;
  const node = hash.slice(20, 32);

  return `${timeLow}-${timeMid}-${timeHigh}-${clockSeq}-${node}`;
}
