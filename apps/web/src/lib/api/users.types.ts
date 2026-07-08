export interface GetUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: "admin" | "user";
  isActive?: boolean;
}

export interface ResetPasswordRequest {
  newPassword: string;
}
