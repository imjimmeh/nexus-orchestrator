export interface ResolvedCacheMounts {
  volumes: Array<{
    hostPath: string;
    containerPath: string;
    readOnly: boolean;
  }>;
  env: Record<string, string>;
}
