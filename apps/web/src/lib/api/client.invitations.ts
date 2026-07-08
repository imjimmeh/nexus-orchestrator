import type { ApiClient } from "./client";
import type {
  AcceptInvitationDto,
  AcceptInvitationResult,
  ApiClientInvitationMethods,
  CreateInvitationDto,
  CreateInvitationResult,
  Invitation,
} from "./client.invitations.types";

export type { ApiClientInvitationMethods };

export const invitationApiMethods: ApiClientInvitationMethods = {
  async createInvitation(
    this: ApiClient,
    scopeNodeId: string,
    dto: CreateInvitationDto,
  ): Promise<CreateInvitationResult> {
    return this.post<CreateInvitationResult>(
      `/scopes/${scopeNodeId}/invitations`,
      dto,
    );
  },

  async getInvitations(
    this: ApiClient,
    scopeNodeId: string,
  ): Promise<Invitation[]> {
    return this.get<Invitation[]>(`/scopes/${scopeNodeId}/invitations`);
  },

  async revokeInvitation(this: ApiClient, id: string): Promise<void> {
    return this.delete<void>(`/invitations/${id}`);
  },

  async acceptInvitation(
    this: ApiClient,
    dto: AcceptInvitationDto,
  ): Promise<AcceptInvitationResult> {
    return this.post<AcceptInvitationResult>("/invitations/accept", dto);
  },
};
