import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { AssetImportController } from './asset-import.controller.js';
import { AssetImporterService } from './asset-importer.service.js';
import type { HarnessAssetSource } from '@nexus/core';
import type { PrepareImportResult } from './asset-importer.service.types.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const RESOLVED_SHA = 'abc1234567890abcdef1234567890abcdef123456';

const GIT_SOURCE: HarnessAssetSource = {
  kind: 'git',
  repo: 'https://github.com/example/my-test-plugin',
  ref: 'main',
};

const PINNED_SOURCE: HarnessAssetSource = {
  kind: 'git',
  repo: 'https://github.com/example/my-test-plugin',
  ref: RESOLVED_SHA,
};

const PREVIEW_RESULT: PrepareImportResult = {
  kind: 'plugin',
  manifest: {
    name: 'my-test-plugin',
    capabilities: { slashCommands: ['run'] },
  },
  checksum: 'sha256:abc123',
  pinnedSource: PINNED_SOURCE,
  bundleSizeBytes: 512,
};

function makeService(): Pick<
  AssetImporterService,
  'prepareImport' | 'confirmImport'
> & {
  prepareImport: ReturnType<typeof vi.fn>;
  confirmImport: ReturnType<typeof vi.fn>;
} {
  return {
    prepareImport: vi.fn(async () => PREVIEW_RESULT),
    confirmImport: vi.fn(async () => 'new-asset-uuid'),
  };
}

// ---------------------------------------------------------------------------
// Preview endpoint
// ---------------------------------------------------------------------------

describe('AssetImportController — POST /harness/assets/import (preview)', () => {
  let controller: AssetImportController;
  let svc: ReturnType<typeof makeService>;

  beforeEach(() => {
    svc = makeService();
    controller = new AssetImportController(
      svc as unknown as AssetImporterService,
    );
  });

  it('returns manifest, checksum, and pinnedSource from prepareImport', async () => {
    const result = await controller.preview({ source: GIT_SOURCE });

    expect(result).toEqual({
      kind: PREVIEW_RESULT.kind,
      manifest: PREVIEW_RESULT.manifest,
      checksum: PREVIEW_RESULT.checksum,
      pinnedSource: PREVIEW_RESULT.pinnedSource,
    });
  });

  it('calls prepareImport with the source and scopeNodeId', async () => {
    await controller.preview({ source: GIT_SOURCE, scopeNodeId: 'scope-1' });

    expect(svc.prepareImport).toHaveBeenCalledWith(GIT_SOURCE, {
      scopeNodeId: 'scope-1',
    });
  });

  it('passes undefined scopeNodeId when not provided', async () => {
    await controller.preview({ source: GIT_SOURCE });

    expect(svc.prepareImport).toHaveBeenCalledWith(GIT_SOURCE, {
      scopeNodeId: undefined,
    });
  });

  it('NEVER calls confirmImport (no persist on preview)', async () => {
    await controller.preview({ source: GIT_SOURCE });

    expect(svc.confirmImport).not.toHaveBeenCalled();
  });

  it('propagates UnprocessableEntityException from a bad source', async () => {
    svc.prepareImport.mockRejectedValueOnce(
      new UnprocessableEntityException('bad source'),
    );

    await expect(controller.preview({ source: GIT_SOURCE })).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(svc.confirmImport).not.toHaveBeenCalled();
  });

  it('does NOT include bundleSizeBytes in the preview response', async () => {
    const result = await controller.preview({ source: GIT_SOURCE });

    expect(result).not.toHaveProperty('bundleSizeBytes');
  });
});

// ---------------------------------------------------------------------------
// Confirm endpoint
// ---------------------------------------------------------------------------

describe('AssetImportController — POST /harness/assets/import/confirm (persist)', () => {
  let controller: AssetImportController;
  let svc: ReturnType<typeof makeService>;

  beforeEach(() => {
    svc = makeService();
    controller = new AssetImportController(
      svc as unknown as AssetImporterService,
    );
  });

  it('returns { id } from confirmImport', async () => {
    const result = await controller.confirm({ source: GIT_SOURCE });

    expect(result).toEqual({ id: 'new-asset-uuid' });
  });

  it('calls confirmImport with the source and scopeNodeId', async () => {
    await controller.confirm({ source: GIT_SOURCE, scopeNodeId: 'scope-2' });

    expect(svc.confirmImport).toHaveBeenCalledWith(GIT_SOURCE, {
      scopeNodeId: 'scope-2',
    });
  });

  it('passes undefined scopeNodeId when not provided', async () => {
    await controller.confirm({ source: GIT_SOURCE });

    expect(svc.confirmImport).toHaveBeenCalledWith(GIT_SOURCE, {
      scopeNodeId: undefined,
    });
  });

  it('propagates UnprocessableEntityException from a bad source', async () => {
    svc.confirmImport.mockRejectedValueOnce(
      new UnprocessableEntityException('vetting failed'),
    );

    await expect(controller.confirm({ source: GIT_SOURCE })).rejects.toThrow(
      UnprocessableEntityException,
    );
  });
});

// ---------------------------------------------------------------------------
// Secret non-leakage contract
// ---------------------------------------------------------------------------

describe('AssetImportController — preview never returns secret values', () => {
  it('manifest returned from preview is the safe summary, not raw env/headers', async () => {
    // The service is responsible for redacting; the controller just passes
    // through whatever prepareImport returns. This test asserts that the
    // controller does not inject any secret-bearing fields itself.
    const safeManifest = {
      name: 'my-test-plugin',
      capabilities: {},
    };
    const svc = makeService();
    svc.prepareImport.mockResolvedValueOnce({
      ...PREVIEW_RESULT,
      manifest: safeManifest,
    });
    const controller = new AssetImportController(
      svc as unknown as AssetImporterService,
    );

    const result = await controller.preview({ source: GIT_SOURCE });

    expect(result.manifest).toEqual(safeManifest);
    // No raw env or headers should appear
    expect(result).not.toHaveProperty('env');
    expect(result).not.toHaveProperty('headers');
  });
});
