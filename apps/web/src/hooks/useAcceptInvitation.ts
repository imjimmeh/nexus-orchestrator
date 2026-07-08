// apps/web/src/hooks/useAcceptInvitation.ts
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { AcceptInvitationDto } from "@/lib/api/client.invitations.types";

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: (dto: AcceptInvitationDto) => api.acceptInvitation(dto),
  });
}
