export interface ParsedSpec {
  sourceId: string;
  slug: string;
  sourcePath: string;
  sourceHash: string;
  scope: 'standard' | 'large';
  title: string;
  dependsOnSourceIds?: string[];
  body: string;
  filePath: string;
}
