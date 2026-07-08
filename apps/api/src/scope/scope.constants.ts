export const GLOBAL_SCOPE_NODE_ID = '00000000-0000-0000-0000-000000000000';
export const SCOPE_NODE_TYPES = [
  'platform',
  'org',
  'region',
  'team',
  'project',
] as const;

export type { ScopeNodeType } from './scope.constants.types';
