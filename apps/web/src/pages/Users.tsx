import * as React from "react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserResponse,
  CreateUserRequest,
  UpdateUserRequest,
} from "@nexus/core";
import { usersApi, GetUsersParams } from "@/lib/api/users";
import { useAuth } from "@/hooks/useAuth";
import {
  EditUserDialog,
  DeleteUserDialog,
  ResetPasswordDialog,
  UsersAccessDenied,
} from "./UsersDialogs";
import { UsersTableSection } from "./UsersTableSection";
import type { UserFormData } from "./users.types";
import { ScopeMembersPanel } from "@/components/scope/ScopeMembersPanel";
import { useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";

const QUERY_KEY = "users";
const ITEMS_PER_PAGE = 10;

function getInitialFormData(): UserFormData {
  return {
    username: "",
    email: "",
    password: "",
    role: "user",
    isActive: true,
  };
}

function buildUsersParams(params: {
  page: number;
  search: string;
  roleFilter: "all" | "admin" | "user";
  statusFilter: "all" | "active" | "inactive";
}): GetUsersParams {
  const { page, search, roleFilter, statusFilter } = params;

  return {
    page,
    limit: ITEMS_PER_PAGE,
    ...(search && { search }),
    ...(roleFilter !== "all" && { role: roleFilter }),
    ...(statusFilter !== "all" && { isActive: statusFilter === "active" }),
  };
}

function buildUpdateUserRequest(
  formData: UserFormData,
  selectedUser: UserResponse,
): UpdateUserRequest {
  const updateData: UpdateUserRequest = {};

  if (formData.username !== selectedUser.username) {
    updateData.username = formData.username;
  }

  if (formData.email !== selectedUser.email) {
    updateData.email = formData.email;
  }

  if (formData.role !== selectedUser.roles[0]) {
    updateData.role = formData.role;
  }

  if (formData.isActive !== selectedUser.isActive) {
    updateData.isActive = formData.isActive;
  }

  return updateData;
}

function openUserEditDialog(params: {
  user: UserResponse;
  setSelectedUser: (user: UserResponse | null) => void;
  setFormData: (data: UserFormData) => void;
  setIsEditDialogOpen: (open: boolean) => void;
}) {
  const { user, setSelectedUser, setFormData, setIsEditDialogOpen } = params;
  setSelectedUser(user);
  setFormData({
    username: user.username,
    email: user.email,
    role: user.roles[0] || "user",
    isActive: user.isActive,
  });
  setIsEditDialogOpen(true);
}

function openUserDeleteDialog(
  user: UserResponse,
  setSelectedUser: (user: UserResponse | null) => void,
  setIsDeleteDialogOpen: (open: boolean) => void,
) {
  setSelectedUser(user);
  setIsDeleteDialogOpen(true);
}

function openUserResetPasswordDialog(
  user: UserResponse,
  setSelectedUser: (user: UserResponse | null) => void,
  setNewPassword: (password: string) => void,
  setIsResetPasswordDialogOpen: (open: boolean) => void,
) {
  setSelectedUser(user);
  setNewPassword("");
  setIsResetPasswordDialogOpen(true);
}

interface UsersDialogSectionProps {
  isEditDialogOpen: boolean;
  isDeleteDialogOpen: boolean;
  isResetPasswordDialogOpen: boolean;
  selectedUser: UserResponse | null;
  formData: UserFormData;
  newPassword: string;
  isSaving: boolean;
  isDeleting: boolean;
  isResetting: boolean;
  onEditOpenChange: (open: boolean) => void;
  onDeleteOpenChange: (open: boolean) => void;
  onResetOpenChange: (open: boolean) => void;
  onSubmitEdit: (event: React.SyntheticEvent) => void;
  onDelete: () => void;
  onSubmitResetPassword: (event: React.SyntheticEvent) => void;
  onFormDataChange: (next: UserFormData) => void;
  onPasswordChange: (password: string) => void;
}

function UsersDialogSection({
  isEditDialogOpen,
  isDeleteDialogOpen,
  isResetPasswordDialogOpen,
  selectedUser,
  formData,
  newPassword,
  isSaving,
  isDeleting,
  isResetting,
  onEditOpenChange,
  onDeleteOpenChange,
  onResetOpenChange,
  onSubmitEdit,
  onDelete,
  onSubmitResetPassword,
  onFormDataChange,
  onPasswordChange,
}: Readonly<UsersDialogSectionProps>) {
  return (
    <>
      <EditUserDialog
        open={isEditDialogOpen}
        onOpenChange={onEditOpenChange}
        selectedUser={selectedUser}
        formData={formData}
        isSaving={isSaving}
        onSubmit={onSubmitEdit}
        onFormDataChange={onFormDataChange}
      />

      <DeleteUserDialog
        open={isDeleteDialogOpen}
        onOpenChange={onDeleteOpenChange}
        selectedUser={selectedUser}
        isDeleting={isDeleting}
        onDelete={onDelete}
      />

      <ResetPasswordDialog
        open={isResetPasswordDialogOpen}
        onOpenChange={onResetOpenChange}
        selectedUser={selectedUser}
        newPassword={newPassword}
        isResetting={isResetting}
        onSubmit={onSubmitResetPassword}
        onPasswordChange={onPasswordChange}
      />
    </>
  );
}

function useUsersMutations(params: {
  queryClient: ReturnType<typeof useQueryClient>;
  projectQueryKey: string;
  formData: UserFormData;
  selectedUser: UserResponse | null;
  newPassword: string;
  setIsCreateDialogOpen: (open: boolean) => void;
  setIsEditDialogOpen: (open: boolean) => void;
  setIsDeleteDialogOpen: (open: boolean) => void;
  setIsResetPasswordDialogOpen: (open: boolean) => void;
  setSelectedUser: (user: UserResponse | null) => void;
  setFormData: (data: UserFormData) => void;
  setNewPassword: (value: string) => void;
}) {
  const {
    queryClient,
    projectQueryKey,
    formData,
    selectedUser,
    newPassword,
    setIsCreateDialogOpen,
    setIsEditDialogOpen,
    setIsDeleteDialogOpen,
    setIsResetPasswordDialogOpen,
    setSelectedUser,
    setFormData,
    setNewPassword,
  } = params;

  const createUserMutation = useMutation({
    mutationFn: (data: CreateUserRequest) => usersApi.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [projectQueryKey] });
      setIsCreateDialogOpen(false);
      setFormData(getInitialFormData());
    },
  });
  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserRequest }) =>
      usersApi.updateUser(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [projectQueryKey] });
      setIsEditDialogOpen(false);
      setSelectedUser(null);
    },
  });
  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => usersApi.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [projectQueryKey] });
      setIsDeleteDialogOpen(false);
      setSelectedUser(null);
    },
  });
  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      usersApi.resetPassword(id, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [projectQueryKey] });
      setIsResetPasswordDialogOpen(false);
      setSelectedUser(null);
      setNewPassword("");
    },
  });

  const handleCreateSubmit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!formData.password) {
      return;
    }

    createUserMutation.mutate({
      username: formData.username,
      email: formData.email,
      password: formData.password,
      role: formData.role,
      isActive: formData.isActive,
    });
  };

  const handleEditSubmit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!selectedUser) {
      return;
    }

    const updateData = buildUpdateUserRequest(formData, selectedUser);
    if (Object.keys(updateData).length === 0) {
      setIsEditDialogOpen(false);
      setSelectedUser(null);
      return;
    }

    updateUserMutation.mutate({ id: selectedUser.id, data: updateData });
  };

  const handleDelete = () => {
    if (!selectedUser) {
      return;
    }
    deleteUserMutation.mutate(selectedUser.id);
  };

  const handleResetPassword = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!selectedUser || !newPassword) {
      return;
    }

    resetPasswordMutation.mutate({
      id: selectedUser.id,
      password: newPassword,
    });
  };

  return {
    createUserMutation,
    updateUserMutation,
    deleteUserMutation,
    resetPasswordMutation,
    handleCreateSubmit,
    handleEditSubmit,
    handleDelete,
    handleResetPassword,
  };
}

export function Users() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "user">("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isResetPasswordDialogOpen, setIsResetPasswordDialogOpen] =
    useState(false);
  const [selectedUser, setSelectedUser] = useState<UserResponse | null>(null);
  const [formData, setFormData] = useState<UserFormData>(getInitialFormData());
  const [newPassword, setNewPassword] = useState("");

  const { activeScopeNodeId } = useScopeContext();
  const isGlobalScope = activeScopeNodeId === GLOBAL_SCOPE_NODE_ID;

  const params = buildUsersParams({ page, search, roleFilter, statusFilter });
  const { data: usersData, isLoading } = useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => usersApi.getUsers(params),
    enabled: isAdmin() && isGlobalScope,
  });

  const {
    createUserMutation,
    updateUserMutation,
    deleteUserMutation,
    resetPasswordMutation,
    handleCreateSubmit,
    handleEditSubmit,
    handleDelete,
    handleResetPassword,
  } = useUsersMutations({
    queryClient,
    projectQueryKey: QUERY_KEY,
    formData,
    selectedUser,
    newPassword,
    setIsCreateDialogOpen,
    setIsEditDialogOpen,
    setIsDeleteDialogOpen,
    setIsResetPasswordDialogOpen,
    setSelectedUser,
    setFormData,
    setNewPassword,
  });
  const openEditDialog = (user: UserResponse) =>
    openUserEditDialog({
      user,
      setSelectedUser,
      setFormData,
      setIsEditDialogOpen,
    });
  const openDeleteDialog = (user: UserResponse) => {
    openUserDeleteDialog(user, setSelectedUser, setIsDeleteDialogOpen);
  };
  const openResetPasswordDialog = (user: UserResponse) => {
    openUserResetPasswordDialog(
      user,
      setSelectedUser,
      setNewPassword,
      setIsResetPasswordDialogOpen,
    );
  };
  const toggleUserStatus = (user: UserResponse) => {
    updateUserMutation.mutate({
      id: user.id,
      data: { isActive: !user.isActive },
    });
  };
  if (!isAdmin()) {
    return <UsersAccessDenied isAdmin={false} />;
  }
  const users = usersData?.data || [];
  const meta = usersData?.meta;
  if (!isGlobalScope) {
    return (
      <div className="space-y-6">
        <ScopeMembersPanel scopeNodeId={activeScopeNodeId} />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <UsersTableSection
        users={users}
        isLoading={isLoading}
        page={page}
        search={search}
        roleFilter={roleFilter}
        statusFilter={statusFilter}
        isCreateDialogOpen={isCreateDialogOpen}
        formData={formData}
        createPending={createUserMutation.isPending}
        meta={meta}
        onPageChange={setPage}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        onRoleFilterChange={(value) => {
          setRoleFilter(value);
          setPage(1);
        }}
        onStatusFilterChange={(value) => {
          setStatusFilter(value);
          setPage(1);
        }}
        onCreateDialogOpenChange={setIsCreateDialogOpen}
        onFormDataChange={setFormData}
        onCreateSubmit={handleCreateSubmit}
        onOpenEdit={openEditDialog}
        onOpenDelete={openDeleteDialog}
        onOpenResetPassword={openResetPasswordDialog}
        onToggleStatus={toggleUserStatus}
      />
      <UsersDialogSection
        isEditDialogOpen={isEditDialogOpen}
        isDeleteDialogOpen={isDeleteDialogOpen}
        isResetPasswordDialogOpen={isResetPasswordDialogOpen}
        selectedUser={selectedUser}
        formData={formData}
        newPassword={newPassword}
        isSaving={updateUserMutation.isPending}
        isDeleting={deleteUserMutation.isPending}
        isResetting={resetPasswordMutation.isPending}
        onEditOpenChange={setIsEditDialogOpen}
        onDeleteOpenChange={setIsDeleteDialogOpen}
        onResetOpenChange={setIsResetPasswordDialogOpen}
        onSubmitEdit={handleEditSubmit}
        onDelete={handleDelete}
        onSubmitResetPassword={handleResetPassword}
        onFormDataChange={setFormData}
        onPasswordChange={setNewPassword}
      />
    </div>
  );
}
