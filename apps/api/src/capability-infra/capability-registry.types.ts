import { ZodTypeAny } from 'zod';
import {
  CapabilityPolicyTag,
  CapabilityTransport,
  MutatingActionUnion,
} from './capability-manifest.types';

export interface DiscoveredCapabilityDefinition<
  TSchema extends ZodTypeAny = ZodTypeAny,
> {
  name: string;
  tierRestriction: 1 | 2;
  policyTags: CapabilityPolicyTag[];
  transport: CapabilityTransport;
  runtimeOwner: 'api' | 'runner';
  description: string;
  inputSchema: TSchema;
  apiCallback?: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    pathTemplate: string;
    bodyMapping?: Record<string, string>;
  };
  bridgeAction?: string;
  mutatingAction?: MutatingActionUnion;
  modeBehavior?: {
    autonomous?: string;
    supervised?: string;
    notifications_only?: string;
  };
  seedInRegistry?: boolean;
}
