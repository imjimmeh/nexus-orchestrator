import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import {
  bindCredential,
  getCredentialOAuthStatus,
  getCredentialRequirements,
  startCredentialOAuth,
  submitCredentialOAuthCode,
  unbindCredential,
} from "@/lib/api/harness-credentials-api";
import type {
  BindCredentialRequest,
  CredentialRequirementsResponse,
  OAuthSessionStatus,
  OAuthStartResult,
  StartOAuthRequest,
  SubmitOAuthCodeRequest,
} from "@/lib/api/harness-credentials-api.types";

const DEFAULT_OAUTH_POLL_INTERVAL_MS = 3000;

export function useCredentialRequirements(
  harnessId: string,
  scopeNodeId?: string,
) {
  return useQuery<CredentialRequirementsResponse>({
    queryKey: queryKeys.harnessCredentials.requirements(harnessId, scopeNodeId),
    queryFn: () => getCredentialRequirements(api, harnessId, scopeNodeId),
    enabled: !!harnessId,
  });
}

export function useBindCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      harnessId,
      key,
      body,
    }: {
      harnessId: string;
      key: string;
      body: BindCredentialRequest;
    }) => bindCredential(api, harnessId, key, body),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.harnessCredentials.requirements(
          variables.harnessId,
          variables.body.scopeNodeId,
        ),
      });
    },
  });
}

export function useUnbindCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      harnessId,
      key,
      scopeNodeId,
    }: {
      harnessId: string;
      key: string;
      scopeNodeId?: string;
    }) => unbindCredential(api, harnessId, key, scopeNodeId),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.harnessCredentials.requirements(
          variables.harnessId,
          variables.scopeNodeId,
        ),
      });
    },
  });
}

export function useStartCredentialOAuth() {
  return useMutation<
    OAuthStartResult,
    unknown,
    { harnessId: string; key: string; body: StartOAuthRequest }
  >({
    mutationFn: ({ harnessId, key, body }) =>
      startCredentialOAuth(api, harnessId, key, body),
  });
}

export function useSubmitCredentialOAuthCode() {
  return useMutation<
    { accepted: boolean },
    unknown,
    { harnessId: string; key: string; body: SubmitOAuthCodeRequest }
  >({
    mutationFn: ({ harnessId, key, body }) =>
      submitCredentialOAuthCode(api, harnessId, key, body),
  });
}

export function useCredentialOAuthStatus(
  params: { harnessId: string; key: string; sessionId: string },
  options: { enabled: boolean; intervalMs?: number },
) {
  return useQuery<OAuthSessionStatus>({
    queryKey: queryKeys.harnessCredentials.oauthSession(
      params.harnessId,
      params.key,
      params.sessionId,
    ),
    queryFn: () =>
      getCredentialOAuthStatus(
        api,
        params.harnessId,
        params.key,
        params.sessionId,
      ),
    enabled: options.enabled && !!params.sessionId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && status !== "pending") {
        return false;
      }
      return options.intervalMs ?? DEFAULT_OAUTH_POLL_INTERVAL_MS;
    },
  });
}
