import type { HostMountMode, IHostMountBinding } from '@nexus/core';

export const HOST_MOUNT_CATALOG_SETTING_KEY = 'workflow_host_mount_catalog';
export const HOST_MOUNT_RW_APPROVAL_REQUIRED_SETTING_KEY =
  'workflow_host_mount_rw_approval_required';
export const HOST_MOUNT_CONTAINER_ROOT = '/workspace/host-shares';

export interface HostMountCatalogEntry {
  alias: string;
  apiRoot: string;
  defaultMode: HostMountMode;
  writableAllowed: boolean;
  approvalRequiredOnRw: boolean;
}

export interface HostMountPolicy {
  allow_host_mounts?: string[];
  deny_host_mounts?: string[];
  allow_host_mount_rw?: string[];
}

export interface NormalizedHostMountRequest {
  alias: string;
  subpath?: string;
  mode?: HostMountMode;
}

export interface HostMountApprovalRequirement {
  alias: string;
  mode: 'rw';
  reason: string;
}

export interface HostMountResolutionResolvedOutcome {
  status: 'resolved';
  bindings: IHostMountBinding[];
  approvals_required: [];
}

export interface HostMountResolutionApprovalRequiredOutcome {
  status: 'approval_required';
  bindings: IHostMountBinding[];
  approvals_required: HostMountApprovalRequirement[];
}

export type HostMountResolutionOutcome =
  | HostMountResolutionResolvedOutcome
  | HostMountResolutionApprovalRequiredOutcome;
