import type { PluginLifecycleState as SdkPluginLifecycleState } from '@nexus/plugin-sdk';

export type PluginLifecycleState = SdkPluginLifecycleState;

export interface PluginLifecycleTransition {
  readonly from: PluginLifecycleState;
  readonly to: PluginLifecycleState;
}

export type PluginLifecycleTransitionFailureReason =
  | 'transition_not_allowed'
  | 'invalid_lifecycle_state';

export type PluginLifecycleTransitionResult =
  | (PluginLifecycleTransition & {
      readonly allowed: true;
    })
  | (PluginLifecycleTransition & {
      readonly allowed: false;
      readonly reason: PluginLifecycleTransitionFailureReason;
      readonly message: string;
    });
