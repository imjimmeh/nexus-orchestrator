import * as fs from "node:fs";
import * as path from "node:path";
import type { CanonicalToolDefinition } from "../engine/session-context.js";
import type { HostMountScopeBinding } from "./host-mount-scope.types.js";

const HOST_MOUNT_SCOPE_MANIFEST_FILE = "_host_mount_scope.json";
const HOST_SHARE_CONTAINER_ROOT = "/workspace/host-shares";

const READ_HOST_MOUNT_TOOL_NAMES = new Set(["read", "ls", "find", "grep"]);
const RECURSIVE_READ_HOST_MOUNT_TOOL_NAMES = new Set(["find", "grep"]);
const WRITE_HOST_MOUNT_TOOL_NAMES = new Set(["write"]);

type ToolExecute = CanonicalToolDefinition["execute"];

type HostMountAccessMode = "read" | "write";

export function readHostMountScopeManifest(
  extensionsDir: string,
): HostMountScopeBinding[] {
  const filePath = `${extensionsDir}/${HOST_MOUNT_SCOPE_MANIFEST_FILE}`;
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!Array.isArray(parsed)) {
      return [];
    }

    const bindings: HostMountScopeBinding[] = [];
    for (const entry of parsed) {
      const binding = parseHostMountScopeBinding(entry);
      if (binding) {
        bindings.push(binding);
      }
    }

    return bindings;
  } catch {
    // Malformed manifest; ignore
    return [];
  }
}

export function applyHostMountScopeGuards(params: {
  codingTools: CanonicalToolDefinition[];
  cwd: string;
  scopeBindings: HostMountScopeBinding[];
}): CanonicalToolDefinition[] {
  if (params.scopeBindings.length === 0) {
    return params.codingTools;
  }

  return params.codingTools.map((tool) => {
    const accessMode = resolveHostMountAccessMode(tool.name);
    if (!accessMode) {
      return tool;
    }

    const originalExecute = tool.execute;
    const guardedExecute: ToolExecute = async (callId, toolParams, signal) => {
      assertHostMountAccessAllowed({
        cwd: params.cwd,
        scopeBindings: params.scopeBindings,
        toolName: tool.name,
        accessMode,
        toolParams,
      });

      return originalExecute(callId, toolParams, signal);
    };

    return {
      ...tool,
      execute: guardedExecute,
    };
  });
}

function resolveHostMountAccessMode(
  toolName: string,
): HostMountAccessMode | null {
  if (READ_HOST_MOUNT_TOOL_NAMES.has(toolName)) {
    return "read";
  }

  if (WRITE_HOST_MOUNT_TOOL_NAMES.has(toolName)) {
    return "write";
  }

  return null;
}

function assertHostMountAccessAllowed(params: {
  cwd: string;
  scopeBindings: HostMountScopeBinding[];
  toolName: string;
  accessMode: HostMountAccessMode;
  toolParams: Record<string, unknown>;
}): void {
  const candidatePaths = resolveToolPathCandidates({
    toolName: params.toolName,
    toolParams: params.toolParams,
    cwd: params.cwd,
  });

  for (const candidatePath of candidatePaths) {
    if (canTraverseHostShareRoot(params.toolName, candidatePath)) {
      throw new Error(
        `Denied ${params.toolName}: path '${candidatePath}' can traverse host mount scopes`,
      );
    }

    if (!isWithinPath(HOST_SHARE_CONTAINER_ROOT, candidatePath)) {
      continue;
    }

    const matchingBinding = resolveMostSpecificBinding(
      params.scopeBindings,
      candidatePath,
    );
    if (!matchingBinding) {
      throw new Error(
        `Denied ${params.toolName}: path '${candidatePath}' is outside approved host mount scope`,
      );
    }

    if (params.accessMode === "write" && matchingBinding.readOnly) {
      throw new Error(
        `Denied ${params.toolName}: path '${candidatePath}' is read-only`,
      );
    }
  }
}

function resolveToolPathCandidates(params: {
  toolName: string;
  toolParams: Record<string, unknown>;
  cwd: string;
}): string[] {
  const candidatePaths = extractToolPathCandidates({
    toolParams: params.toolParams,
    cwd: params.cwd,
  });

  if (
    candidatePaths.length === 0 &&
    RECURSIVE_READ_HOST_MOUNT_TOOL_NAMES.has(params.toolName)
  ) {
    return [normalizeCandidatePath(".", params.cwd)];
  }

  return candidatePaths;
}

function extractToolPathCandidates(params: {
  toolParams: Record<string, unknown>;
  cwd: string;
}): string[] {
  const rawCandidates: unknown[] = [
    params.toolParams.path,
    params.toolParams.file_path,
    params.toolParams.filePath,
    params.toolParams.source_path,
    params.toolParams.sourcePath,
    params.toolParams.target_path,
    params.toolParams.targetPath,
    params.toolParams.destination_path,
    params.toolParams.destinationPath,
  ];

  const pathListCandidates = [params.toolParams.paths, params.toolParams.files];
  for (const listCandidate of pathListCandidates) {
    if (!Array.isArray(listCandidate)) {
      continue;
    }

    for (const listEntry of listCandidate) {
      rawCandidates.push(listEntry);
    }
  }

  const normalized = rawCandidates
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => normalizeCandidatePath(candidate, params.cwd))
    .filter((candidate) => candidate.length > 0);

  return [...new Set(normalized)];
}

function normalizeCandidatePath(candidatePath: string, cwd: string): string {
  const trimmed = candidatePath.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const normalizedInput = trimmed.replaceAll("\\", "/");
  if (path.posix.isAbsolute(normalizedInput)) {
    return path.posix.normalize(normalizedInput);
  }

  return path.posix.normalize(path.posix.resolve(cwd, normalizedInput));
}

function resolveMostSpecificBinding(
  scopeBindings: HostMountScopeBinding[],
  candidatePath: string,
): HostMountScopeBinding | null {
  let matchedBinding: HostMountScopeBinding | null = null;

  for (const binding of scopeBindings) {
    if (!isWithinPath(binding.containerPath, candidatePath)) {
      continue;
    }

    if (
      !matchedBinding ||
      binding.containerPath.length > matchedBinding.containerPath.length
    ) {
      matchedBinding = binding;
    }
  }

  return matchedBinding;
}

function isWithinPath(rootPath: string, candidatePath: string): boolean {
  const relative = path.posix.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.posix.isAbsolute(relative))
  );
}

function canTraverseHostShareRoot(
  toolName: string,
  candidatePath: string,
): boolean {
  if (!RECURSIVE_READ_HOST_MOUNT_TOOL_NAMES.has(toolName)) {
    return false;
  }

  return (
    candidatePath !== HOST_SHARE_CONTAINER_ROOT &&
    isWithinPath(candidatePath, HOST_SHARE_CONTAINER_ROOT)
  );
}

function parseHostMountScopeBinding(
  value: unknown,
): HostMountScopeBinding | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const alias = readTrimmedString(record.alias);
  const hostPath = readTrimmedString(record.hostPath);
  const containerPathRaw = readTrimmedString(record.containerPath);

  if (!alias || !hostPath || !containerPathRaw) {
    return null;
  }

  const containerPath = normalizeCandidatePath(containerPathRaw, "/");
  if (!path.posix.isAbsolute(containerPath)) {
    return null;
  }

  const mode = record.mode === "rw" ? "rw" : "ro";
  const readOnly =
    typeof record.readOnly === "boolean" ? record.readOnly : mode !== "rw";

  return {
    alias,
    hostPath,
    containerPath,
    mode: readOnly ? "ro" : "rw",
    readOnly,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
