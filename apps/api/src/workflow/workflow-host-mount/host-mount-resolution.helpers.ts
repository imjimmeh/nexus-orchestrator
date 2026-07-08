import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  asRecord,
  readString,
  type HostMountMode,
  type IHostMountRequest,
} from '@nexus/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  HostMountCatalogEntry,
  HostMountPolicy,
  NormalizedHostMountRequest,
} from './host-mount-resolution.service.types';
import { HOST_MOUNT_CATALOG_SETTING_KEY } from './host-mount-resolution.service.types';

export function parseCatalogFromEnv(value: string | undefined): unknown {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new BadRequestException(
      'NEXUS_HOST_MOUNT_CATALOG_JSON must contain valid JSON',
    );
  }
}

export function parseHostMountCatalog(
  rawCatalog: unknown,
): Map<string, HostMountCatalogEntry> {
  const catalogRecord = asRecord(rawCatalog);
  if (!catalogRecord) {
    throw new BadRequestException(
      `${HOST_MOUNT_CATALOG_SETTING_KEY} must be an object`,
    );
  }

  const catalog = new Map<string, HostMountCatalogEntry>();

  for (const [alias, rawEntry] of Object.entries(catalogRecord)) {
    const normalizedAlias = normalizeAlias(alias);
    const parsedEntry = parseCatalogEntry(normalizedAlias, rawEntry);
    catalog.set(normalizedAlias, parsedEntry);
  }

  return catalog;
}

export function normalizeHostMountRequest(params: {
  jobId: string;
  index: number;
  request: IHostMountRequest;
}): NormalizedHostMountRequest {
  const alias =
    typeof params.request.alias === 'string'
      ? params.request.alias.trim()
      : undefined;

  if (!alias) {
    throw new BadRequestException(
      `Job '${params.jobId}' host_mounts[${params.index.toString()}].alias is required`,
    );
  }

  ensureAliasIsValid(alias, params.jobId, params.index);

  const subpath =
    typeof params.request.subpath === 'string'
      ? params.request.subpath.trim()
      : undefined;

  if (subpath !== undefined && !isSafeRelativeSubpath(subpath)) {
    throw new BadRequestException(
      `Job '${params.jobId}' host_mounts[${params.index.toString()}].subpath must be a safe relative path`,
    );
  }

  if (
    params.request.mode !== undefined &&
    params.request.mode !== 'ro' &&
    params.request.mode !== 'rw'
  ) {
    throw new BadRequestException(
      `Job '${params.jobId}' host_mounts[${params.index.toString()}].mode must be ro or rw`,
    );
  }

  return {
    alias,
    subpath,
    mode: params.request.mode,
  };
}

export function compactStringLists(values: unknown[]): string[][] {
  const lists: string[][] = [];

  for (const value of values) {
    const normalized = normalizeStringArray(value);
    if (normalized.length > 0) {
      lists.push(normalized);
    }
  }

  return lists;
}

export function isAliasAllowed(alias: string, allowLists: string[][]): boolean {
  if (allowLists.length === 0) {
    return false;
  }

  return allowLists.every((list) => matchesAlias(alias, list));
}

export function isAliasDenied(alias: string, denyLists: string[][]): boolean {
  return denyLists.some((list) => matchesAlias(alias, list));
}

export function resolveProjectPolicyFromState(
  stateVariables?: Record<string, unknown>,
): HostMountPolicy | undefined {
  for (const candidate of listProjectPolicyCandidates(stateVariables)) {
    const record = asRecord(candidate);
    if (record) {
      return record;
    }
  }

  return undefined;
}

export function resolveContainerSubpath(subpath: string): string {
  return subpath
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment.length > 0)
    .join('/');
}

export async function resolveHostMountTargetPath(params: {
  alias: string;
  apiRoot: string;
  subpath?: string;
}): Promise<string> {
  const rootPath = await realpathOrThrow(
    params.apiRoot,
    `Host mount alias '${params.alias}' api_root does not exist`,
  );

  if (!params.subpath) {
    return rootPath;
  }

  const targetPath = path.resolve(
    rootPath,
    params.subpath.replaceAll('/', path.sep),
  );
  const resolvedTargetPath = await realpathOrThrow(
    targetPath,
    `Host mount alias '${params.alias}' subpath '${params.subpath}' does not exist`,
  );

  if (!isWithinRoot(rootPath, resolvedTargetPath)) {
    throw new ForbiddenException(
      `Host mount alias '${params.alias}' subpath escapes configured root`,
    );
  }

  return resolvedTargetPath;
}

export function resolveHostMountContainerPath(
  alias: string,
  subpath: string | undefined,
  containerRoot: string,
): string {
  if (!subpath) {
    return path.posix.join(containerRoot, alias);
  }

  return path.posix.join(
    containerRoot,
    alias,
    resolveContainerSubpath(subpath),
  );
}

export function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parseCatalogEntry(
  alias: string,
  rawEntry: unknown,
): HostMountCatalogEntry {
  if (typeof rawEntry === 'string') {
    return {
      alias,
      apiRoot: requireAbsolutePath(rawEntry, alias),
      defaultMode: 'ro',
      writableAllowed: false,
      approvalRequiredOnRw: false,
    };
  }

  const entryRecord = asRecord(rawEntry);
  if (!entryRecord) {
    throw new BadRequestException(
      `Host mount catalog entry '${alias}' must be a string path or object`,
    );
  }

  const apiRoot = requireAbsolutePath(
    readNonEmptyString(entryRecord.api_root),
    alias,
  );
  const defaultMode = parseMode(entryRecord.default_mode, alias);

  return {
    alias,
    apiRoot,
    defaultMode: defaultMode ?? 'ro',
    writableAllowed: entryRecord.writable_allowed === true,
    approvalRequiredOnRw: entryRecord.approval_required_on_rw === true,
  };
}

function parseMode(value: unknown, alias: string): HostMountMode | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'ro' || value === 'rw') {
    return value;
  }

  throw new BadRequestException(
    `Host mount catalog entry '${alias}' default_mode must be ro or rw`,
  );
}

function listProjectPolicyCandidates(
  stateVariables?: Record<string, unknown>,
): unknown[] {
  const root = asRecord(stateVariables);
  if (!root) {
    return [];
  }

  const trigger = asRecord(root.trigger);
  const triggerProject = asRecord(trigger?.project);

  return [
    trigger?.project_mount_policy,
    trigger?.projectMountPolicy,
    triggerProject?.mount_policy,
    triggerProject?.mountPolicy,
    root.project_mount_policy,
    root.projectMountPolicy,
  ];
}

function normalizeAlias(alias: string): string {
  const normalizedAlias = alias.trim();
  if (!normalizedAlias) {
    throw new BadRequestException('Host mount alias cannot be empty');
  }

  ensureAliasPattern(normalizedAlias);
  return normalizedAlias;
}

function ensureAliasIsValid(alias: string, jobId: string, index: number): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(alias)) {
    throw new BadRequestException(
      `Job '${jobId}' host_mounts[${index.toString()}].alias is invalid`,
    );
  }
}

function ensureAliasPattern(alias: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(alias)) {
    throw new BadRequestException(
      `Host mount alias '${alias}' contains unsupported characters`,
    );
  }
}

function requireAbsolutePath(value: string | undefined, alias: string): string {
  if (!value) {
    throw new BadRequestException(
      `Host mount catalog entry '${alias}' requires api_root`,
    );
  }

  if (!path.isAbsolute(value)) {
    throw new BadRequestException(
      `Host mount catalog entry '${alias}' api_root must be absolute`,
    );
  }

  return value;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);

  return [...new Set(normalized)];
}

function matchesAlias(alias: string, list: string[]): boolean {
  return list.includes('*') || list.includes(alias);
}

function isSafeRelativeSubpath(subpath: string): boolean {
  const normalized = subpath.trim().replaceAll('\\', '/');

  if (!normalized || normalized.startsWith('/')) {
    return false;
  }

  if (/^[a-zA-Z]:/.test(normalized)) {
    return false;
  }

  const segments = normalized
    .split('/')
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return false;
  }

  return !segments.some((segment) => segment === '.' || segment === '..');
}

function readNonEmptyString(value: unknown): string | undefined {
  const trimmed = readString(value)?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

async function realpathOrThrow(
  pathValue: string,
  message: string,
): Promise<string> {
  try {
    return await fs.realpath(pathValue);
  } catch {
    throw new BadRequestException(message);
  }
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}
