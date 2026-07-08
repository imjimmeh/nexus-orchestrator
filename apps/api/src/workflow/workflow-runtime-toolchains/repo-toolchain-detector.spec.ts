import { describe, it, expect } from 'vitest';
import { detectToolchainsFromFiles } from './repo-toolchain-detector';

describe('detectToolchainsFromFiles', () => {
  it('detects go version from go.mod', () => {
    const out = detectToolchainsFromFiles({
      'go.mod': 'module x\n\ngo 1.23\n',
    });
    expect(out).toEqual([{ tool: 'go', version: '1.23' }]);
  });

  it('detects python from .tool-versions with version', () => {
    const out = detectToolchainsFromFiles({
      '.tool-versions': 'python 3.12.1\nnode 24.0.0\n',
    });
    expect(out).toEqual([
      { tool: 'node', version: '24.0.0' },
      { tool: 'python', version: '3.12.1' },
    ]);
  });

  it('detects rust@latest from Cargo.toml presence', () => {
    const out = detectToolchainsFromFiles({
      'Cargo.toml': "[package]\nname='x'\n",
    });
    expect(out).toEqual([{ tool: 'rust', version: 'latest' }]);
  });

  it('detects python@latest from requirements.txt presence', () => {
    const out = detectToolchainsFromFiles({ 'requirements.txt': 'flask\n' });
    expect(out).toEqual([{ tool: 'python', version: 'latest' }]);
  });

  it('reads node engine from package.json', () => {
    const out = detectToolchainsFromFiles({
      'package.json': JSON.stringify({ engines: { node: '24' } }),
    });
    expect(out).toEqual([{ tool: 'node', version: '24' }]);
  });

  it('returns [] when nothing is present or files are null', () => {
    expect(detectToolchainsFromFiles({ 'go.mod': null })).toEqual([]);
  });

  it('dedupes, preferring the first (most specific) source', () => {
    const out = detectToolchainsFromFiles({
      '.tool-versions': 'python 3.12\n',
      'requirements.txt': 'flask\n',
    });
    expect(out).toEqual([{ tool: 'python', version: '3.12' }]);
  });
});
