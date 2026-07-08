export interface StaleHostShareMountDiagnostic {
  container_id: string;
  container_name: string;
  source_path: string;
  destination_path: string;
  reason: 'missing_source' | 'not_directory';
}

export interface RuntimeArtifactsInspection {
  managed_container_count: number;
  orphaned_container_ids: string[];
  stale_container_ids: string[];
  stale_mount_directories: string[];
  stale_host_share_mounts: StaleHostShareMountDiagnostic[];
}
