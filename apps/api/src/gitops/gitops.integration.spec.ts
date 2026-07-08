import { describe, it, expect, vi } from 'vitest';
import { ConfigExportService } from './config-export.service';
import {
  parseDesiredStateFiles,
  validateDesiredState,
} from '@nexus/gitops-contracts';
import { parse as parseYaml } from 'yaml';
import { GLOBAL_SCOPE_NODE_ID } from '../scope/scope.constants';

const ROOT = GLOBAL_SCOPE_NODE_ID;
const ACME = 'acme-uuid';

function makeExporter() {
  const scopeService = {
    getDescendantIds: vi.fn().mockResolvedValue([ROOT, ACME]),
    getNodesByIds: vi.fn().mockResolvedValue([
      {
        id: ROOT,
        parentId: null,
        type: 'platform',
        name: 'Platform',
        slug: 'platform',
        metadata: null,
      },
      {
        id: ACME,
        parentId: ROOT,
        type: 'org',
        name: 'Acme',
        slug: 'acme',
        metadata: null,
      },
    ]),
  } as any;
  const roleRepo = {
    find: vi.fn().mockResolvedValue([]),
    query: vi.fn().mockResolvedValue([]),
  } as any;
  const assignmentRepo = { query: vi.fn().mockResolvedValue([]) } as any;
  const workflowRepo = { find: vi.fn().mockResolvedValue([]) } as any;
  const agentRepo = { find: vi.fn().mockResolvedValue([]) } as any;
  const skillRepo = { find: vi.fn().mockResolvedValue([]) } as any;
  return new ConfigExportService(
    scopeService,
    roleRepo,
    assignmentRepo,
    workflowRepo,
    agentRepo,
    skillRepo,
  );
}

describe('GitOps export/validate round-trip (EPIC-204H)', () => {
  it('export(current DB) parses and validates clean', async () => {
    const exporter = makeExporter();
    const files = await exporter.exportToFiles();
    const desiredFiles = files.map((f) => ({
      path: f.path,
      content: parseYaml(f.yaml) as Record<string, unknown>,
    }));
    const parsed = parseDesiredStateFiles(desiredFiles);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const ctx = {
        knownPermissions: new Set<string>(),
        knownSystemRoles: new Set<string>(),
        knownUsers: new Set<string>(),
        knownDefaultAgents: new Set<string>(),
        knownDefaultWorkflows: new Set<string>(),
        knownDefaultSkills: new Set<string>(),
      };
      const res = validateDesiredState(parsed.state, ctx);
      expect(res.ok).toBe(true);
    }
  });

  it('a tampered assignment (unknown scope) fails lint', async () => {
    const exporter = makeExporter();
    const files = await exporter.exportToFiles();
    const desiredFiles = files.map((f) => ({
      path: f.path,
      content: parseYaml(f.yaml) as Record<string, unknown>,
    }));
    // Inject a bad assignment
    desiredFiles.push({
      path: 'assignments.yaml',
      content: {
        apiVersion: 'nexus.gitops/v1',
        kind: 'AssignmentList',
        assignments: [{ user: 'alice', role: 'org_admin', scope: '/ghost' }],
      },
    });
    const parsed = parseDesiredStateFiles(desiredFiles);
    if (!parsed.ok) {
      expect(parsed.ok).toBe(false);
      return;
    }
    const ctx = {
      knownPermissions: new Set<string>(),
      knownSystemRoles: new Set(['org_admin']),
      knownUsers: new Set<string>(),
      knownDefaultAgents: new Set<string>(),
      knownDefaultWorkflows: new Set<string>(),
      knownDefaultSkills: new Set<string>(),
    };
    const res = validateDesiredState(parsed.state, ctx);
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('assignment.unknown_scope');
  });
});
