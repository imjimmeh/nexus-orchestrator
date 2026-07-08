import { describe, it, expect, vi } from 'vitest';
import { McpTransportType } from '@nexus/core';
import type { ResolvedMcpServerDescriptor } from '@nexus/core';
import { resolveMcpServerRefs } from './harness-mcp-ref-resolution';
import type { McpServer } from '../mcp/database/entities/mcp-server.entity';
import type { McpSecretResolver } from './harness-mcp-ref-resolution.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 'server-uuid-1',
    name: 'my-mcp-server',
    enabled: true,
    transport_type: McpTransportType.HTTP,
    url: 'http://localhost:3100',
    headers: { 'X-Api': 'plain-key' },
    headers_secret_id: null,
    command: null,
    args: null,
    env: null,
    env_secret_id: null,
    include_tools: null,
    exclude_tools: null,
    timeout_ms: 30000,
    connect_timeout_ms: 10000,
    max_retries: 2,
    retry_backoff_ms: 1000,
    last_status: 'connected' as McpServer['last_status'],
    last_error: null,
    last_connected_at: null,
    last_discovered_at: null,
    last_discovered_tool_count: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// Minimal McpServerRepository shape (only findById is used by the resolver).
function makeMockRepo(servers: Map<string, McpServer>) {
  return {
    findById: vi.fn(async (id: string) => servers.get(id) ?? null),
  };
}

/**
 * A passthrough secret resolver that returns plaintext as-is and records
 * invocations. Used for tests that don't exercise secret resolution itself.
 */
function makePassthroughResolver(): McpSecretResolver & {
  resolveMap: ReturnType<typeof vi.fn>;
} {
  return {
    resolveMap: vi.fn(async ({ plaintext }) => plaintext ?? null),
  };
}

/**
 * A fake resolver that returns a fixed map for any secretId that is set,
 * merged with plaintext (secret values take precedence on key collision).
 */
function makeSecretResolver(
  secretValues: Record<string, string>,
): McpSecretResolver {
  return {
    resolveMap: vi.fn(async ({ secretId, plaintext }) => {
      if (secretId) {
        // Merge: plaintext first, then secret overrides (secret wins on collision).
        return { ...(plaintext ?? {}), ...secretValues };
      }
      return plaintext ?? null;
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveMcpServerRefs', () => {
  it('resolves an HTTP server ref into a descriptor with correct shape', async () => {
    const server = makeServer({
      id: 'uuid-http',
      name: 'http-server',
      transport_type: McpTransportType.HTTP,
      url: 'https://mcp.example.com',
      headers: { Accept: 'application/json' },
      headers_secret_id: null,
    });
    const repo = makeMockRepo(new Map([['uuid-http', server]]));

    const result = await resolveMcpServerRefs(
      ['uuid-http'],
      repo,
      makePassthroughResolver(),
    );

    expect(result.resolved).toHaveLength(1);
    const desc = result.resolved[0];
    expect(desc.id).toBe('uuid-http');
    expect(desc.name).toBe('http-server');
    expect(desc.transportType).toBe('http');
    expect(desc.url).toBe('https://mcp.example.com');
    expect(desc.headers).toEqual({ Accept: 'application/json' });
    // envSecretId and headersSecretId are no longer on the descriptor
    // (resolution happens API-side; only resolved maps are emitted).
    expect(
      (desc as Record<string, unknown>)['headersSecretId'],
    ).toBeUndefined();
    // No stdio fields on an HTTP server
    expect(desc.command).toBeUndefined();
    expect(desc.args).toBeUndefined();
    expect(desc.env).toBeUndefined();
    expect((desc as Record<string, unknown>)['envSecretId']).toBeUndefined();
    expect(desc.timeoutMs).toBe(30000);
    expect(desc.connectTimeoutMs).toBe(10000);
    expect(result.droppedIds).toHaveLength(0);
  });

  it('resolves a stdio server ref into a descriptor with correct shape', async () => {
    const server = makeServer({
      id: 'uuid-stdio',
      name: 'stdio-server',
      transport_type: McpTransportType.STDIO,
      command: '/usr/local/bin/my-tool',
      args: ['--mode', 'stdio'],
      env: { LOG_LEVEL: 'debug' },
      env_secret_id: null,
      url: null,
      headers: null,
      headers_secret_id: null,
      include_tools: ['tool_a', 'tool_b'],
      exclude_tools: ['tool_c'],
    });
    const repo = makeMockRepo(new Map([['uuid-stdio', server]]));

    const result = await resolveMcpServerRefs(
      ['uuid-stdio'],
      repo,
      makePassthroughResolver(),
    );

    expect(result.resolved).toHaveLength(1);
    const desc = result.resolved[0];
    expect(desc.transportType).toBe('stdio');
    expect(desc.command).toBe('/usr/local/bin/my-tool');
    expect(desc.args).toEqual(['--mode', 'stdio']);
    expect(desc.env).toEqual({ LOG_LEVEL: 'debug' });
    expect((desc as Record<string, unknown>)['envSecretId']).toBeUndefined();
    expect(desc.includeTools).toEqual(['tool_a', 'tool_b']);
    expect(desc.excludeTools).toEqual(['tool_c']);
    // No HTTP fields on a stdio server
    expect(desc.url).toBeUndefined();
    expect(desc.headers).toBeUndefined();
    expect(
      (desc as Record<string, unknown>)['headersSecretId'],
    ).toBeUndefined();
    expect(result.droppedIds).toHaveLength(0);
  });

  it('drops unknown server ids and records them in droppedIds (no throw)', async () => {
    const repo = makeMockRepo(new Map()); // empty — nothing found

    const result = await resolveMcpServerRefs(
      ['unknown-id'],
      repo,
      makePassthroughResolver(),
    );

    expect(result.resolved).toHaveLength(0);
    expect(result.droppedIds).toEqual(['unknown-id']);
  });

  it('resolves multiple refs, dropping only the unknown ones', async () => {
    const known = makeServer({ id: 'known-id' });
    const repo = makeMockRepo(new Map([['known-id', known]]));

    const result = await resolveMcpServerRefs(
      ['known-id', 'missing-a', 'missing-b'],
      repo,
      makePassthroughResolver(),
    );

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].id).toBe('known-id');
    expect(result.droppedIds).toEqual(['missing-a', 'missing-b']);
  });

  it('de-duplicates refs so each server is resolved at most once', async () => {
    const server = makeServer({ id: 'dup-id' });
    const findById = vi.fn(async () => server);
    const repo = { findById };

    const result = await resolveMcpServerRefs(
      ['dup-id', 'dup-id'],
      repo,
      makePassthroughResolver(),
    );

    // Should appear only once even though ref was given twice
    expect(result.resolved).toHaveLength(1);
    // findById should only be called once due to dedup
    expect(findById).toHaveBeenCalledTimes(1);
    expect(result.droppedIds).toHaveLength(0);
  });

  it('returns empty arrays when given no refs', async () => {
    const repo = makeMockRepo(new Map());
    const result = await resolveMcpServerRefs(
      [],
      repo,
      makePassthroughResolver(),
    );
    expect(result.resolved).toHaveLength(0);
    expect(result.droppedIds).toHaveLength(0);
  });

  it('omits null/undefined optional fields from the descriptor', async () => {
    const server = makeServer({
      id: 'minimal-http',
      name: 'minimal',
      transport_type: McpTransportType.HTTP,
      url: 'http://localhost:9999',
      headers: null,
      headers_secret_id: null,
      include_tools: null,
      exclude_tools: null,
    });
    const repo = makeMockRepo(new Map([['minimal-http', server]]));

    const result = await resolveMcpServerRefs(
      ['minimal-http'],
      repo,
      makePassthroughResolver(),
    );

    const desc = result.resolved[0];
    // Optional null fields must NOT appear as `null` in the descriptor
    expect(desc.headers).toBeUndefined();
    expect(
      (desc as Record<string, unknown>)['headersSecretId'],
    ).toBeUndefined();
    expect(desc.includeTools).toBeUndefined();
    expect(desc.excludeTools).toBeUndefined();
  });

  it('produces a descriptor whose shape matches ResolvedMcpServerDescriptor contract', async () => {
    const server = makeServer({ id: 'contract-check' });
    const repo = makeMockRepo(new Map([['contract-check', server]]));

    const result = await resolveMcpServerRefs(
      ['contract-check'],
      repo,
      makePassthroughResolver(),
    );

    const desc = result.resolved[0];
    // Required fields that must always be present
    expect(typeof desc.id).toBe('string');
    expect(typeof desc.name).toBe('string');
    expect(['stdio', 'http']).toContain(desc.transportType);
    expect(typeof desc.timeoutMs).toBe('number');
    expect(typeof desc.connectTimeoutMs).toBe('number');
  });

  // -------------------------------------------------------------------------
  // Fix A: Secret resolution
  // -------------------------------------------------------------------------

  describe('secret resolution (Fix A)', () => {
    it('resolves env_secret_id for a stdio server when only a secret_id is set (plaintext null)', async () => {
      const server = makeServer({
        id: 'stdio-secret',
        name: 'secure-stdio',
        transport_type: McpTransportType.STDIO,
        command: '/bin/tool',
        env: null, // no plaintext
        env_secret_id: 'env-secret-uuid',
        url: null,
        headers: null,
        headers_secret_id: null,
      });
      const repo = makeMockRepo(new Map([['stdio-secret', server]]));
      const resolver = makeSecretResolver({ SECRET_TOKEN: 'resolved-value' });

      const result = await resolveMcpServerRefs(
        ['stdio-secret'],
        repo,
        resolver,
      );

      expect(result.resolved).toHaveLength(1);
      const desc = result.resolved[0];
      // The secret-resolved values must appear in env.
      expect(desc.env).toEqual({ SECRET_TOKEN: 'resolved-value' });
      // envSecretId must NOT appear on the descriptor (resolved API-side).
      expect((desc as Record<string, unknown>)['envSecretId']).toBeUndefined();
    });

    it('resolves headers_secret_id for an HTTP server when only a secret_id is set (plaintext null)', async () => {
      const server = makeServer({
        id: 'http-secret',
        name: 'secure-http',
        transport_type: McpTransportType.HTTP,
        url: 'https://mcp.example.com',
        headers: null, // no plaintext
        headers_secret_id: 'headers-secret-uuid',
        env: null,
        env_secret_id: null,
      });
      const repo = makeMockRepo(new Map([['http-secret', server]]));
      const resolver = makeSecretResolver({
        Authorization: 'Bearer token-xyz',
      });

      const result = await resolveMcpServerRefs(
        ['http-secret'],
        repo,
        resolver,
      );

      expect(result.resolved).toHaveLength(1);
      const desc = result.resolved[0];
      // The secret-resolved Authorization header must be present.
      expect(desc.headers).toEqual({ Authorization: 'Bearer token-xyz' });
      // headersSecretId must NOT appear on the descriptor (resolved API-side).
      expect(
        (desc as Record<string, unknown>)['headersSecretId'],
      ).toBeUndefined();
    });

    it('merges plaintext env with secret env, secret values take precedence on key collision', async () => {
      const server = makeServer({
        id: 'stdio-merge',
        name: 'merge-stdio',
        transport_type: McpTransportType.STDIO,
        command: '/bin/tool',
        env: { LOG_LEVEL: 'debug', PLAIN_KEY: 'plain-val' },
        env_secret_id: 'env-secret-uuid',
        url: null,
        headers: null,
        headers_secret_id: null,
      });
      const repo = makeMockRepo(new Map([['stdio-merge', server]]));
      // Secret overrides LOG_LEVEL; adds SECRET_KEY.
      const resolver = makeSecretResolver({
        LOG_LEVEL: 'info', // overrides plaintext
        SECRET_KEY: 'secret-val',
      });

      const result = await resolveMcpServerRefs(
        ['stdio-merge'],
        repo,
        resolver,
      );

      expect(result.resolved).toHaveLength(1);
      const desc = result.resolved[0];
      expect(desc.env).toEqual({
        PLAIN_KEY: 'plain-val',
        LOG_LEVEL: 'info', // secret wins
        SECRET_KEY: 'secret-val',
      });
    });

    it('merges plaintext headers with secret headers, secret values take precedence on key collision', async () => {
      const server = makeServer({
        id: 'http-merge',
        name: 'merge-http',
        transport_type: McpTransportType.HTTP,
        url: 'https://example.com',
        headers: { Accept: 'application/json', Authorization: 'plain-token' },
        headers_secret_id: 'headers-secret-uuid',
        env: null,
        env_secret_id: null,
      });
      const repo = makeMockRepo(new Map([['http-merge', server]]));
      // Secret overrides Authorization; Accept is preserved from plaintext.
      const resolver = makeSecretResolver({
        Authorization: 'Bearer secret-token',
      });

      const result = await resolveMcpServerRefs(['http-merge'], repo, resolver);

      expect(result.resolved).toHaveLength(1);
      const desc = result.resolved[0];
      expect(desc.headers).toEqual({
        Accept: 'application/json',
        Authorization: 'Bearer secret-token', // secret wins
      });
    });

    it('passes env_secret_id to resolveMap for stdio servers', async () => {
      const server = makeServer({
        id: 'spy-stdio',
        name: 'spy-server',
        transport_type: McpTransportType.STDIO,
        command: '/bin/tool',
        env: null,
        env_secret_id: 'env-secret-uuid',
        url: null,
        headers: null,
        headers_secret_id: null,
      });
      const repo = makeMockRepo(new Map([['spy-stdio', server]]));
      const resolver: McpSecretResolver = {
        resolveMap: vi.fn(async () => ({ RESOLVED: 'yes' })),
      };

      await resolveMcpServerRefs(['spy-stdio'], repo, resolver);

      expect(resolver.resolveMap).toHaveBeenCalledWith(
        expect.objectContaining({
          secretId: 'env-secret-uuid',
          purpose: 'env',
          serverName: 'spy-server',
        }),
      );
    });

    it('passes headers_secret_id to resolveMap for HTTP servers', async () => {
      const server = makeServer({
        id: 'spy-http',
        name: 'spy-http-server',
        transport_type: McpTransportType.HTTP,
        url: 'https://example.com',
        headers: null,
        headers_secret_id: 'headers-secret-uuid',
        env: null,
        env_secret_id: null,
      });
      const repo = makeMockRepo(new Map([['spy-http', server]]));
      const resolver: McpSecretResolver = {
        resolveMap: vi.fn(async () => ({ Authorization: 'Bearer resolved' })),
      };

      await resolveMcpServerRefs(['spy-http'], repo, resolver);

      expect(resolver.resolveMap).toHaveBeenCalledWith(
        expect.objectContaining({
          secretId: 'headers-secret-uuid',
          purpose: 'headers',
          serverName: 'spy-http-server',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Fix C: Disabled servers
  // -------------------------------------------------------------------------

  describe('disabled servers (Fix C)', () => {
    it('does not produce a descriptor for a disabled server', async () => {
      const disabledServer = makeServer({
        id: 'disabled-uuid',
        enabled: false,
      });
      const repo = makeMockRepo(new Map([['disabled-uuid', disabledServer]]));

      const result = await resolveMcpServerRefs(
        ['disabled-uuid'],
        repo,
        makePassthroughResolver(),
      );

      expect(result.resolved).toHaveLength(0);
      // Not in droppedIds either — disabled is a different outcome from not-found.
      expect(result.droppedIds).toHaveLength(0);
    });

    it('skips disabled servers while still resolving enabled ones', async () => {
      const enabled = makeServer({ id: 'enabled-id', enabled: true });
      const disabled = makeServer({ id: 'disabled-id', enabled: false });
      const repo = makeMockRepo(
        new Map([
          ['enabled-id', enabled],
          ['disabled-id', disabled],
        ]),
      );

      const result = await resolveMcpServerRefs(
        ['disabled-id', 'enabled-id'],
        repo,
        makePassthroughResolver(),
      );

      expect(result.resolved).toHaveLength(1);
      expect(result.resolved[0].id).toBe('enabled-id');
      expect(result.droppedIds).toHaveLength(0);
    });
  });
});
