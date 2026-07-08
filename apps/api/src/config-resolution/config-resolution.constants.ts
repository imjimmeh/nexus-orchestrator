export const CONFIG_OBJECT_TYPES = [
  'workflow',
  'agent_profile',
  'skill',
] as const;

export type {
  ConfigObjectType,
  OverrideStrategy,
} from './config-resolution.constants.types';
