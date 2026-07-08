import { useState } from "react";
import { ProjectWarRoomMessageKind, ProjectWarRoomParticipantRole, ProjectWarRoomResolutionType } from "@/lib/api/orchestration.types";
import type {
  WarRoomActionNotice,
  WarRoomManagerState,
} from "./WarRoomSessionManagerPanel.hooks";

export function useWarRoomManagerState(): WarRoomManagerState {
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [openSessionId, setOpenSessionId] = useState("");
  const [openInitialMessage, setOpenInitialMessage] = useState("");
  const [inviteAgentProfile, setInviteAgentProfile] = useState("");
  const [inviteRole, setInviteRole] =
    useState<ProjectWarRoomParticipantRole>("architect");
  const [messageKind, setMessageKind] =
    useState<ProjectWarRoomMessageKind>("proposal");
  const [messageBody, setMessageBody] = useState("");
  const [closeResolutionType, setCloseResolutionType] =
    useState<ProjectWarRoomResolutionType>("manual");
  const [closeNote, setCloseNote] = useState("");
  const [notice, setNotice] = useState<WarRoomActionNotice | null>(null);
  return {
    selectedSessionId,
    setSelectedSessionId,
    openSessionId,
    setOpenSessionId,
    openInitialMessage,
    setOpenInitialMessage,
    inviteAgentProfile,
    setInviteAgentProfile,
    inviteRole,
    setInviteRole,
    messageKind,
    setMessageKind,
    messageBody,
    setMessageBody,
    closeResolutionType,
    setCloseResolutionType,
    closeNote,
    setCloseNote,
    notice,
    setNotice,
  };
}
