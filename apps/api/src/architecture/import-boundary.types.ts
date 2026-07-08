export type ImportBoundaryDomain = 'control-plane' | 'chat-domain';

export interface ImportBoundaryException {
  sourceFile: string;
  targetFile: string;
  fromDomain: ImportBoundaryDomain;
  toDomain: ImportBoundaryDomain;
  reason: string;
  owner: string;
  expiresOn: string;
}

export interface ImportBoundaryEdge {
  sourceFile: string;
  targetFile: string;
  fromDomain: ImportBoundaryDomain;
  toDomain: ImportBoundaryDomain;
}

export type ImportBoundarySeedRow = readonly [
  sourceFile: string,
  targetFile: string,
  fromDomain: ImportBoundaryDomain,
  toDomain: ImportBoundaryDomain,
];
