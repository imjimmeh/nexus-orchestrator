export enum InvitationStatus {
  Pending = 'pending',
  Accepted = 'accepted',
  Revoked = 'revoked',
  Expired = 'expired',
}

export const INVITATION_STATUS_VALUES = [
  'pending',
  'accepted',
  'revoked',
  'expired',
] as const;
