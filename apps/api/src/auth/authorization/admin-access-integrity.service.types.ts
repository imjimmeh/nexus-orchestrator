/** A legacy (user_roles) grant that lacks the expected root-scoped role_assignment. */
export interface OrphanedLegacyRole {
  userId: string;
  roleId: string;
}
