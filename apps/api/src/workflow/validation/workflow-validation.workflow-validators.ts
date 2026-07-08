import {
  IJob,
  isRecord,
  isToolPolicyEffect,
  IToolPermissionPolicy,
  IWorkflowTransition,
} from '@nexus/core';
import { DAGResolverService } from '../dag-resolver.service';
import { isNonEmptyString, isStringArray } from './workflow-validation.guards';
import {
  ValidationCollector,
  ValidationContext,
} from './workflow-validation.types';

export function validateWorkflowStructure(
  context: ValidationContext,
  collector: ValidationCollector,
): void {
  const { definition } = context;

  if (!isNonEmptyString(definition.workflow_id)) {
    collector.add('Missing workflow_id');
  }

  if (!isNonEmptyString(definition.name)) {
    collector.add('Missing name');
  }

  validatePolicyShape(
    definition.permissions,
    'Workflow permissions',
    collector,
  );

  if (!Array.isArray(definition.jobs) || definition.jobs.length === 0) {
    collector.add('Workflow must contain at least one job');
  }
}

export function validateJobStructuralFields(
  context: ValidationContext,
  collector: ValidationCollector,
): void {
  for (const job of context.jobs) {
    if (!isNonEmptyString(job.id)) {
      continue;
    }

    validatePolicyShape(job.permissions, 'Job permissions', collector, job.id);
    validateHostMountRequests(job, collector);

    validateDependsOn(job, context, collector);
    validateTransitions(job, context, collector);
  }
}

export function validateGraph(
  context: ValidationContext,
  collector: ValidationCollector,
  dagResolver: DAGResolverService,
): void {
  if (context.skipGraphValidation || context.jobs.length === 0) {
    return;
  }

  try {
    dagResolver.buildDependencyGraph(context.jobs);
  } catch (error) {
    collector.add((error as Error).message);
  }
}

function validatePolicyShape(
  policy: IToolPermissionPolicy | undefined,
  scopeLabel: string,
  collector: ValidationCollector,
  jobId?: string,
): void {
  const jobSuffix = jobId ? ` for job '${jobId}'` : '';

  if (policy === undefined || policy === null) {
    return;
  }

  if (!isRecord(policy)) {
    collector.add(`${scopeLabel}${jobSuffix} must be an object`);
    return;
  }

  validatePolicyListField(
    policy.allow_host_mounts,
    scopeLabel,
    jobSuffix,
    'allow_host_mounts',
    collector,
  );
  validatePolicyListField(
    policy.deny_host_mounts,
    scopeLabel,
    jobSuffix,
    'deny_host_mounts',
    collector,
  );
  validatePolicyListField(
    policy.allow_host_mount_rw,
    scopeLabel,
    jobSuffix,
    'allow_host_mount_rw',
    collector,
  );

  validateToolPolicyShape(policy, scopeLabel, jobSuffix, collector);
}

function validateSingleRule(
  rule: unknown,
  i: number,
  scopeLabel: string,
  jobSuffix: string,
  collector: ValidationCollector,
): void {
  if (typeof rule === 'string') {
    if (!/^\S+\s+\S+/.test(rule.trim())) {
      collector.add(
        `${scopeLabel}${jobSuffix}.tool_policy.rules[${i.toString()}] invalid format: expected "<effect> <tool-glob> [args...]"`,
      );
    }
  } else if (rule !== null && typeof rule === 'object') {
    const r = rule as Record<string, unknown>;
    if (!isToolPolicyEffect(r.effect)) {
      collector.add(
        `${scopeLabel}${jobSuffix}.tool_policy.rules[${i.toString()}].effect must be a valid ToolPolicyEffect`,
      );
    }
    if (typeof r.tool !== 'string' || r.tool.trim().length === 0) {
      collector.add(
        `${scopeLabel}${jobSuffix}.tool_policy.rules[${i.toString()}].tool is required and must be non-empty`,
      );
    }
  } else {
    collector.add(
      `${scopeLabel}${jobSuffix}.tool_policy.rules[${i.toString()}] must be a rule object or string`,
    );
  }
}

function validateToolPolicyShape(
  policy: IToolPermissionPolicy | undefined,
  scopeLabel: string,
  jobSuffix: string,
  collector: ValidationCollector,
): void {
  if (policy === undefined || policy === null) return;

  if (policy.tool_policy === undefined) return;

  const doc = policy.tool_policy;

  if (typeof doc.default !== 'string' || !isToolPolicyEffect(doc.default)) {
    collector.add(
      `${scopeLabel}${jobSuffix}.tool_policy.default must be a valid ToolPolicyEffect (allow, deny, require_approval, guardrail_deny)`,
    );
  }

  if (!Array.isArray(doc.rules)) {
    collector.add(
      `${scopeLabel}${jobSuffix}.tool_policy.rules must be an array`,
    );
    return;
  }

  for (let i = 0; i < doc.rules.length; i++) {
    validateSingleRule(doc.rules[i], i, scopeLabel, jobSuffix, collector);
  }
}

function validatePolicyListField(
  value: unknown,
  scopeLabel: string,
  jobSuffix: string,
  fieldName:
    | 'allow_tools'
    | 'deny_tools'
    | 'allow_host_mounts'
    | 'deny_host_mounts'
    | 'allow_host_mount_rw'
    | 'approval_required_tools',
  collector: ValidationCollector,
): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    collector.add(`${scopeLabel}${jobSuffix}.${fieldName} must be an array`);
    return;
  }

  if (value.some((tool) => !isNonEmptyString(tool))) {
    collector.add(
      `${scopeLabel}${jobSuffix}.${fieldName} contains invalid entry`,
    );
  }
}

function validateDependsOn(
  job: IJob,
  context: ValidationContext,
  collector: ValidationCollector,
): void {
  if (job.depends_on !== undefined && job.needs !== undefined) {
    collector.add(`Job '${job.id}' cannot define both needs and depends_on`);
    context.skipGraphValidation = true;
  }

  if (job.depends_on !== undefined) {
    if (Array.isArray(job.depends_on)) {
      if (!isStringArray(job.depends_on)) {
        collector.add(`Job '${job.id}' depends_on contains invalid entry`);
        context.skipGraphValidation = true;
      }
    } else {
      collector.add(`Job '${job.id}' depends_on must be an array`);
      context.skipGraphValidation = true;
    }
  }

  validateNeeds(job, context, collector);
}

function validateNeeds(
  job: IJob,
  context: ValidationContext,
  collector: ValidationCollector,
): void {
  if (job.needs === undefined) {
    return;
  }

  if (!Array.isArray(job.needs)) {
    collector.add(`Job '${job.id}' needs must be an array`);
    context.skipGraphValidation = true;
    return;
  }

  for (const need of job.needs) {
    if (typeof need === 'string') {
      if (!isNonEmptyString(need)) {
        collector.add(`Job '${job.id}' needs contains invalid entry`);
        context.skipGraphValidation = true;
      }
      continue;
    }

    if (!isRecord(need)) {
      collector.add(`Job '${job.id}' needs contains invalid entry`);
      context.skipGraphValidation = true;
      continue;
    }

    if (!isNonEmptyString(need.job)) {
      collector.add(`Job '${job.id}' needs entry must reference a job`);
      context.skipGraphValidation = true;
    }
  }
}

function validateTransitions(
  job: IJob,
  context: ValidationContext,
  collector: ValidationCollector,
): void {
  if (job.transitions === undefined) {
    return;
  }

  if (!Array.isArray(job.transitions)) {
    collector.add(`Job '${job.id}' transitions must be an array`);
    context.skipGraphValidation = true;
    return;
  }

  for (const transition of job.transitions) {
    if (!isValidTransition(transition)) {
      collector.add(`Job '${job.id}' transition entry must be an object`);
      context.skipGraphValidation = true;
      continue;
    }

    if (!isNonEmptyString(transition.next)) {
      collector.add(
        `Job '${job.id}' transition target must be a non-empty string`,
      );
      context.skipGraphValidation = true;
    }
  }
}

function isValidTransition(
  transition: unknown,
): transition is IWorkflowTransition {
  return isRecord(transition);
}

function validateHostMountRequests(
  job: IJob,
  collector: ValidationCollector,
): void {
  if (job.host_mounts === undefined) {
    return;
  }

  if (!Array.isArray(job.host_mounts)) {
    collector.add(`Job '${job.id}' host_mounts must be an array`);
    return;
  }

  for (const [index, mount] of job.host_mounts.entries()) {
    validateHostMountRequestEntry(job.id, index, mount, collector);
  }
}

function validateHostMountRequestEntry(
  jobId: string,
  index: number,
  mount: unknown,
  collector: ValidationCollector,
): void {
  if (!isRecord(mount)) {
    collector.add(
      `Job '${jobId}' host_mounts[${index.toString()}] must be an object`,
    );
    return;
  }

  if (!isNonEmptyString(mount.alias)) {
    collector.add(
      `Job '${jobId}' host_mounts[${index.toString()}].alias must be a non-empty string`,
    );
  }

  validateHostMountMode(jobId, index, mount.mode, collector);
  validateHostMountSubpath(jobId, index, mount.subpath, collector);
}

function validateHostMountMode(
  jobId: string,
  index: number,
  mode: unknown,
  collector: ValidationCollector,
): void {
  if (mode === undefined || mode === 'ro' || mode === 'rw') {
    return;
  }

  collector.add(
    `Job '${jobId}' host_mounts[${index.toString()}].mode must be one of ro, rw`,
  );
}

function validateHostMountSubpath(
  jobId: string,
  index: number,
  subpath: unknown,
  collector: ValidationCollector,
): void {
  if (subpath === undefined) {
    return;
  }

  if (!isNonEmptyString(subpath)) {
    collector.add(
      `Job '${jobId}' host_mounts[${index.toString()}].subpath must be a non-empty string`,
    );
    return;
  }

  if (!isSafeRelativeSubpath(subpath)) {
    collector.add(
      `Job '${jobId}' host_mounts[${index.toString()}].subpath must be a safe relative path`,
    );
  }
}

function isSafeRelativeSubpath(subpath: string): boolean {
  const normalized = subpath.trim().replaceAll('\\', '/');

  if (normalized.length === 0) {
    return false;
  }

  if (normalized.startsWith('/')) {
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

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return false;
  }

  return true;
}
