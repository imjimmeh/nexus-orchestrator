import {
  CreateUserRequest,
  CreateUserResponse,
  UpdateUserRequest,
  UpdateUserResponse,
  UserResponse,
  UserListResponse,
} from "@nexus/core";
import { api } from "./client";
import type { GetUsersParams } from "./users.types";

export type { GetUsersParams, ResetPasswordRequest } from "./users.types";

export async function getUsers(
  params?: GetUsersParams,
): Promise<UserListResponse> {
  return api.get<UserListResponse>("/users", {
    params: params as Record<string, unknown> | undefined,
  });
}

export async function getUser(id: string): Promise<UserResponse> {
  return api.get<UserResponse>(`/users/${id}`);
}

export async function createUser(
  data: CreateUserRequest,
): Promise<CreateUserResponse> {
  return api.post<CreateUserResponse>("/users", data);
}

export async function updateUser(
  id: string,
  data: UpdateUserRequest,
): Promise<UpdateUserResponse> {
  return api.patch<UpdateUserResponse>(`/users/${id}`, data);
}

export async function deleteUser(id: string): Promise<void> {
  return api.delete<void>(`/users/${id}`);
}

export async function resetPassword(
  id: string,
  newPassword: string,
): Promise<{ success: true; message: string }> {
  return api.post<{ success: true; message: string }>(
    `/users/${id}/reset-password`,
    {
      newPassword,
    },
  );
}

export const usersApi = {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  resetPassword,
};
