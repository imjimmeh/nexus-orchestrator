import type * as React from "react";
import { Link } from "react-router-dom";
import type { UserResponse } from "@nexus/core";
import type { UserFormData } from "./users.types";
import { Button } from "@/components/ui/button";
import { UsersCreateDialog, UsersTableCard } from "./UsersTableSectionParts";

interface UsersTableSectionProps {
  users: UserResponse[];
  isLoading: boolean;
  page: number;
  search: string;
  roleFilter: "all" | "admin" | "user";
  statusFilter: "all" | "active" | "inactive";
  isCreateDialogOpen: boolean;
  formData: UserFormData;
  createPending: boolean;
  meta?: {
    total: number;
    totalPages: number;
  };
  onPageChange: (nextPage: number) => void;
  onSearchChange: (value: string) => void;
  onRoleFilterChange: (value: "all" | "admin" | "user") => void;
  onStatusFilterChange: (value: "all" | "active" | "inactive") => void;
  onCreateDialogOpenChange: (open: boolean) => void;
  onFormDataChange: (next: UserFormData) => void;
  onCreateSubmit: (event: React.SyntheticEvent) => void;
  onOpenEdit: (user: UserResponse) => void;
  onOpenDelete: (user: UserResponse) => void;
  onOpenResetPassword: (user: UserResponse) => void;
  onToggleStatus: (user: UserResponse) => void;
}

export function UsersTableSection({
  users,
  isLoading,
  page,
  search,
  roleFilter,
  statusFilter,
  isCreateDialogOpen,
  formData,
  createPending,
  meta,
  onPageChange,
  onSearchChange,
  onRoleFilterChange,
  onStatusFilterChange,
  onCreateDialogOpenChange,
  onFormDataChange,
  onCreateSubmit,
  onOpenEdit,
  onOpenDelete,
  onOpenResetPassword,
  onToggleStatus,
}: Readonly<UsersTableSectionProps>) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Users</h2>
          <p className="text-muted-foreground">
            Manage system users and their permissions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/memory">Memory Explorer</Link>
          </Button>
          <UsersCreateDialog
            open={isCreateDialogOpen}
            formData={formData}
            createPending={createPending}
            onOpenChange={onCreateDialogOpenChange}
            onFormDataChange={onFormDataChange}
            onSubmit={onCreateSubmit}
          />
        </div>
      </div>

      <UsersTableCard
        users={users}
        isLoading={isLoading}
        page={page}
        search={search}
        roleFilter={roleFilter}
        statusFilter={statusFilter}
        meta={meta}
        onPageChange={onPageChange}
        onSearchChange={onSearchChange}
        onRoleFilterChange={onRoleFilterChange}
        onStatusFilterChange={onStatusFilterChange}
        onOpenEdit={onOpenEdit}
        onOpenDelete={onOpenDelete}
        onOpenResetPassword={onOpenResetPassword}
        onToggleStatus={onToggleStatus}
      />
    </>
  );
}
