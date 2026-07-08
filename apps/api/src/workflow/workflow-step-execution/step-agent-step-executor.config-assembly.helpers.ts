import type {
  IJobStep,
  HarnessRuntimeConfig,
  HarnessId,
  HarnessSessionRef,
  HarnessCapabilities,
  ResolvedHarnessCredential,
  RunnerProviderAuth,
  FallbackChainEntry,
} from '@nexus/core';
import type { StateManagerService } from '../state-manager.service';
import {
  extractModelOverrideFromTriggerState,
  extractProviderOverrideFromTriggerState,
} from './step-support.helpers';
import type { HarnessCredentialResolverLike } from './step-agent-step-executor.helpers.types';

export function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function resolveStepInputOverrides(params: {
  resolvedJobInputs: Record<string, unknown>;
  stateVariables: Record<string, unknown>;
  step: IJobStep;
  stateManager: StateManagerService;
}): {
  explicitModel?: string;
  explicitProvider?: string;
  explicitSystemPrompt?: string;
  stepFallbackChain?: FallbackChainEntry[];
} {
  const promptTemplateVariables = buildPromptTemplateVariables(
    params.stateVariables,
    params.resolvedJobInputs,
  );
  return {
    explicitModel:
      readOptionalString(params.resolvedJobInputs.model) ??
      extractModelOverrideFromTriggerState(params.stateVariables),
    explicitProvider:
      readOptionalString(params.resolvedJobInputs.provider) ??
      extractProviderOverrideFromTriggerState(params.stateVariables),
    explicitSystemPrompt: resolveExplicitSystemPrompt({
      rawPrompt: params.step.prompt,
      stateManager: params.stateManager,
      promptTemplateVariables,
    }),
    stepFallbackChain: readFallbackChain(
      params.resolvedJobInputs.fallback_chain,
    ),
  };
}

function buildPromptTemplateVariables(
  stateVariables: Record<string, unknown>,
  resolvedJobInputs: Record<string, unknown>,
): Record<string, unknown> {
  const promptTemplateVariables: Record<string, unknown> = {
    ...stateVariables,
    state: stateVariables,
    inputs: resolvedJobInputs,
  };

  for (const [key, value] of Object.entries(resolvedJobInputs)) {
    if (promptTemplateVariables[key] === undefined) {
      promptTemplateVariables[key] = value;
    }
  }

  return promptTemplateVariables;
}

function resolveExplicitSystemPrompt(params: {
  rawPrompt: unknown;
  stateManager: StateManagerService;
  promptTemplateVariables: Record<string, unknown>;
}): string | undefined {
  const rawStepPrompt = readOptionalString(params.rawPrompt);
  if (!rawStepPrompt) {
    return undefined;
  }

  return params.stateManager.substituteTemplate(
    rawStepPrompt,
    params.promptTemplateVariables,
  );
}

export function resolveRetryPrompt(userMessage: unknown): string | undefined {
  if (typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return undefined;
  }

  return userMessage;
}

/**
 * Validates and extracts a `FallbackChainEntry[]` from an unknown value.
 * Returns `undefined` if the value is not a non-empty array of
 * `{provider_name: string, model_name: string}` objects.
 */
function readFallbackChain(value: unknown): FallbackChainEntry[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const entries = (value as unknown[]).filter(
    (item): item is FallbackChainEntry =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).provider_name === 'string' &&
      typeof (item as Record<string, unknown>).model_name === 'string',
  );
  return entries.length > 0 ? entries : undefined;
}

export function buildRunnerSessionConfig(input: {
  resumeSessionRef?: HarnessSessionRef;
  resumeMechanism: HarnessCapabilities['resumeMechanism'];
}): { resume: HarnessSessionRef } | undefined {
  if (input.resumeSessionRef && input.resumeMechanism === 'config_ref') {
    return { resume: input.resumeSessionRef };
  }
  return undefined;
}

export function assembleBaseRunnerConfig(params: {
  harnessId: HarnessId;
  capabilities?: HarnessCapabilities;
  resumeSessionRef?: HarnessSessionRef;
  providerConfig: {
    provider: string;
    baseUrl?: string;
    providerConfig?: HarnessRuntimeConfig['model']['providerConfig'];
  };
  model: string;
  resolvedAuth: RunnerProviderAuth;
  credentials: Record<string, ResolvedHarnessCredential> | undefined;
  systemPrompt: string;
  initialPrompt: string;
}): HarnessRuntimeConfig {
  const resumeMechanism = params.capabilities?.resumeMechanism;
  const session = resumeMechanism
    ? buildRunnerSessionConfig({
        resumeSessionRef: params.resumeSessionRef,
        resumeMechanism,
      })
    : undefined;

  return {
    harnessId: params.harnessId,
    model: {
      provider: params.providerConfig.provider,
      model: params.model,
      auth: params.resolvedAuth,
      baseUrl: params.providerConfig.baseUrl,
      providerConfig: params.providerConfig.providerConfig,
    },
    prompt: {
      systemPrompt: params.systemPrompt,
      initialPrompt: params.initialPrompt,
    },
    ...(session ? { session } : {}),
    ...(params.credentials
      ? { harnessOptions: { credentials: params.credentials } }
      : {}),
  };
}

export async function resolveCredentials(params: {
  credentialResolver?: HarnessCredentialResolverLike;
  harnessId: HarnessId;
  scopeNodeId?: string;
  providerAuth: RunnerProviderAuth;
}): Promise<{
  resolvedAuth: RunnerProviderAuth;
  credentials: Record<string, ResolvedHarnessCredential> | undefined;
}> {
  if (!params.credentialResolver) {
    return { resolvedAuth: params.providerAuth, credentials: undefined };
  }

  const resolvedAuth = await params.credentialResolver.resolvePrimaryAuth({
    harnessId: params.harnessId,
    scopeNodeId: params.scopeNodeId,
    providerAuth: params.providerAuth,
  });
  const extras = await params.credentialResolver.resolveAll({
    harnessId: params.harnessId,
    scopeNodeId: params.scopeNodeId,
  });
  const credentials = Object.keys(extras).length > 0 ? extras : undefined;
  return { resolvedAuth, credentials };
}

export function buildInitialPrompt(
  systemPrompt: string,
  retryPrompt: string | undefined,
  isResume: boolean,
): string {
  // On resume the prior conversation — including the original task, which is
  // delivered as the first user turn — is replayed (pi via session-tree
  // injection, claude_code via SDK `options.resume`) and the system prompt is
  // supplied separately. The user turn must therefore be ONLY the
  // continuation/join message; re-sending the full prompt makes the agent treat
  // the whole task as a fresh instruction and re-execute the entire step,
  // looping on every resume. Plain post-failure retries have no replayed session
  // (no resumeSessionRef) and keep the full prompt so the task is delivered.
  // See docs/analysis/2026-06-15-claude-code-resume-restarts-whole-step-loop.md.
  if (isResume && retryPrompt) {
    return retryPrompt;
  }
  return retryPrompt ? `${systemPrompt}\n\n${retryPrompt}` : systemPrompt;
}
