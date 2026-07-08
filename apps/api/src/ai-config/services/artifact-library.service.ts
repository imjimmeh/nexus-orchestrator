import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ArtifactFileSummary,
  ArtifactLibraryRecord,
  ArtifactScope,
  CreateArtifactInput,
  ListArtifactsInput,
  UpsertArtifactFileInput,
} from './artifact-library.service.types';

const ARTIFACT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARTIFACT_METADATA_FILE = 'artifact.json';

interface ArtifactMetadataRecord {
  artifact_id: string;
  name: string;
  description: string;
  scope: ArtifactScope;
  owner_profile: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class ArtifactLibraryService {
  private readonly libraryRoot: string;

  constructor() {
    this.libraryRoot =
      process.env.NEXUS_ARTIFACT_LIBRARY_PATH?.trim() ||
      path.join(process.cwd(), 'storage', 'artifacts');

    fs.mkdirSync(this.libraryRoot, { recursive: true });
  }

  getLibraryRootPath(): string {
    return this.libraryRoot;
  }

  listArtifacts(params?: ListArtifactsInput): ArtifactLibraryRecord[] {
    if (!fs.existsSync(this.libraryRoot)) {
      return [];
    }

    const query = params?.query?.trim().toLowerCase() ?? '';

    return fs
      .readdirSync(this.libraryRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.tryReadArtifactRecord(entry.name))
      .filter((record): record is ArtifactLibraryRecord => Boolean(record))
      .filter((record) => {
        if (params?.scope && record.scope !== params.scope) {
          return false;
        }

        if (
          params?.owner_profile &&
          record.ownerProfile !== params.owner_profile.trim()
        ) {
          return false;
        }

        if (!query) {
          return true;
        }

        return (
          record.id.includes(query) ||
          record.name.toLowerCase().includes(query) ||
          record.description.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  getArtifact(id: string): ArtifactLibraryRecord {
    const normalizedId = this.normalizeArtifactId(id);
    const record = this.tryReadArtifactRecord(normalizedId);
    if (!record) {
      throw new NotFoundException(`Artifact with id ${normalizedId} not found`);
    }

    return record;
  }

  artifactExists(id: string): boolean {
    const normalizedId = this.normalizeArtifactId(id);
    return this.tryReadArtifactRecord(normalizedId) !== null;
  }

  createArtifact(input: CreateArtifactInput): ArtifactLibraryRecord {
    const artifactId = this.resolveArtifactId(input);
    if (this.artifactExists(artifactId)) {
      throw new BadRequestException(
        `Artifact id already exists: ${artifactId}`,
      );
    }

    const now = new Date().toISOString();
    const metadataRecord: ArtifactMetadataRecord = {
      artifact_id: artifactId,
      name: this.normalizeNonEmpty(input.name, 'name'),
      description: this.normalizeNonEmpty(input.description, 'description'),
      scope: input.scope ?? 'global',
      owner_profile:
        typeof input.owner_profile === 'string' &&
        input.owner_profile.trim().length > 0
          ? input.owner_profile.trim()
          : null,
      metadata:
        input.metadata && typeof input.metadata === 'object'
          ? input.metadata
          : null,
      created_at: now,
      updated_at: now,
    };

    this.writeMetadataFile(artifactId, metadataRecord);
    return this.getArtifact(artifactId);
  }

  upsertArtifact(input: CreateArtifactInput): ArtifactLibraryRecord {
    const artifactId = this.resolveArtifactId(input);
    const existing = this.tryReadMetadata(artifactId);
    if (!existing) {
      return this.createArtifact({
        ...input,
        artifact_id: artifactId,
      });
    }

    const nextRecord = this.buildUpsertMetadataRecord(existing, input);

    this.writeMetadataFile(artifactId, nextRecord);
    return this.getArtifact(artifactId);
  }

  listArtifactFiles(id: string): ArtifactFileSummary[] {
    const artifact = this.getArtifact(id);
    const allFiles = this.listRelativeFiles(artifact.rootPath);

    return allFiles
      .filter((relativePath) => relativePath !== ARTIFACT_METADATA_FILE)
      .map((relativePath) => {
        const fullPath = path.join(artifact.rootPath, relativePath);
        const stats = fs.statSync(fullPath);
        return {
          path: relativePath,
          sizeBytes: stats.size,
          updatedAt: stats.mtime.toISOString(),
        };
      });
  }

  upsertArtifactFile(params: UpsertArtifactFileInput): ArtifactFileSummary[] {
    const artifact = this.getArtifact(params.artifactId);
    const safePath = this.resolveSafeRelativePath(params.relativePath);
    if (safePath === ARTIFACT_METADATA_FILE) {
      throw new BadRequestException(
        `${ARTIFACT_METADATA_FILE} cannot be updated as a regular artifact file`,
      );
    }

    const targetPath = path.join(artifact.rootPath, safePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, params.content);

    this.touchArtifact(artifact.id);
    return this.listArtifactFiles(artifact.id);
  }

  deleteArtifactFile(id: string, relativePath: string): ArtifactFileSummary[] {
    const artifact = this.getArtifact(id);
    const safePath = this.resolveSafeRelativePath(relativePath);
    if (safePath === ARTIFACT_METADATA_FILE) {
      throw new BadRequestException(
        `${ARTIFACT_METADATA_FILE} cannot be deleted via artifact file endpoint`,
      );
    }

    const targetPath = path.join(artifact.rootPath, safePath);
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    this.touchArtifact(artifact.id);
    return this.listArtifactFiles(artifact.id);
  }

  private tryReadArtifactRecord(id: string): ArtifactLibraryRecord | null {
    const normalizedId = this.normalizeArtifactId(id);
    const metadata = this.tryReadMetadata(normalizedId);
    if (!metadata) {
      return null;
    }

    const rootPath = this.resolveArtifactDirectory(normalizedId);
    return {
      id: metadata.artifact_id,
      name: metadata.name,
      description: metadata.description,
      scope: metadata.scope,
      ownerProfile: metadata.owner_profile,
      metadata: metadata.metadata,
      createdAt: new Date(metadata.created_at),
      updatedAt: new Date(metadata.updated_at),
      rootPath,
    };
  }

  private tryReadMetadata(id: string): ArtifactMetadataRecord | null {
    const artifactDir = this.resolveArtifactDirectory(id);
    const metadataPath = path.join(artifactDir, ARTIFACT_METADATA_FILE);
    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    const parsed = this.parseMetadataJson(metadataPath, id);
    return this.toMetadataRecord(parsed, id);
  }

  private writeMetadataFile(
    artifactId: string,
    metadata: ArtifactMetadataRecord,
  ): void {
    const artifactDir = this.resolveArtifactDirectory(artifactId);
    fs.mkdirSync(artifactDir, { recursive: true });

    const metadataPath = path.join(artifactDir, ARTIFACT_METADATA_FILE);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  }

  private touchArtifact(artifactId: string): void {
    const metadata = this.tryReadMetadata(artifactId);
    if (!metadata) {
      return;
    }

    this.writeMetadataFile(artifactId, {
      ...metadata,
      updated_at: new Date().toISOString(),
    });
  }

  private resolveArtifactId(input: CreateArtifactInput): string {
    if (typeof input.artifact_id === 'string' && input.artifact_id.trim()) {
      return this.normalizeArtifactId(input.artifact_id);
    }

    return this.slugifyName(input.name);
  }

  private slugifyName(value: string): string {
    const normalized = value
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/^-+|-+$/g, '');

    return this.normalizeArtifactId(normalized);
  }

  private normalizeArtifactId(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('artifact id cannot be empty');
    }

    if (normalized.length > 80) {
      throw new BadRequestException('artifact id cannot exceed 80 characters');
    }

    if (!ARTIFACT_ID_PATTERN.test(normalized)) {
      throw new BadRequestException(
        'artifact id must be lowercase and may include letters, numbers, and hyphens',
      );
    }

    return normalized;
  }

  private normalizeNonEmpty(value: string, fieldName: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new BadRequestException(`${fieldName} cannot be empty`);
    }

    return normalized;
  }

  private resolveArtifactDirectory(artifactId: string): string {
    return path.join(this.libraryRoot, artifactId);
  }

  private listRelativeFiles(rootPath: string): string[] {
    const output: string[] = [];

    const visit = (currentPath: string) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const absolutePath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          visit(absolutePath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        output.push(
          path.relative(rootPath, absolutePath).replaceAll('\\', '/'),
        );
      }
    };

    visit(rootPath);
    return output.sort((a, b) => a.localeCompare(b));
  }

  private resolveSafeRelativePath(inputPath: string): string {
    const normalized = inputPath.trim().replaceAll('\\', '/');
    if (!normalized) {
      throw new BadRequestException('file path cannot be empty');
    }

    if (normalized.startsWith('/')) {
      throw new BadRequestException('file path must be relative');
    }

    const resolved = path.posix.normalize(normalized);
    if (
      resolved === '.' ||
      resolved.startsWith('../') ||
      resolved.includes('/../')
    ) {
      throw new BadRequestException(
        'file path cannot escape artifact directory',
      );
    }

    return resolved;
  }

  private buildUpsertMetadataRecord(
    existing: ArtifactMetadataRecord,
    input: CreateArtifactInput,
  ): ArtifactMetadataRecord {
    const nextName = this.resolveOptionalNonEmpty(input.name) ?? existing.name;
    const nextDescription =
      this.resolveOptionalNonEmpty(input.description) ?? existing.description;
    const nextOwnerProfile =
      this.resolveOptionalNonEmpty(input.owner_profile) ??
      existing.owner_profile;

    return {
      artifact_id: existing.artifact_id,
      name: nextName,
      description: nextDescription,
      scope: input.scope ?? existing.scope,
      owner_profile: nextOwnerProfile,
      metadata:
        input.metadata && typeof input.metadata === 'object'
          ? input.metadata
          : existing.metadata,
      created_at: existing.created_at,
      updated_at: new Date().toISOString(),
    };
  }

  private resolveOptionalNonEmpty(
    value: string | undefined | null,
  ): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private parseMetadataJson(metadataPath: string, id: string): unknown {
    const raw = fs.readFileSync(metadataPath, 'utf8');
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new BadRequestException(`Invalid artifact metadata for ${id}`);
    }
  }

  private toMetadataRecord(
    parsed: unknown,
    id: string,
  ): ArtifactMetadataRecord {
    if (!this.isMetadataObject(parsed)) {
      throw new BadRequestException(`Invalid artifact metadata for ${id}`);
    }

    this.assertRequiredMetadataFields(parsed, id);
    const record = parsed;

    return {
      artifact_id: record.artifact_id,
      name: record.name,
      description: record.description,
      scope: record.scope,
      owner_profile:
        typeof record.owner_profile === 'string' ? record.owner_profile : null,
      metadata:
        record.metadata && typeof record.metadata === 'object'
          ? record.metadata
          : null,
      created_at: record.created_at,
      updated_at: record.updated_at,
    };
  }

  private isMetadataObject(
    value: unknown,
  ): value is Partial<ArtifactMetadataRecord> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private assertRequiredMetadataFields(
    record: Partial<ArtifactMetadataRecord>,
    id: string,
  ): asserts record is ArtifactMetadataRecord {
    const requiredStringValues: unknown[] = [
      record.artifact_id,
      record.name,
      record.description,
      record.created_at,
      record.updated_at,
    ];

    if (requiredStringValues.some((value) => typeof value !== 'string')) {
      throw new BadRequestException(`Invalid artifact metadata for ${id}`);
    }

    if (record.scope !== 'global' && record.scope !== 'profile') {
      throw new BadRequestException(`Invalid artifact metadata for ${id}`);
    }
  }
}
