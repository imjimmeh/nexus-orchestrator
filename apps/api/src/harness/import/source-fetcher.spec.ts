import { describe, it, expect, vi } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DefaultSourceFetcher,
  SourceFetchError,
  type SystemAdapter,
} from './source-fetcher.js';
import type { HarnessAssetSource } from '@nexus/core';

// ---------------------------------------------------------------------------
// SystemAdapter test double
// ---------------------------------------------------------------------------

type SpawnResult = ReturnType<SystemAdapter['spawn']>;

interface SpawnCall {
  cmd: string;
  args: string[];
}

/**
 * Builds a minimal fake ChildProcess factory.
 *
 * Unlike creating the proc immediately, we return a FACTORY so that the
 * close-event emission is scheduled AFTER the caller has registered its
 * listeners — avoiding the "emit before listen" race.
 */
function makeSpawnFactory(
  stdoutLines: string[],
  exitCode: number,
): () => SpawnResult {
  return () => {
    const closeListeners: Array<(code: number) => void> = [];
    const stdoutListeners: Array<(chunk: Buffer) => void> = [];

    const proc: SpawnResult = {
      stdout: {
        on: vi.fn((_event: string, cb: (chunk: Buffer) => void) => {
          stdoutListeners.push(cb);
        }),
      } as unknown as SpawnResult['stdout'],
      stderr: {
        on: vi.fn(),
      } as unknown as SpawnResult['stderr'],
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'close') {
          closeListeners.push(cb);
          // Schedule emission AFTER this `on` call so that the timer set-up
          // in runCommand also completes before the close fires.
          void Promise.resolve().then(() => {
            for (const line of stdoutLines) {
              for (const stdoutCb of stdoutListeners) {
                stdoutCb(Buffer.from(line + '\n'));
              }
            }
            for (const closeCb of closeListeners) {
              closeCb(exitCode);
            }
          });
        }
      }),
      kill: vi.fn(),
    };

    return proc;
  };
}

/**
 * Creates a `SystemAdapter` whose `spawn` cycles through the provided
 * factories in order (repeating the last one when exhausted).
 *
 * All other methods are no-ops or return sensible defaults; override as
 * needed.
 */
function makeAdapter(
  spawnFactories: Array<() => SpawnResult>,
  overrides: Partial<SystemAdapter> = {},
): SystemAdapter & { spawnCalls: SpawnCall[] } {
  const spawnCalls: SpawnCall[] = [];
  let callIndex = 0;

  return {
    spawnCalls,
    spawn(cmd, args, _opts) {
      spawnCalls.push({ cmd, args });
      const factory =
        spawnFactories[callIndex] ??
        spawnFactories[spawnFactories.length - 1] ??
        makeSpawnFactory([], 1);
      callIndex++;
      return factory();
    },
    mkdtempSync: vi.fn(() => '/tmp/nexus-sf-test'),
    rmSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ size: 0 })),
    readFileSync: vi.fn(() => ''),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RESOLVED_SHA = 'abc1234567890abcdef1234567890abcdef123456';
const REPO = 'https://github.com/example/my-plugin';
const REF = 'v1.2.3';
const GIT_SOURCE: HarnessAssetSource = { kind: 'git', repo: REPO, ref: REF };

/** Builds a success adapter: clone exit-0, rev-parse → sha, empty dir. */
function makeSuccessAdapter(
  sha = RESOLVED_SHA,
): ReturnType<typeof makeAdapter> {
  return makeAdapter([
    makeSpawnFactory([], 0), // git clone --branch ...
    makeSpawnFactory([sha], 0), // git rev-parse HEAD
  ]);
}

// ---------------------------------------------------------------------------
// Security validation
// ---------------------------------------------------------------------------

describe('DefaultSourceFetcher — security validation', () => {
  it('rejects a repo starting with "-" BEFORE spawning', async () => {
    const adapter = makeSuccessAdapter();
    const fetcher = new DefaultSourceFetcher(adapter);

    await expect(
      fetcher.fetch({ kind: 'git', repo: '-malicious', ref: 'main' }),
    ).rejects.toThrow(SourceFetchError);
    expect(adapter.spawnCalls).toHaveLength(0);
  });

  it('rejects a ref starting with "-" BEFORE spawning', async () => {
    const adapter = makeSuccessAdapter();
    const fetcher = new DefaultSourceFetcher(adapter);

    await expect(
      fetcher.fetch({ kind: 'git', repo: REPO, ref: '--upload-pack=evil' }),
    ).rejects.toThrow(SourceFetchError);
    expect(adapter.spawnCalls).toHaveLength(0);
  });

  it('rejects a subdir starting with "-" BEFORE spawning', async () => {
    const adapter = makeSuccessAdapter();
    const fetcher = new DefaultSourceFetcher(adapter);

    await expect(
      fetcher.fetch({
        kind: 'git',
        repo: REPO,
        ref: 'main',
        subdir: '-inject',
      }),
    ).rejects.toThrow(SourceFetchError);
    expect(adapter.spawnCalls).toHaveLength(0);
  });

  it('throws SourceFetchError with reason "invalid_source" for a bad repo', async () => {
    const fetcher = new DefaultSourceFetcher(makeSuccessAdapter());

    let caught: unknown;
    try {
      await fetcher.fetch({ kind: 'git', repo: '-bad', ref: 'main' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SourceFetchError);
    expect((caught as SourceFetchError).reason).toBe('invalid_source');
  });
});

// ---------------------------------------------------------------------------
// Git clone argument safety
// ---------------------------------------------------------------------------

describe('DefaultSourceFetcher — git clone argument safety', () => {
  it('passes repo and ref as separate array elements (injection-safe)', async () => {
    const adapter = makeSuccessAdapter();
    const fetcher = new DefaultSourceFetcher(adapter);

    await fetcher.fetch(GIT_SOURCE).catch(() => undefined);

    const cloneCall = adapter.spawnCalls[0];
    expect(cloneCall?.cmd).toBe('git');
    expect(Array.isArray(cloneCall?.args)).toBe(true);
    expect(cloneCall?.args).toContain('clone');
    expect(cloneCall?.args).toContain(REPO);
    expect(cloneCall?.args).toContain(REF);
    // Each token must be a SEPARATE element — not a single shell-interpolated string
    expect(
      cloneCall?.args.some((a: string) => a.includes(REPO) && a.includes(REF)),
    ).toBe(false);
  });

  it('passes HEAD to git rev-parse as a separate array element', async () => {
    const adapter = makeSuccessAdapter();
    const fetcher = new DefaultSourceFetcher(adapter);

    await fetcher.fetch(GIT_SOURCE).catch(() => undefined);

    const revParseCall = adapter.spawnCalls.find((c) =>
      c.args.includes('rev-parse'),
    );
    expect(revParseCall).toBeDefined();
    expect(revParseCall?.args).toContain('HEAD');
    // Must not be concatenated ("rev-parse HEAD" as a single arg)
    expect(
      revParseCall?.args.every((a: string) => a !== 'rev-parse HEAD'),
    ).toBe(true);
  });

  it('captures the resolved SHA from `git rev-parse HEAD`', async () => {
    const sha = 'deadbeef1234567890abcdef1234567890abcdef';
    const adapter = makeAdapter(
      [makeSpawnFactory([], 0), makeSpawnFactory([sha], 0)],
      {
        readdirSync: vi.fn(() => [
          { name: 'ext.ts', isDirectory: () => false },
        ]),
        statSync: vi.fn(() => ({ size: 50 })),
        readFileSync: vi.fn(() => 'export default function setup(pi) {}'),
      },
    );

    const result = await new DefaultSourceFetcher(adapter).fetch(GIT_SOURCE);

    expect(result.resolvedRef).toBe(sha);
  });

  it('throws SourceFetchError(clone_failed) when all clone attempts exit non-zero', async () => {
    // Both clone attempts (--branch and fallback plain) fail
    const adapter = makeAdapter([
      makeSpawnFactory([], 1), // clone --branch fails
      makeSpawnFactory([], 1), // clone plain falls back and also fails
    ]);

    let caught: unknown;
    try {
      await new DefaultSourceFetcher(adapter).fetch(GIT_SOURCE);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SourceFetchError);
    expect((caught as SourceFetchError).reason).toBe('clone_failed');
  });
});

// ---------------------------------------------------------------------------
// Size cap enforcement (real fs — no adapter mock needed for the disk part)
// ---------------------------------------------------------------------------

describe('DefaultSourceFetcher — size cap during read', () => {
  it('aborts with SourceFetchError(size_cap_exceeded) when total bytes exceed the cap', async () => {
    // Create a real temp dir with a file larger than the cap.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-spec-'));
    fs.writeFileSync(path.join(tmpDir, 'big.ts'), 'x'.repeat(1024));

    try {
      // Use real fs methods for the read path so the actual file is seen.
      const adapter = makeAdapter(
        [makeSpawnFactory([], 0), makeSpawnFactory([RESOLVED_SHA], 0)],
        {
          mkdtempSync: vi.fn(() => tmpDir),
          rmSync: vi.fn(),
          readdirSync(dirPath: string) {
            return fs
              .readdirSync(dirPath, { withFileTypes: true })
              .map((e) => ({
                name: e.name,
                isDirectory: () => e.isDirectory(),
              }));
          },
          statSync(filePath: string) {
            return fs.statSync(filePath);
          },
          readFileSync(filePath: string) {
            return fs.readFileSync(filePath, 'utf8');
          },
        },
      );
      const fetcher = new DefaultSourceFetcher(adapter);

      let caught: unknown;
      try {
        // Cap is 100 bytes; the file is 1024 bytes — must abort.
        await fetcher.fetch(GIT_SOURCE, { sizeCap: 100 });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(SourceFetchError);
      expect((caught as SourceFetchError).reason).toBe('size_cap_exceeded');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Temp dir cleanup
// ---------------------------------------------------------------------------

describe('DefaultSourceFetcher — temp dir cleanup', () => {
  it('calls rmSync(recursive+force) after a successful fetch', async () => {
    const tmpDir = '/tmp/nexus-sf-cleanup-ok';
    const rmSpy = vi.fn();
    const adapter = makeAdapter(
      [makeSpawnFactory([], 0), makeSpawnFactory([RESOLVED_SHA], 0)],
      {
        mkdtempSync: vi.fn(() => tmpDir),
        rmSync: rmSpy,
        readdirSync: vi.fn(() => []),
      },
    );

    await new DefaultSourceFetcher(adapter).fetch(GIT_SOURCE);

    expect(rmSpy).toHaveBeenCalledWith(tmpDir, {
      recursive: true,
      force: true,
    });
  });

  it('calls rmSync(recursive+force) even when clone fails', async () => {
    const tmpDir = '/tmp/nexus-sf-cleanup-err';
    const rmSpy = vi.fn();
    const adapter = makeAdapter(
      [makeSpawnFactory([], 1), makeSpawnFactory([], 1)],
      {
        mkdtempSync: vi.fn(() => tmpDir),
        rmSync: rmSpy,
      },
    );

    await new DefaultSourceFetcher(adapter)
      .fetch(GIT_SOURCE)
      .catch(() => undefined);

    expect(rmSpy).toHaveBeenCalledWith(tmpDir, {
      recursive: true,
      force: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Registry source
// ---------------------------------------------------------------------------

describe('DefaultSourceFetcher — registry source', () => {
  it('throws SourceFetchError with reason "unsupported"', async () => {
    const fetcher = new DefaultSourceFetcher();

    let caught: unknown;
    try {
      await fetcher.fetch({
        kind: 'registry',
        name: 'my-pkg',
        version: '1.0.0',
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SourceFetchError);
    expect((caught as SourceFetchError).reason).toBe('unsupported');
  });
});

// ---------------------------------------------------------------------------
// Authored source
// ---------------------------------------------------------------------------

describe('DefaultSourceFetcher — authored source', () => {
  it('throws SourceFetchError with reason "unsupported"', async () => {
    const fetcher = new DefaultSourceFetcher();

    let caught: unknown;
    try {
      await fetcher.fetch({ kind: 'authored' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SourceFetchError);
    expect((caught as SourceFetchError).reason).toBe('unsupported');
  });
});

// ---------------------------------------------------------------------------
// Subdir support
// ---------------------------------------------------------------------------

describe('DefaultSourceFetcher — subdir support', () => {
  it('reads files relative to subdir when source.subdir is set', async () => {
    const tmpDir = '/tmp/nexus-sf-subdir';
    const sha = RESOLVED_SHA;
    const subdirReadSpy = vi.fn(() => [
      { name: 'plugin.json', isDirectory: () => false },
    ]);
    const adapter = makeAdapter(
      [makeSpawnFactory([], 0), makeSpawnFactory([sha], 0)],
      {
        mkdtempSync: vi.fn(() => tmpDir),
        rmSync: vi.fn(),
        readdirSync: subdirReadSpy,
        statSync: vi.fn(() => ({ size: 20 })),
        readFileSync: vi.fn(() => '{"name":"x"}'),
      },
    );
    const source: HarnessAssetSource = {
      kind: 'git',
      repo: REPO,
      ref: 'main',
      subdir: 'packages/my-plugin',
    };

    const result = await new DefaultSourceFetcher(adapter).fetch(source);

    // readdirSync must be called on the subdir path
    expect(subdirReadSpy).toHaveBeenCalledWith(
      path.join(tmpDir, 'packages/my-plugin'),
    );
    expect(result.resolvedRef).toBe(sha);
    expect(result.files[0]?.path).toBe('plugin.json');
  });
});
