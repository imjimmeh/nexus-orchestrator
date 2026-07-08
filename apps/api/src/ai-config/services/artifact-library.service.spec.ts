import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ArtifactLibraryService } from './artifact-library.service';

describe('ArtifactLibraryService', () => {
  let tempRoot: string;
  let service: ArtifactLibraryService;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-library-'));
    process.env.NEXUS_ARTIFACT_LIBRARY_PATH = tempRoot;
    service = new ArtifactLibraryService();
  });

  afterEach(() => {
    delete process.env.NEXUS_ARTIFACT_LIBRARY_PATH;
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('creates and lists global artifacts', () => {
    const created = service.createArtifact({
      name: 'Release Notes Bundle',
      description: 'Reusable release note templates.',
      scope: 'global',
    });

    expect(created.id).toBe('release-notes-bundle');

    const listed = service.listArtifacts({ query: 'release' });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe('release-notes-bundle');
  });

  it('upserts and lists artifact files', () => {
    const created = service.createArtifact({
      artifact_id: 'ops-playbooks',
      name: 'Ops Playbooks',
      description: 'Operational script snippets',
    });

    const files = service.upsertArtifactFile({
      artifactId: created.id,
      relativePath: 'scripts/rollback.sh',
      content: Buffer.from('echo rollback', 'utf8'),
    });

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('scripts/rollback.sh');

    const listedFiles = service.listArtifactFiles(created.id);
    expect(listedFiles).toHaveLength(1);
    expect(listedFiles[0]?.path).toBe('scripts/rollback.sh');
  });

  it('upserts artifact metadata when artifact already exists', () => {
    service.createArtifact({
      artifact_id: 'chat-templates',
      name: 'Chat Templates',
      description: 'Initial templates',
    });

    const updated = service.upsertArtifact({
      artifact_id: 'chat-templates',
      name: 'Chat Templates',
      description: 'Updated templates',
      scope: 'profile',
      owner_profile: 'friendly-general-assistant',
    });

    expect(updated.scope).toBe('profile');
    expect(updated.ownerProfile).toBe('friendly-general-assistant');
    expect(updated.description).toBe('Updated templates');
  });

  it('rejects artifact file paths that escape the artifact directory', () => {
    service.createArtifact({
      artifact_id: 'safe-artifact',
      name: 'Safe Artifact',
      description: 'Path safety checks',
    });

    expect(() =>
      service.upsertArtifactFile({
        artifactId: 'safe-artifact',
        relativePath: '../escape.txt',
        content: Buffer.from('nope', 'utf8'),
      }),
    ).toThrow(BadRequestException);
  });
});
