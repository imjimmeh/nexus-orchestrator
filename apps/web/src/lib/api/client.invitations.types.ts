export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Invitation {
  id: string;
  scopeNodeId: string;
  roleId: string;
  roleName?: string;
  email: string | null;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

export interface CreateInvitationDto {
  roleId: string;
  email?: string;
}

export interface CreateInvitationResult {
  invitation: Invitation;
  inviteToken: string;
}

export interface AcceptInvitationDto {
  token: string;
  username?: string;
  password?: string;
}

export interface AcceptInvitationResult {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

export interface ApiClientInvitationMethods {
  createInvitation(
    this: import("./client").ApiClient,
    scopeNodeId: string,
    dto: CreateInvitationDto,
  ): Promise<CreateInvitationResult>;
  getInvitations(
    this: import("./client").ApiClient,
    scopeNodeId: string,
  ): Promise<Invitation[]>;
  revokeInvitation(
    this: import("./client").ApiClient,
    id: string,
  ): Promise<void>;
  acceptInvitation(
    this: import("./client").ApiClient,
    dto: AcceptInvitationDto,
  ): Promise<AcceptInvitationResult>;
}
