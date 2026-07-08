export type ArtifactScope = 'global' | 'profile';

export interface ArtifactLibraryRecord {
  id: string;
  name: string;
  description: string;
  scope: ArtifactScope;
  ownerProfile: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  rootPath: string;
}

export interface ArtifactFileSummary {
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface CreateArtifactInput {
  artifact_id?: string;
  name: string;
  description: string;
  scope?: ArtifactScope;
  owner_profile?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListArtifactsInput {
  query?: string;
  scope?: ArtifactScope;
  owner_profile?: string;
}

export interface UpsertArtifactFileInput {
  artifactId: string;
  relativePath: string;
  content: Buffer;
}
