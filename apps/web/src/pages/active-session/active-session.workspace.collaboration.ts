import { useEffect, useMemo, useState } from "react";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { useAgentProfiles } from "@/hooks/useAgentProfiles";
import {
  useChatSessionParticipants,
  useChatSessionState,
  useInviteChatSessionParticipant,
} from "@/hooks/useChatSessions";
import { ChatSessionParticipantRole } from "@/lib/api/chat-sessions.types";

type InviteCandidate = {
  name: string;
  tierPreference: string | null;
};

function useInviteSelection(params: {
  isChatSession: boolean;
  chatSessionIdParam: string | undefined;
  inviteCandidates: InviteCandidate[];
  invitePending: boolean;
  onInvite: (
    payload: {
      agent_profile: string;
      role: ChatSessionParticipantRole;
    },
    onAccepted: () => void,
  ) => void;
}) {
  const [inviteAgentProfile, setInviteAgentProfile] = useState("");
  const [inviteRole, setInviteRole] =
    useState<ChatSessionParticipantRole>("participant");

  useEffect(() => {
    if (!inviteAgentProfile) {
      return;
    }

    const stillAvailable = params.inviteCandidates.some(
      (candidate) => candidate.name === inviteAgentProfile,
    );
    if (!stillAvailable) {
      setInviteAgentProfile("");
    }
  }, [inviteAgentProfile, params.inviteCandidates]);

  const onInviteParticipant = () => {
    if (!params.isChatSession || !params.chatSessionIdParam) {
      return;
    }

    const targetProfile = inviteAgentProfile.trim();
    if (!targetProfile || params.invitePending) {
      return;
    }

    params.onInvite(
      {
        agent_profile: targetProfile,
        role: inviteRole,
      },
      () => {
        setInviteAgentProfile("");
        setInviteRole("participant");
      },
    );
  };

  return {
    inviteAgentProfile,
    inviteRole,
    setInviteAgentProfile,
    setInviteRole,
    onInviteParticipant,
  };
}

function resolveChatCollaborationErrors(params: {
  chatParticipantsError: unknown;
  chatSessionStateError: unknown;
  inviteError: unknown;
}) {
  return {
    chatParticipantsError: params.chatParticipantsError
      ? getApiErrorMessage(
          params.chatParticipantsError,
          "Unable to load participants.",
        )
      : null,
    chatSessionStateError: params.chatSessionStateError
      ? getApiErrorMessage(
          params.chatSessionStateError,
          "Unable to load chat collaboration state.",
        )
      : null,
    inviteError: params.inviteError
      ? getApiErrorMessage(params.inviteError, "Unable to invite participant.")
      : null,
  };
}

export function useChatCollaborationState(params: {
  isChatSession: boolean;
  chatSessionIdParam: string | undefined;
}) {
  const { data: agentProfiles = [] } = useAgentProfiles();
  const {
    data: chatParticipants = [],
    isLoading: chatParticipantsLoading,
    error: chatParticipantsError,
  } = useChatSessionParticipants(
    params.isChatSession ? params.chatSessionIdParam : undefined,
  );
  const {
    data: chatSessionState,
    isLoading: chatSessionStateLoading,
    error: chatSessionStateError,
  } = useChatSessionState(
    params.isChatSession ? params.chatSessionIdParam : undefined,
  );
  const inviteParticipantMutation = useInviteChatSessionParticipant(
    params.isChatSession ? params.chatSessionIdParam : undefined,
  );

  const participantRoster = chatSessionState?.participants ?? chatParticipants;
  const inviteCandidates = useMemo(() => {
    if (!params.isChatSession) {
      return [] as InviteCandidate[];
    }

    const currentParticipantNames = new Set(
      participantRoster.map((participant) =>
        participant.agentProfile.toLowerCase(),
      ),
    );

    return agentProfiles
      .filter(
        (profile) =>
          profile.is_active &&
          !currentParticipantNames.has(profile.name.toLowerCase()),
      )
      .map((profile) => ({
        name: profile.name,
        tierPreference: profile.tier_preference ?? null,
      }));
  }, [agentProfiles, params.isChatSession, participantRoster]);

  const inviteSelection = useInviteSelection({
    isChatSession: params.isChatSession,
    chatSessionIdParam: params.chatSessionIdParam,
    inviteCandidates,
    invitePending: inviteParticipantMutation.isPending,
    onInvite: (payload, onAccepted) => {
      inviteParticipantMutation.mutate(payload, {
        onSuccess: (result) => {
          if (result.status === "accepted") {
            onAccepted();
          }
        },
      });
    },
  });

  const errors = resolveChatCollaborationErrors({
    chatParticipantsError,
    chatSessionStateError,
    inviteError: inviteParticipantMutation.error,
  });

  return {
    chatSessionState,
    participantRoster,
    chatParticipantsLoading,
    chatParticipantsError: errors.chatParticipantsError,
    chatSessionStateLoading,
    chatSessionStateError: errors.chatSessionStateError,
    inviteCandidates,
    inviteAgentProfile: inviteSelection.inviteAgentProfile,
    inviteRole: inviteSelection.inviteRole,
    invitePending: inviteParticipantMutation.isPending,
    inviteError: errors.inviteError,
    inviteDenialReason: inviteParticipantMutation.data?.denialReason ?? null,
    onInviteAgentProfileChange: inviteSelection.setInviteAgentProfile,
    onInviteRoleChange: inviteSelection.setInviteRole,
    onInviteParticipant: inviteSelection.onInviteParticipant,
  };
}
