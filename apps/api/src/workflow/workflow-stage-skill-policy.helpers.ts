import {
  WORKFLOW_LIFECYCLE_STAGES,
  type WorkflowLifecycleStage,
} from './workflow-stage-skill-policy.service.types';

interface JobStageRule {
  stage: WorkflowLifecycleStage;
  mode: 'any' | 'all';
  tokens: string[];
}

const JOB_STAGE_RULES: JobStageRule[] = [
  { stage: 'discovery', mode: 'any', tokens: ['discover'] },
  {
    stage: 'decomposition',
    mode: 'any',
    tokens: ['refine', 'decompos', 'spec'],
  },
  { stage: 'review', mode: 'any', tokens: ['review'] },
  { stage: 'post_merge', mode: 'all', tokens: ['post', 'merge'] },
  { stage: 'merge', mode: 'any', tokens: ['merge'] },
  { stage: 'implementation', mode: 'any', tokens: ['implement', 'code'] },
];

export function resolveStageFromJobIdentifier(
  jobId: string | undefined,
): WorkflowLifecycleStage | null {
  if (!jobId) {
    return null;
  }

  const normalizedJobId = normalizeIdentifier(jobId);

  for (const rule of JOB_STAGE_RULES) {
    const matches =
      rule.mode === 'all'
        ? rule.tokens.every((token) => normalizedJobId.includes(token))
        : rule.tokens.some((token) => normalizedJobId.includes(token));

    if (matches) {
      return rule.stage;
    }
  }

  return null;
}

export function normalizeLifecycleStage(
  value: string,
): WorkflowLifecycleStage | null {
  const normalizedValue = normalizeIdentifier(value);

  for (const stage of WORKFLOW_LIFECYCLE_STAGES) {
    if (normalizeIdentifier(stage) === normalizedValue) {
      return stage;
    }
  }

  return null;
}

export function normalizeIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_');
}

export function normalizeProfileIdentifier(value: string): string {
  return normalizeIdentifier(value);
}

export function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase().replaceAll('_', '-');
}

export function normalizeSkillNameList(values: string[] | undefined): string[] {
  if (!values) {
    return [];
  }

  return Array.from(
    new Set(values.map((value) => normalizeSkillName(value)).filter(Boolean)),
  );
}

export function readFirstString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  return undefined;
}

export function readStringArray(value: unknown): {
  values: string[] | undefined;
  invalid: boolean;
} {
  if (value === undefined) {
    return {
      values: undefined,
      invalid: false,
    };
  }

  if (!Array.isArray(value)) {
    return {
      values: undefined,
      invalid: true,
    };
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (normalized.length !== value.length) {
    return {
      values: undefined,
      invalid: true,
    };
  }

  return {
    values: normalized,
    invalid: false,
  };
}
